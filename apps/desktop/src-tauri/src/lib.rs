use std::{
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicBool, Ordering},
};

use serde::Serialize;
use tauri::WindowEvent;
use url::Url;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopStatus {
    api_base_url: String,
    web_url: String,
    lan_api_base_url: Option<String>,
    lan_web_url: Option<String>,
    tauri: &'static str,
}

fn get_api_base_url() -> String {
    std::env::var("API_BASE_URL").unwrap_or_else(|_| "http://localhost:3000".into())
}

fn get_web_url() -> String {
    std::env::var("WEB_URL")
        .or_else(|_| std::env::var("PUBLIC_BASE_URL"))
        .unwrap_or_else(|_| "http://localhost:3000".into())
}

fn get_lan_ip() -> Option<String> {
    std::env::var("LAN_IP")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn rewrite_url_host(url: &str, host: &str) -> Option<String> {
    let mut parsed = Url::parse(url).ok()?;

    if parsed.set_host(Some(host)).is_err() {
        return None;
    }

    Some(parsed.to_string())
}

static HOST_STOP_REQUESTED: AtomicBool = AtomicBool::new(false);

fn has_stop_script(root: &Path) -> bool {
    root.join("infra").join("scripts").join("stop-host.ps1").is_file()
}

fn find_repo_root() -> Option<PathBuf> {
    let mut search_roots = Vec::new();

    if let Ok(current_dir) = std::env::current_dir() {
        search_roots.push(current_dir);
    }

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            search_roots.push(exe_dir.to_path_buf());
        }
    }

    for start in search_roots {
        for ancestor in start.ancestors() {
            if has_stop_script(ancestor) {
                return Some(ancestor.to_path_buf());
            }
        }
    }

    None
}

fn stop_host_server_if_running() {
    if HOST_STOP_REQUESTED.swap(true, Ordering::SeqCst) {
        return;
    }

    let Some(repo_root) = find_repo_root() else {
        eprintln!("VideoShare desktop could not locate repo root; skipping host shutdown.");
        return;
    };

    let stop_script_path = repo_root.join("infra").join("scripts").join("stop-host.ps1");
    let shell = if Command::new("pwsh").arg("-Version").output().is_ok() {
        "pwsh"
    } else {
        "powershell"
    };

    let status = Command::new(shell)
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            stop_script_path.to_string_lossy().as_ref(),
        ])
        .current_dir(repo_root)
        .status();

    match status {
        Ok(result) if result.success() => {}
        Ok(result) => {
            eprintln!(
                "VideoShare desktop stop-host script exited with status {:?}.",
                result.code()
            );
        }
        Err(error) => {
            eprintln!("VideoShare desktop failed to run stop-host script: {error}");
        }
    }
}

#[tauri::command]
fn get_local_status() -> DesktopStatus {
    let api_base_url = get_api_base_url();
    let web_url = get_web_url();
    let lan_ip = get_lan_ip();

    DesktopStatus {
        api_base_url: api_base_url.clone(),
        web_url: web_url.clone(),
        lan_api_base_url: lan_ip
            .as_deref()
            .and_then(|ip| rewrite_url_host(&api_base_url, ip)),
        lan_web_url: lan_ip
            .as_deref()
            .and_then(|ip| rewrite_url_host(&web_url, ip)),
        tauri: "ready",
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_local_status])
        .on_window_event(|_window, event| {
            if matches!(event, WindowEvent::CloseRequested { .. }) {
                stop_host_server_if_running();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
