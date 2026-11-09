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
    use prism_core::agent::{
        run_agent, AgentResult, CalculatorTool, StepMessage, ToolRegistry,
    };
    use prism_core::native_tools::{self};
    use prism_core::sandbox::{resolve_policy, ResolvedSandbox, SandboxPolicy};
    use prism_core::transport::{HttpRequest, ReqwestTransport, Transport};

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
                headers.push(("Authorization".to_string(), format!("Bearer {}", self.api_key)));
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
        let resolved = settings
            .resolve_provider(&settings.provider)
            .ok_or_else(|| format!("unknown provider {}", settings.provider))?;
        let api_key = settings.key_for(&settings.provider);
        if resolved.needs_key && api_key.trim().is_empty() {
            return Err(format!("API key required for {} — /key <key>", resolved.label));
        }
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
        let task = task.to_string();
        let tx = tx.clone();
        // Sandbox posture before anything spawns: `PRISM_AGENT_SANDBOX_POLICY`
        // carries either inline policy JSON or a path to it (`--policy`
        // shape). A strict policy that this host cannot
        // enforce fails the job instead of silently weakening; `auto` keeps
        // running with the record kept in each shell observation.
        let sandbox = match std::env::var("PRISM_AGENT_SANDBOX_POLICY") {
            Ok(source) => {
                let resolved = load_sandbox_policy(&source)?;
                match prism_core::sandbox::plan_spawn(&resolved) {
                    Ok(used) => Some((resolved, used)),
                    // strict on an unsupported host: fail the job with the
                    // reason instead of silently weakening (`Err` surfaces
                    // on the /agent line).
                    Err(outcome) => {
                        let reason = prism_core::sandbox::outcome_str(&outcome);
                        return Err(format!("sandbox preflight: {reason}"));
                    }
                }
            }
            Err(_) => None,
        };

        // Agent loop runs on its own thread (blocking LLM steps), tools
        // scoped to the workspace root. Mutating tools stay on Ask =>
        // headless deny unless the user flips them with /agent-perms.
        std::thread::spawn(move || {
            let registry = ToolRegistry::new();
            registry.register(std::sync::Arc::new(CalculatorTool));
            native_tools::register_all(&registry, &workspace_root);

            // Opted-in guarded shell: the sandbox policy is the permission
            // boundary, so the tool registers at the default Allow and
            // every call runs guard → denylist → enforced subprocess.
            #[cfg(all(target_os = "linux", feature = "native-transport"))]
            if let Some((res, _used)) = &sandbox {
                registry.register(std::sync::Arc::new(
                    prism_core::sandbox::GuardedShellTool { res: res.clone() },
                ));
            }
            #[cfg(not(all(target_os = "linux", feature = "native-transport")))]
            {
                // Policy posture was validated before spawn; neither the
                // guard nor the enforcement layer exists on this host, so
                // no shell tool is registered.
                let _ = sandbox;
            }

            let result: AgentResult = {
                let mut step_fn = |system: &str, hist: &[StepMessage]| {
                    step_impl.complete(system, hist)
                };
                run_agent(&task, &mut step_fn, &registry, 12, &|_, _| false)
            };

            let _ = tx.send(Event::AgentDone(result));
        });
        Ok(())
    }
}
