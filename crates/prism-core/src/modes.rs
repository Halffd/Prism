//! Interaction modes: one core abstraction the UI switches between.
//!
//! A mode is a *configured posture*, not a separate app: it decides
//! which prompt-assembly path runs, what the tool surface looks like,
//! and which panels the host should show. The five modes:
//!
//! | Mode      | Tools | Prompt assembly | Purpose |
//! |-----------|-------|-----------------|---------|
//! | chat      | none  | plain           | ChatGPT-style conversation |
//! | agent     | full  | plain + system  | autonomous work, subagents, permissions |
//! | creative  | none  | cards           | SillyTavern-style roleplay/cards |
//! | daemon    | full  | plain + system  | long-running task/trigger management |
//! | generative| none  | none            | image/video/audio/OCR generation screens |
//!
//! The core owns the *definitions* and their defaults; the host owns
//! the presentation. That keeps modes identical across Slint, TUI and
//! the API.

use serde::{Deserialize, Serialize};

/// The six interaction modes. Each is a contract on the same runtime:
/// same transports, same models, different constraints (ChatGPT /
/// opencode / Cursor / SillyTavern / Hermes / ComfyUI-style).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Mode {
    /// No tools, plain conversation (ChatGPT-style).
    Chat,
    /// Full tool surface, permissions, subagents (Claude Code /
    /// opencode-style autonomous work).
    Agent,
    /// Style-only code assistance: refactor and format text with no
    /// tool execution and no role-play/jailbreak contamination
    /// (Cursor-style).
    Code,
    /// Character cards, personas, lore (SillyTavern-style).
    Creative,
    /// Persistent tasks + triggers on the agent loop (Hermes/long-running).
    Daemon,
    /// Media generation screens (image/video/audio/OCR).
    Generative,
}

impl Default for Mode {
    fn default() -> Self {
        Mode::Chat
    }
}

impl Mode {
    /// All modes in UI order.
    pub fn all() -> &'static [Mode] {
        &[
            Mode::Chat,
            Mode::Agent,
            Mode::Code,
            Mode::Creative,
            Mode::Daemon,
            Mode::Generative,
        ]
    }

    pub fn id(self) -> &'static str {
        match self {
            Mode::Chat => "chat",
            Mode::Agent => "agent",
            Mode::Code => "code",
            Mode::Creative => "creative",
            Mode::Daemon => "daemon",
            Mode::Generative => "generative",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Mode::Chat => "Chat",
            Mode::Agent => "Agent",
            Mode::Code => "Code",
            Mode::Creative => "Creative",
            Mode::Daemon => "Daemon",
            Mode::Generative => "Generative",
        }
    }

    /// From an id string; unknown ids fall back to Chat.
    pub fn from_id(s: &str) -> Mode {
        Mode::all()
            .iter()
            .copied()
            .find(|m| m.id() == s.trim().to_lowercase())
            .unwrap_or(Mode::Chat)
    }

    /// One-line purpose shown in the mode switcher.
    pub fn blurb(self) -> &'static str {
        match self {
            Mode::Chat => "Plain conversation, no tools",
            Mode::Agent => "Autonomous work with tools and permissions",
            Mode::Code => "Code style and refactors, no tools",
            Mode::Creative => "Character cards and roleplay",
            Mode::Daemon => "Long-running tasks and triggers",
            Mode::Generative => "Images, video, audio, OCR",
        }
    }
}

/// What a mode enables. Hosts read this to decide what to render.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ModeTraits {
    /// Show/advertise the tool surface.
    pub tools: bool,
    /// Assemble the prompt through the character-card engine.
    pub card_prompt: bool,
    /// Show the media generation screens.
    pub media: bool,
    /// Show the task list + trigger editor.
    pub tasks: bool,
    /// Show the strategy switcher (react / plan-and-execute).
    pub strategy: bool,
    /// May spawn nested subagent workers (agent/daemon only — chat and
    /// code modes cannot, which keeps chat from silently acquiring
    /// superpowers through a cycle).
    pub subagents: bool,
    /// Slash commands advertised by this mode (`/fix`, `/swipe`, `/img`).
    /// Empty means none.
    pub commands: Vec<String>,
    /// Prompt/output style contract, applied as instructions on top of
    /// the mode preset.
    #[serde(default)]
    pub style: ModeStyle,
    /// How long the interaction persists.
    #[serde(default)]
    pub persistence: Persistence,
}

