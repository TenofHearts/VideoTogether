use serde::Serialize;
use std::net::UdpSocket;
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

fn detect_lan_ip() -> Option<String> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let ip = socket.local_addr().ok()?.ip();

    if ip.is_loopback() {
        None
    } else {
        Some(ip.to_string())
    }
}

fn get_web_url() -> String {
    std::env::var("WEB_URL").unwrap_or_else(|_| "http://localhost:5173".into())
}

fn get_lan_web_url(web_url: &str, lan_ip: Option<&str>) -> Option<String> {
    let lan_ip = lan_ip?;
    let mut parsed = Url::parse(web_url).ok()?;

    if parsed.set_host(Some(lan_ip)).is_err() {
        return None;
    }

    Some(parsed.to_string())
}

#[tauri::command]
fn get_local_status() -> DesktopStatus {
    let lan_ip = detect_lan_ip();
    let web_url = get_web_url();

    DesktopStatus {
        api_base_url: "http://localhost:3000".into(),
        web_url: web_url.clone(),
        lan_api_base_url: lan_ip.as_ref().map(|ip| format!("http://{}:3000", ip)),
        lan_web_url: get_lan_web_url(&web_url, lan_ip.as_deref()),
        tauri: "ready",
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_local_status])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
