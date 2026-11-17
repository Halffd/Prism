//! MCP over stdio — the `mcpServers` config file every Prism surface
//! reads (`<config>/prism/mcp.json`, `$PRISM_MCP_CONFIG` override).
//!
//! Each server is a child process spoken to with JSON-RPC 2.0 over
//! newline-delimited stdin/stdout: `initialize` handshake, then
//! `tools/list`, then `tools/call`. Tool names from foreign code are
//! never advertised raw: every MCP tool surfaces as
//! `mcp__<server>__<tool>` sanitized into the core's tool-name class,
//! and the sanitized→(server, tool) map lives in the connection.
//!
//! The module is gated on `native-transport` because wasm hosts cannot
//! spawn children.

use serde::Deserialize;
use std::collections::{BTreeMap, HashMap};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::SyncSender;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// One configured server: how to spawn it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}

/// The whole config file: servers plus raw `subagents` entries (the
/// subagents module validates and upserts those; see
/// `subagents::upsert_config_specs`).
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpFile {
    #[serde(default)]
    pub mcp_servers: BTreeMap<String, McpServerConfig>,
    #[serde(default)]
    pub subagents: Vec<serde_json::Value>,
}

/// Config path: `$PRISM_MCP_CONFIG` wins, else the core config root.
pub fn config_path() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("PRISM_MCP_CONFIG") {
        if !p.is_empty() {
            return Some(PathBuf::from(p));
        }
    }
    crate::host::config_dir().map(|d| d.join("mcp.json"))
}

/// Load the config file. `None` when absent or malformed — an empty or
/// broken config never kills a surface, it just advertises nothing.
pub fn load_file() -> Option<McpFile> {
    let path = config_path()?;
    let text = std::fs::read_to_string(&path).ok()?;
    match serde_json::from_str::<McpFile>(&text) {
        Ok(file) => {
            // An entry without a usable command is dropped here; the
            // connect step reports what remains.
            let mcp_servers: BTreeMap<String, McpServerConfig> = file
                .mcp_servers
                .into_iter()
                .filter(|(_, cfg)| !cfg.command.trim().is_empty())
                .collect();
            Some(McpFile {
                mcp_servers,
                subagents: file.subagents,
            })
        }
        Err(_) => None,
    }
}

/// The core's tool-name class: lowercase `[a-z0-9_]`, never empty.
pub fn sanitize_tool_part(part: &str) -> String {
    let mut cleaned = String::new();
    let mut last_underscore = false;
    for c in part.chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            cleaned.push(c);
            last_underscore = false;
        } else if c.is_ascii_uppercase() {
            cleaned.push(c.to_ascii_lowercase());
            last_underscore = false;
        } else if !last_underscore {
            cleaned.push('_');
            last_underscore = true;
        }
    }
    let cleaned = cleaned.trim_matches('_').to_string();
    if cleaned.is_empty() {
        "unnamed".into()
    } else {
        cleaned
    }
}

/// The advertised name for one server/tool pair.
pub fn advertised_name(server: &str, tool: &str) -> String {
    format!(
        "mcp__{}__{}",
        sanitize_tool_part(server),
        sanitize_tool_part(tool)
    )
}

/// Map the agent's string input onto `tools/call` arguments. JSON
/// objects pass through; a bare string wraps into the tool's single
/// declared property (the ReAct step favors a raw string there).
pub fn parse_tool_args(input: &str, schema: &serde_json::Value) -> serde_json::Value {
    let trimmed = input.trim();
    if trimmed.starts_with('{') {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if v.is_object() {
                return v;
            }
        }
    }
    let single = schema
        .get("properties")
        .and_then(|p| p.as_object())
        .filter(|p| p.len() == 1)
        .and_then(|p| p.keys().next().cloned());
    match single {
        Some(key) => serde_json::json!({ key: input }),
        None => serde_json::json!({ "input": input }),
    }
}

