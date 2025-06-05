use std::process::Command;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
struct PythonResponse {
    #[serde(flatten)]
    data: serde_json::Value,
}

#[tauri::command]
async fn call_python_backend(command: String, args: Vec<String>) -> Result<PythonResponse, String> {
    // Try to use venv Python first, fallback to system Python
    let python_exe = if cfg!(windows) {
        "..\\python-backend\\venv\\Scripts\\python.exe"
    } else {
        "../python-backend/venv/bin/python"
    };
    
    let mut cmd = Command::new(python_exe);
    cmd.arg("../python-backend/main.py");
    cmd.arg(&command);
    
    for arg in &args {
        cmd.arg(arg);
    }
    
    let output = match cmd.output() {
        Ok(output) => output,
        Err(_) => {
            // Fallback to system python if venv doesn't exist
            let mut fallback_cmd = Command::new("python");
            fallback_cmd.arg("../python-backend/main.py");
            fallback_cmd.arg(&command);
            for arg in &args {
                fallback_cmd.arg(arg);
            }
            fallback_cmd.output().map_err(|e| format!("Failed to execute command with both venv and system Python: {}", e))?
        }
    };
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Python command failed: {}", stderr));
    }
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    let json_value: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse JSON response: {}", e))?;
    
    Ok(PythonResponse { data: json_value })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![call_python_backend])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
