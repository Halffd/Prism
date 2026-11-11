//! Session: one struct composing the five layers every surface drives.
//!
//! ```text
//! Session { mode, prompt, capability, transport, persistence }
//!   prompt       — system preset + user input + card/lorebook binding
//!   capability   — tools, subagents, commands, permissions
//!   transport    — provider selection + proxy rotation/cooldown
//!   persistence  — session / chat tree / job queue scoping
//! ```
//!
//! The layers are data, not behavior: each one is a plain struct with
//! mode-scoped defaults, and the assembly functions (`prompt_messages`,
//! `effective_permission`) are the only places the layers interact.
//! That keeps the whole thing testable without I/O and lets Slint, TUI
//! and the API construct sessions identically.

use crate::cards::{self, CharacterCard, Persona};
use crate::client::ChatMessage;
use crate::modes::{Mode, ModeTraits};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ---- prompt layer ---------------------------------------------------------

/// The system prompt a mode starts from. Modes differ in what they ask
/// the model to be, so the preset is a lookup, not a constant.
pub fn default_system_prompt(mode: Mode) -> &'static str {
    match mode {
        Mode::Chat => "You are a helpful assistant.",
        Mode::Agent => {
            "You are an autonomous agent. Use the available tools to complete the task, then give the final answer."
        }
        Mode::Creative => "Stay in character and narrate the scene.",
        Mode::Daemon => {
            "You are a background daemon. Complete the scheduled task with the tools available and report the result."
        }
        Mode::Generative => "You are a media generation assistant.",
    }
}

/// One entry bound to a session: the system prompt plus the user's text.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PromptLayer {
    /// Mode preset, or a user-supplied override.
    #[serde(default = "default_system_prompt_string")]
    pub system_prompt: String,
    /// The user's current instruction.
    #[serde(default)]
    pub user_input: String,
    /// Bound character card (creative mode).
    #[serde(default)]
    pub card: Option<CharacterCard>,
    /// Bound persona for {{persona}} macros.
    #[serde(default)]
    pub persona: Option<Persona>,
}

fn default_system_prompt_string() -> String {
    default_system_prompt(Mode::default()).to_string()
}

impl PromptLayer {
    pub fn new(mode: Mode) -> Self {
        PromptLayer {
            system_prompt: default_system_prompt(mode).to_string(),
            user_input: String::new(),
            card: None,
            persona: None,
        }
    }

    /// Replace the preset with user text (empty resets to the preset).
    pub fn override_prompt(&mut self, mode: Mode, text: &str) {
        let t = text.trim();
        self.system_prompt = if t.is_empty() {
            default_system_prompt(mode).to_string()
        } else {
            t.to_string()
        };
    }

    /// Assemble the outgoing messages for this prompt layer. With a card
    /// bound, the core card engine expands macros and injects lore;
    /// otherwise it is the plain prompt + input.
    pub fn build_messages(&self, history: &[ChatMessage]) -> Vec<ChatMessage> {
        match (&self.card, &self.persona) {
            (Some(card), Some(persona)) => {
                let lore = crate::cards::LoreScan::default();
                cards::build_messages(
                    card,
                    persona,
                    history,
                    &lore,
                    &self.user_input,
                    Some(&self.system_prompt),
                )
            }
            _ => {
                let mut out = Vec::new();
                if !self.system_prompt.trim().is_empty() {
                    out.push(ChatMessage {
                        role: "system".into(),
                        content: self.system_prompt.clone(),
                        images: Vec::new(),
                    });
                }
                out.extend(history.iter().cloned());
                if !self.user_input.trim().is_empty() {
                    out.push(ChatMessage {
                        role: "user".into(),
                        content: self.user_input.clone(),
                        images: Vec::new(),
                    });
                }
                out
            }
        }
    }
}

// ---- capability layer ----------------------------------------------------

/// Which tools/subagents/commands a session may use, plus the
/// permission policy that gates them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CapabilityLayer {
    /// Tool names allowed in this session (mode-scoped).
    #[serde(default)]
    pub tools: Vec<String>,
    /// Subagent names selectable here.
    #[serde(default)]
    pub subagents: Vec<String>,
    /// Command ids of interest to the surface.
    #[serde(default)]
    pub commands: Vec<String>,
    /// Per-tool permission overrides.
    #[serde(default)]
    pub permissions: HashMap<String, PermissionLevel>,
    /// Default when a tool has no explicit entry.
    #[serde(default = "default_permission")]
    pub default_permission: PermissionLevel,
}

