// Shared application logic for both desktop and Android

slint::include_modules!();

pub mod graph;
pub mod image;
pub mod media;
pub mod studio;

// Re-export all public types and functions from dependencies
#[cfg(feature = "agent")]
pub use prism_core::agent::AgentResult;
pub use prism_core::cards::{self, CharacterCard, Persona};
pub use prism_core::catalog;
pub use prism_core::client::{
    ApiChatRequest, ChatMessage, ModelsEvent, ModelsRequest, OllamaChatRequest, StreamEvent,
    StreamRequest,
};
pub use prism_core::conversations::{self, Conversation, ConversationMeta, StoredMessage};
pub use prism_core::modes::{DaemonTask, Feature, GenCapability, Mode, ModeTraits, TaskTrigger};
#[cfg(feature = "agent")]
pub use prism_core::native_tools;
pub use prism_core::providers::{self, ollama_root_url, PROVIDERS};
pub use prism_core::session::{PermissionLevel, Session};
pub use prism_core::settings::{Connection, Settings};
pub use prism_core::workspace::Workspace;
pub use prism_core::{host, thinking};
pub use slint::{ComponentHandle, ModelRc, SharedString, VecModel};
pub use std::cell::RefCell;
pub use std::rc::Rc;
pub use std::sync::mpsc::{self, Receiver, TryRecvError};
pub use std::sync::Arc;

/// Matches COMPUTE_LEVELS in the TUI settings screen / shared types.
pub const COMPUTE_LEVELS: &[&str] = &[
    "auto",
    "cpu-only",
    "gpu-auto",
    "gpu-nvidia",
    "gpu-amd",
    "gpu-intel",
];

/// undefined = server default (no num_gpu override). 99 = offload all layers.
pub const GPU_LAYER_CYCLE: &[Option<u32>] = &[
    None,
    Some(0),
    Some(8),
    Some(16),
    Some(24),
    Some(32),
    Some(99),
];

/// undefined = server default (no num_ctx override).
pub const CONTEXT_TOKEN_CYCLE: &[Option<u32>] = &[
    None,
    Some(1024),
    Some(2048),
    Some(4096),
    Some(8192),
    Some(16384),
    Some(32768),
];

/// One message from the agent thread, drained on the UI thread by the
/// timer pump. `Done` carries the JSON `AgentResult` and is handed to
/// the `agent-done` callback; `Failed` is a pre-execution failure.
#[cfg(feature = "agent")]
pub enum AgentEvent {
    Done(String),
    Failed(String),
    /// Out-of-band system line from a background job (MCP connect
    /// results, subagent bookkeeping). Never carries a final answer.
    Notice(String),
    /// A background subagent finished; `result` is the JSON
    /// `AgentResult` (the same shape `Done` carries for a foreground
    /// run). `task` is echoed so the transcript names the work.
    SubagentDone {
        spec: String,
        task: String,
        result: String,
    },
}

/// One finished research job (web, deep search, ensemble). Formatted by
/// the core so the desktop and CLI show the same text.
#[derive(Debug, Clone)]
pub struct ResearchResult {
    pub title: String,
    pub body: String,
    pub status: String,
}

/// One line in the chat transcript.
#[derive(Clone, Debug)]
pub struct Line {
    pub role: String, // "user" | "assistant" | "system"
    pub content: String,
    /// Reasoning extracted from `<thinking>` tags at stream end.
    pub thinking: Option<String>,
    /// User-assigned labels on this message.
    pub tags: Vec<String>,
    /// False = unread.
    pub read: bool,
    /// The content was edited after it was written.
    pub edited: bool,
}

impl Line {
    /// A fresh line with the default per-message state (read, no tags,
    /// not edited).
    pub fn new(role: &str, content: impl Into<String>) -> Line {
        Line {
            role: role.into(),
            content: content.into(),
            thinking: None,
            tags: Vec::new(),
            read: true,
            edited: false,
        }
    }

    pub fn to_widget(&self) -> ChatLine {
        let (content, thinking) = if self.role == "assistant" {
            match &self.thinking {
                Some(t) => (self.content.clone(), Some(t.clone())),
                None => match thinking::split_display(&self.content) {
                    (Some(t), a) => (a.to_string(), Some(t.to_string())),
                    (None, c) => (c.to_string(), None),
                },
            }
        } else {
            (self.content.clone(), None)
        };
        ChatLine {
            role: self.role.as_str().into(),
            content: content.into(),
            thinking: thinking.unwrap_or_default().into(),
            tags: self.tags.join(", ").into(),
            read: self.read,
            edited: self.edited,
        }
    }
}

pub struct State {
    pub settings: Settings,
    pub lines: Vec<Line>,
    pub chats: Vec<ConversationMeta>,
    pub current_id: Option<String>,
    pub current_created: u64,
    pub confirm_delete: Option<String>,
    pub streaming: bool,
    pub rx: Option<Receiver<StreamEvent>>,
    pub rx_models: Option<Receiver<ModelsEvent>>,
    /// Receivers for research jobs, drained by the timer pump.
    pub rx_research: Vec<Receiver<ResearchResult>>,

    /// Receivers for agent/subagent jobs, drained by the timer pump
    /// (`drain_agent`); Slint handles are not `Send`, so worker threads
    /// report back through channels instead of upgrading a weak handle
    /// off the main thread. More than one may be live (a foreground
    /// run plus background subagents).
    #[cfg(feature = "agent")]
    pub rx_agent: Vec<Receiver<AgentEvent>>,
    pub gpu_idx: usize,
    pub ctx_idx: usize,
    /// Position in the sent-prompt history while cycling with Up/Down:
    /// None = not cycling (editing fresh text); Some(i) = viewing
    /// `history[history.len() - 1 - i]`. New chat / send resets it.
    pub history_idx: Option<usize>,
    /// Input text saved when Up/Down cycling starts; restored when the
    /// user cycles forward past the newest entry.
    pub history_draft: Option<String>,
    /// Loaded character card (SillyTavern V2/V1 JSON on disk).
    pub card: Option<CharacterCard>,
    /// Current interaction mode.
    pub mode: Mode,
    /// Full five-layer session for the current mode.
    pub session: Session,
    /// Daemon-mode scheduled tasks (in-memory; the host persists them).
    pub daemon_tasks: Vec<DaemonTask>,
    /// True while an agent-mode run is in flight.
    pub agent_busy: bool,
    /// Last random-prompt pick, so "Surprise me" avoids an immediate repeat.
    pub last_random: Option<String>,
    /// The user's persona for {{persona}} macros.
    pub persona: Persona,
    /// Prompts queued while streaming. Each is the prompt text.
    pub prompt_queue: Vec<String>,
    /// Whether a queued prompt is currently being processed (steered).
    pub queue_processing: bool,
    /// Media capability panel state.
    pub media: crate::shared::media::MediaState,
    /// Video studio surface state (simulated renders + workspace grid).
    pub studio: crate::shared::studio::StudioState,
    /// Image studio surface state (native/A1111/ComfyUI generation).
    pub image: crate::shared::image::ImageState,
    /// Canvas node-graph surface state (the same drawing the Dioxus
    /// studio and the shared document carry).
    pub canvas: crate::shared::graph::CanvasState,
    /// Surface mode: 0 = Chat, 1 = Agent, 2 = IDE (editor + agent
    /// sidebar). The composer's
    /// routing follows it (`on_send` observes `ui.get_ui_mode()`).
    pub ui_mode: usize,
    /// Open IDE workspace folder (None until `ide.workspace.open`).
    pub workspace: Option<Workspace>,
    /// Path (workspace-relative) of the file in the editor, if any.
    pub open_rel: Option<String>,
    /// Editor buffer contents; `editor_dirty` set when edited.
    pub editor_text: String,
    pub editor_dirty: bool,
    /// Tags on the current session.
    pub session_tags: Vec<String>,
    /// The current session is archived (hidden from the default list).
    pub session_archived: bool,
    /// The current session is unread.
    pub session_read: bool,
    /// The conversation this session was forked from, if any.
    pub forked_from: Option<String>,
    /// The message index in the source the fork branched at.
    pub forked_at_message: Option<usize>,
    /// Context items attached to the next request.
    pub context_items: Vec<prism_core::context::ContextItem>,
    /// Token budget for the attached context.
    pub context_budget: usize,
}

impl State {
    pub fn new() -> Self {
        let settings = host::load_settings();
        let gpu_idx = GPU_LAYER_CYCLE
            .iter()
            .position(|g| *g == settings.hardware.gpu_layers_override)
            .unwrap_or(0);
        let ctx_idx = CONTEXT_TOKEN_CYCLE
            .iter()
            .position(|c| *c == settings.hardware.context_tokens)
            .unwrap_or(0);
        State {
            settings,
            lines: Vec::new(),
            chats: host::list_conversations(),
            current_id: None,
            current_created: 0,
            confirm_delete: None,
            streaming: false,
            rx: None,
            rx_models: None,
            rx_research: Vec::new(),
            #[cfg(feature = "agent")]
            rx_agent: Vec::new(),
            gpu_idx,
            ctx_idx,
            history_idx: None,
            history_draft: None,
            card: None,
            persona: Persona::default(),
            mode: Mode::default(),
            session: Session::new(Mode::default(), &available_tool_names()),
            daemon_tasks: Vec::new(),
            agent_busy: false,
            last_random: None,
            prompt_queue: Vec::new(),
            queue_processing: false,
            media: crate::shared::media::MediaState::default(),
            studio: crate::shared::studio::StudioState::default(),
            image: crate::shared::image::ImageState::default(),
            canvas: crate::shared::graph::CanvasState::default(),
            ui_mode: 0,
            workspace: None,
            open_rel: None,
            editor_text: String::new(),
            editor_dirty: false,
            session_tags: Vec::new(),
            session_archived: false,
            session_read: true,
            forked_from: None,
            forked_at_message: None,
            context_items: Vec::new(),
            context_budget: 4000,
        }
    }
}

impl State {
    /// Dropdown labels: built-ins then custom ("Label (custom)").
    pub fn provider_labels(&self) -> Vec<SharedString> {
        let mut v: Vec<SharedString> = PROVIDERS
            .iter()
            .map(|p| SharedString::from(p.label))
            .collect();
        for (id, cp) in &self.settings.custom_providers {
            let label = if cp.label.is_empty() {
                match prism_core::providers::find(&cp.canonical) {
                    Some(def) => format!("{} (custom)", def.label),
                    None => id.clone(),
                }
            } else {
                cp.label.clone()
            };
            v.push(SharedString::from(label));
        }
        v
    }

    /// Provider id at a dropdown index (mirrors `provider_labels`).
    pub fn provider_id_at(&self, idx: usize) -> Option<String> {
        if idx < PROVIDERS.len() {
            return Some(PROVIDERS[idx].id.to_string());
        }
        self.settings
            .custom_providers
            .keys()
            .nth(idx - PROVIDERS.len())
            .cloned()
    }
}

// All the functions previously in main.rs, shared by desktop and Android.

pub fn effective_model(settings: &Settings) -> String {
    if !settings.model.trim().is_empty() {
        return settings.model.trim().to_string();
    }
    match settings.resolve_provider(&settings.provider) {
        Some(r) => {
            if !r.default_model.is_empty() {
                return r.default_model;
            }
            // Bare custom endpoint without a default: newest non-deprecated
            // catalog entry when the id happens to be known, else empty.
            catalog::snapshot()
                .providers
                .get(&settings.provider)
                .and_then(|p| p.default_model())
                .unwrap_or("")
                .to_string()
        }
        None => providers::find(&settings.provider)
            .map(|p| p.default_model.to_string())
            .unwrap_or_default(),
    }
}

/// Hint for the model field when empty: the provider's default model
/// enriched with catalog metadata (context window, capabilities) when
/// the catalog knows the model.
pub fn model_hint(settings: &Settings) -> SharedString {
    if !settings.model.trim().is_empty() {
        return "".into();
    }
    let model = effective_model(settings);
    if model.is_empty() {
        return "".into();
    }
    match catalog::snapshot().model(&settings.provider, &model) {
        Some(info) => model_info_hint(info).into(),
        None => model.into(),
    }
}

/// "name · 128k ctx · tools/reasoning" one-liner for a catalog model.
fn model_info_hint(info: &catalog::ModelInfo) -> String {
    let mut parts: Vec<String> = Vec::new();
    if !info.name.is_empty() {
        parts.push(info.name.clone());
    }
    if let Some(ctx) = info.limit_context {
        parts.push(format!(
            "{}k ctx",
            if ctx >= 1000 { ctx / 1000 } else { ctx }
        ));
    }
    let mut caps: Vec<&str> = Vec::new();
    if info.tool_call {
        caps.push("tools");
    }
    if info.reasoning {
        caps.push("reasoning");
    }
    if info.attachment {
        caps.push("attachments");
    }
    if !caps.is_empty() {
        parts.push(caps.join("/"));
    }
    if info.deprecated() {
        parts.push("deprecated".into());
    }
    if parts.is_empty() {
        info.id.clone()
    } else {
        parts.join(" · ")
    }
}

/// Models for the picker: per-provider cache (live /models fetch)
/// first, catalog models second (when the cache has no entry). Sorted
/// newest-first with deprecated at the end (catalog ordering).
pub fn cached_models(settings: &Settings) -> Vec<SharedString> {
    if let Some(v) = settings.model_cache.get(&settings.provider) {
        if !v.is_empty() {
            return v.iter().map(|m| SharedString::from(m.clone())).collect();
        }
    }
    catalog::snapshot()
        .models_for(&settings.provider)
        .into_iter()
        .map(|m| SharedString::from(m.id.clone()))
        .collect()
}

/// Load the sandbox policy: a path to a policy JSON file, or inline
/// JSON (`PRISM_AGENT_SANDBOX_POLICY` accepts both) — the same env
/// contract the CLI uses.
pub fn load_sandbox_policy(source: &str) -> Result<prism_core::sandbox::ResolvedSandbox, String> {
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
    let policy = prism_core::sandbox::parse_policy(&text).map_err(|e| format!("policy: {e}"))?;
    Ok(prism_core::sandbox::resolve_policy(&policy))
}

#[cfg(feature = "agent")]
mod agent_integration {
    use super::*;
    use prism_core::agent::{run_agent, AgentResult, CalculatorTool, StepMessage, ToolRegistry};
    use prism_core::subagents::SubagentRegistry;
    use prism_core::transport::{ReqwestTransport, Transport as _};
    use std::sync::Arc;
    use std::time::Duration;

    struct SlintLlmStep {
        transport: Arc<ReqwestTransport>,
        base_url: String,
        api_key: String,
        model: String,
        temperature: f32,
        max_tokens: Option<u32>,
    }

