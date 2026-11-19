//! Non-interactive CLI commands.
//!
//! Every command here is a thin, real driver over `prism-core`: the same
//! settings, conversation store, provider clients, MCP transport and
//! subagent registry the TUI and desktop use. Nothing is a stub — a
//! command either performs its action or fails with the reason.

use crate::chat;
use crate::events::Event;
use prism_core::agent::Tool as _;
use prism_core::client::ChatMessage;
use prism_core::host;
use prism_core::settings::Settings;
use std::io::Write;
use std::time::Duration;

fn json_flag(args: &[String]) -> bool {
    args.iter().any(|a| a == "--json")
}

fn value_after<'a>(args: &'a [String], flag: &str) -> Option<&'a str> {
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1))
        .map(String::as_str)
}

fn positional(args: &[String]) -> Vec<&str> {
    let mut out = Vec::new();
    let mut skip = false;
    for arg in args {
        if skip {
            skip = false;
            continue;
        }
        if arg.starts_with("--") {
            if matches!(
                arg.as_str(),
                "--model" | "--provider" | "--system" | "--limit" | "--json" | "--target" | "--ttl"
            ) {
                skip = !matches!(arg.as_str(), "--json");
            }
            continue;
        }
        out.push(arg.as_str());
    }
    out
}

fn load() -> Settings {
    host::load_settings()
}

fn save(settings: &Settings) -> anyhow::Result<()> {
    host::save_settings(settings).map_err(|e| anyhow::anyhow!("{e}"))
}

/// Short id for tables (storage ids are opaque).
fn short(id: &str) -> &str {
    &id[..id.len().min(8)]
}

/// `prism resume [id]` — resolve the conversation the TUI should open.
pub fn resume_cli(args: &[String]) -> anyhow::Result<Option<String>> {
    let metas = host::list_conversations();
    if metas.is_empty() {
        anyhow::bail!("no conversations to resume");
    }
    let wanted = positional(args).first().copied();
    let id = match wanted {
        Some(id) => {
            let found = metas
                .iter()
                .find(|m| m.id == id || m.id.starts_with(id))
                .ok_or_else(|| anyhow::anyhow!("no conversation with id {id}"))?;
            found.id.clone()
        }
        None => metas[0].id.clone(),
    };
    let conv = host::load_conversation(&id)
        .ok_or_else(|| anyhow::anyhow!("conversation {id} could not be loaded"))?;
    if json_flag(args) {
        println!(
            "{}",
            serde_json::to_string_pretty(&serde_json::json!({
                "id": conv.id,
                "title": conv.title,
                "messages": conv.messages.len(),
                "updated_at": conv.updated_at,
            }))?
        );
        return Ok(None);
    }
    println!(
        "resuming {} — {} ({} messages)",
        short(&conv.id),
        conv.title,
        conv.messages.len()
    );
    Ok(Some(id))
}

/// `prism sessions [--json] [--limit N]` — the shared conversation
/// store, newest first.
pub fn sessions_cli(args: &[String]) -> anyhow::Result<()> {
    let limit = value_after(args, "--limit")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(50);
    let metas = host::list_conversations();
    if json_flag(args) {
        let rows: Vec<serde_json::Value> = metas
            .iter()
            .take(limit)
            .map(|m| {
                serde_json::json!({
                    "id": m.id,
                    "title": m.title,
                    "updated_at": m.updated_at,
                })
            })
            .collect();
        println!("{}", serde_json::to_string_pretty(&rows)?);
        return Ok(());
    }
    if metas.is_empty() {
        println!("No sessions.");
        return Ok(());
    }
    for m in metas.iter().take(limit) {
        let conv = host::load_conversation(&m.id);
        println!(
            "{}  {} msgs  {}  {}",
            short(&m.id),
            conv.map(|c| c.messages.len()).unwrap_or(0),
            m.updated_at,
            m.title
        );
    }
    Ok(())
}