/// The prompt/output style a mode enforces. Applied as a short
/// instruction block on top of the mode preset so a chat prompt never
/// leaks a role-play jailbreak and code never gets narrative filler.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ModeStyle {
    Conversational,
    TerseExecution,
    MinimalDiff,
    Narrative,
    OpsReport,
    AssetDescription,
}

impl Default for ModeStyle {
    fn default() -> Self {
        ModeStyle::Conversational
    }
}

/// How long a mode's interaction persists.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Persistence {
    /// In-memory/last-session state; gone on exit.
    Session,
    /// Chat tree with branches (creative).
    ChatTree,
    /// Job queue with retries (generative).
    JobQueue,
    /// Long-running daemon: tasks survive reboot (daemon).
    AlwaysOn,
}

impl Default for Persistence {
    fn default() -> Self {
        Persistence::Session
    }
}

impl Mode {
    pub fn traits(self) -> ModeTraits {
        match self {
            Mode::Chat => ModeTraits {
                tools: false,
                card_prompt: false,
                media: false,
                tasks: false,
                strategy: false,
                subagents: false,
                commands: Vec::new(),
                style: ModeStyle::Conversational,
                persistence: Persistence::Session,
            },
            Mode::Agent => ModeTraits {
                tools: true,
                card_prompt: false,
                media: false,
                tasks: false,
                strategy: true,
                subagents: true,
                commands: ["fix", "test", "commit", "review"]
                    .iter()
                    .map(|s| s.to_string())
                    .collect(),
                style: ModeStyle::TerseExecution,
                persistence: Persistence::Session,
            },
            Mode::Code => ModeTraits {
                tools: false,
                card_prompt: false,
                media: false,
                tasks: false,
                strategy: false,
                subagents: false,
                commands: Vec::new(),
                style: ModeStyle::MinimalDiff,
                persistence: Persistence::Session,
            },
            Mode::Creative => ModeTraits {
                tools: false,
                card_prompt: true,
                media: false,
                tasks: false,
                strategy: false,
                subagents: false,
                commands: ["swipe", "continue", "impersonate", "branch"]
                    .iter()
                    .map(|s| s.to_string())
                    .collect(),
                style: ModeStyle::Narrative,
                persistence: Persistence::ChatTree,
            },
            Mode::Daemon => ModeTraits {
                tools: true,
                card_prompt: false,
                media: false,
                tasks: true,
                strategy: true,
                subagents: true,
                commands: Vec::new(),
                style: ModeStyle::OpsReport,
                persistence: Persistence::AlwaysOn,
            },
            Mode::Generative => ModeTraits {
                tools: false,
                card_prompt: false,
                media: true,
                tasks: false,
                strategy: false,
                subagents: false,
                commands: ["img", "vid", "tts", "stt", "ocr"]
                    .iter()
                    .map(|s| s.to_string())
                    .collect(),
                style: ModeStyle::AssetDescription,
                persistence: Persistence::JobQueue,
            },
        }
    }
}

/// A scheduled task for daemon mode.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DaemonTask {
    pub id: String,
    /// Human label shown in the list.
    pub name: String,
    /// The instruction handed to the agent when the trigger fires.
    pub instruction: String,
    /// When the task runs.
    pub trigger: TaskTrigger,
    #[serde(default)]
    pub enabled: bool,
    /// Epoch ms of the last run (None = never).
    #[serde(default)]
    pub last_run: Option<u64>,
    /// Result text of the last run (truncated by the host).
    #[serde(default)]
    pub last_result: Option<String>,
}

/// What fires a task.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum TaskTrigger {
    /// Every N seconds.
    Interval { seconds: u64 },
    /// Once, after N seconds from enable.
    Once { after_seconds: u64 },
    /// Not automatic: the host runs it on demand.
    Manual,
}

impl Default for TaskTrigger {
    fn default() -> Self {
        TaskTrigger::Manual
    }
}

impl DaemonTask {
    pub fn new(name: &str, instruction: &str, trigger: TaskTrigger) -> Self {
        DaemonTask {
            id: crate::conversations::new_id(),
            name: name.to_string(),
            instruction: instruction.to_string(),
            trigger,
            enabled: true,
            last_run: None,
            last_result: None,
        }
    }