    impl SlintLlmStep {
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
                    .post_body(prism_core::transport::HttpRequest {
                        url: self.base_url.clone(),
                        headers,
                        body: Some(body.to_string()),
                    })
                    .await?;
                let v: serde_json::Value =
                    serde_json::from_slice(&bytes).map_err(|e| format!("json: {e}"))?;
                v["choices"][0]["message"]["content"]
                    .as_str()
                    .map(String::from)
                    .ok_or_else(|| String::from("missing choices[0].message.content in response"))
            })
        }
    }

    /// Persisted per-tool policy (`Settings::tool_permissions`, shared
    /// with `prism permissions`). Explicit entries only; the registry's
    /// own defaults stand everywhere else.
    fn apply_persisted_permissions(reg: &ToolRegistry, settings: &prism_core::settings::Settings) {
        for tool in settings.tool_permissions.keys() {
            if let Some(level) = settings.tool_permission(tool) {
                reg.set_permission(tool, level);
            }
        }
    }

    /// The tool surface every run starts from: calculator, the
    /// workspace-scoped native tools, and the guarded shell when a
    /// sandbox policy resolved.
    fn build_registry(
        workspace_root: &std::path::Path,
        sandbox: &Option<prism_core::sandbox::ResolvedSandbox>,
    ) -> ToolRegistry {
        let reg = ToolRegistry::new();
        reg.register(Arc::new(CalculatorTool));
        native_tools::register_all(&reg, workspace_root);
        // The sandbox policy is the permission boundary for the guarded
        // `shell` tool; guard → denylist → enforced subprocess.
        #[cfg(all(target_os = "linux", feature = "native-transport"))]
        if let Some(res) = sandbox {
            reg.register(Arc::new(prism_core::sandbox::GuardedShellTool {
                res: res.clone(),
            }));
        }
        #[cfg(not(all(target_os = "linux", feature = "native-transport")))]
        {
            // Enforcing tool unavailable on this host; the posture already
            // recorded what (if anything) is active.
            let _ = sandbox;
        }
        reg
    }

    /// Connect the configured MCP servers into this run's registry.
    /// Failures stream back as `Notice` lines; a dead server never
    /// stops the run.
    fn register_mcp_tools(reg: &ToolRegistry, tx: &mpsc::Sender<AgentEvent>) {
        let Some(file) = prism_core::mcp::load_file() else {
            return;
        };
        if file.mcp_servers.is_empty() {
            return;
        }
        let surface = prism_core::mcp::McpSurface::connect(&file, Duration::from_secs(10));
        for tool in &surface.tools {
            reg.register(tool.clone());
        }
        if !surface.tools.is_empty() {
            let _ = tx.send(AgentEvent::Notice(format!(
                "mcp: {} tool(s) registered from {} server config(s)",
                surface.tools.len(),
                file.mcp_servers.len()
            )));
        }
        for e in &surface.errors {
            let _ = tx.send(AgentEvent::Notice(format!("mcp: {e}")));
        }
    }

    /// Shipped subagent profiles plus the `subagents` entries in the
    /// shared MCP config file (same file every surface reads).
    fn subagent_registry() -> (SubagentRegistry, Vec<String>) {
        let mut reg = SubagentRegistry::default();
        let warnings = match prism_core::mcp::load_file() {
            Some(file) => reg.upsert_config_specs(&file.subagents).1,
            None => Vec::new(),
        };
        (reg, warnings)
    }

    /// A registry restricted to the given names (the subagent allowlist
    /// clamp, intersected with what this host advertises).
    fn clamp_registry(reg: &ToolRegistry, names: &[String]) -> ToolRegistry {
        let out = ToolRegistry::new();
        for name in names {
            if let Some(tool) = reg.get(name) {
                out.register(tool);
            }
        }
        out
    }

    #[cfg(feature = "agent")]
    pub fn run_agent_from_palette(
        ui: &AppWindow,
        state: &Rc<RefCell<State>>,
        lines_model: &Rc<VecModel<ChatLine>>,
        task: &str,
    ) {
        if state.borrow().streaming {
            push_system(
                ui,
                state,
                lines_model,
                "wait for the chat stream to finish".into(),
            );
            return;
        }
        let task = task.to_string();
        let provider = state.borrow().settings.provider.clone();
        let settings = state.borrow().settings.clone();
        // The IDE's open workspace, falling back to the launcher cwd —
        // the same root the editor panel and the file tools enforce.
        let workspace_root = state
            .borrow()
            .workspace
            .as_ref()
            .map(|w| w.root.clone())
            .unwrap_or_else(|| std::path::PathBuf::from("."));

        // Opt-in sandbox through the same env contract as the CLI
        // (`PRISM_AGENT_SANDBOX_POLICY` = policy JSON or a path to it).
        // A plan failure under `strict` aborts instead of silently
        // weakening; the posture line is echoed into the transcript.
        let sandbox = match std::env::var("PRISM_AGENT_SANDBOX_POLICY") {
            Ok(source) => match load_sandbox_policy(&source) {
                Ok(res) => match prism_core::sandbox::plan_spawn(&res) {
                    Ok(used) => {
                        push_system(
                            ui,
                            state,
                            lines_model,
                            format!("agent sandbox: plan {used:?}"),
                        );
                        Some(res)
                    }
                    Err(outcome) => {
                        push_system(
                            ui,
                            state,
                            lines_model,
                            format!(
                                "agent aborted — sandbox preflight: {}",
                                prism_core::sandbox::outcome_str(&outcome)
                            ),
                        );
                        return;
                    }
                },
                Err(e) => {
                    push_system(
                        ui,
                        state,
                        lines_model,
                        format!("agent runs unsandboxed — {e}"),
                    );
                    None
                }
            },
            Err(_) => None,
        };

        // The agent loop runs on its own thread; completion is reported
        // through the channel and drained by the timer pump (Slint
        // handles are not Send, so no handle upgrade off the main
        // thread).
        let (atx, arx) = std::sync::mpsc::channel::<AgentEvent>();
        state.borrow_mut().rx_agent.push(arx);

        std::thread::spawn(move || {
            let reg = build_registry(&workspace_root, &sandbox);
            register_mcp_tools(&reg, &atx);
            apply_persisted_permissions(&reg, &settings);

            let Some(resolved) = settings.resolve_provider(&provider) else {
                let _ = atx.send(AgentEvent::Failed(format!("unknown provider {provider}")));
                return;
            };
            let api_key = settings.key_for(&provider);
            if resolved.needs_key && api_key.trim().is_empty() {
                let _ = atx.send(AgentEvent::Failed(format!(
                    "API key required for {} — set it in settings",
                    resolved.label
                )));
                return;
            }

            let step_impl = SlintLlmStep {
                transport: Arc::new(ReqwestTransport::new()),
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

            let task = task;
            let result: AgentResult = {
                let mut step_fn =
                    |system: &str, hist: &[StepMessage]| step_impl.complete(system, hist);
                run_agent(&task, &mut step_fn, &reg, 12, &|_, _| false)
            };

            let result_json =
                serde_json::to_string(&result).unwrap_or_else(|e| format!("{{\"error\":\"{e}\"}}"));
            let _ = atx.send(AgentEvent::Done(result_json));
        });
    }

    /// Palette `agent.mcp`: probe the configured servers off the UI
    /// thread and stream the report into the transcript.
    pub fn probe_mcp_from_palette(
        ui: &AppWindow,
        state: &Rc<RefCell<State>>,
        lines_model: &Rc<VecModel<ChatLine>>,
    ) {
        let (tx, rx) = mpsc::channel::<AgentEvent>();
        state.borrow_mut().rx_agent.push(rx);
        push_system(
            ui,
            state,
            lines_model,
            "mcp: probing configured servers…".into(),
        );
        std::thread::spawn(move || {
            let path = prism_core::mcp::config_path()
                .map(|p| p.display().to_string())
                .unwrap_or_else(|| "<no config root>".into());
            let Some(file) = prism_core::mcp::load_file() else {
                let _ = tx.send(AgentEvent::Notice(format!(
                    "mcp: no configuration at {path} — add an \"mcpServers\" object"
                )));
                return;
            };
            if file.mcp_servers.is_empty() {
                let _ = tx.send(AgentEvent::Notice(format!(
                    "mcp: {path} has no usable servers (command required)"
                )));
                return;
            }
            let surface = prism_core::mcp::McpSurface::connect(&file, Duration::from_secs(10));
            let _ = tx.send(AgentEvent::Notice(format!(
                "mcp: {} tool(s) from {} configured server(s) — {path}",
                surface.tools.len(),
                file.mcp_servers.len()
            )));
            for server in file.mcp_servers.keys() {
                let tools: Vec<&str> = surface
                    .tools
                    .iter()
                    .filter(|t| t.server_name() == server)
                    .map(|t| t.advertised.as_str())
                    .collect();
                let _ = tx.send(AgentEvent::Notice(if tools.is_empty() {
                    format!("  {server}: connected, no tools")
                } else {
                    format!("  {server}: {}", tools.join(", "))
                }));
            }
            for e in &surface.errors {
                let _ = tx.send(AgentEvent::Notice(format!("  failed: {e}")));
            }
        });
    }

    /// Palette `agent.subagents`: list every profile this host exposes.
    pub fn list_subagents_from_palette(
        ui: &AppWindow,
        state: &Rc<RefCell<State>>,
        lines_model: &Rc<VecModel<ChatLine>>,
    ) {
        let (registry, warnings) = subagent_registry();
        push_system(
            ui,
            state,
            lines_model,
            "subagents — background profiles (core registry):".into(),
        );
        for name in registry.names() {
            let Some(spec) = registry.get(&name) else {
                continue;
            };
            let tools = if spec.tool_allowlist.is_empty() {
                "full surface".to_string()
            } else {
                spec.tool_allowlist.join(", ")
            };
            let model = spec
                .forced_model
                .as_ref()
                .map(|m| format!(" · model {m}"))
                .unwrap_or_default();
            push_system(
                ui,
                state,
                lines_model,
                format!("  {name}: {}", spec.description),
            );
            push_system(ui, state, lines_model, format!("    tools: {tools}{model}"));
        }
        for w in &warnings {
            push_system(ui, state, lines_model, format!("  config warning: {w}"));
        }
        push_system(
            ui,
            state,
            lines_model,
            "run one: palette \"Run a background subagent\" with query \"<name> <task>\"".into(),
        );
    }

    /// Palette `agent.subagent`: run one profile on a background thread
    /// with its forced model and clamped tools. The answer lands in the
    /// transcript through `SubagentDone`.
    pub fn run_subagent_from_palette(
        ui: &AppWindow,
        state: &Rc<RefCell<State>>,
        lines_model: &Rc<VecModel<ChatLine>>,
        query: &str,
    ) {
        let query = query.trim();
        let name = query.split_whitespace().next().unwrap_or("").to_string();
        let task = query[name.len()..].trim().to_string();
        if name.is_empty() || task.is_empty() {
            push_system(
                ui,
                state,
                lines_model,
                "usage: <name> <task> (palette: Run a background subagent)".into(),
            );
            return;
        }
        let (registry, warnings) = subagent_registry();
        if registry.get(&name).is_none() {
            push_system(
                ui,
                state,
                lines_model,
                format!(
                    "unknown subagent {name:?} — known: {}",
                    registry.names().join(", ")
                ),
            );
            return;
        }
        for w in &warnings {
            push_system(
                ui,
                state,
                lines_model,
                format!("agents config warning: {w}"),
            );
        }
        let provider = state.borrow().settings.provider.clone();
        let settings = state.borrow().settings.clone();
        let workspace_root = state
            .borrow()
            .workspace
            .as_ref()
            .map(|w| w.root.clone())
            .unwrap_or_else(|| std::path::PathBuf::from("."));
        let Some(resolved) = settings.resolve_provider(&provider) else {
            push_system(
                ui,
                state,
                lines_model,
                format!("unknown provider {provider}"),
            );
            return;
        };
        let api_key = settings.key_for(&provider);
        if resolved.needs_key && api_key.trim().is_empty() {
            push_system(
                ui,
                state,
                lines_model,
                format!(
                    "API key required for {} — set it in settings",
                    resolved.label
                ),
            );
            return;
        }
        let session_model = if settings.model.trim().is_empty() {
            resolved.default_model.clone()
        } else {
            settings.model.trim().to_string()
        };
        let model = match registry.resolve_model(
            &name,
            &session_model,
            Some(resolved.default_model.clone()),
        ) {
            Ok(resolution) => resolution.model,
            Err(e) => {
                push_system(ui, state, lines_model, format!("subagent model: {e}"));
                return;
            }
        };

        let sandbox = match std::env::var("PRISM_AGENT_SANDBOX_POLICY") {
            Ok(source) => match load_sandbox_policy(&source) {
                Ok(res) => match prism_core::sandbox::plan_spawn(&res) {
                    Ok(used) => {
                        push_system(
                            ui,
                            state,
                            lines_model,
                            format!("subagent sandbox: plan {used:?}"),
                        );
                        Some(res)
                    }
                    Err(outcome) => {
                        push_system(
                            ui,
                            state,
                            lines_model,
                            format!(
                                "subagent aborted — sandbox preflight: {}",
                                prism_core::sandbox::outcome_str(&outcome)
                            ),
                        );
                        return;
                    }
                },
                Err(e) => {
                    push_system(
                        ui,
                        state,
                        lines_model,
                        format!("subagent runs unsandboxed — {e}"),
                    );
                    None
                }
            },
            Err(_) => None,
        };

        let (tx, rx) = mpsc::channel::<AgentEvent>();
        state.borrow_mut().rx_agent.push(rx);
        push_system(
            ui,
            state,
            lines_model,
            format!("subagent {name} running in background — {task}"),
        );
        let spec_name = name.clone();
        std::thread::spawn(move || {
            let reg = build_registry(&workspace_root, &sandbox);
            register_mcp_tools(&reg, &tx);
            apply_persisted_permissions(&reg, &settings);
            let advertised = reg.tool_names();
            let effective = match registry.clamp_tools(&spec_name, &advertised) {
                Ok(names) => names,
                Err(e) => {
                    let _ = tx.send(AgentEvent::Failed(format!("subagent {spec_name}: {e}")));
                    return;
                }
            };
            let reg = clamp_registry(&reg, &effective);

            let step_impl = SlintLlmStep {
                transport: Arc::new(ReqwestTransport::new()),
                base_url: resolved.base_url.clone(),
                api_key: api_key.trim().to_string(),
                model,
                temperature: settings.temperature,
                max_tokens: settings.max_tokens,
            };
            let task_for_run = task.clone();
            let result: AgentResult = {
                let mut step_fn =
                    |system: &str, hist: &[StepMessage]| step_impl.complete(system, hist);
                run_agent(&task_for_run, &mut step_fn, &reg, 12, &|_, _| false)
            };
            let result_json =
                serde_json::to_string(&result).unwrap_or_else(|e| format!("{{\"error\":\"{e}\"}}"));
            let _ = tx.send(AgentEvent::SubagentDone {
                spec: spec_name,
                task,
                result: result_json,
            });
        });
    }
}

#[cfg(not(feature = "agent"))]
#[allow(unexpected_cfgs)]
pub fn run_agent_from_palette(
    _ui: &AppWindow,
    _state: &Rc<RefCell<State>>,
    _lines_model: &Rc<VecModel<ChatLine>>,
    _task: &str,
) {
    eprintln!("agent feature not enabled");
}

// ---- IDE surface (three surface modes) ----

/// Composer placeholder per surface mode: the connection to the person
/// typing changes even though the same LineEdit drives both.
fn composer_hint(mode: usize) -> &'static str {
    match mode {
        1 => "Describe an agent task… (Enter to run)",
        2 => "Ask the agent about the workspace… (Enter to run)",
        // The canvas draws rather than chats, so the composer is not the
        // primary input there.
        5 => "The canvas is open — press Generate…",
        _ => "Type a message… (Enter to send, ↑/↓ history)",
    }
}

