use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopStatus {
    api_base_url: String,
    web_url: String,
    tauri: &'static str,
}

#[tauri::command]
fn get_local_status() -> DesktopStatus {
    DesktopStatus {
        api_base_url: "http://localhost:3000".into(),
        web_url: "http://localhost:5173".into(),
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
