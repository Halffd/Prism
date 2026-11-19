//! Local daemon ("`prism serve`") plus the tiny client the other
//! commands use to talk to it.
//!
//! Plain HTTP/1.1 over a loopback `TcpListener` — no async runtime, no
//! framework. State lives in one `ServerState` behind a mutex; each
//! connection is a thread. The pid/port/token are written to
//! `<config>/server.json` so `status`, `ping`, `stop`, `reload` and the
//! pairing flow find the same process.

use crate::cmd;
use crate::events::Event;
use prism_core::host;
use prism_core::settings::Settings;
use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Clone, serde::Serialize)]
struct Job {
    id: String,
    spec: String,
    task: String,
    status: String,
    started_at: u64,
    answer: Option<String>,
    error: Option<String>,
}

struct ServerState {
    started_at: u64,
    token: String,
    jobs: BTreeMap<String, Job>,
    cancelled: BTreeMap<String, Arc<AtomicBool>>,
    shutdown: Arc<AtomicBool>,
}

/// Where the daemon records its address.
pub fn server_file() -> Option<std::path::PathBuf> {
    host::config_dir().map(|d| d.join("server.json"))
}

fn read_server_file() -> Option<serde_json::Value> {
    let text = std::fs::read_to_string(server_file()?).ok()?;
    serde_json::from_str(&text).ok()
}

fn pid_alive(pid: u64) -> bool {
    #[cfg(target_os = "linux")]
    {
        std::path::Path::new(&format!("/proc/{pid}")).exists()
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = pid;
        true
    }
}

/// The recorded server, or `None` when the file is absent/stale.
pub fn running_server() -> Option<serde_json::Value> {
    let info = read_server_file()?;
    let pid = info.get("pid")?.as_u64()?;
    if !pid_alive(pid) {
        return None;
    }
    Some(info)
}

/// Minimal HTTP request to the daemon; returns the parsed JSON body.
pub fn server_request(
    method: &str,
    path: &str,
    body: Option<serde_json::Value>,
) -> anyhow::Result<serde_json::Value> {
    let info = running_server()
        .ok_or_else(|| anyhow::anyhow!("no server running (start: prism serve)"))?;
    let port = info
        .get("port")
        .and_then(|p| p.as_u64())
        .ok_or_else(|| anyhow::anyhow!("server.json has no port"))?;
    let host = info
        .get("host")
        .and_then(|h| h.as_str())
        .unwrap_or("127.0.0.1");
    let addr: SocketAddr = format!("{host}:{port}")
        .parse()
        .map_err(|e| anyhow::anyhow!("bad server address: {e}"))?;
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(5))
        .map_err(|e| anyhow::anyhow!("connect {addr}: {e}"))?;
    let payload = body.map(|b| b.to_string()).unwrap_or_default();
    let mut req = format!(
        "{method} {path} HTTP/1.1\r\nHost: {host}:{port}\r\nConnection: close\r\nContent-Type: application/json\r\n"
    );
    if let Some(t) = info.get("token").and_then(|t| t.as_str()) {
        if !t.is_empty() {
            req.push_str(&format!("Authorization: Bearer {t}\r\n"));
        }
    }
    req.push_str(&format!(
        "Content-Length: {}\r\n\r\n{payload}",
        payload.len()
    ));
    stream.write_all(req.as_bytes())?;
    let mut raw = String::new();
    stream.read_to_string(&mut raw)?;
    let (head, body) = raw
        .split_once("\r\n\r\n")
        .ok_or_else(|| anyhow::anyhow!("malformed server response"))?;
    let status = head.lines().next().unwrap_or("");
    let value: serde_json::Value =
        serde_json::from_str(body.trim()).unwrap_or_else(|_| serde_json::json!({ "raw": body }));
    if !status.contains(" 200 ") && !status.contains(" 202 ") {
        anyhow::bail!(
            "{}",
            value
                .get("error")
                .and_then(|e| e.as_str())
                .unwrap_or(status)
        );
    }
    Ok(value)
}

/// `GET /health` for `prism ping`.
pub fn ping_server() -> Option<serde_json::Value> {
    running_server()?;
    server_request("GET", "/health", None).ok()
}