/// Switch the surface mode and sync the dependent UI bits.
pub fn set_mode(ui: &AppWindow, state: &Rc<RefCell<State>>, mode: usize) {
    // 0 Chat, 1 Agent, 2 IDE, 3 Studio, 4 Image, 5 Canvas.
    let mode = mode.min(5);
    state.borrow_mut().ui_mode = mode;
    ui.set_ui_mode(mode as i32);
    ui.set_composer_hint(composer_hint(mode).into());
}

/// Open a folder as the IDE workspace; on success the file tree is
/// refreshed and the status strip reports the topic. Empty arg falls
/// back to a refresh (the palette arg is the folder).
pub fn open_workspace(ui: &AppWindow, state: &Rc<RefCell<State>>, arg: &str) {
    if arg.trim().is_empty() {
        if let Some(ws) = &state.borrow().workspace {
            ui.set_ide_status(ws.topic().into());
            refresh_tree(ui, state);
            return;
        }
        ui.set_ide_status("usage: open workspace <dir>".into());
        return;
    }
    match Workspace::open(arg) {
        Ok(ws) => {
            let topic = ws.topic();
            state.borrow_mut().workspace = Some(ws);
            ui.set_workspace_path(topic.clone().into());
            ui.set_ide_status("".into());
            refresh_tree(ui, state);
        }
        Err(e) => ui.set_ide_status(e.into()),
    }
}

/// Refresh the file tree from the workspace (no-op status when none).
pub fn refresh_tree(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    let Some(ws) = &state.borrow().workspace else {
        ui.set_ide_status("no workspace open — try: open workspace <dir>".into());
        return;
    };
    match ws.list_files() {
        Ok(rows) => {
            let model = Rc::new(VecModel::from(
                rows.iter()
                    .map(|r| TreeRow {
                        rel: r.rel.as_str().into(),
                        isDir: r.is_dir,
                        depth: r.depth as i32,
                    })
                    .collect::<Vec<_>>(),
            ));
            ui.set_tree_rows(ModelRc::from(model));
            let n = rows.len();
            ui.set_ide_status(format!("{n} entries — click a file to open it").into());
        }
        Err(e) => ui.set_ide_status(e.into()),
    }
}

/// Open one workspace file into the editor pane.
pub fn open_tree_file(ui: &AppWindow, state: &Rc<RefCell<State>>, rel: &str) {
    let Some(ws) = &state.borrow().workspace else {
        ui.set_ide_status("open a workspace first (palette: Open workspace folder…)".into());
        return;
    };
    if rel.ends_with('/') {
        ui.set_ide_status(format!("{rel} — a directory; click file rows").into());
        return;
    }
    match ws.read_file(rel) {
        Ok(text) => {
            ui.set_open_rel(rel.into());
            ui.set_editor_text(text.into());
            ui.set_editor_dirty(false);
            ui.set_ide_status(format!("opened {rel}").into());
            let mut st = state.borrow_mut();
            st.open_rel = Some(rel.to_string());
            st.editor_text = ui.get_editor_text().to_string();
            st.editor_dirty = false;
        }
        Err(e) => ui.set_ide_status(e.into()),
    }
}

/// Record an edit from the TextEdit: content kept in state, dirty set.
pub fn editor_changed(ui: &AppWindow, state: &Rc<RefCell<State>>, text: &str) {
    let mut st = state.borrow_mut();
    st.editor_text = text.to_string();
    st.editor_dirty = true;
    ui.set_editor_dirty(true);
}

/// Persist the editor buffer back to the workspace file.
pub fn save_editor(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    let (rel, text): (Option<String>, String) = {
        let st = state.borrow();
        match &st.open_rel {
            Some(rel) if st.editor_dirty => (Some(rel.clone()), ui.get_editor_text().to_string()),
            _ => (None, String::new()),
        }
    };
    let _ = text;
    let Some(rel) = rel else {
        ui.set_ide_status(if ui.get_editor_text().is_empty() {
            "nothing to save".into()
        } else {
            "editor unchanged".into()
        });
        return;
    };
    let Some(ws) = &state.borrow().workspace else {
        return;
    };
    match ws.write_file(&rel, &text) {
        Ok(()) => {
            ui.set_editor_dirty(false);
            ui.set_ide_status(format!("saved {rel} ({} bytes)", text.len()).into());
            refresh_tree(ui, state);
            ui.set_ide_status(format!("saved {rel} ({} bytes)", text.len()).into());
        }
        Err(e) => ui.set_ide_status(e.into()),
    }
}
/// Kick off a live /models fetch for the current provider. Shared by
/// the settings button and the palette command.
pub fn fetch_models(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    let (base_url, api_key, status) = {
        let st = state.borrow_mut();
        if st.rx_models.is_some() {
            return;
        }
        let provider = st.settings.provider.clone();
        let key = st.settings.key_for(&provider);
        let base_url = if provider == "ollama" {
            st.settings.local_base_url.trim().to_string()
        } else {
            st.settings
                .resolve_provider(&provider)
                .map(|r| r.base_url)
                .unwrap_or_default()
        };
        let needs_key = st
            .settings
            .resolve_provider(&provider)
            .map(|r| r.needs_key)
            .unwrap_or(false);
        if base_url.is_empty() || (needs_key && key.trim().is_empty()) {
            (
                String::new(),
                String::new(),
                "set an API key first".to_string(),
            )
        } else {
            (base_url, key, "fetching…".to_string())
        }
    };
    if base_url.is_empty() {
        ui.set_models_status(status.into());
        return;
    }
    let (tx, rx) = mpsc::channel();
    state.borrow_mut().rx_models = Some(rx);
    ui.set_models_status(status.into());
    host::spawn_models_fetch(
        ModelsRequest {
            base_url,
            api_key: api_key.trim().to_string(),
        },
        tx,
    );
}

// ---- character cards (SillyTavern-style prompting) ----

/// One-line card summary for the settings panel.
fn card_summary(card: &CharacterCard) -> String {
    let mut parts = vec![card.name.clone()];
    if !card.description.trim().is_empty() {
        let d = card.description.trim();
        parts.push(if d.chars().count() > 40 {
            format!("{}…", d.chars().take(40).collect::<String>())
        } else {
            d.to_string()
        });
    }
    if !card.alternate_greetings.is_empty() {
        parts.push(format!("{} alt greetings", card.alternate_greetings.len()));
    }
    parts.join(" · ")
}

fn card_load(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    let path = ui.get_card_path().trim().to_string();
    if path.is_empty() {
        ui.set_card_summary("no path given".into());
        return;
    }
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) => {
            ui.set_card_summary(format!("read failed: {e}").into());
            return;
        }
    };
    match cards::parse_card(&text) {
        Ok(card) => {
            {
                let mut st = state.borrow_mut();
                st.card = Some(card.clone());
            }
            ui.set_card_loaded(true);
            ui.set_card_summary(card_summary(&card).into());
        }
        Err(e) => ui.set_card_summary(format!("not a Prism card: {e}").into()),
    }
}

fn card_clear(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    state.borrow_mut().card = None;
    ui.set_card_loaded(false);
    ui.set_card_summary("".into());
}

// ---- interaction modes ----

/// Labels + blurbs for the mode rail (same order as `Mode::all()`).
fn mode_lists() -> (Vec<SharedString>, Vec<SharedString>, Vec<SharedString>) {
    let modes = Mode::all();
    let labels = modes
        .iter()
        .map(|m| SharedString::from(m.label()))
        .collect();
    let blurbs = modes
        .iter()
        .map(|m| SharedString::from(m.blurb()))
        .collect();
    // The traits line: only the constraints that bind, in a fixed order.
    // Chat (nothing enabled) keeps an empty line so the tile stays compact.
    let traits = modes
        .iter()
        .map(|m| {
            let t = m.traits();
            let mut bits = Vec::new();
            if t.tools {
                bits.push("tools");
            }
            if t.subagents {
                bits.push("subagents");
            }
            if t.tasks {
                bits.push("tasks");
            }
            if t.media {
                bits.push("media");
            }
            bits.push(t.style.style_label());
            bits.push(t.persistence.label());
            SharedString::from(bits.join(" · "))
        })
        .collect();
    (labels, blurbs, traits)
}

fn gen_cap_labels() -> Vec<SharedString> {
    GenCapability::all()
        .iter()
        .map(|c| SharedString::from(c.label()))
        .collect()
}

/// The tool names the agent loop would run with on this host. The
/// permissions editor renders this list, so it must come from the same
/// registry the loop uses — not a hand-written duplicate.
pub fn available_tool_names() -> Vec<String> {
    use prism_core::agent::{CalculatorTool, ToolRegistry};
    let reg = ToolRegistry::new();
    reg.register(Arc::new(CalculatorTool));
    prism_core::native_tools::register_all(&reg, std::path::Path::new("."));
    reg.tool_names()
}

/// Apply a trait set to every mode-derived UI property. Takes the
/// traits rather than a mode, because a blended session's traits are
/// not any single mode's traits.
fn apply_mode_traits(ui: &AppWindow, t: ModeTraits) {
    ui.set_mode_tools(t.tools);
    ui.set_mode_cards(t.card_prompt);
    ui.set_mode_media(t.media);
    ui.set_mode_tasks(t.tasks);
    ui.set_mode_strategy(t.strategy);
    // Creative mode implies the prompt engine; daemon/agent too.
    if t.card_prompt && !ui.get_prompt_engine_on() {
        ui.set_prompt_engine_on(true);
    }
}

// ---- session permission helpers ------------------------------------------

/// Effective permission for one tool in a session, borrowed briefly.
fn st_session_perm(state: &Rc<RefCell<State>>, tool: &str) -> PermissionLevel {
    state.borrow().session.permission_for(tool)
}

// ---- agent + daemon panel plumbing -------------------------------------

/// PaletteRow is reused as the generic (id, title, group) list row for
/// agent steps and daemon tasks.
fn daemon_rows(tasks: &[DaemonTask]) -> Vec<PaletteRow> {
    tasks
        .iter()
        .map(|t| PaletteRow {
            id: t.id.clone().into(),
            title: format!(
                "{}{}",
                t.name,
                match &t.trigger {
                    TaskTrigger::Interval { seconds } => format!(" · every {seconds}s"),
                    TaskTrigger::Once { .. } => " · once".into(),
                    TaskTrigger::Manual => " · manual".into(),
                }
            )
            .into(),
            group: if t.enabled { "on".into() } else { "off".into() },
        })
        .collect()
}

fn daemon_sync(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    let rows = daemon_rows(&state.borrow().daemon_tasks);
    ui.set_daemon_tasks(ModelRc::from(Rc::new(VecModel::from(rows))));
}

fn daemon_add(
    ui: &AppWindow,
    state: &Rc<RefCell<State>>,
    name: &str,
    instruction: &str,
    interval: &str,
) {
    let name = name.trim();
    let instruction = instruction.trim();
    if name.is_empty() || instruction.is_empty() {
        ui.set_settings_status("daemon task needs a name and instruction".into());
        return;
    }
    let interval_secs = interval.trim().parse::<u64>().ok();
    let trigger = match interval_secs {
        Some(s) => TaskTrigger::Interval { seconds: s.max(1) },
        None => TaskTrigger::Manual,
    };
    {
        let mut st = state.borrow_mut();
        st.daemon_tasks
            .push(DaemonTask::new(name, instruction, trigger));
    }
    daemon_sync(ui, state);
    ui.set_daemon_name("".into());
    ui.set_daemon_instruction("".into());
    ui.set_daemon_interval("".into());
    ui.set_settings_status(format!("daemon task '{name}' added").into());
}

fn daemon_remove(ui: &AppWindow, state: &Rc<RefCell<State>>, id: &str) {
    {
        let mut st = state.borrow_mut();
        st.daemon_tasks.retain(|t| t.id != id);
    }
    daemon_sync(ui, state);
    ui.set_settings_status("daemon task removed".into());
}

fn daemon_toggle(ui: &AppWindow, state: &Rc<RefCell<State>>, id: &str) {
    {
        let mut st = state.borrow_mut();
        if let Some(t) = st.daemon_tasks.iter_mut().find(|t| t.id == id) {
            t.enabled = !t.enabled;
        }
    }
    daemon_sync(ui, state);
}

fn mode_select(ui: &AppWindow, state: &Rc<RefCell<State>>, idx: i32) {
    let Some(mode) = Mode::all().get(idx as usize).copied() else {
        return;
    };
    {
        let mut st = state.borrow_mut();
        let tools = st.session.capability.tools.clone();
        st.session.set_mode(mode, &tools);
        st.mode = mode;
    }
    ui.set_pmode_idx(idx);
    apply_mode_traits(ui, state.borrow().session.active_traits());
    refresh_session_panels(ui, state);
    let extra = match mode {
        Mode::Daemon => "daemon mode: tasks + tools + strategy",
        Mode::Generative => "generative mode: media screens",
        Mode::Creative => "creative mode: cards + personas + lore",
        Mode::Agent => "agent mode: tools + permissions + subagents",
        Mode::Code => "code mode: style + refactors, no tools",
        Mode::Chat => "chat mode: no tools",
    };
    ui.set_settings_status(extra.into());
}

/// Push the session's blend, capabilities and permissions into the UI
/// models. Called after every change to any of the three.
fn refresh_session_panels(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    let (mixed, summary, cap_rows, perm_rows, perm_default) = {
        let st = state.borrow();
        let mixed = Mode::all()
            .iter()
            .map(|m| st.session.mixed.contains(m))
            .collect::<Vec<bool>>();
        let names: Vec<&str> = st
            .session
            .active_modes()
            .iter()
            .map(|m| m.label())
            .collect();
        let traits = st.session.active_traits();
        let summary = format!(
            "{} · {} · {}",
            names.join(" + "),
            traits.style.style_label(),
            traits.persistence.label()
        );
        // Capability rows: the feature id, its label, and whether it is
        // currently on. `group` carries the on/off mark.
        let cap_rows: Vec<PaletteRow> = Feature::all()
            .iter()
            .map(|f| PaletteRow {
                id: f.id().into(),
                title: f.label().into(),
                group: if st.session.feature(*f) { "on" } else { "off" }.into(),
            })
            .collect();
        // Permission rows: the tool name and its effective level.
        let perm_rows: Vec<PaletteRow> = st
            .session
            .capability
            .permission_rows()
            .iter()
            .map(|(tool, level)| PaletteRow {
                id: tool.clone().into(),
                title: tool.clone().into(),
                group: level.label().into(),
            })
            .collect();
        let perm_default = st.session.capability.default_permission.label().to_string();
        (mixed, summary, cap_rows, perm_rows, perm_default)
    };
    ui.set_pmode_mixed(ModelRc::from(Rc::new(VecModel::from(mixed))));
    ui.set_pmode_blend_summary(summary.into());
    ui.set_cap_rows(ModelRc::from(Rc::new(VecModel::from(cap_rows))));
    ui.set_perm_rows(ModelRc::from(Rc::new(VecModel::from(perm_rows))));
    ui.set_perm_default(perm_default.into());
}

