use serde::Serialize;
use url::Url;

const FIXED_LAN_IP: &str = "10.147.17.22";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopStatus {
    api_base_url: String,
    web_url: String,
    lan_api_base_url: Option<String>,
    lan_web_url: Option<String>,
    tauri: &'static str,
}

fn get_web_url() -> String {
    std::env::var("WEB_URL").unwrap_or_else(|_| "http://localhost:5173".into())
}

fn get_lan_web_url(web_url: &str, lan_ip: &str) -> Option<String> {
    let mut parsed = Url::parse(web_url).ok()?;

    if parsed.set_host(Some(lan_ip)).is_err() {
        return None;
    }

    Some(parsed.to_string())
}

#[tauri::command]
fn get_local_status() -> DesktopStatus {
    let web_url = get_web_url();

    DesktopStatus {
        api_base_url: "http://localhost:3000".into(),
        web_url: web_url.clone(),
        lan_api_base_url: Some(format!("http://{}:3000", FIXED_LAN_IP)),
        lan_web_url: get_lan_web_url(&web_url, FIXED_LAN_IP),
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