/// `prism models [--provider id] [--fetch] [--json]` — catalog, cached
/// and live model ids.
pub fn models_cli(args: &[String]) -> anyhow::Result<()> {
    let settings = load();
    let provider = value_after(args, "--provider")
        .map(String::from)
        .unwrap_or_else(|| settings.provider.clone());
    let mut models: Vec<(String, bool)> = Vec::new();
    let catalog = prism_core::catalog::snapshot();
    let default = catalog
        .providers
        .get(&provider)
        .and_then(|p| p.default_model())
        .map(String::from);
    for m in catalog.models_for(&provider) {
        models.push((m.id.clone(), Some(&m.id) == default.as_ref()));
    }
    for m in settings.model_cache.get(&provider).into_iter().flatten() {
        if !models.iter().any(|(id, _)| id == m) {
            models.push((m.clone(), false));
        }
    }
    if args.iter().any(|a| a == "--fetch") {
        let resolved = settings
            .resolve_provider(&provider)
            .ok_or_else(|| anyhow::anyhow!("unknown provider {provider}"))?;
        let (tx, rx) = std::sync::mpsc::channel();
        host::spawn_models_fetch(
            prism_core::client::ModelsRequest {
                base_url: resolved.base_url.clone(),
                api_key: settings.key_for(&provider),
            },
            tx,
        );
        match rx.recv_timeout(Duration::from_secs(45)) {
            Ok(prism_core::client::ModelsEvent::Loaded { models: live }) => {
                for m in live {
                    if !models.iter().any(|(id, _)| id == &m) {
                        models.push((m, false));
                    }
                }
            }
            Ok(prism_core::client::ModelsEvent::Error(e)) => {
                eprintln!("model fetch failed: {e}");
            }
            Err(_) => eprintln!("model fetch timed out"),
        }
    }
    if json_flag(args) {
        let rows: Vec<serde_json::Value> = models
            .iter()
            .map(|(id, is_default)| serde_json::json!({ "id": id, "default": is_default }))
            .collect();
        println!(
            "{}",
            serde_json::to_string_pretty(&serde_json::json!({
                "provider": provider,
                "models": rows,
            }))?
        );
        return Ok(());
    }
    if models.is_empty() {
        println!("No models for {provider} (try --fetch).");
        return Ok(());
    }
    for (id, is_default) in models {
        println!("{}{id}", if is_default { "* " } else { "  " });
    }
    Ok(())
}

/// `prism send <prompt> [--provider id] [--model id] [--system text]
/// [--json]` — one non-interactive completion.
pub fn send_cli(args: &[String]) -> anyhow::Result<()> {
    let words = positional(args);
    let prompt = words.join(" ");
    if prompt.trim().is_empty() {
        anyhow::bail!(
            "usage: prism send <prompt> [--provider id] [--model id] [--system text] [--json]"
        );
    }
    let mut settings = load();
    if let Some(p) = value_after(args, "--provider") {
        settings.provider = p.to_string();
    }
    if let Some(m) = value_after(args, "--model") {
        settings.model = m.to_string();
    }
    if let Some(s) = value_after(args, "--system") {
        settings.system_prompt = s.to_string();
    }
    let history = vec![ChatMessage::text("user", &prompt)];
    let (tx, rx) = std::sync::mpsc::channel::<Event>();
    chat::start_job(&settings, history, &tx).map_err(anyhow::Error::msg)?;
    let mut out = String::new();
    let mut printed = false;
    let as_json = json_flag(args);
    loop {
        match rx.recv_timeout(Duration::from_secs(300)) {
            Ok(Event::Stream(prism_core::client::StreamEvent::Chunk(chunk))) => {
                if as_json {
                    out.push_str(&chunk);
                } else {
                    print!("{chunk}");
                    let _ = std::io::stdout().flush();
                    printed = true;
                }
            }
            Ok(Event::Stream(prism_core::client::StreamEvent::Done)) => break,
            Ok(Event::Stream(prism_core::client::StreamEvent::Error(e))) => {
                anyhow::bail!("{e}");
            }
            Ok(Event::Stream(prism_core::client::StreamEvent::Retrying {
                attempt,
                max,
                delay_ms,
                reason,
            })) => eprintln!("retry {attempt}/{max} in {delay_ms}ms ({reason})"),
            Ok(_) => {}
            Err(e) => anyhow::bail!("stream ended without Done: {e}"),
        }
    }
    if as_json {
        println!(
            "{}",
            serde_json::to_string_pretty(&serde_json::json!({
                "provider": settings.provider,
                "model": if settings.model.is_empty() {
                    settings
                        .resolve_provider(&settings.provider)
                        .map(|r| r.default_model)
                        .unwrap_or_default()
                } else {
                    settings.model.clone()
                },
                "text": out,
            }))?
        );
    } else if printed {
        println!();
    }
    Ok(())
}

