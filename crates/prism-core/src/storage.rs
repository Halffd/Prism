//! Filesystem boundary of the core.
//!
//! Settings and conversation persistence go through this trait so the
//! same logic runs on native filesystems and (later) browser storage.
//! The native impl is `FsStorage`; WASM hosts inject their own.

use std::io;
use std::path::{Path, PathBuf};

pub trait Storage: Send + Sync {
    fn read_to_string(&self, path: &Path) -> io::Result<String>;
    /// Write via tmp file + rename so a crash mid-write cannot truncate.
    fn write_atomic(&self, path: &Path, contents: &str) -> io::Result<()>;
    fn create_dir_all(&self, path: &Path) -> io::Result<()>;
    /// Paths of entries directly inside `dir` (non-recursive).
    fn read_dir(&self, dir: &Path) -> io::Result<Vec<PathBuf>>;
    fn remove_file(&self, path: &Path) -> io::Result<()>;
}

/// Native std::fs implementation. Compiles everywhere; only meaningful
/// where a real filesystem exists.
pub struct FsStorage;

impl Storage for FsStorage {
    fn read_to_string(&self, path: &Path) -> io::Result<String> {
        std::fs::read_to_string(path)
    }

    fn write_atomic(&self, path: &Path, contents: &str) -> io::Result<()> {
        let mut tmp_name = path.as_os_str().to_os_string();
        tmp_name.push(".tmp");
        let tmp = PathBuf::from(tmp_name);
        std::fs::write(&tmp, contents)?;
        match std::fs::rename(&tmp, path) {
            Ok(()) => Ok(()),
            Err(e) => {
                // Best effort cleanup so a failed write leaves no litter.
                let _ = std::fs::remove_file(&tmp);
                Err(e)
            }
        }
    }

    fn create_dir_all(&self, path: &Path) -> io::Result<()> {
        std::fs::create_dir_all(path)
    }

    fn read_dir(&self, dir: &Path) -> io::Result<Vec<PathBuf>> {
        Ok(std::fs::read_dir(dir)?
            .collect::<io::Result<Vec<_>>>()?
            .into_iter()
            .map(|e| e.path())
            .collect())
    }

    fn remove_file(&self, path: &Path) -> io::Result<()> {
        std::fs::remove_file(path)
    }
}