/// Blend a mode into the session, or remove it if already blended.
fn mode_mix_toggle(ui: &AppWindow, state: &Rc<RefCell<State>>, idx: i32) {
    let Some(mode) = Mode::all().get(idx as usize).copied() else {
        return;
    };
    let (msg, traits) = {
        let mut st = state.borrow_mut();
        // The primary mode is the base, not a blend member.
        if mode == st.mode {
            (
                format!("{} is the primary mode", mode.label()),
                st.session.active_traits(),
            )
        } else if st.session.remove_mode(mode) {
            (
                format!("unblended {}", mode.label()),
                st.session.active_traits(),
            )
        } else {
            st.session.add_mode(mode);
            (
                format!("blended {}", mode.label()),
                st.session.active_traits(),
            )
        }
    };
    // A blend that grants tools must actually advertise them.
    if traits.tools {
        let mut st = state.borrow_mut();
        if st.session.capability.tools.is_empty() {
            st.session.capability.tools = available_tool_names();
        }
    }
    apply_mode_traits(ui, traits);
    refresh_session_panels(ui, state);
    ui.set_settings_status(msg.into());
}

/// Toggle one capability on the session.
fn cap_toggle(ui: &AppWindow, state: &Rc<RefCell<State>>, feature_id: &str) {
    let Some(feature) = Feature::from_id(feature_id) else {
        ui.set_settings_status(format!("unknown capability: {feature_id}").into());
        return;
    };
    let traits = {
        let mut st = state.borrow_mut();
        let current = st.session.feature(feature);
        st.session.set_feature(feature, !current);
        if !st.session.feature(feature) {
            // Revoking tools retracts the surface too: a policy that
            // allows a tool the session cannot see would disagree.
            st.session.capability.tools.clear();
            st.session.capability.permissions.clear();
        } else if st.session.capability.tools.is_empty() {
            st.session.capability.tools = available_tool_names();
        }
        st.session.active_traits()
    };
    apply_mode_traits(ui, traits.clone());
    refresh_session_panels(ui, state);
    ui.set_settings_status(
        format!(
            "{} {}",
            if traits.has(feature) { "on" } else { "off" },
            feature.id()
        )
        .into(),
    );
}

/// Cycle one tool's permission: allow → ask → deny → allow.
fn perm_cycle(ui: &AppWindow, state: &Rc<RefCell<State>>, tool: &str) {
    let result = {
        let mut st = state.borrow_mut();
        let current = st.session.capability.permission_for(tool);
        st.session.capability.set_permission(tool, current.cycled())
    };
    if !result {
        ui.set_settings_status(format!("no such tool: {tool}").into());
        return;
    }
    refresh_session_panels(ui, state);
}

/// Cycle the default permission applied to tools with no explicit entry.
fn perm_default_cycle(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    {
        let mut st = state.borrow_mut();
        let current = st.session.capability.default_permission;
        st.session
            .capability
            .set_default_permission(current.cycled());
    }
    refresh_session_panels(ui, state);
}

fn persona_edit(state: &Rc<RefCell<State>>, name: &str, desc: &str) {
    let mut p = state.borrow().persona.clone();
    p.name = name.to_string();
    p.description = desc.to_string();
    state.borrow_mut().persona = p;
}

// ---- data sync ----

fn sync_status(ui: &AppWindow, msg: impl Into<SharedString>) {
    ui.set_sync_status(msg.into());
}

fn sync_export(ui: &AppWindow) {
    // Desktop: write the envelope to a user-visible file. Slint has no
    // native file dialog dependency; the config dir path is reported.
    match host::export_data(None) {
        Ok(()) => {
            let where_to = host::sync_path()
                .map(|p| p.display().to_string())
                .unwrap_or_else(|| "config dir".into());
            sync_status(ui, format!("exported to {where_to}"));
        }
        Err(e) => sync_status(ui, format!("export failed: {e}")),
    }
}

fn sync_import(ui: &AppWindow) {
    // Import the envelope from the standard sync path (the file the
    // extension exports). Missing file = clear status message.
    let Some(path) = host::sync_path() else {
        sync_status(ui, "no config dir on this platform");
        return;
    };
    if !path.exists() {
        sync_status(ui, format!("no envelope at {}", path.display()));
        return;
    }
    match host::import_data(&path) {
        Ok(n) => sync_status(ui, format!("imported {n} conversations")),
        Err(e) => sync_status(ui, format!("import failed: {e}")),
    }
}

fn sync_clear(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    match host::clear_data() {
        Ok(n) => {
            {
                let mut st = state.borrow_mut();
                st.lines.clear();
                st.current_id = None;
                st.current_created = 0;
                st.confirm_delete = None;
            }
            sync_status(ui, format!("cleared {n} conversations (settings kept)"));
        }
        Err(e) => sync_status(ui, format!("clear failed: {e}")),
    }
}

// ---- custom providers ----

fn refresh_custom_provider_rows(ui: &AppWindow, settings: &Settings) {
    let rows: Vec<ProviderRow> = settings
        .custom_providers
        .iter()
        .map(|(id, cp)| {
            let label = if cp.label.is_empty() {
                match prism_core::providers::find(&cp.canonical) {
                    Some(def) => format!("{} (custom)", def.label),
                    None => id.clone(),
                }
            } else {
                cp.label.clone()
            };
            ProviderRow {
                id: id.into(),
                label: label.into(),
            }
        })
        .collect();
    ui.set_custom_provider_rows(ModelRc::from(Rc::new(VecModel::from(rows))));
}

fn add_custom_provider(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    let id = ui.get_new_provider_id().trim().to_string();
    let url = ui
        .get_new_provider_url()
        .trim()
        .trim_end_matches('/')
        .to_string();
    if id.is_empty() || url.is_empty() {
        ui.set_settings_status("provider id and base URL required".into());
        return;
    }
    if prism_core::providers::find(&id).is_some() {
        ui.set_settings_status(format!("'{id}' is a built-in provider").into());
        return;
    }
    let canonical_idx = ui.get_new_provider_canonical_idx();
    let canonical = if canonical_idx <= 0 {
        String::new()
    } else {
        prism_core::providers::PROVIDERS
            .get(canonical_idx as usize - 1)
            .map(|p| p.id.to_string())
            .unwrap_or_default()
    };
    {
        let mut st = state.borrow_mut();
        st.settings.custom_providers.insert(
            id.clone(),
            prism_core::settings::ConfigProvider {
                canonical,
                base_url: url,
                ..Default::default()
            },
        );
        let labels = st.provider_labels();
        let total = prism_core::providers::PROVIDERS.len() + st.settings.custom_providers.len();
        let pos = (0..total)
            .find(|&i| st.provider_id_at(i).as_deref() == Some(id.as_str()))
            .unwrap_or(0);
        drop(st);
        refresh_custom_provider_rows(ui, &state.borrow().settings);
        ui.set_provider_labels(ModelRc::from(Rc::new(VecModel::from(labels))));
        ui.set_provider_idx(pos as i32);
        ui.set_new_provider_id("".into());
        ui.set_new_provider_url("".into());
        ui.set_settings_status(format!("provider '{id}' added").into());
    }
}

fn remove_custom_provider(ui: &AppWindow, state: &Rc<RefCell<State>>, id: &str) {
    {
        let mut st = state.borrow_mut();
        st.settings.custom_providers.remove(id);
        let labels = st.provider_labels();
        let was_current = st.settings.provider == id;
        if was_current {
            st.settings.provider = "openai".into();
        }
        let total = prism_core::providers::PROVIDERS.len() + st.settings.custom_providers.len();
        let pos = (0..total)
            .find(|&i| st.provider_id_at(i).as_deref() == Some(st.settings.provider.as_str()))
            .unwrap_or(0);
        drop(st);
        refresh_custom_provider_rows(ui, &state.borrow().settings);
        ui.set_provider_labels(ModelRc::from(Rc::new(VecModel::from(labels))));
        ui.set_provider_idx(pos as i32);
        if was_current {
            ui.set_provider("openai".into());
        }
        ui.set_settings_status(format!("provider '{id}' removed").into());
    }
}

// ---- command palette ----

/// Rebuild the palette result list from the current query. Registry
/// commands plus one "model:<id>" row per catalog/cached model so the
/// palette doubles as the model switcher.
pub fn palette_refresh(ui: &AppWindow, state: &Rc<RefCell<State>>, query: &str) {
    let mut rows: Vec<PaletteRow> = prism_core::commands::filter_commands(query)
        .into_iter()
        .map(|c| PaletteRow {
            id: c.id.into(),
            title: c.title.into(),
            group: c.group.label().into(),
        })
        .collect();
    let q = query.trim().to_lowercase();
    if q.is_empty() || "model".contains(&q) || q.contains("switch") {
        for m in cached_models(&state.borrow().settings) {
            let id = m.to_string();
            rows.push(PaletteRow {
                id: format!("model:{id}").into(),
                title: format!("Switch to {id}").into(),
                group: "Models".into(),
            });
        }
    }
    ui.set_palette_results(ModelRc::from(Rc::new(VecModel::from(rows))));
    ui.set_palette_idx(0);
}

/// Execute a palette row. `id` is either a registry command id or
/// "model:<model-id>" for the model switcher.
pub fn palette_execute(
    ui: &AppWindow,
    state: &Rc<RefCell<State>>,
    lines_model: &Rc<VecModel<ChatLine>>,
    id: &str,
) {
    ui.set_palette_open(false);
    // arg-taking commands take the palette query (e.g. the workspace
    // folder the user typed); capture it before the reset.
    let query = ui.get_palette_query().to_string();
    ui.set_palette_query("".into());
    if let Some(model) = id.strip_prefix("model:") {
        state.borrow_mut().settings.model = model.to_string();
        ui.set_model(model.into());
        ui.set_model_hint("".into());
        return;
    }
    match id {
        "chat.new" => {
            if !require_idle(ui, state, lines_model) {
                return;
            }
            persist_current(ui, state, lines_model);
            {
                let mut st = state.borrow_mut();
                st.lines.clear();
                st.current_id = None;
                st.current_created = 0;
                st.confirm_delete = None;
                st.history_idx = None;
                st.history_draft = None;
                st.chats = host::list_conversations();
            }
            refresh_transcript(ui, lines_model, &[]);
            refresh_chats(ui, state);
        }
        "chat.history.back" => history_recall(ui, state, true),
        "chat.history.forward" => history_recall(ui, state, false),
        "models.fetch" | "models.refresh_catalog" => fetch_models(ui, state),
        "settings.connection.direct" => {
            state.borrow_mut().settings.connection = Connection::Direct;
            ui.set_connection_idx(0);
        }
        "settings.connection.api" => {
            state.borrow_mut().settings.connection = Connection::PrismApi;
            ui.set_connection_idx(1);
        }
        "settings.save" => {
            let status = match host::save_settings(&state.borrow().settings) {
                Ok(()) => match host::settings_path() {
                    Some(path) => format!("saved to {}", path.display()),
                    None => "saved".into(),
                },
                Err(e) => format!("save failed: {e}"),
            };
            ui.set_settings_status(status.into());
        }
        "settings.thinking.toggle" => {
            let next = !state.borrow().settings.thinking_enabled;
            state.borrow_mut().settings.thinking_enabled = next;
            ui.set_thinking_enabled(next);
        }
        "hardware.cycle_gpu" => {
            let label = {
                let mut st = state.borrow_mut();
                st.gpu_idx = (st.gpu_idx + 1) % GPU_LAYER_CYCLE.len();
                st.settings.hardware.gpu_layers_override = GPU_LAYER_CYCLE[st.gpu_idx];
                gpu_label(st.gpu_idx)
            };
            ui.set_gpu_label(label);
        }
        "hardware.cycle_ctx" => {
            let label = {
                let mut st = state.borrow_mut();
                st.ctx_idx = (st.ctx_idx + 1) % CONTEXT_TOKEN_CYCLE.len();
                st.settings.hardware.context_tokens = CONTEXT_TOKEN_CYCLE[st.ctx_idx];
                ctx_label(st.ctx_idx)
            };
            ui.set_ctx_label(label);
        }
        "hardware.compute.cpu"
        | "hardware.compute.auto"
        | "hardware.compute.gpu"
        | "hardware.compute.gpu_nvidia"
        | "hardware.compute.gpu_amd"
        | "hardware.compute.gpu_intel" => {
            let compute = id.rsplit('.').next().unwrap_or("auto");
            let mapped = match compute {
                "cpu" => "cpu-only",
                "gpu" => "gpu-auto",
                other => other,
            };
            if let Some(i) = COMPUTE_LEVELS.iter().position(|c| *c == mapped) {
                state.borrow_mut().settings.hardware.preferred_compute = mapped.to_string();
                ui.set_compute_idx(i as i32);
            }
        }
        "view.toggle_chats" => {
            let next = !ui.get_show_chats();
            ui.set_show_chats(next);
        }
        "view.toggle_settings" => {
            let next = !ui.get_show_settings();
            ui.set_show_settings(next);
        }
        "view.scroll_end" => ui.invoke_scroll_to_end(),
        "agent.run" => {
            let task = state.borrow().settings.system_prompt.clone();
            #[cfg(feature = "agent")]
            crate::shared::agent_integration::run_agent_from_palette(ui, state, lines_model, &task);
            #[cfg(not(feature = "agent"))]
            run_agent_from_palette(ui, state, lines_model, &task);
        }
        // Palette command: probe the host and report how the agent's
        // sandbox would be planned (preflight, policy from
        // `PRISM_AGENT_SANDBOX_POLICY` when set). Nothing spawns.
        "agent.sandbox" => {
            let report = prism_core::sandbox::preflight();
            let mut detail = format!(
                "sandbox preflight: landlock {}{}",
                if report.landlock_supported {
                    "supported"
                } else {
                    "UNSUPPORTED"
                },
                report
                    .landlock_abi
                    .map(|abi| format!(" (abi v{abi})"))
                    .unwrap_or_default()
            );
            match std::env::var("PRISM_AGENT_SANDBOX_POLICY") {
                Ok(source) => {
                    detail.push_str(&match load_sandbox_policy(&source) {
                        Ok(res) => match prism_core::sandbox::plan_spawn(&res) {
                            Ok(used) => format!(" · plan {used:?}"),
                            Err(outcome) => format!(
                                " · plan rejected: {}",
                                prism_core::sandbox::outcome_str(&outcome)
                            ),
                        },
                        Err(e) => format!(" · {e}"),
                    });
                }
                Err(_) => detail.push_str(
                    " · no PRISM_AGENT_SANDBOX_POLICY set (agent runs without a shell tool)",
                ),
            }
            push_system(ui, state, lines_model, detail);
        }
        "agent.mcp" => {
            #[cfg(feature = "agent")]
            crate::shared::agent_integration::probe_mcp_from_palette(ui, state, lines_model);
            #[cfg(not(feature = "agent"))]
            push_system(ui, state, lines_model, "agent feature not enabled".into());
        }
        "agent.subagents" => {
            #[cfg(feature = "agent")]
            crate::shared::agent_integration::list_subagents_from_palette(ui, state, lines_model);
            #[cfg(not(feature = "agent"))]
            push_system(ui, state, lines_model, "agent feature not enabled".into());
        }
        "agent.subagent" => {
            #[cfg(feature = "agent")]
            crate::shared::agent_integration::run_subagent_from_palette(
                ui,
                state,
                lines_model,
                query.trim(),
            );
            #[cfg(not(feature = "agent"))]
            push_system(ui, state, lines_model, "agent feature not enabled".into());
        }
        // Surface modes — plain chat, agent-first composer, and the
        // editor + agent sidebar pair.
        "ide.mode.chat" => set_mode(ui, state, 0),
        "ide.mode.agent" => set_mode(ui, state, 1),
        "ide.mode.agent_sidebar" => set_mode(ui, state, 2),
        "ide.mode.studio" => set_mode(ui, state, 3),
        "ide.mode.image" => set_mode(ui, state, 4),
        "ide.workspace.open" => open_workspace(ui, state, query.trim()),
        "ide.workspace.refresh" => refresh_tree(ui, state),
        "ide.workspace.save" => save_editor(ui, state),
        other => push_system(ui, state, lines_model, format!("unknown command: {other}")),
    }
}