fn default_permission() -> PermissionLevel {
    PermissionLevel::Allow
}

/// Re-export so callers don't need to import from `agent`.
pub use crate::agent::Permission as PermissionLevel;

impl CapabilityLayer {
    /// The tool surface a mode gets by default: chat and generative get
    /// none; agent and daemon get everything the host registered.
    pub fn for_mode(mode: Mode, available_tools: &[String]) -> Self {
        let t = mode.traits();
        CapabilityLayer {
            tools: if t.tools {
                available_tools.to_vec()
            } else {
                Vec::new()
            },
            subagents: Vec::new(),
            commands: if t.tools {
                crate::commands::COMMANDS
                    .iter()
                    .map(|c| c.id.to_string())
                    .collect()
            } else {
                Vec::new()
            },
            permissions: HashMap::new(),
            default_permission: PermissionLevel::Allow,
        }
    }

    /// Effective permission for a tool.
    pub fn permission_for(&self, tool: &str) -> PermissionLevel {
        if !self.tools.iter().any(|t| t == tool) {
            // Not advertised to this session: deny rather than allow-by-absence,
            // so a surface's tool list and the policy never disagree.
            return PermissionLevel::Deny;
        }
        *self
            .permissions
            .get(tool)
            .unwrap_or(&self.default_permission)
    }

    pub fn allows(&self, tool: &str) -> bool {
        self.permission_for(tool) != PermissionLevel::Deny
    }
}

// ---- transport layer -----------------------------------------------------

/// Which inference endpoint this session talks to, and how proxy
/// rotation should behave when several are configured.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TransportLayer {
    /// Provider id (remote or local).
    pub provider: String,
    /// Model id (empty = provider default).
    #[serde(default)]
    pub model: String,
    /// Auth key resolved for the provider.
    #[serde(default)]
    pub api_key: String,
    /// Base URL override for custom/local endpoints.
    #[serde(default)]
    pub base_url: String,
    /// Rotation policy for multi-endpoint setups.
    #[serde(default)]
    pub rotation: Rotation,
    /// Cooldown after a failure, in seconds (0 = no cooldown).
    #[serde(default)]
    pub cooldown_seconds: u32,
}

impl Default for TransportLayer {
    fn default() -> Self {
        TransportLayer {
            provider: "openai".into(),
            model: String::new(),
            api_key: String::new(),
            base_url: String::new(),
            rotation: Rotation::PreferPrimary,
            cooldown_seconds: 0,
        }
    }
}

/// How endpoints are ordered when more than one is configured.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Rotation {
    /// Try the primary first, fall back to the rest.
    PreferPrimary,
    /// Round-robin across endpoints.
    RoundRobin,
    /// Random per request.
    Random,
}

impl Default for Rotation {
    fn default() -> Self {
        Rotation::PreferPrimary
    }
}

/// A candidate endpoint for a session.
#[derive(Debug, Clone, PartialEq)]
pub struct Endpoint {
    pub url: String,
    /// Weight for Random selection.
    pub weight: u32,
    /// Epoch ms until which this endpoint is cooling down.
    pub cooldown_until: u64,
}

impl Endpoint {
    pub fn new(url: &str) -> Self {
        Endpoint {
            url: url.to_string(),
            weight: 1,
            cooldown_until: 0,
        }
    }

    pub fn available_at(&self, now_ms: u64) -> bool {
        self.cooldown_until <= now_ms
    }
}

/// Pick the next endpoint by the policy; `tick` is a deterministic input
/// for round-robin/round-robin fallback so the choice is testable.
pub fn select_endpoint(
    endpoints: &[Endpoint],
    rotation: Rotation,
    now_ms: u64,
    tick: u64,
) -> Option<&Endpoint> {
    let live: Vec<&Endpoint> = endpoints.iter().filter(|e| e.available_at(now_ms)).collect();
    if live.is_empty() {
        return None;
    }
    match rotation {
        Rotation::PreferPrimary => live.first().copied(),
        Rotation::RoundRobin => Some(live[(tick as usize) % live.len()]),
        Rotation::Random => {
            // xorshift over the tick: deterministic in tests, varied in use.
            let mut h = tick;
            h ^= h << 13;
            h ^= h >> 7;
            h ^= h << 17;
            Some(live[(h as usize) % live.len()])
        }
    }
}

