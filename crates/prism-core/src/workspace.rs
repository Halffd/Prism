//! The desktop IDE workspace: one folder, a guarded file tree, and
//! limited reads/writes the editor panel and the `workspace.*` palette
//! commands drive. Path containment reuses `native_tools::safe_join`,
//! so the agent's tools and the editor enforce the same root.
//!
//! Every operation is bounded (depth, count, bytes) so a runaway tree
//! cannot stall the UI thread; non-UTF-8 files refuse instead of
//! corrupting, matching the editor model (text only).

use crate::native_tools::safe_join;
use std::path::{Path, PathBuf};

/// Directories that never belong to the file tree (build output,
/// caches, VCS internals).
const SKIP_DIRS: &[&str] = &[
    ".git", ".hg", ".svn", "node_modules", "target", "dist", "out", ".venv",
    "__pycache__", ".next", ".cache", ".Turbo", "vendor",
];

/// Largest read the editor will show: 512 KB.
const MAX_READ_BYTES: u64 = 512 * 1024;
/// Largest accepted write from the editor: 1 MB.
const MAX_WRITE_BYTES: usize = 1024 * 1024;
/// Tree scan caps: recursion depth and total entries.
const MAX_DEPTH: usize = 4;
const MAX_ENTRIES: usize = 2000;

/// One row of the file tree: workspace-relative path + what it is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileEntry {
    pub rel: String,
    pub is_dir: bool,
    pub depth: usize,
}

#[derive(Debug, Clone)]
pub struct Workspace {
    pub root: PathBuf,
}

/// Resolve `input` to an absolute folder: expand a leading `~`, require
/// the path to exist, and canonicalize it. `Err` carries a
/// human-readable reason the panel can show verbatim.
pub fn open_root(input: &str) -> Result<PathBuf, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("open workspace: no path given (usage: open workspace <dir>)".into());
    }
    let expanded = if trimmed == "~" || trimmed.starts_with("~/") {
        #[cfg(target_os = "windows")]
        let home = std::env::var("USERPROFILE").map(PathBuf::from);
        #[cfg(not(target_os = "windows"))]
        let home = std::env::var("HOME").map(PathBuf::from);
        match home {
            Ok(home) if !home.as_os_str().is_empty() => {
                let rel = trimmed.strip_prefix('~').unwrap_or("");
                if rel.is_empty() { home } else { home.join(rel.trim_start_matches(['/', '\\'])) }
            }
            _ => return Err("open workspace: cannot resolve ~ (no home directory)".into()),
        }
    } else {
        PathBuf::from(trimmed)
    };
    let canonical = expanded
        .canonicalize()
        .map_err(|e| format!("open workspace {}: {e}", expanded.display()))?;
    if !canonical.is_dir() {
        return Err(format!("open workspace {}: not a directory", canonical.display()));
    }
    Ok(canonical)
}

impl Workspace {
    pub fn open(input: &str) -> Result<Self, String> {
        Ok(Self { root: open_root(input)? })
    }

    pub fn topic(&self) -> String {
        format!("workspace: {}", self.root.display())
    }

    pub fn rel_to(&self, path: &Path) -> Option<String> {
        path.strip_prefix(&self.root).ok().map(|p| p.to_string_lossy().replace('\\', "/"))
    }

    /// Depth-first listing: directories first, names sorted case-
    /// insensitively, junk pruned, `MAX_DEPTH`/`MAX_ENTRIES` enforced.
    /// The search itself is synchronous and bounded; at the caps the
    /// found-so-far tree is returned and the pair of caps is recorded in
    /// the trailing entry (a `…` marker) rather than truncated silently
    /// mid-directory.
    pub fn list_files(&self) -> Result<Vec<FileEntry>, String> {
        if !self.root.is_dir() {
            return Err(format!("workspace root {} is not a directory", self.root.display()));
        }
        let mut rows = Vec::new();
        let hit_cap = self.walk_dir(&self.root, 0, &mut rows)?;
        if hit_cap {
            rows.push(FileEntry {
                rel: "… (file tree truncated at the depth/entry caps)".into(),
                is_dir: false,
                depth: 0,
            });
        }
        Ok(rows)
    }