    /// True when the task's trigger says it should run now, given
    /// `now_ms`. Interval fires when `last_run` is None or the interval
    /// has elapsed; Once fires when never run and the delay elapsed
    /// (approximated by "never run and enabled"); Manual never fires.
    pub fn due(&self, now_ms: u64, enabled_at: u64) -> bool {
        if !self.enabled {
            return false;
        }
        match &self.trigger {
            TaskTrigger::Manual => false,
            TaskTrigger::Interval { seconds } => {
                let every = seconds.saturating_mul(1000);
                match self.last_run {
                    None => true,
                    Some(last) => now_ms.saturating_sub(last) >= every.max(1),
                }
            }
            TaskTrigger::Once { .. } => {
                if self.last_run.is_some() {
                    return false;
                }
                // Delay already accounted for by enable time.
                now_ms >= enabled_at
            }
        }
    }

    /// Epoch ms of the next scheduled run, or None for manual.
    pub fn next_run(&self, now_ms: u64) -> Option<u64> {
        if !self.enabled {
            return None;
        }
        match &self.trigger {
            TaskTrigger::Manual => None,
            TaskTrigger::Interval { seconds } => {
                let every = seconds.saturating_mul(1000);
                Some(match self.last_run {
                    None => now_ms,
                    Some(last) => last.saturating_add(every.max(1)),
                })
            }
            TaskTrigger::Once { after_seconds } => {
                if self.last_run.is_some() {
                    return None;
                }
                Some(now_ms.saturating_add(after_seconds.saturating_mul(1000)))
            }
        }
    }
}

/// Generative mode's capability screens.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GenCapability {
    Image,
    Inpaint,
    Video,
    Model3d,
    Audio,
    Transcribe,
    Ocr,
}