/// `POST /reload` for `prism reload` (returns null when no daemon).
pub fn reload_server() -> serde_json::Value {
    if running_server().is_none() {
        return serde_json::Value::Null;
    }
    server_request("POST", "/reload", Some(serde_json::json!({})))
        .unwrap_or_else(|e| serde_json::json!({ "error": e.to_string() }))
}

/// `prism stop <job-id>`.
pub fn stop_cli(args: &[String]) -> anyhow::Result<()> {
    let id = args
        .iter()
        .find(|a| !a.starts_with("--"))
        .ok_or_else(|| anyhow::anyhow!("usage: prism stop <job-id>"))?;
    let out = server_request("POST", "/stop", Some(serde_json::json!({ "id": id })))?;
    println!("{}", serde_json::to_string_pretty(&out)?);
    Ok(())
}

/// `prism stop-all`.
pub fn stop_all_cli(_args: &[String]) -> anyhow::Result<()> {
    let out = server_request("POST", "/stop-all", Some(serde_json::json!({})))?;
    println!("{}", serde_json::to_string_pretty(&out)?);
    Ok(())
}

struct Request {
    method: String,
    path: String,
    body: Vec<u8>,
    authorized: bool,
}

fn parse_request(stream: &mut TcpStream) -> std::io::Result<Request> {
    let mut raw = Vec::new();
    let mut buf = [0u8; 4096];
    // Read until headers end.
    loop {
        let n = stream.read(&mut buf)?;
        if n == 0 {
            break;
        }
        raw.extend_from_slice(&buf[..n]);
        if raw.windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
    }
    let header_end = raw
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .map(|i| i + 4)
        .unwrap_or(raw.len());
    let head = String::from_utf8_lossy(&raw[..header_end]).to_string();
    let mut lines = head.lines();
    let mut first = lines.next().unwrap_or("").split_whitespace();
    let method = first.next().unwrap_or("GET").to_string();
    let path = first.next().unwrap_or("/").to_string();
    let mut content_length = 0usize;
    let mut authorized = false;
    for line in lines {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        let name = name.trim().to_ascii_lowercase();
        let value = value.trim();
        if name == "content-length" {
            content_length = value.parse().unwrap_or(0);
        }
        if name == "authorization" && value.starts_with("Bearer ") {
            authorized = true;
        }
    }
    let mut body = raw[header_end..].to_vec();
    while body.len() < content_length {
        let n = stream.read(&mut buf)?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&buf[..n]);
    }
    body.truncate(content_length);
    Ok(Request {
        method,
        path,
        body,
        authorized,
    })
}

fn write_json(stream: &mut TcpStream, status: &str, value: &serde_json::Value) {
    let body = value.to_string();
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.flush();
}

fn job_line(job: &Job) -> serde_json::Value {
    serde_json::to_value(job).unwrap_or_else(|_| serde_json::json!({}))
}

fn spawn_job(
    state: Arc<Mutex<ServerState>>,
    settings: Settings,
    name: String,
    task: String,
) -> anyhow::Result<String> {
    let id = format!("job_{}", prism_core::conversations::now_ms());
    let workspace = std::env::current_dir()?;
    let (tx, rx) = std::sync::mpsc::channel::<Event>();
    crate::chat::agent_job::spawn_subagent(&settings, &id, &name, &task, workspace, &tx)
        .map_err(anyhow::Error::msg)?;
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut st = state.lock().unwrap();
        st.jobs.insert(
            id.clone(),
            Job {
                id: id.clone(),
                spec: name,
                task,
                status: "running".into(),
                started_at: prism_core::conversations::now_ms(),
                answer: None,
                error: None,
            },
        );
        st.cancelled.insert(id.clone(), cancel.clone());
    }
    let job_id = id.clone();
    std::thread::spawn(move || {
        while let Ok(ev) = rx.recv() {
            match ev {
                Event::SubagentDone { id, result, .. } => {
                    let mut st = state.lock().unwrap();
                    if cancel.load(Ordering::Relaxed) {
                        if let Some(job) = st.jobs.get_mut(&id) {
                            job.status = "stopped".into();
                        }
                        continue;
                    }
                    if let Some(job) = st.jobs.get_mut(&id) {
                        if result.completed {
                            job.status = "done".into();
                            job.answer = Some(result.answer);
                        } else {
                            job.status = "failed".into();
                            job.error = result
                                .error
                                .or_else(|| Some("stopped without an answer".into()));
                        }
                    }
                }
                Event::Notice(text) => {
                    let mut st = state.lock().unwrap();
                    if let Some(job) = st.jobs.get_mut(&job_id) {
                        job.task = format!("{} · {text}", job.task);
                    }
                }
                _ => {}
            }
        }
    });
    Ok(id)
}