/// Apply a cooldown to an endpoint in place.
pub fn cooldown(endpoints: &mut [Endpoint], url: &str, now_ms: u64, seconds: u32) {
    if let Some(e) = endpoints.iter_mut().find(|e| e.url == url) {
        e.cooldown_until = now_ms.saturating_add(u64::from(seconds).saturating_mul(1000));
    }
}

// ---- persistence layer ---------------------------------------------------

/// What a session persists, scoped by mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PersistenceLayer {
    /// Keep messages after the session ends (chat + creative).
    pub messages: bool,
    /// Keep a branchable chat tree (creative).
    pub chat_tree: bool,
    /// Queue jobs (daemon, generative).
    pub job_queue: bool,
}

impl PersistenceLayer {
    pub fn for_mode(mode: Mode) -> Self {
        let t = mode.traits();
        PersistenceLayer {
            // Chat and Creative talk to people; the rest run program work.
            messages: matches!(mode, Mode::Chat | Mode::Creative),
            chat_tree: t.card_prompt,
            // Anything with tools can queue work; media always does.
            job_queue: t.tools || t.media,
        }
    }
}

// ---- session --------------------------------------------------------------

/// One complete session across all five layers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Session {
    pub mode: Mode,
    pub prompt: PromptLayer,
    pub capability: CapabilityLayer,
    pub transport: TransportLayer,
    pub persistence: PersistenceLayer,
}

impl Session {
    /// A session with every layer at its mode default.
    pub fn new(mode: Mode, available_tools: &[String]) -> Self {
        Session {
            mode,
            prompt: PromptLayer::new(mode),
            capability: CapabilityLayer::for_mode(mode, available_tools),
            transport: TransportLayer::default(),
            persistence: PersistenceLayer::for_mode(mode),
        }
    }

    /// Switch modes, resetting the capability and persistence layers to
    /// the new mode's defaults. The transport is kept — switching from
    /// chat to agent should not drop the provider you picked.
    pub fn set_mode(&mut self, mode: Mode, available_tools: &[String]) {
        self.prompt.system_prompt = default_system_prompt(mode).to_string();
        self.mode = mode;
        self.capability = CapabilityLayer::for_mode(mode, available_tools);
        self.persistence = PersistenceLayer::for_mode(mode);
    }

    /// Assemble the outgoing messages for the current prompt.
    pub fn prompt_messages(&self, history: &[ChatMessage]) -> Vec<ChatMessage> {
        self.prompt.build_messages(history)
    }

    /// Effective permission for a tool, considering the mode's tool
    /// surface. Returns Deny for anything the session does not advertise.
    pub fn permission_for(&self, tool: &str) -> PermissionLevel {
        self.capability.permission_for(tool)
    }
}