/// `prism run <task> [--json]` — one agent run (tools + subagent
/// registry), printing every step and the final answer.
pub fn run_cli(args: &[String]) -> anyhow::Result<()> {
    let words = positional(args);
    let task = words.join(" ");
    if task.trim().is_empty() {
        anyhow::bail!("usage: prism run <task> [--json]");
    }
    let settings = load();
    let workspace = std::env::current_dir()?;
    let (tx, rx) = std::sync::mpsc::channel::<Event>();
    chat::agent_job::spawn(&settings, &task, workspace, &tx).map_err(anyhow::Error::msg)?;
    let mut result = None;
    while let Ok(ev) = rx.recv_timeout(Duration::from_secs(600)) {
        match ev {
            Event::Notice(n) => eprintln!("{n}"),
            Event::AgentDone(r) => {
                result = Some(r);
                break;
            }
            _ => {}
        }
    }
    let result = result.ok_or_else(|| anyhow::anyhow!("agent ended without a result"))?;
    if json_flag(args) {
        println!("{}", serde_json::to_string_pretty(&result)?);
        return Ok(());
    }
    for (i, step) in result.steps.iter().enumerate() {
        println!(
            "[{}/{}] {}: {} -> {}",
            i + 1,
            result.steps.len(),
            step.action,
            step.action_input,
            step.observation
        );
    }
    if result.completed {
        println!("{}", result.answer);
    } else {
        anyhow::bail!(
            "{}",
            result
                .error
                .as_deref()
                .unwrap_or("agent stopped without an answer")
        );
    }
    Ok(())
}

/// `prism status [--json]` — local state plus the running server (if
/// any).
pub fn status_cli(args: &[String]) -> anyhow::Result<()> {
    let settings = load();
    let metas = host::list_conversations();
    let mcp = prism_core::mcp::load_file();
    let server = crate::serve::running_server();
    let status = serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "config_dir": host::config_dir().map(|p| p.display().to_string()),
        "settings": host::settings_path().map(|p| p.display().to_string()),
        "conversations": metas.len(),
        "provider": settings.provider,
        "model": if settings.model.is_empty() {
            settings.resolve_provider(&settings.provider).map(|r| r.default_model).unwrap_or_default()
        } else {
            settings.model.clone()
        },
        "connection": match settings.connection {
            prism_core::settings::Connection::Direct => "direct",
            prism_core::settings::Connection::PrismApi => "api",
        },
        "mcp_config": prism_core::mcp::config_path().map(|p| p.display().to_string()),
        "mcp_servers": mcp.as_ref().map(|f| f.mcp_servers.len()).unwrap_or(0),
        "subagents": chat::agent_job::config_registry().0.names(),
        "server": server,
    });
    if json_flag(args) {
        println!("{}", serde_json::to_string_pretty(&status)?);
        return Ok(());
    }
    println!(
        "prism {} · {}",
        env!("CARGO_PKG_VERSION"),
        status["connection"].as_str().unwrap_or("")
    );
    println!(
        "provider: {} / {}",
        status["provider"].as_str().unwrap_or(""),
        status["model"].as_str().unwrap_or("")
    );
    println!(
        "config: {}",
        status["config_dir"].as_str().unwrap_or("<none>")
    );
    println!(
        "sessions: {} · mcp servers: {} · subagents: {}",
        status["conversations"],
        status["mcp_servers"],
        status["subagents"].as_array().map(|a| a.len()).unwrap_or(0)
    );
    match &server {
        Some(s) => println!(
            "server: running on 127.0.0.1:{} (pid {})",
            s.get("port").and_then(|p| p.as_u64()).unwrap_or(0),
            s.get("pid").and_then(|p| p.as_u64()).unwrap_or(0)
        ),
        None => println!("server: not running (start with prism serve)"),
    }
    Ok(())
}

