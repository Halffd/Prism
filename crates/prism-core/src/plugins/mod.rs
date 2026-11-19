//! Plugin system of the core.
//!
//! One crate-level concept: a plugin is a pure-logic extension that hooks
//! the shared request/result pipeline. Everything here is transport-free
//! and UI-free — plugins run natively (desktop, CLI) and compile to WASM
//! with the rest of the core. Filesystem access goes through the
//! [`Storage`] trait, so browser hosts can inject IndexedDB-backed
//! storage exactly like settings and conversations do.
//!
//! Hooks, in pipeline order:
//!
//! 1. [`Plugin::commands`] — named slash commands a surface dispatches by
//!    id (`/memory save ...`), returning user-facing lines.
//! 2. [`Plugin::before_send`] — rewrite outgoing user text (snippet
//!    expansion, tone suffixes, command routing).
//! 3. [`Plugin::format_output`] — rewrite completed assistant text
//!    (markdown table alignment).
//! 4. [`Plugin::status`] — one-line status contribution for surfaces with
//!    a status bar.
//!
//! The [`Registry`] owns plugin instances; surfaces embed one field and
//! forward the hooks. Adding a plugin is one `Registry::with_defaults`
//! entry — no surface changes.

pub mod builtins;
pub mod markdown;

use crate::storage::Storage;
use std::sync::Arc;

/// What a plugin can touch. Grows by adding fields; a `Plugin::new`
/// receives it at construction time so the trait methods stay `&self`.
pub struct PluginContext<'a> {
    /// Storage boundary (filesystem native, IndexedDB on WASM).
    pub storage: &'a dyn Storage,
    /// Config root directory (platform config dir, `$PRISM_CONFIG_DIR`
    /// override). Plugins keep their own state under `<root>/plugins/`.
    pub config_dir: Option<&'a std::path::Path>,
}

impl<'a> PluginContext<'a> {
    /// State directory for this plugin: `<config>/plugins/<name>/`.
    /// `None` when no config dir is available (plugins that need storage
    /// degrade to no-ops and say so in their status line).
    pub fn state_dir(&self, plugin: &str) -> Option<std::path::PathBuf> {
        self.config_dir
            .map(|root| root.join("plugins").join(plugin))
    }
}

/// A Prism plugin. All hooks are synchronous and pure-logic: no threads,
/// no I/O beyond the injected [`Storage`]. Errors are reported as user
/// facing strings, never panics.
pub trait Plugin: Send + Sync {
    /// Stable identifier, also the state directory name.
    fn id(&self) -> &'static str;

    /// One-line description (surfaces show it in plugin lists).
    fn describe(&self) -> &'static str;

    /// Named slash commands. `arg` is everything after the command id.
    /// Return the lines to show the user (already prefixed per-surface).
    fn commands(&self) -> Vec<CommandSpec> {
        Vec::new()
    }

    /// Run a command by id. `Ok(lines)` are user-facing messages;
    /// `Err(e)` is a failure the surface formats. Default: no commands.
    fn run_command(
        &self,
        _ctx: &PluginContext,
        _command: &str,
        _arg: &str,
    ) -> anyhow::Result<Vec<String>> {
        anyhow::bail!("plugin {} has no commands", self.id())
    }

    /// Rewrite outgoing user text before it reaches the request builder.
    /// Return `None` to pass the text through unchanged.
    fn before_send(
        &self,
        _ctx: &PluginContext,
        _text: &str,
        _settings: &crate::settings::Settings,
    ) -> anyhow::Result<Option<String>> {
        Ok(None) // default: pass text through unchanged
    }

    /// Rewrite completed assistant text. Return `None` to keep it as-is.
    fn format_output(&self, ctx: &PluginContext, text: &str) -> anyhow::Result<Option<String>> {
        let _ = (ctx, text);
        Ok(None)
    }

    /// One-line status contribution (e.g. "mem:3 snippets:12").
    /// Empty string = nothing to show.
    fn status(&self, ctx: &PluginContext) -> String {
        let _ = ctx;
        String::new()
    }

    /// Extra lines appended to the system prompt (communication rules,
    /// skills guidance). Applied before request assembly.
    fn system_prompt_suffix(
        &self,
        ctx: &PluginContext,
        settings: &crate::settings::Settings,
    ) -> String {
        let _ = (ctx, settings);
        String::new()
    }
}

/// A named command a plugin answers.
#[derive(Debug, Clone)]
pub struct CommandSpec {
    /// Sub-command id, namespaced as `<plugin_id>.<command>` by the
    /// registry (e.g. `/memory.save`).
    pub name: &'static str,
    /// Usage hint (arg shape only; the surface adds the prefix).
    pub usage: &'static str,
    /// One-line help text.
    pub help: &'static str,
}

