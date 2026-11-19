//! Turn settings + history into a background chat job.
//!
//! Mirrors the proven egui host recipe: system prompt first, thinking
//! instruction applied to messages, hardware overrides only on Ollama's
//! native endpoint, Prism API sends only the latest user content.

use crate::events::{self, Event};
use prism_core::client::{
    ApiChatRequest, ChatMessage, OllamaChatRequest, StreamEvent, StreamRequest,
};
use prism_core::host;
use prism_core::providers;
use prism_core::settings::{Connection, Settings};
use prism_core::thinking;
use std::sync::mpsc::Sender;

/// Start a generation in the background. `tx` receives `Event::Stream`
/// updates. Returns `Err` with a user-facing message for missing keys.
pub fn start_job(
    settings: &Settings,
    mut history: Vec<ChatMessage>,
    tx: &Sender<Event>,
) -> Result<(), String> {
    let (stx, srx) = std::sync::mpsc::channel::<StreamEvent>();
    match settings.connection {
        Connection::Direct => {
            let resolved = settings.resolve_provider(&settings.provider);
            let needs_key = resolved.as_ref().map(|r| r.needs_key).unwrap_or(false);
            let key = settings.key_for(&settings.provider);
            if needs_key && key.trim().is_empty() {
                let label = resolved
                    .as_ref()
                    .map(|r| r.label.as_str())
                    .unwrap_or("provider");
                return Err(format!("API key required for {label} — /key <key>"));
            }
            if !settings.system_prompt.trim().is_empty() {
                history.insert(
                    0,
                    ChatMessage::text("system", settings.system_prompt.trim()),
                );
            }
            // Plugin system-prompt suffixes (communication tone, skills).
            let registry = prism_core::plugins::Registry::with_defaults();
            let suffix = registry.system_prompt_suffix(
                &*host::storage(),
                host::config_dir().as_deref(),
                settings,
            );
            if !suffix.trim().is_empty() {
                let combined = format!("{}\n\n{}", settings.system_prompt.trim(), suffix.trim());
                history.insert(0, ChatMessage::text("system", &combined));
            }
            if settings.thinking_enabled {
                history = thinking::apply_thinking_to_messages(&history);
            }
            // Hardware overrides only reach Ollama through its native
            // endpoint; the OpenAI-compat path ignores them.
            let hw = &settings.hardware;
            if settings.provider == "ollama" && hw.has_overrides() {
                let root = providers::ollama_root_url(&settings.local_base_url);
                let num_gpu = if hw.preferred_compute == "cpu-only" {
                    Some(0)
                } else {
                    hw.gpu_layers_override
                };
                let req = OllamaChatRequest {
                    base_url: root,
                    model: effective_model(settings),
                    temperature: settings.temperature,
                    messages: history,
                    num_ctx: hw.context_tokens,
                    num_gpu,
                    max_tokens: settings.max_tokens,
                };
                host::spawn_ollama_chat(req, stx);
            } else {
                let base_url = resolved
                    .as_ref()
                    .map(|r| r.base_url.clone())
                    .unwrap_or_default();
                let req = StreamRequest {
                    base_url,
                    api_key: key.trim().to_string(),
                    model: effective_model(settings),
                    temperature: settings.temperature,
                    messages: history,
                    max_tokens: settings.max_tokens,
                    top_p: settings.top_p,
                    frequency_penalty: settings.frequency_penalty,
                    presence_penalty: settings.presence_penalty,
                };
                host::spawn_stream(req, stx);
            }
        }
        Connection::PrismApi => {
            if settings.prism_api_token.trim().is_empty() {
                return Err("Prism API token required — set prism_api_token in settings".into());
            }
            let req = ApiChatRequest {
                server_url: settings.prism_api_url.trim().to_string(),
                token: settings.prism_api_token.trim().to_string(),
                content: history
                    .last()
                    .map(|m| m.content.clone())
                    .unwrap_or_default(),
            };
            host::spawn_api_chat(req, stx);
        }
    }
    events::spawn_stream_forward(srx, tx.clone());
    Ok(())
}

pub fn effective_model(settings: &Settings) -> String {
    if !settings.model.trim().is_empty() {
        settings.model.trim().to_string()
    } else {
        providers::find(&settings.provider)
            .map(|p| p.default_model.to_string())
            .unwrap_or_default()
    }
}