fn handle(
    state: Arc<Mutex<ServerState>>,
    settings: &Settings,
    req: Request,
    need_auth: bool,
) -> (&'static str, serde_json::Value) {
    if need_auth && !req.authorized {
        return (
            "401 Unauthorized",
            serde_json::json!({ "error": "unauthorized" }),
        );
    }
    let path = req.path.split('?').next().unwrap_or(&req.path).to_string();
    let query = req.path.split_once('?').map(|(_, q)| q).unwrap_or("");
    match (req.method.as_str(), path.as_str()) {
        ("GET", "/health") => {
            let st = state.lock().unwrap();
            (
                "200 OK",
                serde_json::json!({
                    "ok": true,
                    "version": env!("CARGO_PKG_VERSION"),
                    "uptime_ms": prism_core::conversations::now_ms().saturating_sub(st.started_at),
                    "jobs": st.jobs.len(),
                }),
            )
        }
        ("GET", "/status") => {
            let st = state.lock().unwrap();
            (
                "200 OK",
                serde_json::json!({
                    "version": env!("CARGO_PKG_VERSION"),
                    "uptime_ms": prism_core::conversations::now_ms().saturating_sub(st.started_at),
                    "provider": settings.provider,
                    "model": settings.model,
                    "jobs": st.jobs.values().cloned().collect::<Vec<_>>(),
                }),
            )
        }
        ("GET", "/jobs") => {
            let st = state.lock().unwrap();
            (
                "200 OK",
                serde_json::json!({ "jobs": st.jobs.values().map(job_line).collect::<Vec<_>>() }),
            )
        }
        ("GET", "/sessions") => (
            "200 OK",
            serde_json::json!({
                "sessions": host::list_conversations().into_iter().map(|m| serde_json::json!({
                    "id": m.id, "title": m.title, "updated_at": m.updated_at,
                })).collect::<Vec<_>>()
            }),
        ),
        ("GET", "/agents") => {
            let (registry, warnings) = crate::chat::agent_job::config_registry();
            (
                "200 OK",
                serde_json::json!({
                    "agents": registry.names(),
                    "warnings": warnings,
                }),
            )
        }
        ("GET", "/models") => {
            let provider = query
                .split('&')
                .find_map(|kv| kv.strip_prefix("provider="))
                .map(String::from)
                .unwrap_or_else(|| settings.provider.clone());
            let catalog = prism_core::catalog::snapshot();
            let ids: Vec<String> = catalog
                .models_for(&provider)
                .into_iter()
                .map(|m| m.id.clone())
                .collect();
            (
                "200 OK",
                serde_json::json!({ "provider": provider, "models": ids }),
            )
        }
        ("POST", "/agents/spawn") => {
            let Ok(body) = serde_json::from_slice::<serde_json::Value>(&req.body) else {
                return (
                    "400 Bad Request",
                    serde_json::json!({ "error": "invalid JSON" }),
                );
            };
            let name = body.get("name").and_then(|n| n.as_str()).unwrap_or("");
            let task = body.get("task").and_then(|t| t.as_str()).unwrap_or("");
            if name.is_empty() || task.is_empty() {
                return (
                    "400 Bad Request",
                    serde_json::json!({ "error": "name and task are required" }),
                );
            }
            match spawn_job(
                state.clone(),
                settings.clone(),
                name.to_string(),
                task.to_string(),
            ) {
                Ok(id) => (
                    "202 Accepted",
                    serde_json::json!({ "id": id, "status": "running" }),
                ),
                Err(e) => (
                    "400 Bad Request",
                    serde_json::json!({ "error": e.to_string() }),
                ),
            }
        }
        ("POST", "/send") => {
            let Ok(body) = serde_json::from_slice::<serde_json::Value>(&req.body) else {
                return (
                    "400 Bad Request",
                    serde_json::json!({ "error": "invalid JSON" }),
                );
            };
            let prompt = body.get("prompt").and_then(|p| p.as_str()).unwrap_or("");
            if prompt.trim().is_empty() {
                return (
                    "400 Bad Request",
                    serde_json::json!({ "error": "prompt required" }),
                );
            }
            let mut settings = settings.clone();
            if let Some(model) = body.get("model").and_then(|m| m.as_str()) {
                settings.model = model.to_string();
            }
            let history = vec![prism_core::client::ChatMessage::text("user", prompt)];
            let (tx, rx) = std::sync::mpsc::channel::<Event>();
            if let Err(e) = crate::chat::start_job(&settings, history, &tx) {
                return ("400 Bad Request", serde_json::json!({ "error": e }));
            }
            let mut text = String::new();
            loop {
                match rx.recv_timeout(Duration::from_secs(300)) {
                    Ok(Event::Stream(prism_core::client::StreamEvent::Chunk(c))) => {
                        text.push_str(&c)
                    }
                    Ok(Event::Stream(prism_core::client::StreamEvent::Done)) => break,
                    Ok(Event::Stream(prism_core::client::StreamEvent::Error(e))) => {
                        return ("502 Bad Gateway", serde_json::json!({ "error": e }))
                    }
                    Ok(_) => {}
                    Err(e) => {
                        return (
                            "504 Gateway Timeout",
                            serde_json::json!({ "error": format!("stream ended: {e}") }),
                        )
                    }
                }
            }
            ("200 OK", serde_json::json!({ "text": text }))
        }
        ("POST", "/stop") => {
            let Ok(body) = serde_json::from_slice::<serde_json::Value>(&req.body) else {
                return (
                    "400 Bad Request",
                    serde_json::json!({ "error": "invalid JSON" }),
                );
            };
            let id = body.get("id").and_then(|i| i.as_str()).unwrap_or("");
            let mut st = state.lock().unwrap();
            match st.cancelled.get(id) {
                Some(flag) => {
                    flag.store(true, Ordering::Relaxed);
                    if let Some(job) = st.jobs.get_mut(id) {
                        job.status = "stopping".into();
                    }
                    (
                        "200 OK",
                        serde_json::json!({ "id": id, "status": "stopping" }),
                    )
                }
                None => (
                    "404 Not Found",
                    serde_json::json!({ "error": "no such job", "id": id }),
                ),
            }
        }
        ("POST", "/stop-all") => {
            let mut st = state.lock().unwrap();
            let mut count = 0;
            let ids: Vec<String> = st.cancelled.keys().cloned().collect();
            for id in ids {
                if let Some(flag) = st.cancelled.get(&id) {
                    flag.store(true, Ordering::Relaxed);
                }
                if let Some(job) = st.jobs.get_mut(&id) {
                    job.status = "stopping".into();
                }
                count += 1;
            }
            ("200 OK", serde_json::json!({ "stopping": count }))
        }
        ("POST", "/reload") => (
            "200 OK",
            serde_json::json!({
                "reloaded": true,
                "settings": host::settings_path().map(|p| p.display().to_string()),
            }),
        ),
        ("POST", "/pair") => {
            let Ok(body) = serde_json::from_slice::<serde_json::Value>(&req.body) else {
                return (
                    "400 Bad Request",
                    serde_json::json!({ "error": "invalid JSON" }),
                );
            };
            let target = body
                .get("target")
                .and_then(|t| t.as_str())
                .unwrap_or("browser");
            let mut args = vec![target.to_string(), "--json".to_string()];
            if let Some(ttl) = body.get("ttl").and_then(|t| t.as_u64()) {
                args.push("--ttl".into());
                args.push(ttl.to_string());
            }
            // Reuse the CLI pairing writer (same file the pair command
            // prints).
            if let Err(e) = cmd::pair_cli(&args) {
                return (
                    "400 Bad Request",
                    serde_json::json!({ "error": e.to_string() }),
                );
            }
            let path = host::config_dir()
                .map(|d| d.join("pair").join(format!("{target}.json")))
                .and_then(|p| std::fs::read_to_string(p).ok());
            match path.and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok()) {
                Some(v) => ("200 OK", v),
                None => (
                    "500 Internal Server Error",
                    serde_json::json!({ "error": "pairing write failed" }),
                ),
            }
        }
        ("POST", "/shutdown") => {
            let st = state.lock().unwrap();
            st.shutdown.store(true, Ordering::Relaxed);
            ("200 OK", serde_json::json!({ "stopping": true }))
        }
        _ => (
            "404 Not Found",
            serde_json::json!({ "error": "no such route" }),
        ),
    }
}

