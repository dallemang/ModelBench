use std::process::{Command, Child};
use std::sync::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Serialize, Deserialize)]
struct HttpResponse {
    #[serde(flatten)]
    data: serde_json::Value,
}

#[derive(Serialize, Deserialize)]
struct LoadRdfRequest {
    file_path: String,
}

#[derive(Serialize, Deserialize)]
struct QueryRequest {
    sparql_query: String,
}

#[derive(Serialize, Deserialize)]
struct AddTripleRequest {
    subject: String,
    predicate: String,
    object: String,
}

// Global state to track the Python server
static PYTHON_SERVER: Mutex<Option<(Child, u16)>> = Mutex::new(None);
static LAST_KNOWN_PORT: Mutex<Option<u16>> = Mutex::new(None);
static SERVER_CREATION_LOCK: Mutex<()> = Mutex::new(());

fn find_available_port() -> u16 {
    use std::net::TcpListener;
    
    // Try to bind to port 0 to get an available port
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    port
}

fn start_python_server() -> Result<u16, String> {
    let port = find_available_port();
    
    // Try to use venv Python first, fallback to system Python
    let python_exe = if cfg!(windows) {
        "..\\python-backend\\venv\\Scripts\\python.exe"
    } else {
        "../python-backend/venv/bin/python"
    };
    
    let mut cmd = Command::new(python_exe);
    cmd.arg("../python-backend/server.py");
    cmd.arg(port.to_string());
    
    let child = match cmd.spawn() {
        Ok(child) => child,
        Err(_) => {
            // Fallback to system python if venv doesn't exist
            let mut fallback_cmd = Command::new("python");
            fallback_cmd.arg("../python-backend/server.py");
            fallback_cmd.arg(port.to_string());
            fallback_cmd.spawn().map_err(|e| format!("Failed to start Python server with both venv and system Python: {}", e))?
        }
    };
    
    // Store the child process and port
    let mut server_guard = PYTHON_SERVER.lock().unwrap();
    *server_guard = Some((child, port));
    
    // Cache the port
    let mut last_port_guard = LAST_KNOWN_PORT.lock().unwrap();
    *last_port_guard = Some(port);
    
    // Wait longer for server to start (uvicorn needs time to initialize)
    std::thread::sleep(std::time::Duration::from_millis(2000));
    
    Ok(port)
}

fn get_server_port() -> Result<u16, String> {
    // First check if we have a cached port that's working (fast path)
    {
        let last_port_guard = LAST_KNOWN_PORT.lock().unwrap();
        if let Some(port) = *last_port_guard {
            // Test if the port is still responding before using it
            if test_port_health(port) {
                return Ok(port);
            }
        }
    }
    
    // Use a global lock to prevent concurrent server creation
    let _creation_lock = SERVER_CREATION_LOCK.lock().unwrap();
    
    // Check again after acquiring the lock in case another thread created the server
    {
        let last_port_guard = LAST_KNOWN_PORT.lock().unwrap();
        if let Some(port) = *last_port_guard {
            if test_port_health(port) {
                return Ok(port);
            }
        }
    }
    
    let mut server_guard = PYTHON_SERVER.lock().unwrap();
    
    match server_guard.as_mut() {
        Some((child, port)) => {
            // Check if process is still running - be more conservative
            match child.try_wait() {
                Ok(Some(_exit_status)) => {
                    // Process has definitely exited
                    *server_guard = None;
                    // Clear cached port
                    let mut last_port_guard = LAST_KNOWN_PORT.lock().unwrap();
                    *last_port_guard = None;
                    drop(last_port_guard);
                    drop(server_guard);
                    start_python_server()
                },
                Ok(None) => {
                    // Process is still running, test if port is responding
                    if test_port_health(*port) {
                        // Update cached port
                        let mut last_port_guard = LAST_KNOWN_PORT.lock().unwrap();
                        *last_port_guard = Some(*port);
                        Ok(*port)
                    } else {
                        // Port not responding, restart
                        *server_guard = None;
                        // Clear cached port
                        let mut last_port_guard = LAST_KNOWN_PORT.lock().unwrap();
                        *last_port_guard = None;
                        drop(last_port_guard);
                        drop(server_guard);
                        start_python_server()
                    }
                },
                Err(_e) => {
                    // Error checking process status - be conservative and keep using it
                    // If we can't check the process, test the port instead
                    if test_port_health(*port) {
                        let mut last_port_guard = LAST_KNOWN_PORT.lock().unwrap();
                        *last_port_guard = Some(*port);
                        Ok(*port)
                    } else {
                        *server_guard = None;
                        // Clear cached port
                        let mut last_port_guard = LAST_KNOWN_PORT.lock().unwrap();
                        *last_port_guard = None;
                        drop(last_port_guard);
                        drop(server_guard);
                        start_python_server()
                    }
                }
            }
        },
        None => {
            // No server running, start one
            // Clear cached port
            let mut last_port_guard = LAST_KNOWN_PORT.lock().unwrap();
            *last_port_guard = None;
            drop(last_port_guard);
            drop(server_guard);
            start_python_server()
        }
    }
}

