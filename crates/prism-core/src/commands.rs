//! Command registry: one static table describing every user-invokable
//! action, so any surface can build a command palette (Ctrl+K) or slash
//! menu from it (reduced to what a chat client needs).
//!
//! The registry describes; the surface dispatches. Commands carry an
//! id + human text only — execution stays in the surface's callback
//! wiring (`shared::run_command` maps ids onto existing callbacks).
//! Core owns the table so every surface (Slint, TUI, CLI) lists the
//! same actions.

/// Group a command renders under in a palette.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandGroup {
    Chat,
    Models,
    Settings,
    Hardware,
    Agent,
    View,
    Ide,
}

impl CommandGroup {
    /// Palette section label.
    pub fn label(self) -> &'static str {
        match self {
            CommandGroup::Chat => "Chat",
            CommandGroup::Models => "Models",
            CommandGroup::Settings => "Settings",
            CommandGroup::Hardware => "Hardware",
            CommandGroup::Agent => "Agent",
            CommandGroup::View => "View",
            CommandGroup::Ide => "IDE",
        }
    }
}

/// One user-invokable action.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CommandDef {
    /// Stable dispatch id (e.g. "chat.new"). Surfaces switch on this.
    pub id: &'static str,
    /// Palette display text.
    pub title: &'static str,
    pub group: CommandGroup,
    /// Optional dynamic payload: e.g. "model.pick" needs a model id,
    /// "chat.open" needs a conversation id. None = immediate action.
    pub takes_arg: bool,
    /// Only meaningful while streaming (palette can grey these out).
    pub while_streaming: bool,
}

/// The registry, in palette order (grouped by CommandGroup).
pub const COMMANDS: &[CommandDef] = &[
    // Chat
    CommandDef { id: "chat.new", title: "New chat", group: CommandGroup::Chat, takes_arg: false, while_streaming: false },
    CommandDef { id: "chat.history.back", title: "Previous prompt (↑)", group: CommandGroup::Chat, takes_arg: false, while_streaming: false },
    CommandDef { id: "chat.history.forward", title: "Next prompt (↓)", group: CommandGroup::Chat, takes_arg: false, while_streaming: false },
    // Models
    CommandDef { id: "models.pick", title: "Switch model…", group: CommandGroup::Models, takes_arg: true, while_streaming: false },
    CommandDef { id: "models.fetch", title: "Fetch available models from provider", group: CommandGroup::Models, takes_arg: false, while_streaming: false },
    CommandDef { id: "models.refresh_catalog", title: "Refresh model catalog (re-fetch /models)", group: CommandGroup::Models, takes_arg: false, while_streaming: false },
    // Settings
    CommandDef { id: "settings.connection.direct", title: "Connection: Direct", group: CommandGroup::Settings, takes_arg: false, while_streaming: false },
    CommandDef { id: "settings.connection.api", title: "Connection: Prism API", group: CommandGroup::Settings, takes_arg: false, while_streaming: false },
    CommandDef { id: "settings.save", title: "Save settings", group: CommandGroup::Settings, takes_arg: false, while_streaming: false },
    CommandDef { id: "settings.thinking.toggle", title: "Toggle thinking mode", group: CommandGroup::Settings, takes_arg: false, while_streaming: false },
    // Hardware
    CommandDef { id: "hardware.cycle_gpu", title: "Cycle GPU layers override", group: CommandGroup::Hardware, takes_arg: false, while_streaming: false },
    CommandDef { id: "hardware.cycle_ctx", title: "Cycle context tokens override", group: CommandGroup::Hardware, takes_arg: false, while_streaming: false },
    CommandDef { id: "hardware.compute.cpu", title: "Compute: CPU only", group: CommandGroup::Hardware, takes_arg: false, while_streaming: false },
    CommandDef { id: "hardware.compute.auto", title: "Compute: Auto", group: CommandGroup::Hardware, takes_arg: false, while_streaming: false },
    CommandDef { id: "hardware.compute.gpu", title: "Compute: GPU auto", group: CommandGroup::Hardware, takes_arg: false, while_streaming: false },
    CommandDef { id: "hardware.compute.gpu_nvidia", title: "Compute: GPU NVIDIA", group: CommandGroup::Hardware, takes_arg: false, while_streaming: false },
    CommandDef { id: "hardware.compute.gpu_amd", title: "Compute: GPU AMD", group: CommandGroup::Hardware, takes_arg: false, while_streaming: false },
    CommandDef { id: "hardware.compute.gpu_intel", title: "Compute: GPU Intel", group: CommandGroup::Hardware, takes_arg: false, while_streaming: false },
    // View
    CommandDef { id: "view.toggle_chats", title: "Toggle chats sidebar", group: CommandGroup::View, takes_arg: false, while_streaming: true },
    CommandDef { id: "view.toggle_settings", title: "Toggle settings panel", group: CommandGroup::View, takes_arg: false, while_streaming: true },
    CommandDef { id: "view.scroll_end", title: "Scroll transcript to end", group: CommandGroup::View, takes_arg: false, while_streaming: true },
    // Agent
    CommandDef { id: "agent.run", title: "Run agent on the system prompt", group: CommandGroup::Agent, takes_arg: false, while_streaming: false },
    CommandDef { id: "agent.sandbox", title: "Agent sandbox preflight (probe host, plan policy)", group: CommandGroup::Agent, takes_arg: false, while_streaming: false },
    // IDE — three session types: normal chat, agent chat,
    // and the agent working from inside an editor surface.
    CommandDef { id: "ide.mode.chat", title: "Mode: Chat", group: CommandGroup::Ide, takes_arg: false, while_streaming: false },
    CommandDef { id: "ide.mode.agent", title: "Mode: Agent (input drives the agent loop)", group: CommandGroup::Ide, takes_arg: false, while_streaming: false },
    CommandDef { id: "ide.mode.agent_sidebar", title: "Mode: IDE (editor + agent sidebar)", group: CommandGroup::Ide, takes_arg: false, while_streaming: false },
    CommandDef { id: "ide.workspace.open", title: "Open workspace folder…", group: CommandGroup::Ide, takes_arg: true, while_streaming: false },
    CommandDef { id: "ide.workspace.refresh", title: "Refresh workspace file tree", group: CommandGroup::Ide, takes_arg: false, while_streaming: true },
    CommandDef { id: "ide.workspace.save", title: "Save the open editor file", group: CommandGroup::Ide, takes_arg: false, while_streaming: true },
];