/// owning wrapper so the registry can hold heterogeneous plugins.
type BoxedPlugin = Arc<dyn Plugin>;

/// Ordered plugin registry. Lookup by full id `<plugin>.<command>`;
/// before_send/format_output run in registration order, first writer wins
/// (subsequent plugins see the previous output).
#[derive(Default, Clone)]
pub struct Registry {
    plugins: Vec<BoxedPlugin>,
}

impl Registry {
    pub fn new() -> Self {
        Self {
            plugins: Vec::new(),
        }
    }

    /// Default set: every builtin plugin, in pipeline order.
    pub fn with_defaults() -> Self {
        let mut reg = Self::new();
        reg.register(Arc::new(builtins::Snippets));
        reg.register(Arc::new(builtins::Memory));
        reg.register(Arc::new(builtins::Ponytail));
        reg.register(Arc::new(builtins::Planning));
        reg.register(Arc::new(builtins::Usage));
        reg.register(Arc::new(builtins::TableFormat));
        reg.register(Arc::new(builtins::Skills));
        reg
    }

    pub fn register(&mut self, plugin: BoxedPlugin) {
        self.plugins.push(plugin);
    }

    pub fn ids(&self) -> Vec<&'static str> {
        self.plugins.iter().map(|p| p.id()).collect()
    }

    pub fn get(&self, id: &str) -> Option<&dyn Plugin> {
        self.plugins
            .iter()
            .map(|p| p.as_ref())
            .find(|p| p.id() == id)
    }

    fn context<'a>(
        &self,
        storage: &'a dyn Storage,
        config_dir: Option<&'a std::path::Path>,
    ) -> PluginContext<'a> {
        PluginContext {
            storage,
            config_dir,
        }
    }

    /// Dispatch `<plugin>.<command>`. Returns `None` when no plugin owns
    /// the id (the surface then reports "unknown command").
    pub fn run_command(
        &self,
        storage: &dyn Storage,
        config_dir: Option<&std::path::Path>,
        command: &str,
        arg: &str,
    ) -> Option<anyhow::Result<Vec<String>>> {
        let (plugin_id, cmd) = command.split_once('.')?;
        let plugin = self.get(plugin_id)?;
        let ctx = self.context(storage, config_dir);
        Some(plugin.run_command(&ctx, cmd, arg))
    }

    /// All command specs, namespaced (`memory.save`).
    pub fn command_specs(&self) -> Vec<(String, CommandSpec)> {
        let mut out = Vec::new();
        for p in &self.plugins {
            for spec in p.commands() {
                out.push((format!("{}.{}", p.id(), spec.name), spec));
            }
        }
        out
    }

    /// Pipeline: rewrite outgoing user text. First plugin that returns a
    /// change wins; the result feeds the next plugin.
    pub fn before_send(
        &self,
        storage: &dyn Storage,
        config_dir: Option<&std::path::Path>,
        text: &str,
        settings: &crate::settings::Settings,
    ) -> String {
        let ctx = self.context(storage, config_dir);
        let mut current = text.to_string();
        for p in &self.plugins {
            match p.before_send(&ctx, &current, settings) {
                Ok(Some(next)) if !next.is_empty() => current = next,
                Ok(_) => {}
                Err(_) => {}
            }
        }
        current
    }

    /// Pipeline: rewrite completed assistant text.
    pub fn format_output(
        &self,
        storage: &dyn Storage,
        config_dir: Option<&std::path::Path>,
        text: &str,
    ) -> String {
        let ctx = self.context(storage, config_dir);
        let mut current = text.to_string();
        for p in &self.plugins {
            match p.format_output(&ctx, &current) {
                Ok(Some(next)) => current = next,
                Ok(_) => {}
                Err(_) => {}
            }
        }
        current
    }

    /// Concatenated status contributions (space separated, non-empty).
    pub fn status(&self, storage: &dyn Storage, config_dir: Option<&std::path::Path>) -> String {
        let ctx = self.context(storage, config_dir);
        self.plugins
            .iter()
            .map(|p| p.status(&ctx))
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join(" ")
    }

    /// Concatenated system prompt suffixes.
    pub fn system_prompt_suffix(
        &self,
        storage: &dyn Storage,
        config_dir: Option<&std::path::Path>,
        settings: &crate::settings::Settings,
    ) -> String {
        let ctx = self.context(storage, config_dir);
        self.plugins
            .iter()
            .map(|p| p.system_prompt_suffix(&ctx, settings))
            .filter(|s| !s.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::Storage;
    use std::io;
    use std::path::{Path, PathBuf};

    /// In-memory storage for tests (also the shape WASM hosts inject).
    /// Tracks files *and* directories: `create_dir_all` materializes the
    /// dir so `read_dir` returns it, mirroring `FsStorage`.
    #[derive(Default)]
    pub struct MemStorage {
        files: std::sync::Mutex<std::collections::HashMap<PathBuf, String>>,
        dirs: std::sync::Mutex<std::collections::HashSet<PathBuf>>,
    }

    impl MemStorage {
        pub fn new() -> Self {
            Self::default()
        }
    }

    impl Storage for MemStorage {
        fn read_to_string(&self, path: &Path) -> io::Result<String> {
            self.files
                .lock()
                .unwrap()
                .get(path)
                .cloned()
                .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "missing"))
        }
        fn write_atomic(&self, path: &Path, contents: &str) -> io::Result<()> {
            self.files
                .lock()
                .unwrap()
                .insert(path.to_path_buf(), contents.to_string());
            Ok(())
        }
        fn create_dir_all(&self, path: &Path) -> io::Result<()> {
            let mut dirs = self.dirs.lock().unwrap();
            let mut cur = std::path::PathBuf::new();
            for comp in path.components() {
                cur.push(comp.as_os_str());
                dirs.insert(cur.clone());
            }
            Ok(())
        }
        fn read_dir(&self, dir: &Path) -> io::Result<Vec<PathBuf>> {
            // Direct children: files whose parent is `dir`, plus the dirs
            // registered (non-recursively) inside it.
            let files = self.files.lock().unwrap();
            let dirs = self.dirs.lock().unwrap();
            let mut out: Vec<PathBuf> = files
                .keys()
                .filter(|p| p.parent() == Some(dir))
                .cloned()
                .collect();
            for d in dirs.iter() {
                if d != dir && d.parent() == Some(dir) {
                    out.push(d.clone());
                }
            }
            Ok(out)
        }
        fn remove_file(&self, path: &Path) -> io::Result<()> {
            self.files.lock().unwrap().remove(path);
            Ok(())
        }
    }

    /// Echo test plugin: /test.echo, uppercases before_send.
    struct Echo;
    impl Plugin for Echo {
        fn id(&self) -> &'static str {
            "test"
        }
        fn describe(&self) -> &'static str {
            "test echo plugin"
        }
        fn commands(&self) -> Vec<CommandSpec> {
            vec![CommandSpec {
                name: "echo",
                usage: "<text>",
                help: "echo the argument",
            }]
        }
        fn run_command(
            &self,
            _ctx: &PluginContext,
            command: &str,
            arg: &str,
        ) -> anyhow::Result<Vec<String>> {
            if command == "echo" {
                Ok(vec![format!("echo: {arg}")])
            } else {
                Err(anyhow::anyhow!("unknown command {command}"))
            }
        }
        fn before_send(
            &self,
            _ctx: &PluginContext,
            text: &str,
            _settings: &crate::settings::Settings,
        ) -> anyhow::Result<Option<String>> {
            Ok(Some(format!("{text} [test]")))
        }
    }

    #[test]
    fn dispatches_namespaced_commands() {
        let mut reg = Registry::new();
        reg.register(Arc::new(Echo));
        let storage = MemStorage::new();
        let res = reg
            .run_command(&storage, None, "test.echo", "hi")
            .unwrap()
            .unwrap();
        assert_eq!(res, vec!["echo: hi"]);
        assert!(reg.run_command(&storage, None, "test.nope", "").is_some());
        assert!(reg.run_command(&storage, None, "nosuch.cmd", "").is_none());
    }

    #[test]
    fn before_send_runs_in_order_first_writer_wins() {
        struct Second;
        impl Plugin for Second {
            fn id(&self) -> &'static str {
                "second"
            }
            fn describe(&self) -> &'static str {
                ""
            }
            fn run_command(
                &self,
                _c: &PluginContext,
                _cmd: &str,
                _arg: &str,
            ) -> anyhow::Result<Vec<String>> {
                Ok(vec![])
            }
            fn before_send(
                &self,
                _ctx: &PluginContext,
                text: &str,
                _settings: &crate::settings::Settings,
            ) -> anyhow::Result<Option<String>> {
                Ok(Some(format!("{text} [second]")))
            }
        }
        let mut reg = Registry::new();
        reg.register(Arc::new(Echo));
        reg.register(Arc::new(Second));
        let storage = MemStorage::new();
        let out = reg.before_send(&storage, None, "hi", &crate::settings::Settings::default());
        assert_eq!(out, "hi [test] [second]");
    }

    #[test]
    fn defaults_include_all_builtins() {
        let reg = Registry::with_defaults();
        let ids = reg.ids();
        for expected in [
            "snippets",
            "memory",
            "ponytail",
            "planning",
            "usage",
            "tableformat",
            "skills",
        ] {
            assert!(ids.contains(&expected), "missing builtin {expected}");
        }
    }
}