impl ModeTraits {
    /// Informational: the traits this mode enables.
    pub fn describe(self) -> &'static str {
        match self.tools {
            true if self.card_prompt => "tools + cards",
            true if self.tasks => "tools + tasks",
            _ => "plain",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tools() -> Vec<String> {
        vec!["calculator".into(), "web_search".into()]
    }

    #[test]
    fn mode_defaults_differ_per_mode() {
        let chat = Session::new(Mode::Chat, &tools());
        let agent = Session::new(Mode::Agent, &tools());
        assert!(chat.capability.tools.is_empty());
        assert_eq!(agent.capability.tools, tools());
        assert!(!chat.persistence.job_queue);
        assert!(agent.persistence.job_queue);
        assert!(chat.persistence.messages);
        assert!(!agent.persistence.messages);
        assert!(chat.prompt.system_prompt.contains("helpful assistant"));
    }

    #[test]
    fn creative_binds_card_and_expands_macros() {
        let mut s = Session::new(Mode::Creative, &tools());
        s.prompt.card = Some(CharacterCard {
            name: "Aria".into(),
            description: "An engineer".into(),
            mes_example: "{{user}}: hi".into(),
            system_prompt: "Card system".into(),
            ..Default::default()
        });
        s.prompt.persona = Some(Persona {
            name: "Sam".into(),
            description: String::new(),
        });
        let msgs = s.prompt_messages(&[]);
        let joined = msgs.iter().map(|m| m.content.as_str()).collect::<Vec<_>>().join("\n");
        assert!(joined.contains("An engineer"), "{joined}");
        assert!(joined.contains("Sam: hi"), "{joined}");
        assert!(!joined.contains("{{user}}"), "macros expanded: {joined}");
    }

    #[test]
    fn override_and_reset_system_prompt() {
        let mut s = Session::new(Mode::Chat, &tools());
        s.prompt.override_prompt(Mode::Chat, "Be terse.");
        assert_eq!(s.prompt.system_prompt, "Be terse.");
        s.prompt.override_prompt(Mode::Chat, "   ");
        assert_eq!(s.prompt.system_prompt, default_system_prompt(Mode::Chat));
    }

    #[test]
    fn permission_denies_unadvertised_tools() {
        let mut s = Session::new(Mode::Agent, &tools());
        // Advertised and not overridden -> allowed.
        assert!(s.permission_for("calculator") != PermissionLevel::Deny);
        // Not advertised -> denied even though a default exists.
        assert_eq!(s.permission_for("terminal"), PermissionLevel::Deny);
        // Explicit override wins.
        s.capability
            .permissions
            .insert("calculator".into(), PermissionLevel::Deny);
        assert_eq!(s.permission_for("calculator"), PermissionLevel::Deny);
    }

    #[test]
    fn switching_mode_keeps_transport_and_resets_capabilities() {
        let mut s = Session::new(Mode::Chat, &tools());
        s.transport.provider = "ollama".into();
        s.set_mode(Mode::Agent, &tools());
        assert_eq!(s.transport.provider, "ollama");
        assert_eq!(s.capability.tools, tools());
        assert!(s.prompt.system_prompt.contains("autonomous agent"));
    }

    #[test]
    fn persistence_scoping_per_mode() {
        assert!(PersistenceLayer::for_mode(Mode::Creative).chat_tree);
        assert!(PersistenceLayer::for_mode(Mode::Daemon).job_queue);
        assert!(PersistenceLayer::for_mode(Mode::Generative).job_queue);
        assert!(!PersistenceLayer::for_mode(Mode::Generative).messages);
    }

    #[test]
    fn endpoint_selection_respects_policy_and_cooldown() {
        let eps = vec![
            Endpoint::new("a"),
            Endpoint::new("b"),
            Endpoint::new("c"),
        ];
        // PreferPrimary always picks the first live endpoint.
        for t in 0..5 {
            assert_eq!(select_endpoint(&eps, Rotation::PreferPrimary, t, t).unwrap().url, "a");
        }
        // RoundRobin cycles.
        assert_eq!(select_endpoint(&eps, Rotation::RoundRobin, 0, 0).unwrap().url, "a");
        assert_eq!(select_endpoint(&eps, Rotation::RoundRobin, 0, 1).unwrap().url, "b");
        assert_eq!(select_endpoint(&eps, Rotation::RoundRobin, 0, 2).unwrap().url, "c");
        assert_eq!(select_endpoint(&eps, Rotation::RoundRobin, 0, 3).unwrap().url, "a");

        // Cooldown removes an endpoint from the pool.
        let mut eps = eps;
        cooldown(&mut eps, "a", 0, 30);
        assert_eq!(select_endpoint(&eps, Rotation::PreferPrimary, 10, 0).unwrap().url, "b");
        assert_eq!(select_endpoint(&eps, Rotation::PreferPrimary, 30_001, 0).unwrap().url, "a");
    }

    #[test]
    fn no_live_endpoint_yields_none() {
        let mut eps = vec![Endpoint::new("a")];
        cooldown(&mut eps, "a", 0, 10);
        assert!(select_endpoint(&eps, Rotation::RoundRobin, 100, 0).is_none());
    }
}