/// Join the text parts of a `tools/call` result. `isError` results get
/// the `Error:` prefix the tool-error classifier keys off.
pub fn result_to_text(result: &serde_json::Value) -> String {
    let text = result
        .get("content")
        .and_then(|c| c.as_array())
        .map(|parts| {
            parts
                .iter()
                .filter_map(|p| {
                    let t = p.get("type")?.as_str()?;
                    if t != "text" {
                        return None;
                    }
                    p.get("text")?.as_str().map(String::from)
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default();
    if result.get("isError").and_then(|e| e.as_bool()).unwrap_or(false) {
        if text.is_empty() {
            "Error: mcp tool failed".into()
        } else {
            format!("Error: {text}")
        }
    } else {
        text
    }
}

// ---- transport -----------------------------------------------------------

enum Reply {
    Ok(serde_json::Value),
    Err(String),
}

struct Inner {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    next_id: u64,
    pending: HashMap<u64, SyncSender<Reply>>,
    stderr_tail: String,
    dead: bool,
}

/// One child process speaking JSON-RPC 2.0 over stdio. Shared handles
/// (the agent loop calls tools from its own thread).
pub struct StdioMcpServer {
    /// Configured server key (goes into the sanitized tool name).
    pub name: String,
    request_timeout: Duration,
    inner: Mutex<Inner>,
}

impl StdioMcpServer {
    /// Spawn the child and run the `initialize` handshake. Every
    /// failure path stops the child before returning — no half-alive
    /// connections linger.
    pub fn spawn(
        name: &str,
        cfg: &McpServerConfig,
        request_timeout: Duration,
    ) -> Result<Arc<Self>, String> {
        let mut child = Command::new(&cfg.command)
            .args(&cfg.args)
            .envs(&cfg.env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("failed to start: {e}"))?;
        let stdin = child.stdin.take();
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "no stdout".to_string())?;
        let stderr = child.stderr.take();

        let inner = Mutex::new(Inner {
            child: Some(child),
            stdin,
            next_id: 1,
            pending: HashMap::new(),
            stderr_tail: String::new(),
            dead: false,
        });
        let server = Arc::new(StdioMcpServer {
            name: name.to_string(),
            request_timeout,
            inner,
        });

        // Reader: every line with a known id resolves its waiter. On
        // EOF (server died) every waiter fails — transport death is an
        // error, never a hang.
        let reader_server = server.clone();
        std::thread::spawn(move || {
            let mut lines = BufReader::new(stdout).lines();
            loop {
                match lines.next() {
                    Some(Ok(line)) => reader_server.route_line(&line),
                    _ => break,
                }
            }
            reader_server.mark_dead("exited");
        });

        // Stderr tail for diagnostics (servers log on stderr).
        if let Some(stderr) = stderr {
            let tail_server = server.clone();
            std::thread::spawn(move || {
                let mut lines = BufReader::new(stderr).lines();
                while let Some(Ok(line)) = lines.next() {
                    tail_server.append_stderr(&line);
                }
            });
        }

        server.request(
            "initialize",
            serde_json::json!({
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": { "name": "prism", "version": env!("CARGO_PKG_VERSION") },
            }),
        )
        .map_err(|e| {
            server.stop();
            format!("handshake failed: {e}")
        })?;
        server.notify("notifications/initialized");
        Ok(server)
    }

    fn append_stderr(&self, line: &str) {
        let mut inner = self.inner.lock().unwrap();
        inner.stderr_tail.push_str(line);
        inner.stderr_tail.push('\n');
        let cut = inner.stderr_tail.len().saturating_sub(2000);
        if cut > 0 {
            inner.stderr_tail = inner.stderr_tail[cut..].to_string();
        }
    }

    fn route_line(&self, line: &str) {
        if line.trim().is_empty() {
            return;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            return;
        };
        let Some(id) = v.get("id").and_then(|i| i.as_u64()) else {
            return;
        };
        let reply = if let Some(err) = v.get("error") {
            Reply::Err(
                err.get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("mcp request failed")
                    .to_string(),
            )
        } else {
            Reply::Ok(v.get("result").cloned().unwrap_or(serde_json::Value::Null))
        };
        let waiter = self.inner.lock().unwrap().pending.remove(&id);
        if let Some(tx) = waiter {
            let _ = tx.send(reply);
        }
    }

    fn mark_dead(&self, reason: &str) {
        let mut inner = self.inner.lock().unwrap();
        if inner.dead {
            return;
        }
        inner.dead = true;
        inner.child = None;
        inner.stdin = None;
        let pending: Vec<SyncSender<Reply>> = inner.pending.drain().map(|(_, tx)| tx).collect();
        drop(inner);
        for tx in pending {
            let _ = tx.send(Reply::Err(format!("mcp server {:?} {reason}", self.name)));
        }
    }

    fn send_line(&self, payload: &serde_json::Value) -> Result<(), String> {
        let mut inner = self.inner.lock().unwrap();
        if inner.dead {
            return Err(format!("mcp server {:?} is not running", self.name));
        }
        let Some(stdin) = inner.stdin.as_mut() else {
            return Err(format!("mcp server {:?} is not running", self.name));
        };
        stdin
            .write_all(format!("{payload}\n").as_bytes())
            .map_err(|e| format!("mcp server {:?} write: {e}", self.name))?;
        stdin.flush().map_err(|e| format!("mcp write: {e}"))
    }

    /// Send a request and await its result. A timed-out call also
    /// tears the connection down — a server that misses a deadline is
    /// dead weight for the rest of the session.
    fn request(&self, method: &str, params: serde_json::Value) -> Result<serde_json::Value, String> {
        let (id, rx) = {
            let mut inner = self.inner.lock().unwrap();
            if inner.dead {
                return Err(format!("mcp server {:?} is not running", self.name));
            }
            let id = inner.next_id;
            inner.next_id += 1;
            let (tx, rx) = std::sync::mpsc::sync_channel::<Reply>(1);
            inner.pending.insert(id, tx);
            (id, rx)
        };
        if let Err(e) = self.send_line(&serde_json::json!({
            "jsonrpc": "2.0", "id": id, "method": method, "params": params,
        })) {
            self.inner.lock().unwrap().pending.remove(&id);
            self.mark_dead("write failed");
            return Err(e);
        }
        match rx.recv_timeout(self.request_timeout) {
            Ok(Reply::Ok(v)) => Ok(v),
            Ok(Reply::Err(e)) => Err(e),
            Err(_) => {
                self.inner.lock().unwrap().pending.remove(&id);
                self.mark_dead("hung");
                Err(format!(
                    "mcp request {method:?} timed out on server {:?}",
                    self.name
                ))
            }
        }
    }

    fn notify(&self, method: &str) {
        let _ = self.send_line(&serde_json::json!({
            "jsonrpc": "2.0", "method": method, "params": {}
        }));
    }

    /// Whether the child process is still with us.
    pub fn is_alive(&self) -> bool {
        let mut inner = self.inner.lock().unwrap();
        if inner.dead {
            return false;
        }
        matches!(inner.child.as_mut().map(|c| c.try_wait()), Some(Ok(None)))
    }

    /// `tools/list` — raw tool entries straight from the server.
    pub fn list_tools(&self) -> Result<Vec<serde_json::Value>, String> {
        let result = self.request("tools/list", serde_json::json!({}))?;
        Ok(result
            .get("tools")
            .and_then(|t| t.as_array())
            .cloned()
            .unwrap_or_default())
    }

    /// `tools/call` — `input` is the JSON-string args the agent step
    /// produced; text parts joined, `isError` under the `Error:` prefix.
    pub fn call_tool(&self, tool: &str, input: &str, schema: &serde_json::Value) -> String {
        if !self.is_alive() {
            return format!("Error: mcp server {:?} is not running", self.name);
        }
        let args = parse_tool_args(input, schema);
        match self.request(
            "tools/call",
            serde_json::json!({ "name": tool, "arguments": args }),
        ) {
            Ok(result) => result_to_text(&result),
            Err(e) => format!("Error: mcp call failed: {e}"),
        }
    }

    /// Last stderr lines (diagnostics for a dead server).
    pub fn stderr_tail(&self) -> String {
        self.inner.lock().unwrap().stderr_tail.clone()
    }

    /// Non-panicking close: kill the child; the reader thread fails
    /// the remaining waiters.
    pub fn stop(&self) {
        let child = self.inner.lock().unwrap().child.take();
        if let Some(mut child) = child {
            let _ = child.kill();
        }
        self.mark_dead("stopped");
    }
}

impl Drop for StdioMcpServer {
    fn drop(&mut self) {
        self.stop();
    }
}

/// One executable MCP tool in the core's registry.
pub struct McpTool {
    server: Arc<StdioMcpServer>,
    /// The sanitized, advertised name (`mcp__<server>__<tool>`).
    pub advertised: String,
    /// The raw name the server knows.
    pub raw: String,
    /// The server's declared input schema (drives bare-string wrapping).
    pub schema: serde_json::Value,
    description: String,
}

impl McpTool {
    pub fn new(
        server: Arc<StdioMcpServer>,
        raw: &str,
        description: Option<&str>,
        schema: serde_json::Value,
    ) -> Self {
        McpTool {
            advertised: advertised_name(&server.name, raw),
            server: server.clone(),
            raw: raw.to_string(),
            description: format!(
                "MCP ({}): {}",
                server.name,
                description.unwrap_or(raw)
            ),
            schema,
        }
    }
}

impl crate::agent::Tool for McpTool {
    fn name(&self) -> &str {
        &self.advertised
    }

    fn description(&self) -> &str {
        &self.description
    }

    fn execute(&self, input: &str) -> String {
        self.server.call_tool(&self.raw, input, &self.schema)
    }
}

/// Everything one config connects to: the tools that join the agent's
/// registry and the per-server failures (a dead server is reported,
/// not fatal — the reachable ones still work).
pub struct McpSurface {
    pub tools: Vec<Arc<McpTool>>,
    pub errors: Vec<String>,
}

impl McpSurface {
    /// Connect to every configured server. Empty config = empty surface.
    pub fn connect(file: &McpFile, timeout: Duration) -> McpSurface {
        let mut tools = Vec::new();
        let mut errors = Vec::new();
        for (name, cfg) in &file.mcp_servers {
            match StdioMcpServer::spawn(name, cfg, timeout) {
                Ok(server) => match server.list_tools() {
                    Ok(raw_tools) => {
                        for raw in raw_tools {
                            let Some(raw_name) = raw.get("name").and_then(|n| n.as_str()) else {
                                continue;
                            };
                            tools.push(Arc::new(McpTool::new(
                                server.clone(),
                                raw_name,
                                raw.get("description").and_then(|d| d.as_str()),
                                raw.get("inputSchema").cloned().unwrap_or(serde_json::json!({})),
                            )));
                        }
                    }
                    Err(e) => {
                        let server = server.clone();
                        errors.push(format!("{name}: {e}"));
                        server.stop();
                    }
                },
                Err(e) => errors.push(format!("{name}: {e}")),
            }
        }
        McpSurface { tools, errors }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_matches_the_core_tool_name_class() {
        assert_eq!(sanitize_tool_part("Get-Weather!"), "get_weather");
        assert_eq!(sanitize_tool_part("Boom!"), "boom");
        assert_eq!(sanitize_tool_part("  "), "unnamed");
        assert_eq!(sanitize_tool_part("read__FILE"), "read_file");
        assert_eq!(
            advertised_name("My Server", "Add(2)"),
            "mcp__my_server__add_2"
        );
    }

    #[test]
    fn tool_args_map_onto_the_declared_schema() {
        let schema = serde_json::json!({
            "type": "object",
            "properties": { "text": { "type": "string" } }
        });
        // JSON objects pass through…
        assert_eq!(
            parse_tool_args("{\"a\":1}", &schema),
            serde_json::json!({ "a": 1 })
        );
        // …bare strings wrap into the single declared property…
        assert_eq!(
            parse_tool_args("hello", &schema),
            serde_json::json!({ "text": "hello" })
        );
        // …and ambiguous schemas fall back to the generic envelope.
        let multi = serde_json::json!({ "properties": { "a": {}, "b": {} } });
        assert_eq!(
            parse_tool_args("hello", &multi),
            serde_json::json!({ "input": "hello" })
        );
    }

    #[test]
    fn tool_results_join_text_and_flag_errors() {
        let ok = serde_json::json!({
            "content": [
                { "type": "text", "text": "line one" },
                { "type": "image", "data": "…" },
                { "type": "text", "text": "line two" },
            ]
        });
        assert_eq!(result_to_text(&ok), "line one\nline two");
        let err = serde_json::json!({
            "isError": true,
            "content": [{ "type": "text", "text": "boom" }],
        });
        assert_eq!(result_to_text(&err), "Error: boom");
        let empty_err = serde_json::json!({ "isError": true, "content": [] });
        assert_eq!(result_to_text(&empty_err), "Error: mcp tool failed");
    }

    #[test]
    fn config_path_prefers_the_override_and_load_rejects_junk() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("mcp.json");
        std::env::set_var("PRISM_MCP_CONFIG", &path);

        // absent
        assert!(load_file().is_none());
        // malformed
        std::fs::write(&path, "{not json").unwrap();
        assert!(load_file().is_none());
        // empty servers (after the command filter) still load, with
        // nothing to connect to
        std::fs::write(&path, r#"{"mcpServers": {}}"#).unwrap();
        let file = load_file().unwrap();
        assert!(file.mcp_servers.is_empty());
        // blank commands are dropped
        std::fs::write(
            &path,
            r#"{"mcpServers": {"x": {"command": "   "}, "y": {"command": "true"}}}"#,
        )
        .unwrap();
        let file = load_file().unwrap();
        assert_eq!(file.mcp_servers.len(), 1);
        assert!(file.mcp_servers.contains_key("y"));

        std::env::remove_var("PRISM_MCP_CONFIG");
        // falls back to the core config root
        if let Some(root) = crate::host::config_dir() {
            assert!(config_path().unwrap().ends_with("mcp.json"));
            assert!(config_path().unwrap().starts_with(root));
        }
    }
}