pub fn key_rows(settings: &Settings) -> Vec<KeyRow> {
    PROVIDERS
        .iter()
        .filter(|p| p.needs_key)
        .map(|p| KeyRow {
            provider: p.id.into(),
            label: p.label.into(),
            key: settings.key_for(p.id).into(),
        })
        .collect()
}

pub fn gpu_label(idx: usize) -> SharedString {
    let value = GPU_LAYER_CYCLE
        .get(idx)
        .and_then(|g| *g)
        .map(|g| g.to_string())
        .unwrap_or_else(|| "default".into());
    format!("GPU layers: {value} (cycle)").into()
}

pub fn ctx_label(idx: usize) -> SharedString {
    let value = CONTEXT_TOKEN_CYCLE
        .get(idx)
        .and_then(|c| *c)
        .map(|c| c.to_string())
        .unwrap_or_else(|| "default".into());
    format!("Context tokens: {value} (cycle)").into()
}

pub fn parse_opt_u32(buf: &str) -> Option<Option<u32>> {
    let t = buf.trim();
    if t.is_empty() {
        Some(None)
    } else {
        t.parse::<u32>().ok().map(Some)
    }
}

pub fn parse_opt_f32(buf: &str) -> Option<Option<f32>> {
    let t = buf.trim();
    if t.is_empty() {
        Some(None)
    } else {
        t.parse::<f32>().ok().map(Some)
    }
}

pub fn refresh_transcript(ui: &AppWindow, lines_model: &Rc<VecModel<ChatLine>>, lines: &[Line]) {
    lines_model.set_vec(lines.iter().map(|l| l.to_widget()).collect::<Vec<_>>());
    let _ = ui;
}

pub fn refresh_chats(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    let st = state.borrow();
    let rows: Vec<ChatRow> = st
        .chats
        .iter()
        .map(|c| ChatRow {
            id: c.id.clone().into(),
            title: c.title.clone().into(),
            confirming: st.confirm_delete.as_deref() == Some(c.id.as_str()),
            tags: c.tags.join(", ").into(),
            unread: !c.read,
            archived: c.archived,
        })
        .collect();
    ui.set_chats(ModelRc::from(Rc::new(VecModel::from(rows))));
}

pub fn push_system(
    ui: &AppWindow,
    state: &Rc<RefCell<State>>,
    lines_model: &Rc<VecModel<ChatLine>>,
    text: String,
) {
    push_line(ui, state, lines_model, "system", text);
}

/// Append one line in any role and refresh the transcript.
pub fn push_line(
    ui: &AppWindow,
    state: &Rc<RefCell<State>>,
    lines_model: &Rc<VecModel<ChatLine>>,
    role: &str,
    text: String,
) {
    {
        let mut st = state.borrow_mut();
        st.lines.push(Line::new(role, text));
    }
    let lines = state.borrow().lines.clone();
    refresh_transcript(ui, lines_model, &lines);
    ui.invoke_scroll_to_end();
}

pub fn require_idle(
    ui: &AppWindow,
    state: &Rc<RefCell<State>>,
    lines_model: &Rc<VecModel<ChatLine>>,
) -> bool {
    if state.borrow().streaming {
        push_system(
            ui,
            state,
            lines_model,
            "Wait for the response to finish.".into(),
        );
        return false;
    }
    true
}

pub fn persist_current(
    ui: &AppWindow,
    state: &Rc<RefCell<State>>,
    lines_model: &Rc<VecModel<ChatLine>>,
) {
    let conv = {
        let mut st = state.borrow_mut();
        if st.lines.is_empty() {
            return;
        }
        let now = conversations::now_ms();
        if st.current_id.is_none() {
            st.current_id = Some(conversations::new_id());
        }
        if st.current_created == 0 {
            st.current_created = now;
        }
        let messages: Vec<StoredMessage> = st
            .lines
            .iter()
            .map(|l| StoredMessage {
                role: l.role.clone(),
                content: l.content.clone(),
                thinking: l.thinking.clone(),
                id: None,
                tags: l.tags.clone(),
                read: l.read,
                edited_at: if l.edited { Some(now) } else { None },
            })
            .collect();
        Some(Conversation {
            id: st.current_id.clone().unwrap_or_default(),
            title: conversations::derive_title(&messages),
            created_at: st.current_created,
            updated_at: now,
            messages,
            tags: st.session_tags.clone(),
            archived: st.session_archived,
            read: st.session_read,
            forked_from: st.forked_from.clone(),
            forked_at_message: st.forked_at_message,
        })
    };
    if let Some(conv) = conv {
        match host::save_conversation(&conv) {
            Ok(()) => {
                let chats = host::list_conversations();
                state.borrow_mut().chats = chats;
                refresh_chats(ui, state);
            }
            Err(e) => push_system(
                ui,
                state,
                lines_model,
                format!("failed to save conversation: {e}"),
            ),
        }
    }
}

pub fn finalize_thinking(st: &mut State) {
    if let Some(last) = st.lines.last_mut() {
        if last.role == "assistant"
            && last.thinking.is_none()
            && last.content.contains("<thinking>")
        {
            let (clean, reasoning) = thinking::strip_thinking(&last.content);
            if let Some(reasoning) = reasoning {
                last.content = clean;
                last.thinking = Some(reasoning);
            }
        }
    }
}

pub fn drain_events(
    ui: &AppWindow,
    state: &Rc<RefCell<State>>,
    lines_model: &Rc<VecModel<ChatLine>>,
) {
    let mut st = state.borrow_mut();
    let Some(rx) = st.rx.take() else {
        return;
    };
    let mut finished = false;
    loop {
        match rx.try_recv() {
            Ok(StreamEvent::Chunk(text)) => {
                if let Some(last) = st.lines.last_mut() {
                    last.content.push_str(&text);
                }
            }
            Ok(StreamEvent::Done) => {
                st.streaming = false;
                finished = true;
                break;
            }
            Ok(StreamEvent::Error(e)) => {
                st.streaming = false;
                st.lines.push(Line::new("system", format!("Error: {e}")));
                finished = true;
                break;
            }
            Ok(StreamEvent::Retrying {
                attempt,
                max,
                delay_ms,
                reason,
            }) => {
                st.lines.push(Line::new(
                    "system",
                    format!(
                        "provider retry {attempt}/{max} in {:.1}s ({reason})",
                        delay_ms as f32 / 1000.0
                    ),
                ));
            }
            Err(TryRecvError::Empty) => break,
            Err(TryRecvError::Disconnected) => {
                st.streaming = false;
                break;
            }
        }
    }
    if !finished {
        // Stream still open; put the receiver back.
        st.rx = Some(rx);
    }
    if finished {
        finalize_thinking(&mut st);
        // If there are queued prompts, steer the next one immediately.
        if !st.prompt_queue.is_empty() && !st.queue_processing {
            st.queue_processing = true;
            let next = st.prompt_queue.remove(0);
            drop(st);
            send(ui, state, lines_model, next);
            return;
        }
    }
    let (lines, streaming) = (st.lines.clone(), st.streaming);
    drop(st);
    refresh_transcript(ui, lines_model, &lines);
    ui.set_streaming(streaming);
    if finished {
        ui.invoke_scroll_to_end();
        persist_current(ui, state, lines_model);
    }
}

pub fn drain_models(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    let mut st = state.borrow_mut();
    let Some(rx) = st.rx_models.take() else {
        return;
    };
    match rx.try_recv() {
        Ok(ModelsEvent::Loaded { models }) => {
            let n = models.len();
            let provider = st.settings.provider.clone();
            let cache = st.settings.model_cache.entry(provider).or_default();
            for m in models {
                if !cache.contains(&m) {
                    cache.push(m);
                }
            }
            let status = format!("fetched {n} models");
            drop(st);
            ui.set_models_status(status.into());
        }
        Ok(ModelsEvent::Error(e)) => {
            st.rx_models = None;
            drop(st);
            ui.set_models_status(e.into());
        }
        Err(TryRecvError::Empty) => {
            st.rx_models = Some(rx);
        }
        Err(TryRecvError::Disconnected) => {}
    }
}

/// Panel title for a research kind. Kept pure so the mapping is
/// testable without a Slint window.
pub fn research_title(
    kind: &str,
    query: &str,
    strategy: prism_core::ensemble::VotingStrategy,
) -> String {
    match kind {
        "deep" => format!("Deep search: {query}"),
        "multi" => format!("Multi-send: {query}"),
        "council" => format!("Council ({}): {query}", strategy.label()),
        "debate" => format!("Debate: {query}"),
        _ => format!("Web: {query}"),
    }
}

/// Start one research job and report through the timer pump. The
/// provider choice is persisted, so the next run (and the CLI) sees it.
pub fn research_run(ui: &AppWindow, state: &Rc<RefCell<State>>, kind: &str) {
    let query = ui.get_research_query().trim().to_string();
    if query.is_empty() {
        ui.set_research_status("enter a question first".into());
        return;
    }
    let provider = if ui.get_research_provider_idx() == 1 {
        "searxng"
    } else {
        "duckduckgo"
    };
    let (settings, saved) = {
        let mut st = state.borrow_mut();
        st.settings.search_provider = provider.to_string();
        let saved = host::save_settings(&st.settings);
        (st.settings.clone(), saved)
    };
    let strategy = match ui.get_research_strategy_idx() {
        1 => prism_core::ensemble::VotingStrategy::PeerVote,
        2 => prism_core::ensemble::VotingStrategy::Consensus,
        _ => prism_core::ensemble::VotingStrategy::SingleJudge,
    };
    let title = research_title(kind, &query, strategy);
    ui.set_research_title(title.clone().into());
    ui.set_research_body("working…".into());
    ui.set_research_busy(true);
    ui.set_research_status(
        match saved {
            Ok(()) => format!("{kind} running · {provider}"),
            Err(e) => format!("{kind} running · settings not saved: {e}"),
        }
        .into(),
    );

    let (rtx, rrx) = mpsc::channel::<ResearchResult>();
    state.borrow_mut().rx_research.push(rrx);
    let kind = kind.to_string();
    let provider_note = provider.to_string();
    std::thread::spawn(move || {
        let mut result = match kind.as_str() {
            "deep" => {
                let (tx, rx) = mpsc::channel();
                host::spawn_deep_search(settings, query.clone(), 6, 3, tx);
                match rx.recv() {
                    Ok(deep) => ResearchResult {
                        title: format!("Deep search: {}", deep.query),
                        body: prism_core::web::format_deep(&deep),
                        status: format!("deep search · {}", deep.provider),
                    },
                    Err(e) => ResearchResult {
                        title,
                        body: format!("deep search failed: {e}"),
                        status: "deep search failed".into(),
                    },
                }
            }
            "multi" => {
                let (tx, rx) = mpsc::channel();
                host::spawn_multi(settings, query.clone(), 4, tx);
                match rx.recv() {
                    Ok(responses) => ResearchResult {
                        title: format!("Multi-send: {query}"),
                        body: prism_core::ensemble::format_multi(&query, &responses),
                        status: format!("multi-send · {} response(s)", responses.len()),
                    },
                    Err(e) => ResearchResult {
                        title,
                        body: format!("multi-send failed: {e}"),
                        status: "multi-send failed".into(),
                    },
                }
            }
            "council" => {
                let (tx, rx) = mpsc::channel();
                host::spawn_council(settings, query.clone(), strategy, 4, tx);
                match rx.recv() {
                    Ok(Ok(response)) => ResearchResult {
                        title,
                        body: prism_core::ensemble::format_council(&response),
                        status: format!("council · winner {}", response.winner),
                    },
                    Ok(Err(e)) => ResearchResult {
                        title,
                        body: format!("council failed: {e}"),
                        status: "council failed".into(),
                    },
                    Err(e) => ResearchResult {
                        title,
                        body: format!("council failed: {e}"),
                        status: "council failed".into(),
                    },
                }
            }
            "debate" => {
                let (tx, rx) = mpsc::channel();
                host::spawn_debate(settings, query.clone(), 4, 2, tx);
                match rx.recv() {
                    Ok(Ok(response)) => ResearchResult {
                        title,
                        body: prism_core::ensemble::format_debate(&query, &response),
                        status: format!("debate · {} turn(s)", response.turns.len()),
                    },
                    Ok(Err(e)) => ResearchResult {
                        title,
                        body: format!("debate failed: {e}"),
                        status: "debate failed".into(),
                    },
                    Err(e) => ResearchResult {
                        title,
                        body: format!("debate failed: {e}"),
                        status: "debate failed".into(),
                    },
                }
            }
            _ => {
                let (tx, rx) = mpsc::channel();
                host::spawn_search(settings, query.clone(), 8, tx);
                match rx.recv() {
                    Ok(outcome) => ResearchResult {
                        title: format!("Web: {}", outcome.query),
                        body: prism_core::web::format_search(&outcome),
                        status: format!("web · {}", outcome.provider),
                    },
                    Err(e) => ResearchResult {
                        title,
                        body: format!("web search failed: {e}"),
                        status: "web search failed".into(),
                    },
                }
            }
        };
        if result.status.is_empty() {
            result.status = format!("{provider_note} · done");
        }
        let _ = rtx.send(result);
    });
}

/// Drain finished research jobs once per timer tick.
pub fn drain_research(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    let rxs = std::mem::take(&mut state.borrow_mut().rx_research);
    let mut keep = Vec::new();
    for rx in rxs {
        loop {
            match rx.try_recv() {
                Ok(result) => {
                    ui.set_research_title(result.title.into());
                    ui.set_research_body(result.body.into());
                    ui.set_research_status(result.status.into());
                    ui.set_research_busy(false);
                }
                Err(mpsc::TryRecvError::Empty) => {
                    keep.push(rx);
                    break;
                }
                Err(mpsc::TryRecvError::Disconnected) => break,
            }
        }
    }
    state.borrow_mut().rx_research = keep;
}