impl GenCapability {
    pub fn all() -> &'static [GenCapability] {
        &[
            GenCapability::Image,
            GenCapability::Inpaint,
            GenCapability::Video,
            GenCapability::Model3d,
            GenCapability::Audio,
            GenCapability::Transcribe,
            GenCapability::Ocr,
        ]
    }

    pub fn id(self) -> &'static str {
        match self {
            GenCapability::Image => "image",
            GenCapability::Inpaint => "inpaint",
            GenCapability::Video => "video",
            GenCapability::Model3d => "model-3d",
            GenCapability::Audio => "audio",
            GenCapability::Transcribe => "transcribe",
            GenCapability::Ocr => "ocr",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            GenCapability::Image => "Image",
            GenCapability::Inpaint => "Inpainting",
            GenCapability::Video => "Video",
            GenCapability::Model3d => "3D model",
            GenCapability::Audio => "Audio",
            GenCapability::Transcribe => "Transcribe",
            GenCapability::Ocr => "OCR",
        }
    }

    /// Which core media kind this maps to, if it is a media kind
    /// (audio/transcribe/ocr are not media-request kinds).
    pub fn media_kind(self) -> Option<crate::media::MediaKind> {
        use crate::media::MediaKind;
        match self {
            GenCapability::Image => Some(MediaKind::Image),
            GenCapability::Inpaint => Some(MediaKind::Inpaint),
            GenCapability::Video => Some(MediaKind::Video),
            GenCapability::Model3d => Some(MediaKind::Model),
            GenCapability::Audio | GenCapability::Transcribe | GenCapability::Ocr => None,
        }
    }

    /// True when the capability consumes an input file (audio/transcribe/ocr).
    pub fn needs_input_file(self) -> bool {
        matches!(
            self,
            GenCapability::Transcribe | GenCapability::Ocr | GenCapability::Audio
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modes_roundtrip_by_id() {
        for m in Mode::all() {
            assert_eq!(Mode::from_id(m.id()), *m);
        }
        assert_eq!(Mode::from_id("nonsense"), Mode::Chat);
        assert_eq!(Mode::default(), Mode::Chat);
    }

    #[test]
    fn traits_match_intent() {
        assert!(!Mode::Chat.traits().tools);
        assert!(!Mode::Chat.traits().card_prompt);
        assert!(Mode::Agent.traits().tools);
        assert!(Mode::Agent.traits().strategy);
        assert!(!Mode::Agent.traits().card_prompt);
        assert!(Mode::Creative.traits().card_prompt);
        assert!(!Mode::Creative.traits().tools);
        assert!(Mode::Daemon.traits().tools && Mode::Daemon.traits().tasks);
        assert!(Mode::Generative.traits().media);
        assert!(!Mode::Generative.traits().tools);
    }

    #[test]
    fn code_mode_is_style_only() {
        let t = Mode::Code.traits();
        // No tools, no subagents, no commands: pure style/refactor.
        assert!(!t.tools);
        assert!(!t.subagents);
        assert!(t.commands.is_empty());
        assert_eq!(t.style, ModeStyle::MinimalDiff);
        assert_eq!(t.persistence, Persistence::Session);
    }

    #[test]
    fn only_agent_and_daemon_spawn_subagents() {
        let spawners: Vec<Mode> = Mode::all()
            .iter()
            .copied()
            .filter(|m| m.traits().subagents)
            .collect();
        assert_eq!(spawners, vec![Mode::Agent, Mode::Daemon]);
        assert!(!Mode::Chat.traits().subagents);
        assert!(!Mode::Code.traits().subagents);
        assert!(!Mode::Creative.traits().subagents);
        assert!(!Mode::Generative.traits().subagents);
    }

    #[test]
    fn style_and_persistence_are_distinct_per_mode() {
        use ModeStyle::*;
        use Persistence::*;
        let expected = [
            (Mode::Chat, Conversational, Session),
            (Mode::Agent, TerseExecution, Session),
            (Mode::Code, MinimalDiff, Session),
            (Mode::Creative, Narrative, ChatTree),
            (Mode::Daemon, OpsReport, AlwaysOn),
            (Mode::Generative, AssetDescription, JobQueue),
        ];
        for (mode, style, persistence) in expected {
            let t = mode.traits();
            assert_eq!(t.style, style, "{:?} style", mode);
            assert_eq!(t.persistence, persistence, "{:?} persistence", mode);
        }
    }

    #[test]
    fn commands_are_mode_scoped() {
        assert!(Mode::Chat.traits().commands.is_empty());
        assert!(Mode::Code.traits().commands.is_empty());
        assert_eq!(Mode::Agent.traits().commands.len(), 4);
        assert_eq!(Mode::Creative.traits().commands.len(), 4);
        assert_eq!(Mode::Generative.traits().commands.len(), 5);
    }

    #[test]
    fn interval_due_logic() {
        let mut t = DaemonTask::new("t", "do it", TaskTrigger::Interval { seconds: 60 });
        // Never run → due immediately.
        assert!(t.due(1_000, 1_000));
        // Just ran → not due.
        t.last_run = Some(1_000);
        assert!(!t.due(5_000, 1_000));
        // 60s later → due.
        assert!(t.due(61_000, 1_000));
        // Disabled → never due.
        t.enabled = false;
        assert!(!t.due(10_000_000, 1_000));
    }

    #[test]
    fn once_fires_only_before_first_run() {
        let t = DaemonTask::new("t", "x", TaskTrigger::Once { after_seconds: 10 });
        assert!(t.due(1000, 0));
        let mut t2 = t.clone();
        t2.last_run = Some(1000);
        assert!(!t2.due(999_999, 0));
    }

    #[test]
    fn manual_never_due_and_has_no_next() {
        let t = DaemonTask::new("t", "x", TaskTrigger::Manual);
        assert!(!t.due(10_000, 0));
        assert_eq!(t.next_run(10_000), None);
    }

    #[test]
    fn next_run_for_interval() {
        let mut t = DaemonTask::new("t", "x", TaskTrigger::Interval { seconds: 30 });
        assert_eq!(t.next_run(5_000), Some(5_000)); // never ran → now
        t.last_run = Some(5_000);
        assert_eq!(t.next_run(6_000), Some(35_000));
    }

    #[test]
    fn gen_capability_mapping() {
        assert!(GenCapability::Image.media_kind().is_some());
        assert!(GenCapability::Model3d.media_kind().is_some());
        assert!(GenCapability::Transcribe.media_kind().is_none());
        assert!(GenCapability::Transcribe.needs_input_file());
        assert!(!GenCapability::Image.needs_input_file());
        assert_eq!(GenCapability::all().len(), 7);
    }
}