/// `prism serve [--port N] [--host addr] [--token T] [--token-file F]`.
pub fn serve_cli(args: &[String]) -> anyhow::Result<()> {
    let mut port = 7420u16;
    let mut host = "127.0.0.1".to_string();
    let mut token = String::new();
    let mut it = args.iter();
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--port" => {
                port = it
                    .next()
                    .and_then(|p| p.parse().ok())
                    .ok_or_else(|| anyhow::anyhow!("--port needs a number"))?
            }
            "--host" => host = it.next().cloned().unwrap_or(host),
            "--token" => token = it.next().cloned().unwrap_or_default(),
            "--token-file" => {
                let path = it
                    .next()
                    .ok_or_else(|| anyhow::anyhow!("--token-file needs a path"))?;
                let text = std::fs::read_to_string(path)
                    .map_err(|e| anyhow::anyhow!("read {path}: {e}"))?;
                token = serde_json::from_str::<serde_json::Value>(&text)
                    .ok()
                    .and_then(|v| v.get("token").and_then(|t| t.as_str()).map(String::from))
                    .unwrap_or_else(|| text.trim().to_string());
            }
            other => anyhow::bail!("unknown serve flag: {other}"),
        }
    }
    let listener = TcpListener::bind(format!("{host}:{port}"))
        .map_err(|e| anyhow::anyhow!("bind {host}:{port}: {e}"))?;
    listener.set_nonblocking(true)?;
    port = listener.local_addr()?.port();
    let state = Arc::new(Mutex::new(ServerState {
        started_at: prism_core::conversations::now_ms(),
        token: token.clone(),
        jobs: BTreeMap::new(),
        cancelled: BTreeMap::new(),
        shutdown: Arc::new(AtomicBool::new(false)),
    }));
    if let Some(path) = server_file() {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let info = serde_json::json!({
            "host": host,
            "port": port,
            "pid": std::process::id(),
            "token": token,
            "started_at": prism_core::conversations::now_ms(),
            "version": env!("CARGO_PKG_VERSION"),
        });
        std::fs::write(&path, serde_json::to_string_pretty(&info)?)?;
    }
    println!(
        "prism serve — http://{host}:{port} (auth: {})",
        if token.is_empty() { "off" } else { "bearer" }
    );
    loop {
        if state.lock().unwrap().shutdown.load(Ordering::Relaxed) {
            break;
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                let state = state.clone();
                let need_auth = !state.lock().unwrap().token.is_empty();
                std::thread::spawn(move || {
                    let Ok(req) = parse_request(&mut stream) else {
                        return;
                    };
                    // Settings are re-read per request so `prism reload`
                    // (and edits made by other tools) apply without a
                    // restart.
                    let settings = host::load_settings();
                    let (status, value) = handle(state, &settings, req, need_auth);
                    write_json(&mut stream, status, &value);
                });
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(e) => return Err(anyhow::anyhow!("accept failed: {e}")),
        }
    }
    if let Some(path) = server_file() {
        let _ = std::fs::remove_file(path);
    }
    println!("server stopped");
    Ok(())
}
