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
    public_web_url: Option<String>,
    lan_api_base_url: Option<String>,
    lan_web_url: Option<String>,
    tauri: &'static str,
}

fn get_api_base_url() -> String {
    std::env::var("API_BASE_URL").unwrap_or_else(|_| "http://localhost:3000".into())
}

fn get_configured_web_url() -> String {
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

fn is_loopback_host(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "::1" | "[::1]")
}

fn rewrite_url_host(url: &str, host: &str) -> Option<String> {
    let mut parsed = Url::parse(url).ok()?;

    if parsed.set_host(Some(host)).is_err() {
        return None;
    }

    Some(parsed.to_string())
}

fn rewrite_url_using_origin(template_url: &str, origin_url: &str) -> Option<String> {
    let mut template = Url::parse(template_url).ok()?;
    let origin = Url::parse(origin_url).ok()?;

    if template.set_scheme(origin.scheme()).is_err() {
        return None;
    }

    if template.set_host(origin.host_str()).is_err() {
        return None;
    }

    if template.set_port(origin.port_or_known_default()).is_err() {
        return None;
    }

    Some(template.to_string())
}

fn resolve_local_web_url(configured_web_url: &str, api_base_url: &str) -> String {
    let Ok(parsed_web_url) = Url::parse(configured_web_url) else {
        return api_base_url.to_string();
    };

    let Some(web_host) = parsed_web_url.host_str() else {
        return api_base_url.to_string();
    };

    if is_loopback_host(web_host) {
        return configured_web_url.to_string();
    }

    rewrite_url_using_origin(configured_web_url, api_base_url)
        .unwrap_or_else(|| api_base_url.to_string())
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
        eprintln!("VideoTogether desktop could not locate repo root; skipping host shutdown.");
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
                "VideoTogether desktop stop-host script exited with status {:?}.",
                result.code()
            );
        }
        Err(error) => {
            eprintln!("VideoTogether desktop failed to run stop-host script: {error}");
        }
    }
}

#[tauri::command]
fn get_local_status() -> DesktopStatus {
    let api_base_url = get_api_base_url();
    let configured_web_url = get_configured_web_url();
    let local_web_url = resolve_local_web_url(&configured_web_url, &api_base_url);
    let lan_ip = get_lan_ip();
    let public_web_url = if configured_web_url != local_web_url {
        Some(configured_web_url.clone())
    } else {
        None
    };

    DesktopStatus {
        api_base_url: api_base_url.clone(),
        web_url: local_web_url.clone(),
        public_web_url,
        lan_api_base_url: lan_ip
            .as_deref()
            .and_then(|ip| rewrite_url_host(&api_base_url, ip)),
        lan_web_url: lan_ip
            .as_deref()
            .and_then(|ip| rewrite_url_host(&local_web_url, ip)),
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