/// `prism agents [list|show <name>|run <name> <task>] [--json]`.
pub fn agents_cli(args: &[String]) -> anyhow::Result<()> {
    let (registry, warnings) = chat::agent_job::config_registry();
    let words = positional(args);
    let sub = words.first().copied().unwrap_or("list");
    match sub {
        "list" => {
            if json_flag(args) {
                let specs: Vec<serde_json::Value> = registry
                    .names()
                    .iter()
                    .filter_map(|n| registry.get(n))
                    .map(|s| {
                        serde_json::json!({
                            "name": s.name,
                            "description": s.description,
                            "forced_model": s.forced_model,
                            "tool_allowlist": s.tool_allowlist,
                        })
                    })
                    .collect();
                println!("{}", serde_json::to_string_pretty(&specs)?);
            } else {
                for name in registry.names() {
                    if let Some(spec) = registry.get(&name) {
                        let model = spec
                            .forced_model
                            .as_ref()
                            .map(|m| format!(" · model {m}"))
                            .unwrap_or_default();
                        let tools = if spec.tool_allowlist.is_empty() {
                            "full surface".to_string()
                        } else {
                            spec.tool_allowlist.join(", ")
                        };
                        println!("{}: {}", spec.name, spec.description);
                        println!("  tools: {tools}{model}");
                    }
                }
            }
        }
        "show" => {
            let name = words
                .get(1)
                .ok_or_else(|| anyhow::anyhow!("usage: prism agents show <name>"))?;
            let spec = registry
                .get(name)
                .ok_or_else(|| anyhow::anyhow!("unknown subagent {name:?}"))?;
            println!("{}", serde_json::to_string_pretty(spec)?);
        }
        "run" => {
            let name = words
                .get(1)
                .ok_or_else(|| anyhow::anyhow!("usage: prism agents run <name> <task>"))?;
            let task = words[2..].join(" ");
            if task.trim().is_empty() {
                anyhow::bail!("usage: prism agents run <name> <task>");
            }
            let settings = load();
            let workspace = std::env::current_dir()?;
            let (tx, rx) = std::sync::mpsc::channel::<Event>();
            chat::agent_job::spawn_subagent(&settings, "cli", name, &task, workspace, &tx)
                .map_err(anyhow::Error::msg)?;
            let mut done = None;
            while let Ok(ev) = rx.recv_timeout(Duration::from_secs(600)) {
                match ev {
                    Event::Notice(n) => eprintln!("{n}"),
                    Event::SubagentDone { result, .. } => {
                        done = Some(result);
                        break;
                    }
                    _ => {}
                }
            }
            let result = done.ok_or_else(|| anyhow::anyhow!("subagent ended without a result"))?;
            if json_flag(args) {
                println!("{}", serde_json::to_string_pretty(&result)?);
            } else if result.completed {
                println!("{}", result.answer);
            } else {
                anyhow::bail!("{}", result.error.as_deref().unwrap_or("subagent stopped"));
            }
        }
        other => anyhow::bail!("unknown agents subcommand {other:?} (list|show|run)"),
    }
    for w in warnings {
        eprintln!("config warning: {w}");
    }
    Ok(())
}

/// `prism permissions [list|tools|set <tool> allow|ask|deny|default
/// <level|registry>|reset [tool]] [--json]` — persisted tool policy.
pub fn permissions_cli(args: &[String]) -> anyhow::Result<()> {
    let mut settings = load();
    let words = positional(args);
    let sub = words.first().copied().unwrap_or("list");
    match sub {
        "list" => {
            let rows: Vec<(String, String)> = chat::agent_job::available_tool_names()
                .into_iter()
                .map(|tool| {
                    let level = settings
                        .tool_permission(&tool)
                        .map(|p| p.label().to_string())
                        .unwrap_or_else(|| "registry".into());
                    (tool, level)
                })
                .collect();
            if json_flag(args) {
                let map: std::collections::BTreeMap<_, _> = rows.into_iter().collect();
                println!(
                    "{}",
                    serde_json::to_string_pretty(&serde_json::json!({
                        "default": if settings.default_tool_permission.is_empty() {
                            "registry".to_string()
                        } else {
                            settings.default_tool_permission.clone()
                        },
                        "tools": map,
                    }))?
                );
            } else {
                println!(
                    "default: {}",
                    if settings.default_tool_permission.is_empty() {
                        "registry"
                    } else {
                        &settings.default_tool_permission
                    }
                );
                for (tool, level) in rows {
                    println!("  {tool}: {level}");
                }
            }
        }
        "tools" => {
            for tool in chat::agent_job::available_tool_names() {
                println!("{tool}");
            }
        }
        "set" => {
            let (tool, level) = match words.as_slice() {
                [_, tool, level, ..] => (*tool, *level),
                _ => anyhow::bail!("usage: prism permissions set <tool> allow|ask|deny"),
            };
            if !matches!(level, "allow" | "ask" | "deny") {
                anyhow::bail!("level must be allow, ask or deny");
            }
            if !chat::agent_job::available_tool_names()
                .iter()
                .any(|t| t == tool)
            {
                anyhow::bail!("no such tool: {tool} (see prism permissions tools)");
            }
            settings
                .tool_permissions
                .insert(tool.to_string(), level.to_string());
            save(&settings)?;
            println!("{tool}: {level}");
        }
        "default" => {
            let level = words.get(1).ok_or_else(|| {
                anyhow::anyhow!("usage: prism permissions default <allow|ask|deny|registry>")
            })?;
            if !matches!(*level, "allow" | "ask" | "deny" | "registry") {
                anyhow::bail!("level must be allow, ask, deny or registry");
            }
            settings.default_tool_permission = if *level == "registry" {
                String::new()
            } else {
                level.to_string()
            };
            save(&settings)?;
            println!("default: {level}");
        }
        "reset" => match words.get(1) {
            Some(tool) => {
                settings.tool_permissions.remove(*tool);
                save(&settings)?;
                println!("{tool}: registry default");
            }
            None => {
                settings.tool_permissions.clear();
                settings.default_tool_permission.clear();
                save(&settings)?;
                println!("permissions reset to registry defaults");
            }
        },
        other => anyhow::bail!("unknown permissions subcommand {other:?}"),
    }
    Ok(())
}