fn test_port_health(port: u16) -> bool {
    use std::net::{TcpStream, SocketAddr};
    use std::time::Duration;
    
    // Try multiple times with increasing delays for servers that are starting up
    for attempt in 1..=3 {
        let timeout = Duration::from_millis(200 * attempt); // 200ms, 400ms, 600ms
        let addr: SocketAddr = format!("127.0.0.1:{}", port).parse().unwrap();
        
        match TcpStream::connect_timeout(&addr, timeout) {
            Ok(_) => {
                return true;
            },
            Err(_) => {
                if attempt < 3 {
                    std::thread::sleep(Duration::from_millis(300)); // Wait between attempts
                }
            }
        }
    }
    
    false
}

async fn make_http_request(method: &str, endpoint: &str, body: Option<Value>) -> Result<Value, String> {
    let port = get_server_port()?;
    let url = format!("http://127.0.0.1:{}{}", port, endpoint);
    
    let client = reqwest::Client::new();
    
    let response = match method {
        "GET" => client.get(&url).send().await,
        "POST" => {
            if let Some(body) = body {
                client.post(&url).json(&body).send().await
            } else {
                client.post(&url).send().await
            }
        },
        _ => return Err("Unsupported HTTP method".to_string()),
    };
    
    let response = response.map_err(|e| format!("HTTP request failed: {}", e))?;
    
    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("HTTP error {}: {}", status, error_text));
    }
    
    let json: Value = response.json().await.map_err(|e| format!("Failed to parse JSON response: {}", e))?;
    Ok(json)
}

#[tauri::command]
async fn load_rdf_file(file_path: String) -> Result<HttpResponse, String> {
    let request = LoadRdfRequest { file_path };
    let response = make_http_request("POST", "/load_rdf", Some(serde_json::to_value(request).unwrap())).await?;
    Ok(HttpResponse { data: response })
}

#[tauri::command]
async fn get_graph_info() -> Result<HttpResponse, String> {
    let response = make_http_request("GET", "/graph_info", None).await?;
    Ok(HttpResponse { data: response })
}

#[tauri::command]
async fn query_graph(sparql_query: String) -> Result<HttpResponse, String> {
    let request = QueryRequest { sparql_query };
    let response = make_http_request("POST", "/query", Some(serde_json::to_value(request).unwrap())).await?;
    Ok(HttpResponse { data: response })
}

#[tauri::command]
async fn add_triple(subject: String, predicate: String, object: String) -> Result<HttpResponse, String> {
    let request = AddTripleRequest { subject, predicate, object };
    let response = make_http_request("POST", "/add_triple", Some(serde_json::to_value(request).unwrap())).await?;
    Ok(HttpResponse { data: response })
}

#[tauri::command]
async fn get_hierarchy() -> Result<HttpResponse, String> {
    let response = make_http_request("GET", "/hierarchy", None).await?;
    Ok(HttpResponse { data: response })
}

#[tauri::command]
async fn get_import_hierarchy() -> Result<HttpResponse, String> {
    let response = make_http_request("GET", "/import_hierarchy", None).await?;
    Ok(HttpResponse { data: response })
}

#[tauri::command]
async fn get_backend_port() -> Result<u16, String> {
    get_server_port()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![
        load_rdf_file, 
        get_graph_info, 
        query_graph, 
        add_triple, 
        get_hierarchy,
        get_import_hierarchy,
        get_backend_port
    ])
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
