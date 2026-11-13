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
use crate::modes::{Feature, Mode, ModeTraits};
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
        Mode::Code => {
            "You are a code assistant. Write minimal, idiomatic, correct code. No tools are available and none are needed — return the edited code, not a narrative."
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

    /// Set a per-tool permission override. The tool must be advertised:
    /// granting a permission for a tool this session cannot see would
    /// make the policy and the tool list disagree.
    pub fn set_permission(&mut self, tool: &str, level: PermissionLevel) -> bool {
        if !self.tools.iter().any(|t| t == tool) {
            return false;
        }
        self.permissions.insert(tool.to_string(), level);
        true
    }

    /// Drop a per-tool override so the tool follows the default again.
    pub fn clear_permission(&mut self, tool: &str) -> bool {
        self.permissions.remove(tool).is_some()
    }

    /// Set the fallback permission used for tools with no explicit entry.
    pub fn set_default_permission(&mut self, level: PermissionLevel) {
        self.default_permission = level;
    }

    /// One row per advertised tool: its name and effective permission.
    /// This is what a permissions editor renders.
    pub fn permission_rows(&self) -> Vec<(String, PermissionLevel)> {
        self.tools
            .iter()
            .map(|t| (t.clone(), self.permission_for(t)))
            .collect()
    }

    /// The tools whose permission differs from the default.
    pub fn overridden_tools(&self) -> Vec<String> {
        let mut names: Vec<String> = self
            .permissions
            .iter()
            .filter(|(_tool, level)| **level != self.default_permission)
            .map(|(tool, _)| tool.clone())
            .collect();
        names.sort();
        names
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
    /// Additional modes blended into this session. The primary `mode`
    /// stays first and owns the prompt voice; the rest contribute
    /// capabilities. Empty means a single-mode session.
    #[serde(default)]
    pub mixed: Vec<Mode>,
    /// Explicit per-feature overrides on top of the blended traits.
    /// `Some(true)` forces a feature on, `Some(false)` forces it off,
    /// `None` follows the blended modes.
    #[serde(default)]
    pub feature_overrides: HashMap<Feature, bool>,
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
            mixed: Vec::new(),
            feature_overrides: HashMap::new(),
            prompt: PromptLayer::new(mode),
            capability: CapabilityLayer::for_mode(mode, available_tools),
            transport: TransportLayer::default(),
            persistence: PersistenceLayer::for_mode(mode),
        }
    }

    /// Every mode in this session: the primary first, then the blend.
    pub fn active_modes(&self) -> Vec<Mode> {
        let mut modes = vec![self.mode];
        for m in &self.mixed {
            if *m != self.mode && !modes.contains(m) {
                modes.push(*m);
            }
        }
        modes
    }

    /// The traits this session actually has: the union of every active
    /// mode's traits, with explicit feature overrides applied on top.
    /// This is the single source of truth for what the session can do.
    pub fn active_traits(&self) -> ModeTraits {
        let mut traits = self.mode.traits();
        for m in &self.mixed {
            traits = traits.merged_with(&m.traits());
        }
        for (feature, enabled) in &self.feature_overrides {
            traits = traits.with_feature(*feature, *enabled);
        }
        traits
    }

    /// Is a feature on for this session, after overrides?
    pub fn feature(&self, feature: Feature) -> bool {
        self.active_traits().has(feature)
    }

    /// Force a feature on or off, overriding the blended modes.
    pub fn set_feature(&mut self, feature: Feature, enabled: bool) {
        self.feature_overrides.insert(feature, enabled);
    }

    /// Drop an override so the feature follows the blended modes again.
    pub fn reset_feature(&mut self, feature: Feature) {
        self.feature_overrides.remove(&feature);
    }

    /// Blend another mode into this session. The blended mode's
    /// capabilities are unioned in; its prompt voice is not (the primary
    /// mode owns the voice). Blending the primary mode again is a no-op.
    pub fn add_mode(&mut self, mode: Mode) {
        if mode != self.mode && !self.mixed.contains(&mode) {
            self.mixed.push(mode);
        }
    }

    /// Remove a blended mode. The primary mode cannot be removed.
    pub fn remove_mode(&mut self, mode: Mode) -> bool {
        let before = self.mixed.len();
        self.mixed.retain(|m| *m != mode);
        self.mixed.len() != before
    }

    /// Switch modes, resetting the capability and persistence layers to
    /// the new mode's defaults. The transport is kept — switching from
    /// chat to agent should not drop the provider you picked.
    pub fn set_mode(&mut self, mode: Mode, available_tools: &[String]) {
        self.prompt.system_prompt = default_system_prompt(mode).to_string();
        self.mode = mode;
        self.mixed.clear();
        self.feature_overrides.clear();
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
    use crate::modes::{ModeStyle, Persistence};

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

    // -- mode mixing ------------------------------------------------------

    #[test]
    fn mixing_modes_unions_capabilities() {
        let mut s = Session::new(Mode::Chat, &tools());
        // Chat alone: no tools.
        assert!(!s.feature(Feature::Tools));
        // Blend Creative in: character cards appear, tools still not.
        s.add_mode(Mode::Creative);
        assert_eq!(s.active_modes(), vec![Mode::Chat, Mode::Creative]);
        assert!(s.feature(Feature::CharacterCards));
        assert!(!s.feature(Feature::Tools));
        // Blend Agent in: tools and subagents appear.
        s.add_mode(Mode::Agent);
        assert!(s.feature(Feature::Tools));
        assert!(s.feature(Feature::Subagents));
        assert!(s.feature(Feature::CharacterCards));
    }

    #[test]
    fn mixing_keeps_primary_voice_and_longest_persistence() {
        let mut s = Session::new(Mode::Code, &tools());
        s.add_mode(Mode::Creative);
        let t = s.active_traits();
        // Style comes from the primary mode, not the blend.
        assert_eq!(t.style, ModeStyle::MinimalDiff);
        // Persistence takes the longer-lived scope.
        assert_eq!(t.persistence, Persistence::ChatTree);
        // The prompt still belongs to the primary mode.
        assert!(s.prompt.system_prompt.contains("code assistant"));
    }

    #[test]
    fn mixing_is_idempotent_and_primary_cannot_be_removed() {
        let mut s = Session::new(Mode::Chat, &tools());
        s.add_mode(Mode::Agent);
        s.add_mode(Mode::Agent);
        assert_eq!(s.mixed, vec![Mode::Agent]);
        // Removing the primary mode is refused.
        assert!(!s.remove_mode(Mode::Chat));
        assert_eq!(s.mode, Mode::Chat);
        // Removing a blend works.
        assert!(s.remove_mode(Mode::Agent));
        assert!(s.mixed.is_empty());
        assert!(!s.feature(Feature::Tools));
    }

    #[test]
    fn switching_mode_clears_the_blend_and_overrides() {
        let mut s = Session::new(Mode::Chat, &tools());
        s.add_mode(Mode::Agent);
        s.set_feature(Feature::Media, true);
        s.set_mode(Mode::Creative, &tools());
        assert!(s.mixed.is_empty());
        assert!(s.feature_overrides.is_empty());
        assert!(!s.feature(Feature::Tools));
    }

    // -- capability editing ----------------------------------------------

    #[test]
    fn feature_overrides_beat_the_modes() {
        let mut s = Session::new(Mode::Agent, &tools());
        assert!(s.feature(Feature::Tools));
        // Force tools off even though Agent grants them.
        s.set_feature(Feature::Tools, false);
        assert!(!s.feature(Feature::Tools));
        // Force subagents on for a mode that does not grant them.
        s.set_feature(Feature::Subagents, true);
        assert!(s.feature(Feature::Subagents));
        // Reset returns to the mode's own value.
        s.reset_feature(Feature::Tools);
        assert!(s.feature(Feature::Tools));
    }

    #[test]
    fn turning_commands_off_clears_the_command_list() {
        let mut s = Session::new(Mode::Agent, &tools());
        assert!(!s.active_traits().commands.is_empty());
        s.set_feature(Feature::Commands, false);
        let t = s.active_traits();
        assert!(!t.has(Feature::Commands));
        assert!(t.commands.is_empty(), "{:?}", t.commands);
    }

    #[test]
    fn feature_ids_roundtrip_and_reject_junk() {
        for f in Feature::all() {
            assert_eq!(Feature::from_id(f.id()), Some(*f));
        }
        assert_eq!(Feature::from_id("tools"), Some(Feature::Tools));
        assert_eq!(Feature::from_id("nonsense"), None);
    }

    // -- permission editing ----------------------------------------------

    #[test]
    fn permission_edits_apply_and_clear() {
        let mut s = Session::new(Mode::Agent, &tools());
        // Advertised tool: the override sticks.
        assert!(s.capability.set_permission("calculator", PermissionLevel::Ask));
        assert_eq!(s.permission_for("calculator"), PermissionLevel::Ask);
        assert_eq!(s.capability.overridden_tools(), vec!["calculator"]);
        // Clearing returns it to the default.
        assert!(s.capability.clear_permission("calculator"));
        assert_ne!(s.permission_for("calculator"), PermissionLevel::Ask);
        assert!(s.capability.overridden_tools().is_empty());
    }

    #[test]
    fn permission_edit_rejects_unadvertised_tools() {
        let mut s = Session::new(Mode::Chat, &tools());
        // Chat advertises no tools, so there is nothing to grant.
        assert!(!s.capability.set_permission("calculator", PermissionLevel::Allow));
        assert_eq!(s.permission_for("calculator"), PermissionLevel::Deny);
    }

    #[test]
    fn default_permission_applies_to_every_advertised_tool() {
        let mut s = Session::new(Mode::Agent, &tools());
        s.capability.set_default_permission(PermissionLevel::Ask);
        assert_eq!(s.permission_for("calculator"), PermissionLevel::Ask);
        assert_eq!(s.permission_for("web_search"), PermissionLevel::Ask);
        // An explicit override still wins over the default.
        s.capability.set_permission("calculator", PermissionLevel::Allow);
        assert_eq!(s.permission_for("calculator"), PermissionLevel::Allow);
        assert_eq!(s.permission_for("web_search"), PermissionLevel::Ask);
    }

    #[test]
    fn permission_rows_cover_every_advertised_tool() {
        let mut s = Session::new(Mode::Agent, &tools());
        s.capability.set_permission("web_search", PermissionLevel::Deny);
        let rows = s.capability.permission_rows();
        assert_eq!(rows.len(), 2);
        let by_name: std::collections::HashMap<_, _> =
            rows.into_iter().map(|(n, p)| (n, p)).collect();
        assert_eq!(by_name.get("web_search"), Some(&PermissionLevel::Deny));
        assert_ne!(by_name.get("calculator"), Some(&PermissionLevel::Deny));
    }

    #[test]
    fn permission_levels_cycle_and_parse() {
        assert_eq!(PermissionLevel::Allow.cycled(), PermissionLevel::Ask);
        assert_eq!(PermissionLevel::Ask.cycled(), PermissionLevel::Deny);
        assert_eq!(PermissionLevel::Deny.cycled(), PermissionLevel::Allow);
        assert_eq!(PermissionLevel::from_label("ask"), Some(PermissionLevel::Ask));
        assert_eq!(PermissionLevel::from_label("nonsense"), None);
    }

    #[test]
    fn session_with_modes_and_overrides_roundtrips_through_serde() {
        let mut s = Session::new(Mode::Chat, &tools());
        s.add_mode(Mode::Agent);
        s.set_feature(Feature::Media, true);
        let json = serde_json::to_string(&s).unwrap();
        let back: Session = serde_json::from_str(&json).unwrap();
        assert_eq!(back.mixed, vec![Mode::Agent]);
        assert!(back.feature(Feature::Tools));
        assert!(back.feature(Feature::Media));
    }

    #[test]
    fn legacy_session_without_mix_fields_still_loads() {
        // A session file written before mixing existed must still parse.
        let legacy = r#"{
            "mode":"chat",
            "prompt":{"system_prompt":"x","user_input":"","card":null,"persona":null},
            "capability":{"tools":[],"subagents":[],"commands":[],"permissions":{},"default_permission":"allow"},
            "transport":{"provider":"","rotation":"prefer-primary","endpoints":[],"cooldowns":{}},
            "persistence":{"messages":true,"chat_tree":false,"job_queue":false}
        }"#;
        let s: Session = serde_json::from_str(legacy).unwrap();
        assert!(s.mixed.is_empty());
        assert!(s.feature_overrides.is_empty());
        assert_eq!(s.mode, Mode::Chat);
    }
}