/// `prism mcp [list|tools|test|call <server> <tool> [json]]` — probe
/// and drive the configured stdio servers directly.
pub fn mcp_cli(args: &[String]) -> anyhow::Result<()> {
    let words = positional(args);
    let sub = words.first().copied().unwrap_or("list");
    let path = prism_core::mcp::config_path()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| "<no config root>".into());
    match sub {
        "list" => {
            match prism_core::mcp::load_file() {
                Some(file) if !file.mcp_servers.is_empty() => {
                    println!("{path}");
                    for (name, cfg) in &file.mcp_servers {
                        println!("  {name}: {} {}", cfg.command, cfg.args.join(" "));
                    }
                }
                Some(_) => println!("{path} has no usable servers"),
                None => println!("no configuration at {path}"),
            }
            Ok(())
        }
        "tools" | "test" => {
            let Some(file) = prism_core::mcp::load_file() else {
                anyhow::bail!("no configuration at {path}");
            };
            if file.mcp_servers.is_empty() {
                anyhow::bail!("{path} has no usable servers");
            }
            let started = std::time::Instant::now();
            let surface = prism_core::mcp::McpSurface::connect(&file, Duration::from_secs(10));
            if sub == "test" {
                println!(
                    "connected {} tool(s) from {} server(s) in {} ms",
                    surface.tools.len(),
                    file.mcp_servers.len(),
                    started.elapsed().as_millis()
                );
            }
            if json_flag(args) {
                let tools: Vec<serde_json::Value> = surface
                    .tools
                    .iter()
                    .map(|t| {
                        serde_json::json!({
                            "name": t.advertised,
                            "server": t.server_name(),
                            "raw": t.raw,
                            "description": t.description(),
                        })
                    })
                    .collect();
                println!(
                    "{}",
                    serde_json::to_string_pretty(&serde_json::json!({
                        "tools": tools,
                        "errors": surface.errors,
                    }))?
                );
            } else {
                for t in &surface.tools {
                    println!(
                        "{} ({}): {}",
                        t.advertised,
                        t.server_name(),
                        t.description()
                    );
                }
                for e in &surface.errors {
                    eprintln!("failed: {e}");
                }
            }
            if !surface.errors.is_empty() {
                anyhow::bail!("{} server(s) failed", surface.errors.len());
            }
            Ok(())
        }
        "call" => {
            let server = words
                .get(1)
                .ok_or_else(|| anyhow::anyhow!("usage: prism mcp call <server> <tool> [json]"))?;
            let tool = words
                .get(2)
                .ok_or_else(|| anyhow::anyhow!("usage: prism mcp call <server> <tool> [json]"))?;
            let input = words.get(3).copied().unwrap_or("");
            let Some(file) = prism_core::mcp::load_file() else {
                anyhow::bail!("no configuration at {path}");
            };
            let Some(cfg) = file.mcp_servers.get(*server) else {
                anyhow::bail!(
                    "unknown server {server:?} (configured: {})",
                    file.mcp_servers
                        .keys()
                        .cloned()
                        .collect::<Vec<_>>()
                        .join(", ")
                );
            };
            let handle =
                prism_core::mcp::StdioMcpServer::spawn(server, cfg, Duration::from_secs(20))
                    .map_err(anyhow::Error::msg)?;
            let raw_tools = handle.list_tools().map_err(anyhow::Error::msg)?;
            let entry = raw_tools
                .iter()
                .find(|t| t.get("name").and_then(|n| n.as_str()) == Some(tool))
                .ok_or_else(|| anyhow::anyhow!("server {server:?} has no tool {tool:?}"))?;
            let schema = entry
                .get("inputSchema")
                .cloned()
                .unwrap_or(serde_json::json!({}));
            let out = handle.call_tool(tool, input, &schema);
            println!("{out}");
            handle.stop();
            if out.starts_with("Error:") {
                anyhow::bail!("tool call failed");
            }
            Ok(())
        }
        other => anyhow::bail!("unknown mcp subcommand {other:?} (list|tools|test|call)"),
    }
}