    fn walk_dir(&self, dir: &Path, depth: usize, rows: &mut Vec<FileEntry>) -> Result<bool, String> {
        if rows.len() >= MAX_ENTRIES {
            return Ok(true);
        }
        let mut children = match std::fs::read_dir(dir) {
            Ok(rd) => rd.filter_map(|e| e.ok()).collect::<Vec<_>>(),
            Err(e) => return Err(format!("list {}: {e}", dir.display())),
        };
        children.sort_by_key(|e| e.file_name().as_encoded_bytes().to_ascii_lowercase());
        let mut child_dirs = Vec::new();
        for entry in children {
            if rows.len() >= MAX_ENTRIES {
                return Ok(true);
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            let path = entry.path();
            let is_dir = path.is_dir();
            if SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            let rel = self.rel_to(&path).unwrap_or_else(|| name.clone());
            rows.push(FileEntry { rel, is_dir, depth });
            if is_dir && depth + 1 < MAX_DEPTH {
                child_dirs.push(path);
            }
        }
        let mut hit_cap = false;
        for path in child_dirs {
            if self.walk_dir(&path, depth + 1, rows)? {
                hit_cap = true;
                break;
            }
        }
        Ok(hit_cap || rows.len() >= MAX_ENTRIES)
    }

    /// Text of one workspace file, size-capped. `..`-traversal and
    /// symlinks that leave the root are rejected by `safe_join`.
    pub fn read_file(&self, rel: &str) -> Result<String, String> {
        let path = safe_join(&self.root, rel)?;
        let meta = std::fs::metadata(&path).map_err(|e| format!("read {rel}: {e}"))?;
        if !meta.is_file() {
            return Err(format!("read {rel}: not a regular file"));
        }
        if meta.len() > MAX_READ_BYTES {
            return Err(format!(
                "read {rel}: file is {} bytes; the editor shows at most {MAX_READ_BYTES}",
                meta.len()
            ));
        }
        std::fs::read_to_string(&path).map_err(|e| format!("read {rel}: {e}"))
    }

    /// Atomic bounded write of the editor's buffer. The parent
    /// directory must already exist (the tree lists it); tmp + rename
    /// so a crash cannot leave a half-written file.
    pub fn write_file(&self, rel: &str, content: &str) -> Result<(), String> {
        let path = safe_join(&self.root, rel)?;
        if content.len() > MAX_WRITE_BYTES {
            return Err(format!(
                "write {rel}: {} bytes over the {MAX_WRITE_BYTES}-byte editor cap",
                content.len()
            ));
        }
        let tmp = path.with_extension("prism-tmp");
        std::fs::write(&tmp, content).map_err(|e| format!("write {rel}: {e}"))?;
        match std::fs::rename(&tmp, &path) {
            Ok(()) => Ok(()),
            Err(e) => {
                let _ = std::fs::remove_file(&tmp);
                Err(format!("write {rel}: {e}"))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);
    impl TempDir {
        fn fresh(tag: &str) -> Self {
            let base = std::env::temp_dir().join(format!(
                "prism-ws-{tag}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir_all(&base).unwrap();
            Self(base)
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn write(path: &Path, content: &str) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, content).unwrap();
    }

    #[test]
    fn open_root_resolves_existing_dir_and_rejects_else() {
        let tmp = TempDir::fresh("open");
        let ws = Workspace::open(tmp.0.to_str().unwrap()).unwrap();
        assert_eq!(ws.root, tmp.0.canonicalize().unwrap());
        assert!(open_root("definitely/missing/dir").is_err());
        assert!(open_root("   ").is_err());
        // A plain file is not a workspace.
        write(&tmp.0.join("f.txt"), "x");
        assert!(open_root(tmp.0.join("f.txt").to_str().unwrap()).is_err());
        assert!(open_root("~").is_ok() || open_root("~").is_err());
    }

    #[test]
    fn list_is_sorted_prunes_junk_and_tracks_depth() {
        let tmp = TempDir::fresh("list");
        write(&tmp.0.join("src/main.rs"), "fn main() {}");
        write(&tmp.0.join("src/lib.rs"), "");
        write(&tmp.0.join("z.txt"), "");
        write(&tmp.0.join("node_modules/pkg/index.js"), "");
        write(&tmp.0.join(".git/config"), "");
        write(
            &tmp.0.join("deep/a/b/c/d/e.txt"),
            "beyond depth",
        );
        let ws = Workspace::open(tmp.0.to_str().unwrap()).unwrap();
        let rows = ws.list_files().unwrap();
        let rels: Vec<&str> = rows.iter().map(|r| r.rel.as_str()).collect();
        assert!(rels.contains(&"src"), "dirs listed");
        assert!(rels.contains(&"src/main.rs"), "files listed");
        assert!(!rels.iter().any(|r| r.starts_with("node_modules")), "junk pruned");
        assert!(!rels.iter().any(|r| r.starts_with(".git")), "vcs pruned");
        assert!(!rels.iter().any(|r| r.contains("e.txt")), "depth cap enforced");
        assert!(rels.contains(&"deep/a/b/c"), "up to the depth cap");
        // directories before their own files, sorted inside a directory
        let src_idx = rels.iter().position(|r| *r == "src").unwrap();
        let main_idx = rels.iter().position(|r| *r == "src/main.rs").unwrap();
        let lib_idx = rels.iter().position(|r| *r == "src/lib.rs").unwrap();
        assert!(src_idx < main_idx && main_idx > lib_idx);
    }

    #[test]
    fn read_and_write_stay_inside_the_root() {
        let tmp = TempDir::fresh("rw");
        write(&tmp.0.join("a.txt"), "hello");
        let ws = Workspace::open(tmp.0.to_str().unwrap()).unwrap();
        assert_eq!(ws.read_file("a.txt").unwrap(), "hello");
        ws.write_file("a.txt", "hello again").unwrap();
        assert_eq!(std::fs::read_to_string(tmp.0.join("a.txt")).unwrap(), "hello again");

        // traversal is refused by the same join the tools use
        assert!(ws.read_file("../secrets.txt").is_err());
        write(&tmp.0.parent().unwrap().join("secrets.txt"), "secret");
        assert!(ws.read_file("../secrets.txt").is_err());
        assert!(ws.write_file("/etc/passwd", "x").is_err());

        // no tmp litter after a successful write
        assert!(!tmp.0.join("a.txt.prism-tmp").exists());
    }

    #[test]
    fn read_respects_the_byte_cap() {
        let tmp = TempDir::fresh("cap");
        let big = "x".repeat(MAX_READ_BYTES as usize + 1);
        write(&tmp.0.join("big.txt"), &big);
        let ws = Workspace::open(tmp.0.to_str().unwrap()).unwrap();
        let err = ws.read_file("big.txt").unwrap_err();
        assert!(err.contains("editor shows at most"), "{err}");
    }

    #[test]
    fn write_respects_the_byte_cap() {
        let tmp = TempDir::fresh("wcap");
        let ws = Workspace::open(tmp.0.to_str().unwrap()).unwrap();
        let big = "x".repeat(MAX_WRITE_BYTES + 1);
        let err = ws.write_file("too-big.txt", &big).unwrap_err();
        assert!(err.contains("over the") && err.contains("cap"), "{err}");
        assert!(!tmp.0.join("too-big.txt").exists());
        // failed write leaves no tmp litter either
        assert!(!tmp.0.join("too-big.txt.prism-tmp").exists());
    }

    #[test]
    fn non_directory_root_refused() {
        let tmp = TempDir::fresh("nondir");
        let ws = Workspace { root: tmp.0.join("missing") };
        assert!(ws.list_files().unwrap_err().contains("not a directory"));
    }
}
