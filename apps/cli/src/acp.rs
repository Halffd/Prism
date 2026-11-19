//! Agent Client Protocol (ACP) over stdio.
//!
//! Newline-delimited JSON-RPC 2.0, the shape editors use to drive a
//! local coding agent: `initialize` → `session/new` → `session/prompt`,
//! with `session/update` notifications for the transcript. The actual
//! turn is the same core agent loop (`chat::agent_job`) the TUI uses,
//! so tools, MCP servers, subagent registry and sandbox policy behave
//! identically.

use crate::events::Event;
use prism_core::host;
use std::collections::{BTreeMap, BTreeSet};
use std::io::{BufRead, Write};
use std::sync::mpsc;

fn send(out: &mut impl Write, value: &serde_json::Value) {
    let _ = writeln!(out, "{value}");
    let _ = out.flush();
}

fn notify_chunk(out: &mut impl Write, session: &str, text: &str) {
    send(
        out,
        &serde_json::json!({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": session,
                "update": {
                    "sessionUpdate": "agent_message_chunk",
                    "content": { "type": "text", "text": text },
                }
            }
        }),
    );
}

fn result(id: &serde_json::Value, value: serde_json::Value) -> serde_json::Value {
    serde_json::json!({ "jsonrpc": "2.0", "id": id, "result": value })
}

fn error(id: &serde_json::Value, code: i64, message: &str) -> serde_json::Value {
    serde_json::json!({
        "jsonrpc": "2.0", "id": id,
        "error": { "code": code, "message": message }
    })
}

/// `prism acp` — speak ACP on stdin/stdout until EOF.
pub fn acp_cli(_args: &[String]) -> anyhow::Result<()> {
    let stdin = std::io::stdin();
    let mut out = std::io::stdout();
    let mut sessions: BTreeMap<String, Vec<prism_core::client::ChatMessage>> = BTreeMap::new();
    let mut cancelled: BTreeSet<String> = BTreeSet::new();
    let mut next_session = 1u64;
    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let Ok(msg) = serde_json::from_str::<serde_json::Value>(&line) else {
            send(
                &mut out,
                &serde_json::json!({
                    "jsonrpc": "2.0", "id": serde_json::Value::Null,
                    "error": { "code": -32700, "message": "parse error" }
                }),
            );
            continue;
        };
        let id = msg.get("id").cloned();
        let method = msg.get("method").and_then(|m| m.as_str()).unwrap_or("");
        let params = msg.get("params").cloned().unwrap_or(serde_json::json!({}));
        let Some(id) = id else {
            // Notifications (session/cancel) have no response.
            if method == "session/cancel" {
                if let Some(session) = params.get("sessionId").and_then(|s| s.as_str()) {
                    cancelled.insert(session.to_string());
                }
            }
            continue;
        };
        match method {
            "initialize" => send(
                &mut out,
                &result(
                    &id,
                    serde_json::json!({
                        "protocolVersion": 1,
                        "agentCapabilities": {
                            "promptCapabilities": {
                                "image": false,
                                "audio": false,
                                "embeddedContext": false,
                            },
                            "mcp": { "stdio": true },
                        },
                        "authMethods": [],
                    }),
                ),
            ),
            "authenticate" => send(&mut out, &result(&id, serde_json::json!({}))),
            "session/new" => {
                let session = format!("s{}", next_session);
                next_session += 1;
                sessions.insert(session.clone(), Vec::new());
                send(
                    &mut out,
                    &result(&id, serde_json::json!({ "sessionId": session })),
                );
            }
            "session/prompt" => {
                let session = params
                    .get("sessionId")
                    .and_then(|s| s.as_str())
                    .unwrap_or("");
                if !sessions.contains_key(session) {
                    send(&mut out, &error(&id, -32602, "unknown session"));
                    continue;
                }
                let prompt: String = params
                    .get("prompt")
                    .and_then(|p| p.as_array())
                    .map(|parts| {
                        parts
                            .iter()
                            .filter_map(|p| {
                                if p.get("type").and_then(|t| t.as_str()) == Some("text") {
                                    p.get("text").and_then(|t| t.as_str()).map(String::from)
                                } else {
                                    None
                                }
                            })
                            .collect::<Vec<_>>()
                            .join("\n")
                    })
                    .unwrap_or_default();
                if prompt.trim().is_empty() {
                    send(&mut out, &error(&id, -32602, "empty prompt"));
                    continue;
                }
                let settings = host::load_settings();
                let workspace = std::env::current_dir()?;
                let (tx, rx) = mpsc::channel::<Event>();
                // The core agent loop (tools + MCP + subagents), run in
                // the background so this loop can still read cancels.
                crate::chat::agent_job::spawn(&settings, &prompt, workspace, &tx)
                    .map_err(anyhow::Error::msg)?;
                let mut answer = String::new();
                let mut stopped = false;
                while let Ok(ev) = rx.recv() {
                    match ev {
                        Event::Notice(_) => {}
                        Event::AgentDone(result) => {
                            for step in &result.steps {
                                notify_chunk(
                                    &mut out,
                                    session,
                                    &format!(
                                        "[{}] {} -> {}\n",
                                        step.action, step.action_input, step.observation
                                    ),
                                );
                            }
                            answer = result.answer;
                            break;
                        }
                        _ => {}
                    }
                    if cancelled.remove(session) {
                        stopped = true;
                        break;
                    }
                }
                if !answer.is_empty() {
                    notify_chunk(&mut out, session, &answer);
                }
                if let Some(history) = sessions.get_mut(session) {
                    history.push(prism_core::client::ChatMessage::text("user", &prompt));
                    history.push(prism_core::client::ChatMessage::text("assistant", &answer));
                }
                send(
                    &mut out,
                    &result(
                        &id,
                        serde_json::json!({
                            "stopReason": if stopped || cancelled.contains(session) {
                                "cancelled"
                            } else {
                                "end_turn"
                            }
                        }),
                    ),
                );
            }
            "session/cancel" => {
                // Cancellation is asynchronous; the prompt response
                // reports it.
                send(&mut out, &result(&id, serde_json::json!({})));
            }
            "shutdown" | "exit" => {
                send(&mut out, &result(&id, serde_json::json!({})));
                break;
            }
            other => send(
                &mut out,
                &error(&id, -32601, &format!("method not found: {other}")),
            ),
        }
    }
    Ok(())
}