/// `prism ping [--json]` — the running server, else the provider
/// endpoint (TCP reachability; no key is spent).
pub fn ping_cli(args: &[String]) -> anyhow::Result<()> {
    if let Some(server) = crate::serve::ping_server() {
        if json_flag(args) {
            println!("{}", serde_json::to_string_pretty(&server)?);
        } else {
            println!("server ok: {}", server);
        }
        return Ok(());
    }
    let settings = load();
    let resolved = settings
        .resolve_provider(&settings.provider)
        .ok_or_else(|| anyhow::anyhow!("unknown provider {}", settings.provider))?;
    let started = std::time::Instant::now();
    let target = host_port(&resolved.base_url)?;
    let addr = target
        .parse()
        .map_err(|e| anyhow::anyhow!("bad endpoint {target}: {e}"))?;
    let result = std::net::TcpStream::connect_timeout(&addr, Duration::from_secs(5));
    let elapsed = started.elapsed().as_millis();
    match result {
        Ok(_) => {
            if json_flag(args) {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&serde_json::json!({
                        "server": null,
                        "provider": settings.provider,
                        "endpoint": target,
                        "reachable": true,
                        "latency_ms": elapsed,
                    }))?
                );
            } else {
                println!(
                    "{} {} reachable in {} ms",
                    settings.provider, target, elapsed
                );
            }
            Ok(())
        }
        Err(e) => anyhow::bail!("{} {} unreachable: {e}", settings.provider, target),
    }
}

fn host_port(url: &str) -> anyhow::Result<String> {
    let rest = url
        .split_once("://")
        .map(|(_, r)| r)
        .unwrap_or(url)
        .split('/')
        .next()
        .unwrap_or("");
    if rest.is_empty() {
        anyhow::bail!("no host in {url}");
    }
    let https = url.starts_with("https://");
    Ok(if rest.contains(':') {
        rest.to_string()
    } else {
        format!("{rest}:{}", if https { 443 } else { 80 })
    })
}

/// `prism auth [list|set <provider> <key>|clear <provider>|env]`.
pub fn auth_cli(args: &[String]) -> anyhow::Result<()> {
    let mut settings = load();
    let words = positional(args);
    match words.first().copied().unwrap_or("list") {
        "list" => {
            let rows: Vec<serde_json::Value> = prism_core::providers::PROVIDERS
                .iter()
                .map(|p| {
                    let key = settings.key_for(p.id);
                    let source = if settings
                        .provider_keys
                        .get(p.id)
                        .map(|k| !k.trim().is_empty())
                        .unwrap_or(false)
                        || (!settings.api_key.trim().is_empty() && !p.needs_key)
                    {
                        "stored"
                    } else if !key.trim().is_empty() {
                        "env"
                    } else if p.needs_key {
                        "missing"
                    } else {
                        "not required"
                    };
                    serde_json::json!({
                        "provider": p.id,
                        "label": p.label,
                        "needs_key": p.needs_key,
                        "source": source,
                    })
                })
                .collect();
            if json_flag(args) {
                println!("{}", serde_json::to_string_pretty(&rows)?);
            } else {
                for r in &rows {
                    println!(
                        "{:<14} {:<22} {}",
                        r["provider"].as_str().unwrap_or(""),
                        r["label"].as_str().unwrap_or(""),
                        r["source"].as_str().unwrap_or("")
                    );
                }
            }
        }
        "set" => {
            let (provider, key) = match words.as_slice() {
                [_, provider, key, ..] => (*provider, *key),
                _ => anyhow::bail!("usage: prism auth set <provider> <key>"),
            };
            if settings.resolve_provider(provider).is_none() {
                anyhow::bail!("unknown provider {provider}");
            }
            settings
                .provider_keys
                .insert(provider.to_string(), key.to_string());
            save(&settings)?;
            println!("{provider}: key stored");
        }
        "clear" => {
            let provider = words
                .get(1)
                .ok_or_else(|| anyhow::anyhow!("usage: prism auth clear <provider>"))?;
            settings.provider_keys.remove(*provider);
            if *provider == settings.provider {
                settings.api_key.clear();
            }
            save(&settings)?;
            println!("{provider}: stored key cleared");
        }
        "env" => {
            for p in prism_core::providers::PROVIDERS {
                if p.env.is_empty() {
                    continue;
                }
                let found: Vec<&str> = p
                    .env
                    .iter()
                    .copied()
                    .filter(|name| {
                        std::env::var(name)
                            .map(|v| !v.trim().is_empty())
                            .unwrap_or(false)
                    })
                    .collect();
                if !found.is_empty() {
                    println!("{}: {}", p.id, found.join(", "));
                }
            }
        }
        other => anyhow::bail!("unknown auth subcommand {other:?} (list|set|clear|env)"),
    }
    Ok(())
}