/// Drain every live agent/subagent channel once per timer tick. `Done`
/// is handed to the `agent-done` callback (which renders the steps and
/// appends the answer); `Notice` becomes a system line; a background
/// `SubagentDone` renders its own answer tagged with the profile. An
/// empty channel keeps its receiver; a disconnected one is dropped.
#[cfg(feature = "agent")]
pub fn drain_agent(
    ui: &AppWindow,
    state: &Rc<RefCell<State>>,
    lines_model: &Rc<VecModel<ChatLine>>,
) {
    let rxs = std::mem::take(&mut state.borrow_mut().rx_agent);
    let mut keep = Vec::new();
    for rx in rxs {
        loop {
            match rx.try_recv() {
                Ok(AgentEvent::Done(json)) => ui.invoke_agent_done(json.into()),
                Ok(AgentEvent::Failed(e)) => push_system(ui, state, lines_model, e),
                Ok(AgentEvent::Notice(text)) => push_system(ui, state, lines_model, text),
                Ok(AgentEvent::SubagentDone { spec, task, result }) => {
                    match serde_json::from_str::<AgentResult>(&result) {
                        Ok(result) if result.completed => {
                            push_system(ui, state, lines_model, format!("[bg {spec}] {task}"));
                            push_line(ui, state, lines_model, "assistant", result.answer);
                        }
                        Ok(result) => push_system(
                            ui,
                            state,
                            lines_model,
                            format!(
                                "[bg {spec}] failed: {}",
                                result
                                    .error
                                    .as_deref()
                                    .unwrap_or("stopped without a final answer")
                            ),
                        ),
                        Err(e) => push_system(
                            ui,
                            state,
                            lines_model,
                            format!("[bg {spec}] unreadable result: {e}"),
                        ),
                    }
                }
                Err(mpsc::TryRecvError::Empty) => {
                    keep.push(rx);
                    break;
                }
                Err(mpsc::TryRecvError::Disconnected) => break,
            }
        }
    }
    state.borrow_mut().rx_agent = keep;
}

pub fn send(
    ui: &AppWindow,
    state: &Rc<RefCell<State>>,
    lines_model: &Rc<VecModel<ChatLine>>,
    text: String,
) {
    let content = text.trim().to_string();
    if content.is_empty() {
        return;
    }
    let mut st = state.borrow_mut();
    host::record_prompt(&content);
    st.history_idx = None;

    if st.streaming {
        // Queue instead of dropping — the user can keep typing.
        st.prompt_queue.push(content);
        push_system(
            ui,
            state,
            lines_model,
            "Queued (response in progress)".into(),
        );
        return;
    }

    // Build the request from history BEFORE appending the new user
    // message and the assistant placeholder.
    let mut history: Vec<ChatMessage> = st
        .lines
        .iter()
        .filter(|l| l.role != "system")
        .map(|l| ChatMessage::text(&l.role, &l.content))
        .collect();
    // Plugin pipeline (snippets, tone) — registry is per-call, cheap.
    let registry = prism_core::plugins::Registry::with_defaults();
    let content = registry.before_send(
        &*host::storage(),
        host::config_dir().as_deref(),
        &content,
        &st.settings,
    );
    history.push(ChatMessage::text("user", &content));

    st.lines.push(Line::new("user", content.clone()));
    st.lines.push(Line::new("assistant", String::new()));

    let (tx, rx) = mpsc::channel::<StreamEvent>();

    match st.settings.connection {
        Connection::Direct => {
            let resolved = st.settings.resolve_provider(&st.settings.provider);
            let needs_key = resolved.as_ref().map(|r| r.needs_key).unwrap_or(false);
            let key = st.settings.key_for(&st.settings.provider);
            if needs_key && key.trim().is_empty() {
                let label = resolved
                    .as_ref()
                    .map(|r| r.label.clone())
                    .unwrap_or_else(|| "provider".into());
                drop(st);
                push_system(
                    ui,
                    state,
                    lines_model,
                    format!("API key required for {label}. Open settings."),
                );
                return;
            }

            // System prompt first, like the extension's adapter does.
            if !st.settings.system_prompt.trim().is_empty() {
                history.insert(
                    0,
                    ChatMessage::text("system", st.settings.system_prompt.trim()),
                );
            }
            if st.settings.thinking_enabled {
                history = thinking::apply_thinking_to_messages(&history);
            }

            // Hardware overrides only reach Ollama through its native
            // endpoint; the OpenAI-compat path ignores them.
            let hw = st.settings.hardware.clone();
            if st.settings.provider == "ollama" && hw.has_overrides() {
                let req = OllamaChatRequest {
                    base_url: ollama_root_url(&st.settings.local_base_url),
                    model: effective_model(&st.settings),
                    temperature: st.settings.temperature,
                    messages: history,
                    num_ctx: hw.context_tokens,
                    max_tokens: st.settings.max_tokens,
                    num_gpu: if hw.preferred_compute == "cpu-only" {
                        Some(0)
                    } else {
                        hw.gpu_layers_override
                    },
                };
                st.streaming = true;
                st.rx = Some(rx);
                drop(st);
                host::spawn_ollama_chat(req, tx);
            } else {
                let base_url = resolved.map(|r| r.base_url).unwrap_or_default();
                let req = StreamRequest {
                    base_url,
                    api_key: key.trim().to_string(),
                    model: effective_model(&st.settings),
                    temperature: st.settings.temperature,
                    messages: history,
                    max_tokens: st.settings.max_tokens,
                    top_p: st.settings.top_p,
                    frequency_penalty: st.settings.frequency_penalty,
                    presence_penalty: st.settings.presence_penalty,
                };
                st.streaming = true;
                st.rx = Some(rx);
                drop(st);
                host::spawn_stream(req, tx);
            }
        }
        Connection::PrismApi => {
            if st.settings.prism_api_token.trim().is_empty() {
                drop(st);
                push_system(
                    ui,
                    state,
                    lines_model,
                    "Prism API token required. Open settings.".into(),
                );
                return;
            }
            let req = ApiChatRequest {
                server_url: st.settings.prism_api_url.trim().to_string(),
                token: st.settings.prism_api_token.trim().to_string(),
                content: history
                    .last()
                    .map(|m| m.content.clone())
                    .unwrap_or_default(),
            };
            st.streaming = true;
            st.rx = Some(rx);
            drop(st);
            host::spawn_api_chat(req, tx);
        }
    }

    ui.set_streaming(true);
    let lines = state.borrow().lines.clone();
    refresh_transcript(ui, lines_model, &lines);
    ui.invoke_scroll_to_end();
    persist_current(ui, state, lines_model);
}

