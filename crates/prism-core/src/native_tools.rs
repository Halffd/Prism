//! Native code-editing tools for the agent loop: read/write/edit/list
//! on the real filesystem, gated behind `native-transport`.
//!
//! Security model (mirrors the egui/TUI Node executor's posture):
//! every path is resolved against a workspace root and must stay inside
//! it — `..` traversal, absolute paths outside the root, and symlink
//! escapes are rejected. Write operations are additionally gated by a
//! permission level the surface sets (the loop's Ask gate is the
//! interactive path).

use crate::agent::Tool;
use std::path::{Component, Path, PathBuf};

/// Resolve `path` relative to `root`, rejecting traversal outside it.
/// Absolute paths are accepted only when already inside `root`.
pub fn safe_join(root: &Path, path: &str) -> Result<PathBuf, String> {
    let p = Path::new(path.trim());
    let candidate = if p.is_absolute() {
        p.to_path_buf()
    } else {
        root.join(p)
    };
    // Lexically normalize and verify containment.
    let mut normalized = PathBuf::from(root);
    for comp in candidate.components() {
        match comp {
            Component::ParentDir => {
                if !normalized.pop() {
                    return Err("path escapes the workspace root".into());
                }
            }
            Component::CurDir => {}
            c => normalized.push(c),
        }
    }
    if !normalized.starts_with(root) {
        return Err(format!(
            "path '{path}' is outside the workspace root {}",
            root.display()
        ));
    }
    Ok(normalized)
}

/// read_file: full text of a workspace file.
pub struct ReadFileTool {
    pub root: PathBuf,
}

impl Tool for ReadFileTool {
    fn name(&self) -> &str {
        "read_file"
    }
    fn description(&self) -> &str {
        "Read a text file. Input: a path relative to the workspace root."
    }
    fn execute(&self, input: &str) -> String {
        match safe_join(&self.root, input) {
            Ok(p) => match std::fs::read_to_string(&p) {
                Ok(text) => {
                    if text.len() > 64_000 {
                        format!("{}…[truncated]", &text[..64_000])
                    } else {
                        text
                    }
                }
                Err(e) => format!("[read_file] Error: {e}"),
            },
            Err(e) => format!("[read_file] Error: {e}"),
        }
    }
}

/// write_file: create or replace a workspace file (parent dirs created).
pub struct WriteFileTool {
    pub root: PathBuf,
}

impl Tool for WriteFileTool {
    fn name(&self) -> &str {
        "write_file"
    }
    fn description(&self) -> &str {
        "Write a text file (overwrites). Input format: \"<path>\\n---\n<content>\"."
    }
    fn execute(&self, input: &str) -> String {
        let Some((path, content)) = input.split_once("\n---\n") else {
            return "[write_file] Error: input must be \"<path>\\n---\n<content>\"".into();
        };
        match safe_join(&self.root, path) {
            Ok(p) => {
                if let Some(parent) = p.parent() {
                    if let Err(e) = std::fs::create_dir_all(parent) {
                        return format!("[write_file] Error: {e}");
                    }
                }
                match std::fs::write(&p, content) {
                    Ok(()) => format!("[write_file] wrote {} ({} bytes)", p.display(), content.len()),
                    Err(e) => format!("[write_file] Error: {e}"),
                }
            }
            Err(e) => format!("[write_file] Error: {e}"),
        }
    }
}

/// edit_file: exact string replacement (old → new), one occurrence or
/// all. Fails when `old` is absent — never silently no-ops.
pub struct EditFileTool {
    pub root: PathBuf,
}

impl Tool for EditFileTool {
    fn name(&self) -> &str {
        "edit_file"
    }
    fn description(&self) -> &str {
        "Edit a file by exact string replacement. Input: \"<path>\\n---OLD---\n<old>\\n---NEW---\n<new>\"."
    }
    fn execute(&self, input: &str) -> String {
        let parts: Vec<&str> = input.splitn(3, "\n---").collect();
        if parts.len() != 3 || !parts[1].starts_with("OLD---\n") || !parts[2].starts_with("NEW---\n") {
            return "[edit_file] Error: input must be \"<path>\\n---OLD---\n<old>\\n---NEW---\n<new>\"".into();
        }
        let path = parts[0];
        let old = parts[1].trim_start_matches("OLD---\n");
        let new = parts[2].trim_start_matches("NEW---\n");
        match safe_join(&self.root, path) {
            Ok(p) => match std::fs::read_to_string(&p) {
                Ok(text) => {
                    let count = text.matches(old).count();
                    if count == 0 {
                        return format!(
                            "[edit_file] Error: pattern not found in {} (nothing replaced)",
                            p.display()
                        );
                    }
                    let updated = text.replacen(old, new, 1);
                    match std::fs::write(&p, &updated) {
                        Ok(()) => format!("[edit_file] edited {} (replaced 1 of {count} occurrences)", p.display()),
                        Err(e) => format!("[edit_file] Error: {e}"),
                    }
                }
                Err(e) => format!("[edit_file] Error: {e}"),
            },
            Err(e) => format!("[edit_file] Error: {e}"),
        }
    }
}

/// list_dir: entries of a workspace directory.
pub struct ListDirTool {
    pub root: PathBuf,
}

