use serde::Serialize;
use std::net::UdpSocket;

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

#[tauri::command]
fn get_local_status() -> DesktopStatus {
    let lan_ip = detect_lan_ip();

    DesktopStatus {
        api_base_url: "http://localhost:3000".into(),
        web_url: "http://localhost:5173".into(),
        lan_api_base_url: lan_ip
            .as_ref()
            .map(|ip| format!("http://{}:3000", ip)),
        lan_web_url: lan_ip.map(|ip| format!("http://{}:5173", ip)),
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