/// Cycle sent-prompt history with Up/Down while the input is focused.
/// `back = true` (Up) walks older prompts; at the oldest entry the call
/// is a no-op so the user cannot fall off the end. Forward past the
/// newest entry restores the draft that was being edited when cycling
/// started. Does nothing while streaming (input is disabled anyway).
pub fn history_recall(ui: &AppWindow, state: &Rc<RefCell<State>>, back: bool) {
    if state.borrow().streaming {
        return;
    }
    let history = host::load_prompt_history();
    if history.is_empty() {
        return;
    }
    let mut st = state.borrow_mut();
    let draft = match &st.history_idx {
        None => {
            // Entering cycle mode: remember the current input as draft.
            let d = ui.get_input_text().to_string();
            st.history_draft = Some(d);
            0usize
        }
        Some(i) => *i,
    };
    let last = history.len() - 1;
    let next = if back {
        if draft >= last {
            draft // already at oldest; stay
        } else {
            draft + 1
        }
    } else {
        if draft == 0 {
            // Forward past newest: leave cycle mode, restore draft.
            st.history_idx = None;
            let text = st.history_draft.clone().unwrap_or_default();
            drop(st);
            ui.set_input_text(text.into());
            return;
        }
        draft - 1
    };
    let text = history[history.len() - 1 - next].text.clone();
    st.history_idx = Some(next);
    drop(st);
    ui.set_input_text(text.into());
}
/// Run the Slint UI: build the window, wire callbacks, start the timer pump,
/// and enter the event loop. Shared by desktop main() and Android android_main.
pub fn run_ui() {
    let ui = AppWindow::new().expect("failed to create AppWindow");

    let lines_model: Rc<VecModel<ChatLine>> = Rc::new(VecModel::from(Vec::new()));
    ui.set_transcript(ModelRc::from(lines_model.clone()));

    let state = Rc::new(RefCell::new(State::new()));

    // ---- initial property sync ----
    {
        let st = state.borrow();
        ui.set_provider_labels(ModelRc::from(Rc::new(VecModel::from(st.provider_labels()))));
        ui.set_compute_labels(ModelRc::from(Rc::new(VecModel::from(
            COMPUTE_LEVELS
                .iter()
                .map(|c| SharedString::from(*c))
                .collect::<Vec<_>>(),
        ))));
        ui.set_canonical_labels(ModelRc::from(Rc::new(VecModel::from(
            std::iter::once(SharedString::from("(bare endpoint)"))
                .chain(PROVIDERS.iter().map(|p| SharedString::from(p.label)))
                .collect::<Vec<_>>(),
        ))));
        refresh_custom_provider_rows(&ui, &st.settings);
        ui.set_search_role_labels(ModelRc::from(Rc::new(VecModel::from(
            crate::features::SEARCH_ROLE_LABELS
                .iter()
                .map(|l| SharedString::from(*l))
                .collect::<Vec<_>>(),
        ))));
        ui.set_search_sort_labels(ModelRc::from(Rc::new(VecModel::from(
            crate::features::SEARCH_SORT_LABELS
                .iter()
                .map(|l| SharedString::from(*l))
                .collect::<Vec<_>>(),
        ))));
        ui.set_research_provider_labels(ModelRc::from(Rc::new(VecModel::from(
            vec![
                SharedString::from("DuckDuckGo"),
                SharedString::from("SearXNG"),
            ],
        ))));
        ui.set_research_strategy_labels(ModelRc::from(Rc::new(VecModel::from(
            vec![
                SharedString::from("single-judge"),
                SharedString::from("peer-vote"),
                SharedString::from("consensus"),
            ],
        ))));
        ui.set_research_provider_idx(if st.settings.search_provider == "searxng" {
            1
        } else {
            0
        });
        ui.set_research_status(
            format!(
                "backend: {} · searxng url: {}",
                st.settings.search_provider,
                if st.settings.searxng_url.is_empty() {
                    "<unset>"
                } else {
                    &st.settings.searxng_url
                }
            )
            .into(),
        );
        ui.set_provider(st.settings.provider.as_str().into());
        let total = PROVIDERS.len() + st.settings.custom_providers.len();
        let pos = (0..total)
            .find(|&i| st.provider_id_at(i).as_deref() == Some(st.settings.provider.as_str()))
            .unwrap_or(0);
        ui.set_provider_idx(pos as i32);
        ui.set_connection_idx(match st.settings.connection {
            Connection::Direct => 0,
            Connection::PrismApi => 1,
        });
        ui.set_model(st.settings.model.clone().into());
        ui.set_model_hint(model_hint(&st.settings));
        ui.set_prism_url(st.settings.prism_api_url.clone().into());
        ui.set_prism_token(st.settings.prism_api_token.clone().into());
        ui.set_local_url(st.settings.local_base_url.clone().into());
        ui.set_temperature(st.settings.temperature);
        ui.set_max_tokens(
            st.settings
                .max_tokens
                .map(|v| v.to_string())
                .unwrap_or_default()
                .into(),
        );
        ui.set_top_p(
            st.settings
                .top_p
                .map(|v| v.to_string())
                .unwrap_or_default()
                .into(),
        );
        ui.set_freq_penalty(
            st.settings
                .frequency_penalty
                .map(|v| v.to_string())
                .unwrap_or_default()
                .into(),
        );
        ui.set_pres_penalty(
            st.settings
                .presence_penalty
                .map(|v| v.to_string())
                .unwrap_or_default()
                .into(),
        );
        ui.set_system_prompt(st.settings.system_prompt.clone().into());
        ui.set_thinking_enabled(st.settings.thinking_enabled);
        ui.set_compute_idx(
            COMPUTE_LEVELS
                .iter()
                .position(|c| *c == st.settings.hardware.preferred_compute)
                .unwrap_or(0) as i32,
        );
        ui.set_gpu_label(gpu_label(st.gpu_idx));
        ui.set_ctx_label(ctx_label(st.ctx_idx));
        ui.set_api_keys(ModelRc::from(Rc::new(VecModel::from(key_rows(
            &st.settings,
        )))));
        ui.set_cached_models(ModelRc::from(Rc::new(VecModel::from(cached_models(
            &st.settings,
        )))));
        {
            let (labels, blurbs, traits) = mode_lists();
            ui.set_pmode_labels(ModelRc::from(Rc::new(VecModel::from(labels))));
            ui.set_pmode_blurbs(ModelRc::from(Rc::new(VecModel::from(blurbs))));
            ui.set_pmode_traits(ModelRc::from(Rc::new(VecModel::from(traits))));
            apply_mode_traits(&ui, Mode::default().traits());
            refresh_session_panels(&ui, &state);
            ui.set_gen_cap_labels(ModelRc::from(Rc::new(VecModel::from(gen_cap_labels()))));
        }
        ui.set_media_kind_labels(ModelRc::from(Rc::new(VecModel::from(
            media::MEDIA_KINDS
                .iter()
                .map(|(label, _)| SharedString::from(*label))
                .collect::<Vec<_>>(),
        ))));
        ui.set_media_provider_labels(ModelRc::from(Rc::new(VecModel::from(
            st.media.provider_labels(),
        ))));
        ui.set_media_provider(st.media.provider().into());
        ui.set_media_needs_image(st.media.needs_image());
        ui.set_media_needs_mask(st.media.needs_mask());
        crate::shared::studio::init(&ui, &state);
        crate::shared::image::init(&ui, &state);
        crate::shared::graph::init(&ui, &state);
        ui.set_ui_mode(st.ui_mode as i32);
        ui.set_composer_hint(composer_hint(st.ui_mode).into());
        refresh_chats(&ui, &state);
    }

    // ---- callbacks ----
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        let lines_c = lines_model.clone();
        ui.on_send(move |text| {
            let Some(ui) = ui_w.upgrade() else { return };
            let text = text.to_string();
            // Agent/IDE modes route the composer into the agent loop;
            // Chat keeps the streaming chat.
            if ui.get_ui_mode() != 0 {
                if text.trim().is_empty() {
                    return;
                }
                push_system(&ui, &state_c, &lines_c, format!("[agent task] {text}"));
                #[cfg(feature = "agent")]
                crate::shared::agent_integration::run_agent_from_palette(
                    &ui, &state_c, &lines_c, &text,
                );
                #[cfg(not(feature = "agent"))]
                run_agent_from_palette(&ui, &state_c, &lines_c, &text);
                return;
            }
            send(&ui, &state_c, &lines_c, text);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_history_back(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            history_recall(&ui, &state_c, true);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_history_forward(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            history_recall(&ui, &state_c, false);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_random_prompt(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            // Avoid repeating the last random pick, and seed from the
            // clock so consecutive clicks differ.
            let last = state_c.borrow().last_random.clone();
            let seed = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos() as u64)
                .unwrap_or(0);
            match host::random_prompt(last.as_deref(), seed) {
                Some(p) => {
                    ui.set_input_text(p.clone().into());
                    state_c.borrow_mut().last_random = Some(p);
                }
                None => ui.set_settings_status("no prompts in the pool or history".into()),
            }
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_palette_toggle(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            let open = !ui.get_palette_open();
            ui.set_palette_open(open);
            if open {
                ui.set_palette_query("".into());
                palette_refresh(&ui, &state_c, "");
            }
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_palette_query_changed(move |q| {
            let Some(ui) = ui_w.upgrade() else { return };
            palette_refresh(&ui, &state_c, &q.to_string());
        });
    }
    // ---- IDE callbacks (modes, workspace, editor) ----
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_mode_selected(move |m| {
            let Some(ui) = ui_w.upgrade() else { return };
            set_mode(&ui, &state_c, m as usize);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_workspace_open(move |arg| {
            let Some(ui) = ui_w.upgrade() else { return };
            open_workspace(&ui, &state_c, &arg.to_string());
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_workspace_refresh(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            refresh_tree(&ui, &state_c);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_tree_open(move |rel| {
            let Some(ui) = ui_w.upgrade() else { return };
            open_tree_file(&ui, &state_c, &rel.to_string());
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_editor_changed(move |text| {
            let Some(ui) = ui_w.upgrade() else { return };
            editor_changed(&ui, &state_c, &text.to_string());
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_editor_save(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            save_editor(&ui, &state_c);
        });
    }

    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        let lines_c = lines_model.clone();
        ui.on_palette_execute(move |id| {
            let Some(ui) = ui_w.upgrade() else { return };
            palette_execute(&ui, &state_c, &lines_c, &id.to_string());
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_custom_provider_add(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            add_custom_provider(&ui, &state_c);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_daemon_add(move |name, instruction, interval| {
            let Some(ui) = ui_w.upgrade() else { return };
            daemon_add(
                &ui,
                &state_c,
                &name.to_string(),
                &instruction.to_string(),
                &interval.to_string(),
            );
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_daemon_run(move |id| {
            let Some(ui) = ui_w.upgrade() else { return };
            let id = id.to_string();
            let instruction = {
                let st = state_c.borrow();
                st.daemon_tasks
                    .iter()
                    .find(|t| t.id == id)
                    .map(|t| t.instruction.clone())
            };
            match instruction {
                Some(instr) => {
                    ui.set_settings_status(format!("daemon: running '{}'", instr).into())
                }
                None => ui.set_settings_status("daemon task not found".into()),
            }
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_daemon_toggle(move |id| {
            let Some(ui) = ui_w.upgrade() else { return };
            daemon_toggle(&ui, &state_c, &id.to_string());
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_daemon_remove(move |id| {
            let Some(ui) = ui_w.upgrade() else { return };
            daemon_remove(&ui, &state_c, &id.to_string());
        });
    }
    {
        let ui_w = ui.as_weak();
        ui.on_agent_strategy_selected(move |idx| {
            let Some(ui) = ui_w.upgrade() else { return };
            let label = if idx == 1 {
                "plan-and-execute"
            } else {
                "react"
            };
            ui.set_settings_status(format!("agent strategy: {label}").into());
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_agent_run(move |instruction| {
            let Some(ui) = ui_w.upgrade() else { return };
            if state_c.borrow().agent_busy {
                return;
            }
            let instruction = instruction.trim().to_string();
            if instruction.is_empty() {
                ui.set_settings_status("agent task is empty".into());
                return;
            }
            // The composer text is the prompt layer's user_input, so
            // prompt_messages() and the run agree on what was asked.
            state_c.borrow_mut().session.prompt.user_input = instruction.clone();
            let (mode, tools, denied) = {
                let st = state_c.borrow();
                let mode = st.mode;
                let tools = st.session.capability.tools.clone();
                // Anything the session's permission policy denies is
                // reported before the run starts, not discovered mid-run.
                let denied: Vec<String> = tools
                    .iter()
                    .filter(|t| st.session.permission_for(t) == PermissionLevel::Deny)
                    .cloned()
                    .collect();
                (mode, tools, denied)
            };
            state_c.borrow_mut().agent_busy = true;
            ui.set_agent_busy(true);
            let strategy = ui.get_agent_strategy_idx();
            let strategy_label = if strategy == 1 {
                "plan-and-execute"
            } else {
                "react"
            };
            ui.set_settings_status(
                format!(
                    "agent: {} · {}/{} tools · {}",
                    strategy_label,
                    tools.len() - denied.len(),
                    tools.len(),
                    if denied.is_empty() {
                        "all permitted".to_string()
                    } else {
                        format!("denied: {}", denied.join(", "))
                    }
                )
                .into(),
            );
            // The tool list rendered above the run is the session's own
            // list, not a static one, so what the surface advertises and
            // what the policy permits come from one place.
            let tool_rows: Vec<PaletteRow> = tools
                .iter()
                .map(|t| {
                    let badge = match st_session_perm(&state_c, t) {
                        PermissionLevel::Allow => "allow",
                        PermissionLevel::Ask => "ask",
                        PermissionLevel::Deny => "deny",
                    };
                    PaletteRow {
                        id: format!("tool:{t}").into(),
                        title: t.clone().into(),
                        group: badge.into(),
                    }
                })
                .collect();
            let _ = (mode, strategy_label);
            ui.set_agent_steps(ModelRc::from(Rc::new(VecModel::from(tool_rows))));
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_pmode_selected(move |idx| {
            let Some(ui) = ui_w.upgrade() else { return };
            mode_select(&ui, &state_c, idx);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_pmode_mix_toggle(move |idx| {
            let Some(ui) = ui_w.upgrade() else { return };
            mode_mix_toggle(&ui, &state_c, idx);
        });
    }
    {
        let ui_w = ui.as_weak();
        ui.on_mix_editor_toggle(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            ui.set_show_mix_editor(!ui.get_show_mix_editor());
        });
    }
    {
        let ui_w = ui.as_weak();
        ui.on_cap_editor_toggle(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            ui.set_show_cap_editor(!ui.get_show_cap_editor());
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_cap_toggle(move |feature| {
            let Some(ui) = ui_w.upgrade() else { return };
            cap_toggle(&ui, &state_c, &feature.to_string());
        });
    }
    {
        let ui_w = ui.as_weak();
        ui.on_perm_editor_toggle(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            ui.set_show_perm_editor(!ui.get_show_perm_editor());
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_perm_cycle(move |tool| {
            let Some(ui) = ui_w.upgrade() else { return };
            perm_cycle(&ui, &state_c, &tool.to_string());
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_perm_default_cycle(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            perm_default_cycle(&ui, &state_c);
        });
    }
    {
        let ui_w = ui.as_weak();
        ui.on_gen_cap_selected(move |idx| {
            let Some(ui) = ui_w.upgrade() else { return };
            let cap = GenCapability::all()
                .get(idx as usize)
                .map(|c| c.label())
                .unwrap_or("unknown");
            ui.set_settings_status(format!("generative: {cap}").into());
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_card_load(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            card_load(&ui, &state_c);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_card_clear(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            card_clear(&ui, &state_c);
        });
    }
    {
        let state_c = state.clone();
        ui.on_persona_edited(move |name, desc| {
            // No UI write needed: the persona lives in State only.
            persona_edit(&state_c, &name.to_string(), &desc.to_string());
        });
    }
    {
        // Prompt engine toggle card + persona already live in State; this
        // just reports status so the user sees the setting took.
        let ui_w = ui.as_weak();
        ui.on_prompt_engine_toggle(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            let on = ui.get_prompt_engine_on();
            ui.set_settings_status(if on {
                "core prompt engine on".into()
            } else {
                "core prompt engine off".into()
            });
        });
    }
    {
        let ui_w = ui.as_weak();
        ui.on_sync_export(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            sync_export(&ui);
        });
    }
    {
        let ui_w = ui.as_weak();
        ui.on_sync_import(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            sync_import(&ui);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_sync_clear(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            sync_clear(&ui, &state_c);
        });
    }
    {
        let ui_w = ui.as_weak();
        ui.on_sync_login(move |_email, _password| {
            // Desktop has no Prism cloud account server wired; the
            // extension signs in via its auth provider. Report clearly
            // rather than pretending.
            let Some(ui) = ui_w.upgrade() else { return };
            ui.set_sync_status("cloud sign-in is not available on desktop".into());
        });
    }
    {
        let ui_w = ui.as_weak();
        ui.on_sync_logout(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            ui.set_sync_status("not signed in".into());
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_custom_provider_remove(move |id| {
            let Some(ui) = ui_w.upgrade() else { return };
            remove_custom_provider(&ui, &state_c, &id.to_string());
        });
    }
    {
        let ui_w = ui.as_weak();
        ui.on_palette_move(move |delta| {
            let Some(ui) = ui_w.upgrade() else { return };
            let n = slint::Model::row_count(&ui.get_palette_results()) as i32;
            if n == 0 {
                return;
            }
            let cur = ui.get_palette_idx();
            let next = (cur + delta).rem_euclid(n);
            ui.set_palette_idx(next);
        });
    }
    #[cfg(feature = "agent")]
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        let lines_c = lines_model.clone();
        ui.on_agent_done(move |json| {
            let Some(ui) = ui_w.upgrade() else { return };
            let result: AgentResult = match serde_json::from_str(&json.to_string()) {
                Ok(r) => r,
                Err(e) => {
                    push_system(&ui, &state_c, &lines_c, format!("agent result parse: {e}"));
                    return;
                }
            };
            for (i, step) in result.steps.iter().enumerate() {
                push_system(
                    &ui,
                    &state_c,
                    &lines_c,
                    format!(
                        "[{}/{}] {}: {} -> {}",
                        i + 1,
                        result.steps.len(),
                        step.action,
                        step.action_input,
                        if step.observation.len() > 120 {
                            format!("{}…", &step.observation[..120])
                        } else {
                            step.observation.clone()
                        }
                    ),
                );
            }
            if result.completed {
                ui.set_palette_open(false);
                push_system(&ui, &state_c, &lines_c, "agent finished".into());
                // Append final answer to transcript
                let provider = {
                    let st = state_c.borrow();
                    st.settings.provider.clone()
                };
                let mut st = state_c.borrow_mut();
                st.lines.push(Line::new("user", provider));
                st.lines.push(Line::new("assistant", result.answer.clone()));
                refresh_transcript(&ui, &lines_c, &st.lines);
                st.chats = host::list_conversations();
                // TODO: persist conversation
            } else {
                push_system(
                    &ui,
                    &state_c,
                    &lines_c,
                    result.error.unwrap_or("agent stopped".into()),
                );
            }
        });
    }

    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        let lines_c = lines_model.clone();
        ui.on_new_chat(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            if !require_idle(&ui, &state_c, &lines_c) {
                return;
            }
            persist_current(&ui, &state_c, &lines_c);
            {
                let mut st = state_c.borrow_mut();
                st.lines.clear();
                st.current_id = None;
                st.current_created = 0;
                st.confirm_delete = None;
                st.history_idx = None;
                st.history_draft = None;
                st.chats = host::list_conversations();
            }
            refresh_transcript(&ui, &lines_c, &[]);
            refresh_chats(&ui, &state_c);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        let lines_c = lines_model.clone();
        ui.on_open_chat(move |id| {
            let Some(ui) = ui_w.upgrade() else { return };
            let id = id.to_string();
            if !require_idle(&ui, &state_c, &lines_c)
                || state_c.borrow().current_id.as_deref() == Some(id.as_str())
            {
                return;
            }
            persist_current(&ui, &state_c, &lines_c);
            match host::load_conversation(&id) {
                Some(c) => {
                    let mut st = state_c.borrow_mut();
                    st.lines = c
                        .messages
                        .iter()
                        .map(|m| Line {
                            role: m.role.clone(),
                            content: m.content.clone(),
                            thinking: m.thinking.clone(),
                            tags: m.tags.clone(),
                            read: m.read,
                            edited: m.edited_at.is_some(),
                        })
                        .collect();
                    st.current_id = Some(c.id);
                    st.current_created = c.created_at;
                    st.confirm_delete = None;
                    let lines = st.lines.clone();
                    drop(st);
                    refresh_transcript(&ui, &lines_c, &lines);
                    ui.invoke_scroll_to_end();
                    refresh_chats(&ui, &state_c);
                }
                None => push_system(&ui, &state_c, &lines_c, "conversation not found".into()),
            }
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        let lines_c = lines_model.clone();
        ui.on_request_delete(move |id| {
            let Some(ui) = ui_w.upgrade() else { return };
            let id = id.to_string();
            if !require_idle(&ui, &state_c, &lines_c) {
                return;
            }
            let confirming = state_c.borrow().confirm_delete.as_deref() == Some(id.as_str());
            if confirming {
                if let Err(e) = host::delete_conversation(&id) {
                    push_system(
                        &ui,
                        &state_c,
                        &lines_c,
                        format!("failed to delete conversation: {e}"),
                    );
                }
                {
                    let mut st = state_c.borrow_mut();
                    st.confirm_delete = None;
                    if st.current_id.as_deref() == Some(id.as_str()) {
                        st.lines.clear();
                        st.current_id = None;
                        st.current_created = 0;
                    }
                    st.chats = host::list_conversations();
                }
                let lines = state_c.borrow().lines.clone();
                refresh_transcript(&ui, &lines_c, &lines);
                refresh_chats(&ui, &state_c);
            } else {
                state_c.borrow_mut().confirm_delete = Some(id);
                refresh_chats(&ui, &state_c);
            }
        });
    }
    {
        let state_c = state.clone();
        ui.on_set_connection(move |i| {
            let mut st = state_c.borrow_mut();
            st.settings.connection = match i {
                1 => Connection::PrismApi,
                _ => Connection::Direct,
            };
        });
    }

    // ---- new feature callbacks ----
    {
        let ui_w = ui.as_weak();
        ui.on_search_toggle(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            let open = !ui.get_search_open();
            ui.set_search_open(open);
            if open {
                crate::features::run_search(&ui);
            }
        });
    }
    {
        let ui_w = ui.as_weak();
        ui.on_search_run(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            crate::features::run_search(&ui);
        });
    }
    {
        let ui_w = ui.as_weak();
        ui.on_research_toggle(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            let open = !ui.get_show_research();
            ui.set_show_research(open);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_research_run(move |kind| {
            let Some(ui) = ui_w.upgrade() else { return };
            research_run(&ui, &state_c, kind.as_str());
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        let lines_c = lines_model.clone();
        ui.on_search_jump(move |conversation_id, message_index| {
            let Some(ui) = ui_w.upgrade() else { return };
            crate::features::jump_to_message(
                &ui,
                &state_c,
                &lines_c,
                &conversation_id.to_string(),
                message_index,
            );
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        let lines_c = lines_model.clone();
        ui.on_message_fork(move |index| {
            let Some(ui) = ui_w.upgrade() else { return };
            crate::features::fork_at(&ui, &state_c, &lines_c, index);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_message_edit_start(move |index| {
            let Some(ui) = ui_w.upgrade() else { return };
            crate::features::edit_start(&ui, &state_c, index);
        });
    }
    {
        let ui_w = ui.as_weak();
        ui.on_message_edit_cancel(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            crate::features::edit_cancel(&ui);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        let lines_c = lines_model.clone();
        ui.on_message_edit_commit(move |index, text| {
            let Some(ui) = ui_w.upgrade() else { return };
            crate::features::edit_commit(&ui, &state_c, &lines_c, index, &text.to_string());
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        let lines_c = lines_model.clone();
        ui.on_message_toggle_read(move |index| {
            let Some(ui) = ui_w.upgrade() else { return };
            crate::features::toggle_message_read(&ui, &state_c, &lines_c, index);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        let lines_c = lines_model.clone();
        ui.on_message_tag(move |index, tag| {
            let Some(ui) = ui_w.upgrade() else { return };
            crate::features::tag_message(&ui, &state_c, &lines_c, index, &tag.to_string());
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        let lines_c = lines_model.clone();
        ui.on_message_untag(move |index, tag| {
            let Some(ui) = ui_w.upgrade() else { return };
            crate::features::untag_message(&ui, &state_c, &lines_c, index, &tag.to_string());
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        let lines_c = lines_model.clone();
        ui.on_session_toggle_read(move |_| {
            let Some(ui) = ui_w.upgrade() else { return };
            crate::features::toggle_session_read(&ui, &state_c, &lines_c);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        let lines_c = lines_model.clone();
        ui.on_session_toggle_archive(move |_| {
            let Some(ui) = ui_w.upgrade() else { return };
            crate::features::toggle_session_archive(&ui, &state_c, &lines_c);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        let lines_c = lines_model.clone();
        ui.on_session_tag(move |_, tag| {
            let Some(ui) = ui_w.upgrade() else { return };
            crate::features::tag_session(&ui, &state_c, &lines_c, &tag.to_string());
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        let lines_c = lines_model.clone();
        ui.on_session_untag(move |_, tag| {
            let Some(ui) = ui_w.upgrade() else { return };
            crate::features::untag_session(&ui, &state_c, &lines_c, &tag.to_string());
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_context_toggle(move |id, enabled| {
            let Some(ui) = ui_w.upgrade() else { return };
            crate::features::toggle_context_item(&ui, &state_c, &id.to_string(), enabled);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_context_remove(move |id| {
            let Some(ui) = ui_w.upgrade() else { return };
            crate::features::remove_context_item(&ui, &state_c, &id.to_string());
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_context_budget_changed(move |budget| {
            let Some(ui) = ui_w.upgrade() else { return };
            crate::features::set_context_budget(&ui, &state_c, &budget.to_string());
        });
    }
    {
        let ui_w = ui.as_weak();
        ui.on_backup_export(move |path| {
            let Some(ui) = ui_w.upgrade() else { return };
            crate::features::export_backup(&ui, &path.to_string());
        });
    }
    {
        let ui_w = ui.as_weak();
        ui.on_backup_import(move |path| {
            let Some(ui) = ui_w.upgrade() else { return };
            crate::features::import_backup(&ui, &path.to_string());
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_set_provider(move |i| {
            let Some(ui) = ui_w.upgrade() else { return };
            let mut st = state_c.borrow_mut();
            if let Some(pid) = st.provider_id_at(i as usize) {
                st.settings.provider = pid;
            }
            let (pid, hint, cm, local) = (
                st.settings.provider.clone(),
                model_hint(&st.settings),
                cached_models(&st.settings),
                st.settings.local_base_url.clone(),
            );
            drop(st);
            ui.set_provider(pid.into());
            ui.set_model_hint(hint);
            ui.set_cached_models(ModelRc::from(Rc::new(VecModel::from(cm))));
            ui.set_local_url(local.into());
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_model_edited(move |t| {
            let Some(ui) = ui_w.upgrade() else { return };
            let hint = {
                let mut st = state_c.borrow_mut();
                st.settings.model = t.to_string();
                model_hint(&st.settings)
            };
            ui.set_model_hint(hint);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_fetch_models(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            let (base_url, api_key, status) = {
                let st = state_c.borrow_mut();
                if st.rx_models.is_some() {
                    return;
                }
                let provider = st.settings.provider.clone();
                let key = st.settings.key_for(&provider);
                let base_url = if provider == "ollama" {
                    st.settings.local_base_url.trim().to_string()
                } else {
                    providers::find(&provider)
                        .map(|p| p.base_url.to_string())
                        .unwrap_or_default()
                };
                let needs_key = providers::find(&provider)
                    .map(|p| p.needs_key)
                    .unwrap_or(false);
                if base_url.is_empty() || (needs_key && key.trim().is_empty()) {
                    (
                        String::new(),
                        String::new(),
                        "set an API key first".to_string(),
                    )
                } else {
                    (base_url, key, "fetching…".to_string())
                }
            };
            if base_url.is_empty() {
                ui.set_models_status(status.into());
                return;
            }
            let (tx, rx) = mpsc::channel();
            state_c.borrow_mut().rx_models = Some(rx);
            ui.set_models_status(status.into());
            host::spawn_models_fetch(
                ModelsRequest {
                    base_url,
                    api_key: api_key.trim().to_string(),
                },
                tx,
            );
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_pick_model(move |name| {
            let Some(ui) = ui_w.upgrade() else { return };
            state_c.borrow_mut().settings.model = name.to_string();
            ui.set_model(name);
            ui.set_model_hint("".into());
        });
    }
    {
        let state_c = state.clone();
        ui.on_key_edited(move |provider, key| {
            state_c
                .borrow_mut()
                .settings
                .provider_keys
                .insert(provider.to_string(), key.to_string());
        });
    }
    {
        let state_c = state.clone();
        ui.on_temperature_edited(move |v| {
            state_c.borrow_mut().settings.temperature = v as f32;
        });
    }
    {
        let state_c = state.clone();
        ui.on_sampling_edited(move |field, value| {
            let mut st = state_c.borrow_mut();
            match field.as_str() {
                "max-tokens" => {
                    if let Some(v) = parse_opt_u32(&value) {
                        st.settings.max_tokens = v;
                    }
                }
                "top-p" => {
                    if let Some(v) = parse_opt_f32(&value) {
                        st.settings.top_p = v;
                    }
                }
                "freq" => {
                    if let Some(v) = parse_opt_f32(&value) {
                        st.settings.frequency_penalty = v;
                    }
                }
                "pres" => {
                    if let Some(v) = parse_opt_f32(&value) {
                        st.settings.presence_penalty = v;
                    }
                }
                _ => {}
            }
        });
    }

    {
        let state_c = state.clone();
        ui.on_system_prompt_edited(move |t| {
            let mut st = state_c.borrow_mut();
            st.settings.system_prompt = t.to_string();
            let mode = st.mode;
            st.session.prompt.override_prompt(mode, &t.to_string());
        });
    }
    {
        let state_c = state.clone();
        ui.on_thinking_toggled(move |b| {
            state_c.borrow_mut().settings.thinking_enabled = b;
        });
    }
    {
        let state_c = state.clone();
        ui.on_compute_selected(move |i| {
            if let Some(c) = COMPUTE_LEVELS.get(i as usize) {
                state_c.borrow_mut().settings.hardware.preferred_compute = c.to_string();
            }
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_cycle_gpu(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            let label = {
                let mut st = state_c.borrow_mut();
                st.gpu_idx = (st.gpu_idx + 1) % GPU_LAYER_CYCLE.len();
                st.settings.hardware.gpu_layers_override = GPU_LAYER_CYCLE[st.gpu_idx];
                gpu_label(st.gpu_idx)
            };
            ui.set_gpu_label(label);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_cycle_ctx(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            let label = {
                let mut st = state_c.borrow_mut();
                st.ctx_idx = (st.ctx_idx + 1) % CONTEXT_TOKEN_CYCLE.len();
                st.settings.hardware.context_tokens = CONTEXT_TOKEN_CYCLE[st.ctx_idx];
                ctx_label(st.ctx_idx)
            };
            ui.set_ctx_label(label);
        });
    }
    {
        let state_c = state.clone();
        ui.on_local_url_edited(move |t| {
            state_c.borrow_mut().settings.local_base_url = t.to_string();
        });
    }
    {
        let state_c = state.clone();
        ui.on_prism_url_edited(move |t| {
            state_c.borrow_mut().settings.prism_api_url = t.to_string();
        });
    }
    {
        let state_c = state.clone();
        ui.on_prism_token_edited(move |t| {
            state_c.borrow_mut().settings.prism_api_token = t.to_string();
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_save_settings(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            let status = match host::save_settings(&state_c.borrow().settings) {
                Ok(()) => match host::settings_path() {
                    Some(path) => format!("saved to {}", path.display()),
                    None => "saved".into(),
                },
                Err(e) => format!("save failed: {e}"),
            };
            ui.set_settings_status(status.into());
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_media_kind_selected(move |i| {
            let Some(ui) = ui_w.upgrade() else { return };
            media::select_kind(&ui, &state_c, i);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_media_provider_selected(move |i| {
            let Some(ui) = ui_w.upgrade() else { return };
            media::select_provider(&ui, &state_c, i);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_media_generate(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            media::generate(&ui, &state_c);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_media_poll(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            media::poll(&ui, &state_c);
        });
    }
    // ---- studio callbacks ----
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_studio_select_model(move |i| {
            let Some(ui) = ui_w.upgrade() else { return };
            studio::select_model(&ui, &state_c, i);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_studio_quantity_step(move |d| {
            let Some(ui) = ui_w.upgrade() else { return };
            studio::quantity_step(&ui, &state_c, d);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_studio_generate(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            studio::generate(&ui, &state_c);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_studio_aspect_selected(move |i| {
            let Some(ui) = ui_w.upgrade() else { return };
            studio::select_aspect(&ui, &state_c, i);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_studio_res_selected(move |i| {
            let Some(ui) = ui_w.upgrade() else { return };
            studio::select_res(&ui, &state_c, i);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_studio_dur_selected(move |i| {
            let Some(ui) = ui_w.upgrade() else { return };
            studio::select_dur(&ui, &state_c, i);
        });
    }
    // ---- image studio callbacks ----
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_image_provider_selected(move |i| {
            let Some(ui) = ui_w.upgrade() else { return };
            image::select_provider(&ui, &state_c, i);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_image_sampler_selected(move |i| {
            let Some(ui) = ui_w.upgrade() else { return };
            image::select_sampler(&ui, &state_c, i);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_image_scheduler_selected(move |i| {
            let Some(ui) = ui_w.upgrade() else { return };
            image::select_scheduler(&ui, &state_c, i);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_image_generate(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            image::generate(&ui, &state_c);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_image_seed_random(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            image::seed_random(&ui, &state_c);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_image_seed_lock_toggle(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            image::seed_lock_toggle(&ui, &state_c);
        });
    }
    {
        let ui_w = ui.as_weak();
        ui.on_image_aspect_selected(move |ratio| {
            let Some(ui) = ui_w.upgrade() else { return };
            image::aspect_selected(&ui, &ratio);
        });
    }
    {
        let ui_w = ui.as_weak();
        ui.on_image_batch_step(move |d| {
            let Some(ui) = ui_w.upgrade() else { return };
            image::batch_step(&ui, d);
        });
    }
    {
        let ui_w = ui.as_weak();
        ui.on_image_clip_step(move |d| {
            let Some(ui) = ui_w.upgrade() else { return };
            image::clip_step(&ui, d);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_image_lora_add(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            image::lora_add(&ui, &state_c);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_image_lora_remove(move |i| {
            let Some(ui) = ui_w.upgrade() else { return };
            image::lora_remove(&ui, &state_c, i);
        });
    }
    {
        let state_c = state.clone();
        ui.on_image_lora_name_edited(move |i, text| {
            image::lora_name_edited(&state_c, i, &text);
        });
    }
    {
        let state_c = state.clone();
        ui.on_image_lora_weight_edited(move |i, text| {
            image::lora_weight_edited(&state_c, i, &text);
        });
    }

    // ---- canvas callbacks ----
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_canvas_pointer(move |kind, x, y| {
            let Some(ui) = ui_w.upgrade() else { return };
            graph::pointer(&ui, &state_c, kind, x, y);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_canvas_zoom_at(move |x, y, delta| {
            let Some(ui) = ui_w.upgrade() else { return };
            graph::zoom(&ui, &state_c, x, y, delta);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_canvas_add_node(move |kind| {
            let Some(ui) = ui_w.upgrade() else { return };
            graph::add_node(&ui, &state_c, kind.as_str());
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_canvas_knob_edited(move |knob, value| {
            let Some(ui) = ui_w.upgrade() else { return };
            graph::knob_edited(&ui, &state_c, knob.as_str(), value.as_str());
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_canvas_aspect(move |ratio| {
            let Some(ui) = ui_w.upgrade() else { return };
            graph::aspect_selected(&ui, &state_c, ratio.as_str());
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_canvas_lora_edited(move |index, name, weight| {
            let Some(ui) = ui_w.upgrade() else { return };
            graph::lora_edited(&ui, &state_c, index, name.as_str(), weight.as_str());
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_canvas_lora_add(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            graph::lora_add(&ui, &state_c);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_canvas_lora_remove(move |index| {
            let Some(ui) = ui_w.upgrade() else { return };
            graph::lora_remove(&ui, &state_c, index);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_canvas_seed_roll(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            graph::seed_roll(&ui, &state_c);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_canvas_seed_lock_toggle(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            graph::seed_lock_toggle(&ui, &state_c);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_canvas_delete_selected(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            graph::delete_selected(&ui, &state_c);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_canvas_backend(move |label| {
            let Some(ui) = ui_w.upgrade() else { return };
            graph::select_backend(&ui, &state_c, label.as_str());
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_canvas_generate(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            graph::generate(&ui, &state_c);
        });
    }
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        ui.on_canvas_save(move || {
            let Some(ui) = ui_w.upgrade() else { return };
            graph::save(&ui, &state_c);
        });
    }

    // ---- event pump ----
    let timer = slint::Timer::default();
    {
        let ui_w = ui.as_weak();
        let state_c = state.clone();
        let lines_c = lines_model.clone();
        timer.start(
            slint::TimerMode::Repeated,
            std::time::Duration::from_millis(50),
            move || {
                let Some(ui) = ui_w.upgrade() else { return };
                drain_events(&ui, &state_c, &lines_c);
                drain_models(&ui, &state_c);
                #[cfg(feature = "agent")]
                drain_agent(&ui, &state_c, &lines_c);
                drain_research(&ui, &state_c);
                media::drain(&ui, &state_c);
                studio::drain(&ui, &state_c);
                image::drain(&ui, &state_c);
                graph::drain(&ui, &state_c);
            },
        );
    }

    ui.run().expect("slint event loop failed");
}

#[cfg(test)]
mod research_tests {
    use super::research_title;
    use prism_core::ensemble::VotingStrategy;

    #[test]
    fn research_titles_name_every_view() {
        let strategy = VotingStrategy::SingleJudge;
        assert_eq!(research_title("web", "rust", strategy), "Web: rust");
        assert_eq!(research_title("deep", "rust", strategy), "Deep search: rust");
        assert_eq!(research_title("multi", "rust", strategy), "Multi-send: rust");
        assert_eq!(
            research_title("council", "rust", VotingStrategy::PeerVote),
            "Council (peer-vote): rust"
        );
        assert_eq!(research_title("debate", "rust", strategy), "Debate: rust");
        // Unknown kinds fall back to the web view rather than panicking.
        assert_eq!(research_title("bogus", "rust", strategy), "Web: rust");
    }
}