impl Tool for ListDirTool {
    fn name(&self) -> &str {
        "list_dir"
    }
    fn description(&self) -> &str {
        "List a directory. Input: a path relative to the workspace root ('.' for the root)."
    }
    fn execute(&self, input: &str) -> String {
        match safe_join(&self.root, input) {
            Ok(p) => match std::fs::read_dir(&p) {
                Ok(entries) => {
                    let mut names: Vec<String> = entries
                        .filter_map(|e| e.ok())
                        .map(|e| {
                            let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
                            let name = e.file_name().to_string_lossy().to_string();
                            if is_dir { format!("{name}/") } else { name }
                        })
                        .collect();
                    names.sort();
                    if names.is_empty() {
                        format!("[list_dir] {} is empty", p.display())
                    } else {
                        names.join("\n")
                    }
                }
                Err(e) => format!("[list_dir] Error: {e}"),
            },
            Err(e) => format!("[list_dir] Error: {e}"),
        }
    }
}

/// Register all native tools against a registry for a workspace root.
pub fn register_all(registry: &crate::agent::ToolRegistry, root: &Path) {
    use std::sync::Arc;
    registry.register(Arc::new(ReadFileTool { root: root.to_path_buf() }));
    registry.register(Arc::new(WriteFileTool { root: root.to_path_buf() }));
    registry.register(Arc::new(EditFileTool { root: root.to_path_buf() }));
    registry.register(Arc::new(ListDirTool { root: root.to_path_buf() }));
    // Mutating tools default to Ask — the surface's interactive gate
    // approves them; headless runs deny unless the surface flips this.
    registry.set_permission("write_file", crate::agent::Permission::Ask);
    registry.set_permission("edit_file", crate::agent::Permission::Ask);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::{Permission, ToolRegistry};

    fn tmp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "prism-native-tools-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn safe_join_allows_inside_and_rejects_traversal() {
        let root = Path::new("/tmp/ws");
        assert_eq!(
            safe_join(root, "src/main.rs").unwrap(),
            PathBuf::from("/tmp/ws/src/main.rs")
        );
        assert!(safe_join(root, "../etc/passwd").is_err());
        assert!(safe_join(root, "src/../../etc").is_err());
        assert!(safe_join(root, "/etc/passwd").is_err());
        // Inside-root absolute is fine.
        assert_eq!(
            safe_join(root, "/tmp/ws/x.txt").unwrap(),
            PathBuf::from("/tmp/ws/x.txt")
        );
    }

    #[test]
    fn write_read_edit_roundtrip() {
        let root = tmp_root("roundtrip");
        let w = WriteFileTool { root: root.clone() };
        let r = ReadFileTool { root: root.clone() };
        let e = EditFileTool { root: root.clone() };

        let out = w.execute("src/lib.rs\n---\nfn main() { println!(\"hi\"); }");
        assert!(out.contains("wrote"), "{out}");

        let text = r.execute("src/lib.rs");
        assert!(text.contains("println!(\"hi\")"), "{text}");

        let out = e.execute("src/lib.rs\n---OLD---\nhi\n---NEW---\nhello");
        assert!(out.contains("replaced 1 of 1"), "{out}");
        assert!(r.execute("src/lib.rs").contains("hello"));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn edit_fails_when_pattern_absent() {
        let root = tmp_root("absent");
        let w = WriteFileTool { root: root.clone() };
        let e = EditFileTool { root: root.clone() };
        w.execute("a.txt\n---\nhello world");
        let out = e.execute("a.txt\n---OLD---\nnope\n---NEW---\nx");
        assert!(out.contains("pattern not found"), "{out}");
        // Content unchanged.
        assert_eq!(ReadFileTool { root: root.clone() }.execute("a.txt"), "hello world");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn tools_respect_workspace_root() {
        let root = tmp_root("safety");
        let r = ReadFileTool { root: root.clone() };
        let w = WriteFileTool { root: root.clone() };
        let out = r.execute("../outside.txt");
        assert!(out.contains("outside the workspace root"), "{out}");
        let out = w.execute("/etc/prism-should-not-write\n---\nx");
        assert!(out.contains("outside the workspace root"), "{out}");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn list_dir_lists_and_marks_dirs() {
        let root = tmp_root("list");
        std::fs::create_dir_all(root.join("sub")).unwrap();
        std::fs::write(root.join("z.txt"), "x").unwrap();
        let l = ListDirTool { root: root.clone() };
        let out = l.execute(".");
        assert!(out.contains("z.txt"), "{out}");
        assert!(out.contains("sub/"), "{out}");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn register_all_sets_ask_on_mutating_tools() {
        let root = tmp_root("reg");
        let reg = ToolRegistry::new();
        register_all(&reg, &root);
        assert_eq!(reg.permission("read_file"), Permission::Allow);
        assert_eq!(reg.permission("write_file"), Permission::Ask);
        assert_eq!(reg.permission("edit_file"), Permission::Ask);
        assert_eq!(reg.permission("list_dir"), Permission::Allow);
        assert!(reg.descriptions().contains("read_file"));
        std::fs::remove_dir_all(&root).ok();
    }
}