/// `prism pair <browser|slint|remote> [--ttl seconds] [--json]` — mint
/// a one-time pairing token written under `<config>/pair/`. The server
/// accepts it as `Authorization: Bearer` when `prism serve --token-file`
/// points at the same file.
pub fn pair_cli(args: &[String]) -> anyhow::Result<()> {
    let words = positional(args);
    let target = words.first().copied().ok_or_else(|| {
        anyhow::anyhow!("usage: prism pair <browser|slint|remote> [--ttl seconds]")
    })?;
    if !matches!(target, "browser" | "slint" | "remote") {
        anyhow::bail!("target must be browser, slint or remote");
    }
    let ttl = value_after(args, "--ttl")
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(900);
    let root = host::config_dir().ok_or_else(|| anyhow::anyhow!("no config dir"))?;
    let dir = root.join("pair");
    std::fs::create_dir_all(&dir)?;
    let now = prism_core::conversations::now_ms();
    // No RNG dependency: mix the clock, pid and a per-process counter.
    let mut seed = now ^ (std::process::id() as u64).rotate_left(17);
    let mut token = String::new();
    for i in 0..32u64 {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        token.push_str(&format!("{:x}", (seed >> (i % 8)) & 0xf));
    }
    let record = serde_json::json!({
        "target": target,
        "token": token,
        "created_at": now,
        "expires_at": now + ttl * 1000,
        "version": env!("CARGO_PKG_VERSION"),
    });
    let path = dir.join(format!("{target}.json"));
    std::fs::write(&path, serde_json::to_string_pretty(&record)?)?;
    if json_flag(args) {
        println!("{}", serde_json::to_string_pretty(&record)?);
        return Ok(());
    }
    let url = match target {
        "browser" => "http://127.0.0.1:7420/pair",
        "slint" => "prism-slint --pair",
        _ => "prism serve --token-file",
    };
    println!(
        "paired {target} · token {token} · expires in {ttl}s\n  written: {}\n  use with: {url}",
        path.display()
    );
    Ok(())
}

/// `prism debug [--json]` — redacted diagnostics bundle.
pub fn debug_cli(_args: &[String]) -> anyhow::Result<()> {
    let settings = load();
    let redacted_keys: std::collections::BTreeMap<String, String> = settings
        .provider_keys
        .iter()
        .map(|(k, v)| {
            (
                k.clone(),
                if v.trim().is_empty() {
                    "".into()
                } else {
                    "***".into()
                },
            )
        })
        .collect();
    let locals: Vec<serde_json::Value> = prism_core::local::LOCAL_PROVIDERS
        .iter()
        .map(|p| {
            serde_json::json!({
                "id": p.id,
                "health": format!("{:?}", host::probe_local(p.id, None)),
            })
        })
        .collect();
    let bundle = serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"),
        "platform": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "config_dir": host::config_dir().map(|p| p.display().to_string()),
        "conversations_dir": host::conversations_dir().map(|p| p.display().to_string()),
        "settings_path": host::settings_path().map(|p| p.display().to_string()),
        "settings": {
            "connection": match settings.connection {
                prism_core::settings::Connection::Direct => "direct",
                prism_core::settings::Connection::PrismApi => "api",
            },
            "provider": settings.provider,
            "model": settings.model,
            "temperature": settings.temperature,
            "max_tokens": settings.max_tokens,
            "thinking": settings.thinking_enabled,
            "keys": redacted_keys,
            "tool_permissions": settings.tool_permissions,
            "default_tool_permission": settings.default_tool_permission,
        },
        "conversations": host::list_conversations().len(),
        "mcp": {
            "path": prism_core::mcp::config_path().map(|p| p.display().to_string()),
            "servers": prism_core::mcp::load_file().map(|f| f.mcp_servers.keys().cloned().collect::<Vec<_>>()).unwrap_or_default(),
        },
        "subagents": chat::agent_job::config_registry().0.names(),
        "locals": locals,
        "server": crate::serve::running_server(),
        "env": {
            "PRISM_CONFIG_DIR": std::env::var("PRISM_CONFIG_DIR").ok(),
            "PRISM_CONVERSATIONS_DIR": std::env::var("PRISM_CONVERSATIONS_DIR").ok(),
            "PRISM_MCP_CONFIG": std::env::var("PRISM_MCP_CONFIG").ok(),
            "PRISM_AGENT_SANDBOX_POLICY": std::env::var("PRISM_AGENT_SANDBOX_POLICY").ok(),
        },
    });
    println!("{}", serde_json::to_string_pretty(&bundle)?);
    Ok(())
}

/// `prism reload` — re-read settings and re-apply the running server's
/// config (the server reloads settings per request, so this also reports
/// what changed on disk).
pub fn reload_cli(args: &[String]) -> anyhow::Result<()> {
    let settings = load();
    let mcp = prism_core::mcp::load_file();
    let out = serde_json::json!({
        "settings": host::settings_path().map(|p| p.display().to_string()),
        "provider": settings.provider,
        "model": settings.model,
        "mcp_servers": mcp.map(|f| f.mcp_servers.len()).unwrap_or(0),
        "server": crate::serve::reload_server(),
    });
    if json_flag(args) {
        println!("{}", serde_json::to_string_pretty(&out)?);
    } else {
        println!(
            "reloaded {} · provider {} · mcp servers {}",
            out["settings"].as_str().unwrap_or("<no settings>"),
            out["provider"].as_str().unwrap_or(""),
            out["mcp_servers"]
        );
    }
    Ok(())
}

