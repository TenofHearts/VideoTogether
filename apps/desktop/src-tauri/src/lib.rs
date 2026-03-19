/*
Copyright Jin Ye

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

#[cfg(not(debug_assertions))]
use serde::Deserialize;
use serde::Serialize;
use url::Url;

#[cfg(not(debug_assertions))]
use std::{
    collections::HashMap,
    env,
    fs::{create_dir_all, read_to_string, write},
    io::{Error, ErrorKind, Read, Result as IoResult, Write},
    net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command},
    sync::Mutex,
    thread::sleep,
    time::{Duration, Instant},
};

#[cfg(target_os = "windows")]
#[cfg(not(debug_assertions))]
use std::os::windows::process::CommandExt;

#[cfg(not(debug_assertions))]
use tauri::{Manager, RunEvent, Runtime};

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

#[cfg(not(debug_assertions))]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseDatabaseStatus {
    path: String,
}

#[cfg(not(debug_assertions))]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseStorageStatus {
    media_dir: String,
    hls_dir: String,
    subtitle_dir: String,
    temp_dir: String,
}

#[cfg(not(debug_assertions))]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseSystemStatus {
    database: ReleaseDatabaseStatus,
    storage: ReleaseStorageStatus,
}

#[cfg(not(debug_assertions))]
const DEFAULT_ENV_TEMPLATE: &str = include_str!("../../../../.env.example");
#[cfg(not(debug_assertions))]
const RUNTIME_ENV_OVERRIDE_FILE_NAME: &str = ".env";
#[cfg(not(debug_assertions))]
const RUNTIME_ENV_TEMPLATE_FILE_NAME: &str = ".env.example";

#[cfg(not(debug_assertions))]
fn default_release_env_template() -> String {
    DEFAULT_ENV_TEMPLATE
        .replace("NODE_ENV=development", "NODE_ENV=production")
        .replace("PORT=3003", "PORT=3000")
        .replace(
            "WEB_URL=http://localhost:5173",
            "WEB_URL=http://localhost:3000",
        )
}

const DEFAULT_SERVER_PORT: &str = "3000";
#[cfg(debug_assertions)]
const DEFAULT_WEB_DEV_PORT: &str = "5173";

fn build_local_url(protocol: &str, host: &str, port: &str) -> String {
    format!("{protocol}://{host}:{port}")
}

#[cfg(debug_assertions)]
fn parse_workspace_env_file(contents: &str) -> std::collections::HashMap<String, String> {
    contents
        .lines()
        .filter_map(|line| {
            let line = line.trim();

            if line.is_empty() || line.starts_with('#') {
                return None;
            }

            let (key, value) = line.split_once('=')?;
            let key = key.trim();

            if key.is_empty() {
                return None;
            }

            let value = value.trim().trim_matches('"').trim_matches('\'');
            Some((key.to_string(), value.to_string()))
        })
        .collect()
}

#[cfg(debug_assertions)]
fn find_workspace_root(start_directory: &std::path::Path) -> Option<std::path::PathBuf> {
    let mut candidate = start_directory.to_path_buf();

    loop {
        if candidate.join("apps").join("server").join("package.json").is_file()
            && candidate.join("apps").join("web").join("package.json").is_file()
        {
            return Some(candidate);
        }

        if !candidate.pop() {
            return None;
        }
    }
}

#[cfg(debug_assertions)]
fn read_workspace_env_file() -> std::collections::HashMap<String, String> {
    let Ok(current_directory) = std::env::current_dir() else {
        return std::collections::HashMap::new();
    };

    let Some(workspace_root) = find_workspace_root(&current_directory) else {
        return std::collections::HashMap::new();
    };

    for file_name in [".env", ".env.example"] {
        let candidate = workspace_root.join(file_name);

        if !candidate.is_file() {
            continue;
        }

        let Ok(contents) = std::fs::read_to_string(candidate) else {
            continue;
        };

        return parse_workspace_env_file(&contents);
    }

    std::collections::HashMap::new()
}

#[cfg(debug_assertions)]
fn get_workspace_config_value(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| read_workspace_env_file().get(key).cloned())
}

fn get_api_base_url() -> String {
    #[cfg(not(debug_assertions))]
    {
        if let Some(api_base_url) = get_runtime_config_value("API_BASE_URL") {
            return api_base_url;
        }

        if let Some(port) = get_runtime_config_value("PORT") {
            return build_local_url("http", "localhost", &port);
        }

        return std::env::var("API_BASE_URL")
            .unwrap_or_else(|_| build_local_url("http", "localhost", DEFAULT_SERVER_PORT));
    }

    #[cfg(debug_assertions)]
    {
        if let Some(api_base_url) = get_workspace_config_value("API_BASE_URL") {
            return api_base_url;
        }

        let port = get_workspace_config_value("PORT")
            .unwrap_or_else(|| DEFAULT_SERVER_PORT.to_string());
        return build_local_url("http", "localhost", &port);
    }
}

fn get_configured_web_url() -> String {
    #[cfg(not(debug_assertions))]
    {
        if let Some(web_url) = get_runtime_config_value("WEB_URL")
            .or_else(|| get_runtime_config_value("WEB_ORIGIN"))
        {
            return web_url;
        }

        if let Some(public_base_url) = get_runtime_config_value("PUBLIC_BASE_URL") {
            return public_base_url;
        }

        return std::env::var("WEB_URL")
            .or_else(|_| std::env::var("WEB_ORIGIN"))
            .or_else(|_| std::env::var("PUBLIC_BASE_URL"))
            .unwrap_or_else(|_| build_local_url("http", "localhost", DEFAULT_SERVER_PORT));
    }

    #[cfg(debug_assertions)]
    {
        if let Some(web_url) = get_workspace_config_value("WEB_URL")
            .or_else(|| get_workspace_config_value("WEB_ORIGIN"))
        {
            return web_url;
        }

        let node_env =
            get_workspace_config_value("NODE_ENV").unwrap_or_else(|| "development".to_string());

        if node_env.eq_ignore_ascii_case("production") {
            if let Some(public_base_url) = get_workspace_config_value("PUBLIC_BASE_URL") {
                return public_base_url;
            }
        }

        let protocol = get_workspace_config_value("PUBLIC_PROTOCOL")
            .or_else(|| get_workspace_config_value("APP_PROTOCOL"))
            .unwrap_or_else(|| "http".to_string());
        let host = get_workspace_config_value("PUBLIC_HOST")
            .or_else(|| get_workspace_config_value("APP_HOST"))
            .unwrap_or_else(|| "localhost".to_string());
        let port = get_workspace_config_value("WEB_DEV_PORT")
            .unwrap_or_else(|| DEFAULT_WEB_DEV_PORT.to_string());

        return build_local_url(&protocol, &host, &port);
    }
}

fn get_lan_ip() -> Option<String> {
    #[cfg(not(debug_assertions))]
    if let Some(lan_ip) = get_runtime_config_value("LAN_IP") {
        return Some(lan_ip);
    }

    #[cfg(debug_assertions)]
    if let Some(lan_ip) = get_workspace_config_value("LAN_IP") {
        return Some(lan_ip);
    }

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

#[cfg(not(debug_assertions))]
const SERVER_HOST: &str = "0.0.0.0";
#[cfg(not(debug_assertions))]
const SERVER_PORT: &str = "3000";
#[cfg(not(debug_assertions))]
const SERVER_SIDECAR_NAME: &str = "server";
#[cfg(not(debug_assertions))]
const FFMPEG_SIDECAR_NAME: &str = "ffmpeg";
#[cfg(not(debug_assertions))]
const FFPROBE_SIDECAR_NAME: &str = "ffprobe";
#[cfg(target_os = "windows")]
#[cfg(not(debug_assertions))]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(not(debug_assertions))]
const SERVER_READY_TIMEOUT: Duration = Duration::from_secs(15);
#[cfg(not(debug_assertions))]
const SERVER_READY_POLL_INTERVAL: Duration = Duration::from_millis(250);
#[cfg(not(debug_assertions))]
const SERVER_REQUEST_TIMEOUT: Duration = Duration::from_millis(500);

#[cfg(not(debug_assertions))]
#[derive(Default)]
struct ReleaseSidecarState {
    server_child: Mutex<Option<Child>>,
}

#[cfg(not(debug_assertions))]
fn sidecar_filename(base_name: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("{base_name}.exe")
    } else {
        base_name.to_string()
    }
}

#[cfg(not(debug_assertions))]
fn parse_env_file(contents: &str) -> HashMap<String, String> {
    contents
        .lines()
        .filter_map(|line| {
            let line = line.trim();

            if line.is_empty() || line.starts_with('#') {
                return None;
            }

            let (key, value) = line.split_once('=')?;
            let key = key.trim();

            if key.is_empty() {
                return None;
            }

            let value = value.trim().trim_matches('"').trim_matches('\'');
            Some((key.to_string(), value.to_string()))
        })
        .collect()
}

#[cfg(not(debug_assertions))]
fn read_env_file(path: &Path) -> HashMap<String, String> {
    let Ok(contents) = read_to_string(path) else {
        return HashMap::new();
    };

    parse_env_file(&contents)
}

#[cfg(not(debug_assertions))]
fn resolve_runtime_env_path() -> Option<PathBuf> {
    if let Ok(path) = env::var("VIDEOSHARE_ENV_FILE") {
        let explicit_path = PathBuf::from(path);

        if explicit_path.is_file() {
            return Some(explicit_path);
        }
    }

    let Ok(runtime_dir) = env::var("VIDEOSHARE_RUNTIME_DIR") else {
        return None;
    };

    let runtime_dir = PathBuf::from(runtime_dir);

    for file_name in [
        RUNTIME_ENV_OVERRIDE_FILE_NAME,
        RUNTIME_ENV_TEMPLATE_FILE_NAME,
    ] {
        let candidate = runtime_dir.join(file_name);

        if candidate.is_file() {
            return Some(candidate);
        }
    }

    None
}

#[cfg(not(debug_assertions))]
fn read_runtime_env_file() -> HashMap<String, String> {
    resolve_runtime_env_path()
        .map(|path| read_env_file(&path))
        .unwrap_or_default()
}

#[cfg(not(debug_assertions))]
fn get_runtime_config_value(key: &str) -> Option<String> {
    env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| read_runtime_env_file().get(key).cloned())
}

#[cfg(not(debug_assertions))]
fn ensure_runtime_env_file(runtime_dir: &Path) -> IoResult<PathBuf> {
    let env_file_path = runtime_dir.join(RUNTIME_ENV_TEMPLATE_FILE_NAME);

    if !env_file_path.exists() {
        write(&env_file_path, default_release_env_template())?;
    }

    Ok(env_file_path)
}

#[cfg(not(debug_assertions))]
fn get_release_setting(config: &HashMap<String, String>, key: &str) -> Option<String> {
    env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| config.get(key).cloned())
}

#[cfg(not(debug_assertions))]
fn resolve_release_server_port(preferred_port: &str) -> IoResult<String> {
    let preferred_port = preferred_port.parse::<u16>().map_err(|error| {
        Error::new(
            ErrorKind::InvalidInput,
            format!("invalid release server port {preferred_port}: {error}"),
        )
    })?;

    match TcpListener::bind((Ipv4Addr::LOCALHOST, preferred_port)) {
        Ok(listener) => {
            drop(listener);
            Ok(preferred_port.to_string())
        }
        Err(error) if error.kind() == ErrorKind::AddrInUse => {
            let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
            let port = listener.local_addr()?.port();
            drop(listener);
            Ok(port.to_string())
        }
        Err(error) => Err(error),
    }
}

#[cfg(not(debug_assertions))]
fn remap_release_url_port(url: String, preferred_port: &str, actual_port: &str) -> String {
    if preferred_port == actual_port {
        return url;
    }

    let Ok(mut parsed_url) = Url::parse(&url) else {
        return url;
    };

    let Some(host) = parsed_url.host_str() else {
        return url;
    };

    if !is_loopback_host(host) {
        return url;
    }

    let current_port = parsed_url
        .port_or_known_default()
        .map(|value| value.to_string());

    if current_port.as_deref() != Some(preferred_port) {
        return url;
    }

    if parsed_url
        .set_port(Some(actual_port.parse::<u16>().unwrap_or_default()))
        .is_err()
    {
        return url;
    }

    parsed_url.to_string()
}

#[cfg(not(debug_assertions))]
fn read_local_json<T>(server_port: u16, path: &str) -> IoResult<T>
where
    T: for<'de> Deserialize<'de>,
{
    let address = SocketAddr::from((Ipv4Addr::LOCALHOST, server_port));
    let mut stream = TcpStream::connect_timeout(&address, SERVER_REQUEST_TIMEOUT)?;
    stream.set_read_timeout(Some(SERVER_REQUEST_TIMEOUT))?;
    stream.set_write_timeout(Some(SERVER_REQUEST_TIMEOUT))?;

    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{server_port}\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(request.as_bytes())?;

    let mut response = Vec::new();
    stream.read_to_end(&mut response)?;

    let header_end = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or_else(|| Error::new(ErrorKind::InvalidData, "invalid HTTP response"))?;
    let header_text = std::str::from_utf8(&response[..header_end])
        .map_err(|error| Error::new(ErrorKind::InvalidData, error))?;
    let status_line = header_text
        .lines()
        .next()
        .ok_or_else(|| Error::new(ErrorKind::InvalidData, "missing HTTP status line"))?;

    if !status_line.contains(" 200 ") {
        return Err(Error::other(format!(
            "unexpected response from sidecar: {status_line}"
        )));
    }

    serde_json::from_slice(&response[(header_end + 4)..])
        .map_err(|error| Error::new(ErrorKind::InvalidData, error))
}

#[cfg(not(debug_assertions))]
fn wait_for_release_server_ready(
    child: &mut Child,
    server_port: &str,
    database_path: &Path,
    media_dir: &Path,
    hls_dir: &Path,
    subtitle_dir: &Path,
    temp_dir: &Path,
) -> IoResult<()> {
    let port = server_port.parse::<u16>().map_err(|error| {
        Error::new(
            ErrorKind::InvalidInput,
            format!("invalid release server port {server_port}: {error}"),
        )
    })?;
    let deadline = Instant::now() + SERVER_READY_TIMEOUT;
    let expected_database_path = database_path.to_string_lossy().to_string();
    let expected_media_dir = media_dir.to_string_lossy().to_string();
    let expected_hls_dir = hls_dir.to_string_lossy().to_string();
    let expected_subtitle_dir = subtitle_dir.to_string_lossy().to_string();
    let expected_temp_dir = temp_dir.to_string_lossy().to_string();
    let mut last_error = None;

    while Instant::now() < deadline {
        if let Some(status) = child.try_wait()? {
            return Err(Error::other(format!(
                "bundled server sidecar exited during startup with status {status}"
            )));
        }

        match read_local_json::<ReleaseSystemStatus>(port, "/api/system/status") {
            Ok(status)
                if status.database.path == expected_database_path
                    && status.storage.media_dir == expected_media_dir
                    && status.storage.hls_dir == expected_hls_dir
                    && status.storage.subtitle_dir == expected_subtitle_dir
                    && status.storage.temp_dir == expected_temp_dir =>
            {
                return Ok(());
            }
            Ok(status) => {
                last_error = Some(format!(
                    "expected release storage at {} but the active server reports {}",
                    expected_media_dir, status.storage.media_dir
                ));
            }
            Err(error) => {
                last_error = Some(error.to_string());
            }
        }

        sleep(SERVER_READY_POLL_INTERVAL);
    }

    Err(Error::other(format!(
        "bundled server sidecar did not become ready in time: {}",
        last_error.unwrap_or_else(|| "unknown startup failure".to_string())
    )))
}

#[cfg(not(debug_assertions))]
fn resolve_sidecar_path<R: Runtime>(app: &impl Manager<R>, base_name: &str) -> IoResult<PathBuf> {
    let file_name = sidecar_filename(base_name);
    let mut candidates = Vec::new();

    if let Ok(current_exe) = env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            candidates.push(exe_dir.join(&file_name));
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join(&file_name));
    }

    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| {
            Error::new(
                ErrorKind::NotFound,
                format!("missing bundled sidecar: {file_name}"),
            )
        })
}

#[cfg(not(debug_assertions))]
fn resolve_release_runtime_dir<R: Runtime>(app: &impl Manager<R>) -> IoResult<PathBuf> {
    if let Ok(current_exe) = env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            return Ok(exe_dir.to_path_buf());
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        if let Some(runtime_dir) = resource_dir.parent() {
            return Ok(runtime_dir.to_path_buf());
        }

        return Ok(resource_dir);
    }

    Err(Error::new(
        ErrorKind::NotFound,
        "failed to resolve release runtime directory",
    ))
}

#[cfg(not(debug_assertions))]
fn setup_release_server_sidecar<R: Runtime>(app: &mut tauri::App<R>) -> IoResult<()> {
    let runtime_dir = resolve_release_runtime_dir(app)?;
    let storage_dir = runtime_dir.join("storage");
    let media_dir = storage_dir.join("media");
    let hls_dir = storage_dir.join("hls");
    let subtitle_dir = storage_dir.join("subtitles");
    let temp_dir = storage_dir.join("temp");
    let web_dist_dir = storage_dir.join("web-dist");
    let db_dir = storage_dir.join("db");
    let database_path = db_dir.join("app.db");

    for directory in [
        &storage_dir,
        &media_dir,
        &hls_dir,
        &subtitle_dir,
        &temp_dir,
        &web_dist_dir,
        &db_dir,
    ] {
        create_dir_all(directory)?;
    }

    ensure_runtime_env_file(&runtime_dir)?;
    env::set_var("VIDEOSHARE_RUNTIME_DIR", &runtime_dir);

    let release_config = read_runtime_env_file();
    let server_host =
        get_release_setting(&release_config, "HOST").unwrap_or_else(|| SERVER_HOST.to_string());
    let preferred_server_port =
        get_release_setting(&release_config, "PORT").unwrap_or_else(|| SERVER_PORT.to_string());
    let server_port = resolve_release_server_port(&preferred_server_port)?;
    let api_base_url = format!("http://localhost:{server_port}");
    let public_base_url = get_release_setting(&release_config, "PUBLIC_BASE_URL")
        .map(|url| remap_release_url_port(url, &preferred_server_port, &server_port))
        .unwrap_or_else(|| api_base_url.clone());
    let configured_web_url = get_release_setting(&release_config, "WEB_URL")
        .map(|url| remap_release_url_port(url, &preferred_server_port, &server_port))
        .unwrap_or_else(|| public_base_url.clone());
    let web_origin = get_release_setting(&release_config, "WEB_ORIGIN")
        .map(|url| remap_release_url_port(url, &preferred_server_port, &server_port))
        .unwrap_or_else(|| configured_web_url.clone());
    let lan_ip = get_release_setting(&release_config, "LAN_IP");

    env::set_var("HOST", &server_host);
    env::set_var("PORT", &server_port);
    env::set_var("API_BASE_URL", &api_base_url);
    env::set_var("PUBLIC_BASE_URL", &public_base_url);
    env::set_var("WEB_URL", &configured_web_url);
    env::set_var("WEB_ORIGIN", &web_origin);

    if let Some(ref lan_ip) = lan_ip {
        env::set_var("LAN_IP", lan_ip);
    } else {
        env::remove_var("LAN_IP");
    }

    let server_path = resolve_sidecar_path(app, SERVER_SIDECAR_NAME)?;
    let ffmpeg_path = resolve_sidecar_path(app, FFMPEG_SIDECAR_NAME)?;
    let ffprobe_path = resolve_sidecar_path(app, FFPROBE_SIDECAR_NAME)?;

    let mut command = Command::new(&server_path);
    command
        .current_dir(&runtime_dir)
        .env("NODE_ENV", "production")
        .env("HOST", &server_host)
        .env("PORT", &server_port)
        .env("API_BASE_URL", &api_base_url)
        .env("PUBLIC_BASE_URL", &public_base_url)
        .env("WEB_URL", &configured_web_url)
        .env("WEB_ORIGIN", &web_origin)
        .env("DATABASE_URL", &database_path)
        .env("MEDIA_INPUT_DIR", &media_dir)
        .env("HLS_OUTPUT_DIR", &hls_dir)
        .env("SUBTITLE_DIR", &subtitle_dir)
        .env("TEMP_DIR", &temp_dir)
        .env("WEB_DIST_DIR", &web_dist_dir)
        .env("VIDEOSHARE_RUNTIME_DIR", &runtime_dir)
        .env("FFMPEG_PATH", &ffmpeg_path)
        .env("FFPROBE_PATH", &ffprobe_path);

    if let Some(lan_ip) = lan_ip {
        command.env("LAN_IP", lan_ip);
    }

    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);

    let mut child = command.spawn().map_err(|error| {
        Error::new(
            error.kind(),
            format!(
                "failed to start bundled server sidecar at {}: {error}",
                server_path.display()
            ),
        )
    })?;
    if let Err(error) = wait_for_release_server_ready(
        &mut child,
        &server_port,
        &database_path,
        &media_dir,
        &hls_dir,
        &subtitle_dir,
        &temp_dir,
    ) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(error);
    }

    let state = app.state::<ReleaseSidecarState>();
    let mut server_child = state
        .server_child
        .lock()
        .expect("server sidecar mutex poisoned");
    *server_child = Some(child);

    Ok(())
}

#[cfg(not(debug_assertions))]
fn stop_release_server_sidecar<R: Runtime>(app: &tauri::AppHandle<R>) {
    let state = app.state::<ReleaseSidecarState>();
    let mut server_child = state
        .server_child
        .lock()
        .expect("server sidecar mutex poisoned");

    if let Some(child) = server_child.as_mut() {
        let _ = child.kill();
        let _ = child.wait();
    }

    *server_child = None;
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
    #[allow(unused_mut)]
    let mut builder =
        tauri::Builder::default().invoke_handler(tauri::generate_handler![get_local_status]);

    #[cfg(not(debug_assertions))]
    {
        builder = builder.manage(ReleaseSidecarState::default()).setup(|app| {
            setup_release_server_sidecar(app)?;
            Ok(())
        });
    }

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, _event| {
        #[cfg(not(debug_assertions))]
        {
            let app_handle = _app_handle;
            let event = _event;

            if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
                stop_release_server_sidecar(app_handle);
            }
        }
    });
}