/// Run the core agent loop in a background thread and forward steps as
/// events. Uses `prism_core::agent::run_agent` with a blocking LLM step
/// over the shared reqwest transport; native file tools are registered
/// against the workspace root. Streaming surfaces drive the same loop
/// via their own StepFn — loop semantics live in the core only.
pub mod agent_job {
    use super::*;
    use prism_core::agent::{run_agent, AgentResult, CalculatorTool, StepMessage, ToolRegistry};
    use prism_core::native_tools::{self};
    use prism_core::sandbox::{resolve_policy, ResolvedSandbox, SandboxPolicy};
    use prism_core::subagents::SubagentRegistry;
    use prism_core::transport::{HttpRequest, ReqwestTransport, Transport};
    use std::time::Duration;

    struct FilelessLlmStep<'a> {
        transport: &'a ReqwestTransport,
        base_url: String,
        api_key: String,
        model: String,
        temperature: f32,
        max_tokens: Option<u32>,
    }

    impl<'a> FilelessLlmStep<'a> {
        /// One blocking completion over the OpenAI-compat endpoint.
        fn complete(&self, system: &str, history: &[StepMessage]) -> Result<String, String> {
            let body = serde_json::json!({
                "model": self.model,
                "temperature": self.temperature,
                "max_tokens": self.max_tokens.unwrap_or(2048),
                "messages": std::iter::once(serde_json::json!({
                    "role": "system", "content": system,
                }))
                .chain(history.iter().map(|m| serde_json::json!({
                    "role": m.role, "content": m.content,
                })))
                .collect::<Vec<_>>(),
            });
            let mut headers = vec![("Content-Type".to_string(), "application/json".to_string())];
            if !self.api_key.is_empty() {
                headers.push((
                    "Authorization".to_string(),
                    format!("Bearer {}", self.api_key),
                ));
            }
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .map_err(|e| format!("runtime: {e}"))?;
            rt.block_on(async {
                let bytes = self
                    .transport
                    .post_body(HttpRequest {
                        url: prism_core::providers::chat_completions_url(&self.base_url),
                        headers,
                        body: Some(body.to_string()),
                    })
                    .await?;
                let v: serde_json::Value =
                    serde_json::from_slice(&bytes).map_err(|e| format!("json: {e}"))?;
                v["choices"][0]["message"]["content"]
                    .as_str()
                    .map(String::from)
                    .ok_or_else(|| "missing choices[0].message.content in response".into())
            })
        }
    }

    /// Load the sandbox policy: a path to a policy JSON file, or inline
    /// JSON (`PRISM_AGENT_SANDBOX_POLICY` accepts both).
    fn load_sandbox_policy(source: &str) -> Result<ResolvedSandbox, String> {
        let text = match std::fs::read_to_string(source) {
            Ok(text) => text,
            Err(_) if source.contains('{') => source.to_string(),
            Err(e) => {
                return Err(match std::fs::exists(source) {
                    Ok(true) => format!("sandbox policy {source}: {e}"),
                    _ => format!("sandbox policy: could not open {source} ({e})"),
                })
            }
        };
        let policy: SandboxPolicy =
            prism_core::sandbox::parse_policy(&text).map_err(|e| format!("policy: {e}"))?;
        Ok(resolve_policy(&policy))
    }

    /// Spawn the agent loop; `tx` receives `Event::Stream` updates keyed
    /// as system lines (step thoughts/actions) plus the final answer.
    pub fn spawn(
        settings: &Settings,
        task: &str,
        workspace_root: std::path::PathBuf,
        tx: &Sender<Event>,
    ) -> Result<(), String> {
        let (resolved, api_key) = credentials(settings)?;
        let step_impl = FilelessLlmStep {
            transport: Box::leak(Box::new(ReqwestTransport::new())),
            base_url: resolved.base_url.clone(),
            api_key: api_key.trim().to_string(),
            model: if settings.model.trim().is_empty() {
                resolved.default_model.clone()
            } else {
                settings.model.trim().to_string()
            },
            temperature: settings.temperature,
            max_tokens: settings.max_tokens,
        };
        let sandbox = sandbox_posture()?;
        let task = task.to_string();
        let settings = settings.clone();
        let tx = tx.clone();

        // Agent loop runs on its own thread (blocking LLM steps), tools
        // scoped to the workspace root. Mutating tools stay on Ask =>
        // headless deny unless the user flips them with /agent-perms.
        std::thread::spawn(move || {
            let registry = build_registry(&workspace_root, &sandbox);
            register_mcp(&registry, &tx);
            apply_permissions(&registry, &settings);

            let result: AgentResult = {
                let mut step_fn =
                    |system: &str, hist: &[StepMessage]| step_impl.complete(system, hist);
                run_agent(&task, &mut step_fn, &registry, 12, &|_, _| false)
            };

            let _ = tx.send(Event::AgentDone(result));
        });
        Ok(())
    }

    /// Spawn one background subagent run. The model comes from the
    /// core's forced order (spec → session → provider default) and the
    /// tool surface is the core's allowlist clamp over this host's
    /// registry (with MCP tools when the config provides them).
    pub fn spawn_subagent(
        settings: &Settings,
        id: &str,
        spec_name: &str,
        task: &str,
        workspace_root: std::path::PathBuf,
        tx: &Sender<Event>,
    ) -> Result<(), String> {
        let (resolved, api_key) = credentials(settings)?;
        let (registry_specs, _warnings) = config_registry();
        // Unknown name fails here, before any thread spawns.
        registry_specs
            .get(spec_name)
            .ok_or_else(|| format!("unknown subagent {spec_name:?}"))?;
        let session_model = if settings.model.trim().is_empty() {
            resolved.default_model.clone()
        } else {
            settings.model.trim().to_string()
        };
        let model = registry_specs
            .resolve_model(
                spec_name,
                &session_model,
                Some(resolved.default_model.clone()),
            )
            .map_err(|e| format!("subagent model: {e}"))?
            .model;
        let step_impl = FilelessLlmStep {
            transport: Box::leak(Box::new(ReqwestTransport::new())),
            base_url: resolved.base_url.clone(),
            api_key: api_key.trim().to_string(),
            model,
            temperature: settings.temperature,
            max_tokens: settings.max_tokens,
        };
        let sandbox = sandbox_posture()?;
        let id = id.to_string();
        let spec_name = spec_name.to_string();
        let task = task.to_string();
        let settings = settings.clone();
        let tx = tx.clone();

        std::thread::spawn(move || {
            let registry = build_registry(&workspace_root, &sandbox);
            register_mcp(&registry, &tx);
            apply_permissions(&registry, &settings);
            // Clamp: the allowlist intersected with what this host
            // actually advertises (empty allowlist = full surface).
            let effective = registry_specs.clamp_tools(&spec_name, &registry.tool_names());
            let registry = match effective {
                Ok(names) => filter_registry(&registry, &names),
                Err(e) => {
                    let _ = tx.send(Event::SubagentDone {
                        id,
                        spec: spec_name,
                        result: AgentResult {
                            answer: String::new(),
                            steps: Vec::new(),
                            completed: false,
                            error: Some(e),
                        },
                    });
                    return;
                }
            };

            let result: AgentResult = {
                let mut step_fn =
                    |system: &str, hist: &[StepMessage]| step_impl.complete(system, hist);
                run_agent(&task, &mut step_fn, &registry, 12, &|_, _| false)
            };
            let _ = tx.send(Event::SubagentDone {
                id,
                spec: spec_name,
                result,
            });
        });
        Ok(())
    }

    /// Provider resolution + key check shared by the mainline and
    /// subagent spawn paths.
    fn credentials(
        settings: &Settings,
    ) -> Result<(prism_core::settings::ResolvedProvider, String), String> {
        let resolved = settings
            .resolve_provider(&settings.provider)
            .ok_or_else(|| format!("unknown provider {}", settings.provider))?;
        let api_key = settings.key_for(&settings.provider);
        if resolved.needs_key && api_key.trim().is_empty() {
            return Err(format!(
                "API key required for {} — /key <key>",
                resolved.label
            ));
        }
        Ok((resolved, api_key))
    }

    /// The sandbox posture before anything spawns
    /// (`PRISM_AGENT_SANDBOX_POLICY` = inline policy JSON or a path).
    /// A strict policy this host cannot enforce fails the job instead
    /// of silently weakening; `auto` keeps running with the record kept
    /// in each shell observation.
    fn sandbox_posture(
    ) -> Result<Option<(ResolvedSandbox, prism_core::sandbox::SandboxUsed)>, String> {
        let Ok(source) = std::env::var("PRISM_AGENT_SANDBOX_POLICY") else {
            return Ok(None);
        };
        let resolved = load_sandbox_policy(&source)?;
        match prism_core::sandbox::plan_spawn(&resolved) {
            Ok(used) => Ok(Some((resolved, used))),
            Err(outcome) => {
                let reason = prism_core::sandbox::outcome_str(&outcome);
                Err(format!("sandbox preflight: {reason}"))
            }
        }
    }

    /// Connect every configured MCP server and register its tools in
    /// this run's registry. Failures are reported as system lines; a
    /// dead server never stops the run (Cursor behaves the same).
    fn register_mcp(registry: &ToolRegistry, tx: &Sender<Event>) {
        let Some(file) = prism_core::mcp::load_file() else {
            return;
        };
        if file.mcp_servers.is_empty() {
            return;
        }
        let surface = prism_core::mcp::McpSurface::connect(&file, Duration::from_secs(10));
        for tool in &surface.tools {
            registry.register(tool.clone());
        }
        if !surface.tools.is_empty() {
            let _ = tx.send(Event::Notice(format!(
                "mcp: {} tool(s) registered from {} server config(s)",
                surface.tools.len(),
                file.mcp_servers.len()
            )));
        }
        for e in &surface.errors {
            let _ = tx.send(Event::Notice(format!("mcp: {e}")));
        }
    }

    /// The subagent registry this host runs with: the shipped profiles
    /// plus the `subagents` entries in the shared MCP config file.
    pub fn config_registry() -> (SubagentRegistry, Vec<String>) {
        let mut reg = SubagentRegistry::default();
        let warnings = match prism_core::mcp::load_file() {
            Some(file) => reg.upsert_config_specs(&file.subagents).1,
            None => Vec::new(),
        };
        (reg, warnings)
    }

    /// A registry with only the named tools (the subagent clamp).
    fn filter_registry(registry: &ToolRegistry, names: &[String]) -> ToolRegistry {
        let filtered = ToolRegistry::new();
        for name in names {
            if let Some(tool) = registry.get(name) {
                filtered.register(tool);
            }
        }
        filtered
    }

    /// Build the tool registry the agent loop runs with. Shared by the
    /// spawn path and the permission editor so the editor lists exactly
    /// the tools the loop will have.
    fn build_registry(
        workspace_root: &std::path::Path,
        sandbox: &Option<(ResolvedSandbox, prism_core::sandbox::SandboxUsed)>,
    ) -> ToolRegistry {
        let registry = ToolRegistry::new();
        registry.register(std::sync::Arc::new(CalculatorTool));
        native_tools::register_all(&registry, workspace_root);

        // Opted-in guarded shell: the sandbox policy is the permission
        // boundary, so the tool registers at the default Allow and every
        // call runs guard → denylist → enforced subprocess.
        #[cfg(all(target_os = "linux", feature = "native-transport"))]
        if let Some((res, _used)) = sandbox {
            registry.register(std::sync::Arc::new(prism_core::sandbox::GuardedShellTool {
                res: res.clone(),
            }));
        }
        #[cfg(not(all(target_os = "linux", feature = "native-transport")))]
        {
            // Policy posture was validated before spawn; neither the
            // guard nor the enforcement layer exists on this host, so
            // no shell tool is registered.
            let _ = sandbox;
        }
        registry
    }

    /// Persisted permission overrides from settings (`/permissions`,
    /// `prism permissions set`). Explicit entries only; the registry's
    /// own defaults stand for everything else.
    fn apply_permissions(registry: &ToolRegistry, settings: &Settings) {
        for tool in settings.tool_permissions.keys() {
            if let Some(level) = settings.tool_permission(tool) {
                registry.set_permission(tool, level);
            }
        }
    }

    /// The tool names the agent loop would run with on this host. The
    /// permission editor renders this list.
    pub fn available_tool_names() -> Vec<String> {
        let root = std::path::PathBuf::from(".");
        // No sandbox policy here: the list is the same either way, and
        // probing the policy would read the environment for no reason.
        build_registry(&root, &None).tool_names()
    }
}