/// `prism api [status|url <url>|token <token>]` — the Prism API
/// connection (the same field the desktop uses for server mode).
pub fn api_cli(args: &[String]) -> anyhow::Result<()> {
    let mut settings = load();
    let words = positional(args);
    match words.first().copied().unwrap_or("status") {
        "status" => {
            let started = std::time::Instant::now();
            let target = host_port(&settings.prism_api_url)?;
            let addr = target
                .parse()
                .map_err(|e| anyhow::anyhow!("bad API url: {e}"))?;
            let reachable =
                std::net::TcpStream::connect_timeout(&addr, Duration::from_secs(5)).is_ok();
            let out = serde_json::json!({
                "url": settings.prism_api_url,
                "token": if settings.prism_api_token.trim().is_empty() { "missing" } else { "set" },
                "reachable": reachable,
                "latency_ms": started.elapsed().as_millis(),
            });
            if json_flag(args) {
                println!("{}", serde_json::to_string_pretty(&out)?);
            } else {
                println!(
                    "{} · token {} · {}",
                    out["url"].as_str().unwrap_or(""),
                    out["token"].as_str().unwrap_or(""),
                    if reachable {
                        "reachable"
                    } else {
                        "unreachable"
                    }
                );
            }
        }
        "url" => {
            let url = words
                .get(1)
                .ok_or_else(|| anyhow::anyhow!("usage: prism api url <url>"))?;
            settings.prism_api_url = url.to_string();
            save(&settings)?;
            println!("api url: {url}");
        }
        "token" => {
            let token = words
                .get(1)
                .ok_or_else(|| anyhow::anyhow!("usage: prism api token <token>"))?;
            settings.prism_api_token = token.to_string();
            save(&settings)?;
            println!("api token stored");
        }
        other => anyhow::bail!("unknown api subcommand {other:?} (status|url|token)"),
    }
    Ok(())
}

/// `prism update [--check] [--yes]` — check the local checkout, then
/// reinstall the binary from it with cargo.
pub fn update_cli(args: &[String]) -> anyhow::Result<()> {
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    println!(
        "prism {} at {}",
        env!("CARGO_PKG_VERSION"),
        manifest.display()
    );
    if args.iter().any(|a| a == "--check") {
        let status = std::process::Command::new("git")
            .arg("-C")
            .arg(manifest)
            .args(["log", "-1", "--oneline"])
            .output();
        match status {
            Ok(o) if o.status.success() => {
                println!("checkout: {}", String::from_utf8_lossy(&o.stdout).trim());
            }
            _ => println!("checkout: not a git worktree"),
        }
        return Ok(());
    }
    if !args.iter().any(|a| a == "--yes") {
        anyhow::bail!(
            "reinstall with: cargo install --path {} --force (or pass --yes)",
            manifest.display()
        );
    }
    let status = std::process::Command::new("cargo")
        .arg("install")
        .arg("--path")
        .arg(manifest)
        .arg("--force")
        .status()?;
    if !status.success() {
        anyhow::bail!("cargo install failed with {status}");
    }
    println!("updated prism from {}", manifest.display());
    Ok(())
}

/// `prism uninstall [--yes] [--purge]` — remove the cargo-installed
/// binary and (with --purge) the config root.
pub fn uninstall_cli(args: &[String]) -> anyhow::Result<()> {
    let purge = args.iter().any(|a| a == "--purge");
    if !args.iter().any(|a| a == "--yes") {
        println!("prism {} — uninstall would:", env!("CARGO_PKG_VERSION"));
        println!("  cargo uninstall prism-cli");
        if purge {
            if let Some(dir) = host::config_dir() {
                println!("  rm -rf {}", dir.display());
            }
        }
        println!("pass --yes to apply");
        return Ok(());
    }
    let status = std::process::Command::new("cargo")
        .args(["uninstall", "prism-cli"])
        .status();
    match status {
        Ok(s) if s.success() => println!("prism-cli removed"),
        Ok(s) => eprintln!(
            "cargo uninstall exited with {s} (binary may have been installed another way)"
        ),
        Err(e) => eprintln!("cargo not available: {e} (remove the binary manually)"),
    }
    if purge {
        if let Some(dir) = host::config_dir() {
            std::fs::remove_dir_all(&dir)?;
            println!("removed {}", dir.display());
        }
    }
    Ok(())
}