/// Look up a command by id.
pub fn find_command(id: &str) -> Option<&'static CommandDef> {
    COMMANDS.iter().find(|c| c.id == id)
}

/// Filter commands by a case-insensitive substring over id + title +
/// group label. Empty query returns all. Simple substring filter —
/// fuzzy scoring is a surface concern (finer threshold scoring is
/// overkill while the table is ~20 entries).
pub fn filter_commands(query: &str) -> Vec<&'static CommandDef> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return COMMANDS.iter().collect();
    }
    COMMANDS
        .iter()
        .filter(|c| {
            c.id.to_lowercase().contains(&q)
                || c.title.to_lowercase().contains(&q)
                || c.group.label().to_lowercase().contains(&q)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_unique() {
        let mut ids: Vec<&str> = COMMANDS.iter().map(|c| c.id).collect();
        let n = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), n, "duplicate command ids");
    }

    #[test]
    fn ids_are_namespaced() {
        for c in COMMANDS {
            assert!(
                c.id.contains('.'),
                "command id '{}' must be namespaced (group.action)",
                c.id
            );
            let prefix = c.id.split('.').next().unwrap();
            let expected = match c.group {
                CommandGroup::Chat => "chat",
                CommandGroup::Models => "models",
                CommandGroup::Settings => "settings",
                CommandGroup::Hardware => "hardware",
                CommandGroup::Agent => "agent",
                CommandGroup::View => "view",
                CommandGroup::Ide => "ide",
            };
            assert_eq!(prefix, expected, "{} group/prefix mismatch", c.id);
        }
    }

    #[test]
    fn arg_taking_commands_are_marked() {
        for c in COMMANDS {
            if c.takes_arg {
                assert!(
                    c.id.ends_with("pick") || c.title.ends_with('…'),
                    "{} takes an arg; mark it in title with …",
                    c.id
                );
            }
        }
    }

    #[test]
    fn find_and_filter_roundtrip() {
        let c = find_command("chat.new").expect("chat.new exists");
        assert_eq!(c.title, "New chat");
        assert!(find_command("nope.nope").is_none());
        let filtered = filter_commands("gpu");
        assert!(filtered.iter().all(|c| c.group == CommandGroup::Hardware));
        assert!(!filtered.is_empty());
        assert_eq!(filter_commands("").len(), COMMANDS.len());
    }

    #[test]
    fn filter_matches_case_insensitive_on_title_and_group() {
        assert!(filter_commands("new chat").iter().any(|c| c.id == "chat.new"));
        assert!(filter_commands("hardware").len() >= 8);
        assert!(filter_commands("HARDWARE").len() >= 8);
    }
}
