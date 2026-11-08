//! Agent sandbox: policy model, preflight, and enforcement for shell tools.
//!
//! Ported from the Cursor `agentd` (agent-host-daemon 6.8.0) analysis: the
//! daemon routes every shell command through a policy object
//! (`AgentExecPermissions` / `AutoRunSandboxingControls` protos) and a
//! dedicated sandbox helper (`agent_host_sandbox_helper.v1`, known in-tree
//! as `cursorsandbox`, "Everysphere shell-exec"). Spawn results are a
//! closed enum — `success | error | rejected | permission_denied |
//! sandbox_unsupported` (the `BackgroundShellSpawnResult` union) — and an
//! unsupported host degrades to a *recorded* fallback, never a silent
//! bypass.
//!
//! Prism's port:
//!
//! - [`SandboxPolicy`] — the JSON policy object (the helper's unified
//!   `--policy <POLICY>` file shape: filesystem boundary + network filter
//!   + strict flag).
//! - [`resolve_policy`] — policy → enforceable roots/denylist.
//! - [`shell_guard`] — fail-closed command check before any spawn
//!   (admin denylist, then static workspace-escape detection).
//! - [`spawn_sandboxed`] — Linux enforcement: a Landlock filesystem
//!   ruleset plus, when networking is blocked, a seccomp filter denying
//!   internet socket creation — installed in the child before exec,
//!   exactly where the helper installs it. Unsupported hosts yield
//!   `SandboxUnsupported` (strict) or the provenance-recorded
//!   `UnsandboxedFallback` (auto).
//!
//! Pure code (policy parse/resolve/guard) is target-free so WASM hosts
//! can validate a policy the desktop host will later enforce.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

// ---- policy model -----------------------------------------------------------

/// Sandbox enforcement mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SandboxingMode {
    /// No sandbox; commands run unsandboxed.
    #[default]
    Off,
    /// Enforce when the host supports it; degrade to unsandboxed with a
    /// recorded reason when it does not (the daemon's `auto` posture).
    Auto,
    /// Enforce; reject the spawn when the host cannot enforce.
    #[serde(rename = "strict")]
    Strict,
}

/// Network gating (`SandboxingControls.sandboxNetworking` in the daemon
/// protos).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NetworkMode {
    #[default]
    AllowAll,
    Blocked,
}

/// Network filter entries: coarse mode (`allow_all` / `blocked`) plus a
/// host allowlist consulted by egress-gated tools.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct NetworkPolicy {
    pub mode: NetworkMode,
    /// Allowed hosts; `*.` wildcards and `host:port` forms both match.
    pub allowlist: Vec<String>,
}

impl NetworkPolicy {
    /// Whether an egress host is allowed.
    pub fn permits(&self, host: &str) -> bool {
        match self.mode {
            NetworkMode::AllowAll => true,
            NetworkMode::Blocked => self
                .allowlist
                .iter()
                .any(|pattern| host_pattern_matches(pattern, host)),
        }
    }
}

fn host_pattern_matches(pattern: &str, host: &str) -> bool {
    let strip_port = |s: String| s.split(':').next().unwrap_or("").to_string();
    let pattern = strip_port(pattern.trim().to_ascii_lowercase());
    let host = strip_port(host.trim().to_ascii_lowercase());
    if let Some(suffix) = pattern.strip_prefix("*.") {
        host == suffix || host.ends_with(&format!(".{suffix}"))
    } else {
        pattern == host
    }
}

/// JSON policy — the helper's `--policy <POLICY>` file shape.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct SandboxPolicy {
    pub mode: SandboxingMode,
    pub network: NetworkPolicy,
    /// Admin command denylist (substring match over the command text).
    pub admin_command_denylist: Vec<String>,
    /// True → the admin denylist *replaces* the built-in defaults
    /// instead of merging with them.
    pub admin_denylist_replaces: bool,
    /// Workspace roots: write-allowed, and the child's default cwd.
    pub workspace_roots: Vec<String>,
    /// Read-only roots outside the workspace (the helper's read allowlist;
    /// never write-granted).
    pub read_allowlist_paths: Vec<String>,
}

/// Fully-resolved policy ready for guard/enforcement.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ResolvedSandbox {
    pub mode: SandboxingMode,
    /// Write-allowed roots; also the child's default cwd.
    pub workspace_roots: Vec<PathBuf>,
    /// Read-only roots outside the workspace.
    pub read_roots: Vec<PathBuf>,
    pub network: NetworkPolicy,
    pub admin_command_denylist: Vec<String>,
    pub admin_denylist_replaces: bool,
}

/// Built-in denylist merged into every policy unless
/// `admin_denylist_replaces` (`team_admin_policy_replaces_team`).
pub const BUILTIN_COMMAND_DENYLIST: &[&str] = &["sudo "];

/// Parse the policy file text exactly as the helper accepts it.
pub fn parse_policy(json: &str) -> Result<SandboxPolicy, String> {
    serde_json::from_str(json).map_err(|e| format!("policy parse: {e}"))
}

/// Policy → enforceable form. Pure: identical on desktop and WASM.
pub fn resolve_policy(policy: &SandboxPolicy) -> ResolvedSandbox {
    let workspace_roots: Vec<PathBuf> = if policy.workspace_roots.is_empty() {
        vec![PathBuf::from(".")]
    } else {
        policy.workspace_roots.iter().map(PathBuf::from).collect()
    };
    let denylist: Vec<String> = if policy.admin_denylist_replaces {
        policy.admin_command_denylist.clone()
    } else {
        policy
            .admin_command_denylist
            .iter()
            .cloned()
            .chain(BUILTIN_COMMAND_DENYLIST.iter().map(|s| s.to_string()))
            .collect()
    };
    ResolvedSandbox {
        mode: policy.mode,
        workspace_roots: workspace_roots.clone(),
        read_roots: policy
            .read_allowlist_paths
            .iter()
            .map(PathBuf::from)
            .collect(),
        network: policy.network.clone(),
        admin_command_denylist: denylist,
        admin_denylist_replaces: policy.admin_denylist_replaces,
    }
}

// ---- spawn outcomes ----------------------------------------------------------

/// One closed spawn result — mirrors the daemon's
/// `BackgroundShellSpawnResult` cases (success/error/rejected/
/// permission_denied/sandbox_unsupported).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SpawnOutcome {
    Success(Spawned),
    Rejected { reason: String },
    PermissionDenied { reason: String },
    SandboxUnsupported { reason: String },
    Error { message: String },
}

/// Successful spawn payload.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Spawned {
    /// What actually wrapped the child — provenance for logs.
    pub sandbox: SandboxUsed,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

/// Sandbox backend actually applied. `UnsandboxedFallback` occurs only
/// under `auto` mode and the reason travels with the outcome.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SandboxUsed {
    Landlock,
    LandlockSeccomp,
    UnsandboxedFallback,
    Off,
}

/// Serialize an outcome for the agent's observation channel. The
/// `[shell …]` tag prefixes are the stable markers surfaces render.
pub fn outcome_str(o: &SpawnOutcome) -> String {
    match o {
        SpawnOutcome::Success(s) => {
            let mut text = format!("[shell ok sandbox={:?}] exit {}", s.sandbox, s.exit_code);
            if !s.stdout.is_empty() {
                text.push_str(&format!("\n{}", s.stdout));
            }
            if !s.stderr.is_empty() {
                text.push_str(&format!("\nstderr: {}", s.stderr));
            }
            text
        }
        SpawnOutcome::Rejected { reason } => {
            format!("[shell rejected sandbox=none] {reason}")
        }
        SpawnOutcome::PermissionDenied { reason } => {
            format!("[shell denied sandbox=none] {reason}")
        }
        SpawnOutcome::SandboxUnsupported { reason } => {
            format!("[shell sandbox_unsupported] {reason}")
        }
        SpawnOutcome::Error { message } => format!("[shell error] {message}"),
    }
}

// ---- preflight ---------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PreflightReport {
    pub landlock_supported: bool,
    /// Highest Landlock ABI the kernel reports, when supported.
    pub landlock_abi: Option<u32>,
    pub notes: Vec<String>,
}

/// Probe the host *without* spawning anything (the helper's
/// `--preflight-only`; exit 2 on unsupported).
#[cfg(target_os = "linux")]
pub fn preflight() -> PreflightReport {
    let (supported, abi) = linux::probe_landlock();
    PreflightReport {
        landlock_supported: supported,
        landlock_abi: abi,
        notes: vec!["preflight: no process was spawned".to_string()],
    }
}

#[cfg(not(target_os = "linux"))]
pub fn preflight() -> PreflightReport {
    PreflightReport {
        landlock_supported: false,
        landlock_abi: None,
        notes: vec!["preflight: target host has no Landlock".to_string()],
    }
}

/// Decide how a resolved policy would be applied on this host — no spawn.
/// `Ok(SandboxUsed)` names the child wrapper (`UnsandboxedFallback` is
/// the `auto` contract on unsupported hosts, always recorded);
/// `Err(SandboxUnsupported)` = `strict` mode + unsupported host.
pub fn plan_spawn(res: &ResolvedSandbox) -> Result<SandboxUsed, SpawnOutcome> {
    let supported = preflight().landlock_supported;
    match res.mode {
        SandboxingMode::Off => Ok(SandboxUsed::Off),
        SandboxingMode::Auto => {
            if !supported {
                Ok(SandboxUsed::UnsandboxedFallback)
            } else if res.network.mode == NetworkMode::Blocked {
                Ok(SandboxUsed::LandlockSeccomp)
            } else {
                Ok(SandboxUsed::Landlock)
            }
        }
        SandboxingMode::Strict if supported => {
            if res.network.mode == NetworkMode::Blocked {
                Ok(SandboxUsed::LandlockSeccomp)
            } else {
                Ok(SandboxUsed::Landlock)
            }
        }
        SandboxingMode::Strict => Err(SpawnOutcome::SandboxUnsupported {
            reason: "host cannot enforce Landlock (policy is strict)".to_string(),
        }),
    }
}

// ---- the shell guard ---------------------------------------------------------

/// Fail-closed pre-spawn decision for a command string: admin denylist
/// (substring match, the daemon's `not_allowed_commands` semantics), then
/// static detection of absolute paths outside the workspace. Never needs
/// a process: identical from WASM.
pub fn shell_guard(res: &ResolvedSandbox, command: &str) -> Result<(), String> {
    for deny in &res.admin_command_denylist {
        if !deny.is_empty() && command.contains(deny.as_str()) {
            return Err(format!(
                "not_allowed_commands: matches sandbox denylist entry {deny:?}"
            ));
        }
    }
    for token in shell_tokens(command) {
        if token.len() < 2 || !token.starts_with('/') {
            continue;
        }
        let inside = res.workspace_roots.iter().any(|root| {
            let root_text = root.to_string_lossy();
            // A relative ("." ) root cannot contain absolute paths.
            root_text != "." && {
                let root_text = root_text.as_ref().trim_end_matches('/');
                token == root_text || token.starts_with(format!("{root_text}/").as_str())
            }
        });
        if !inside {
            return Err(format!(
                "command references an absolute path outside the sandbox workspace: {token}"
            ));
        }
    }
    Ok(())
}

/// Whitespace-separated tokens with quote stripping (text level only —
/// no shell grammar evaluation, matching the daemon's static rejector).
fn shell_tokens(command: &str) -> Vec<String> {
    command
        .split_whitespace()
        .map(|t| {
            t.trim_start_matches("path=")
                .trim_matches(|c| c == '"' || c == '\'')
                .to_string()
        })
        .collect()
}

// ---- Linux enforcement -------------------------------------------------------

#[cfg(target_os = "linux")]
mod linux {
    use super::ResolvedSandbox;
    use std::path::PathBuf;

    // Landlock syscall numbers (x86_64 / aarch64 / riscv64 agree; other
    // arches surface as unsupported through the probe).
    const LANDLOCK_CREATE_RULESET: i64 = 444;
    const LANDLOCK_ADD_RULE: i64 = 445;
    const LANDLOCK_RESTRICT_SELF: i64 = 446;
    /// `LANDLOCK_CREATE_RULESET_VERSION` flag: ABI query, creates nothing.
    const LANDLOCK_CREATE_RULESET_VERSION: i64 = 1;
    const LANDLOCK_RULE_PATH_BENEATH: i32 = 1;

    // Landlock v1 access bits (kernel header values).
    const FS_EXECUTE: i64 = 1 << 0;
    const FS_WRITE_FILE: i64 = 1 << 1;
    const FS_READ_FILE: i64 = 1 << 2;
    const FS_READ_DIR: i64 = 1 << 3;
    const FS_REMOVE_DIR: i64 = 1 << 4;
    const FS_REMOVE_FILE: i64 = 1 << 5;
    const FS_MAKE_CHAR: i64 = 1 << 6;
    const FS_MAKE_DIR: i64 = 1 << 7;
    const FS_MAKE_REG: i64 = 1 << 8;
    const FS_MAKE_SOCK: i64 = 1 << 9;
    const FS_MAKE_FIFO: i64 = 1 << 10;
    const FS_MAKE_BLOCK: i64 = 1 << 11;
    const FS_MAKE_SYM: i64 = 1 << 12;

    /// The handled-access set the sandbox subtracts from (v1 standard set).
    const HANDLED_ACCESS: i64 = FS_EXECUTE
        | FS_WRITE_FILE
        | FS_READ_FILE
        | FS_READ_DIR
        | FS_REMOVE_DIR
        | FS_REMOVE_FILE
        | FS_MAKE_CHAR
        | FS_MAKE_DIR
        | FS_MAKE_REG
        | FS_MAKE_SOCK
        | FS_MAKE_FIFO
        | FS_MAKE_BLOCK
        | FS_MAKE_SYM;

    /// Grants for write roots: read + write + create/remove + execute.
    const WRITE_ROOT_ACCESS: i64 = FS_EXECUTE
        | FS_WRITE_FILE
        | FS_READ_FILE
        | FS_READ_DIR
        | FS_REMOVE_DIR
        | FS_REMOVE_FILE
        | FS_MAKE_DIR
        | FS_MAKE_REG
        | FS_MAKE_SOCK
        | FS_MAKE_FIFO
        | FS_MAKE_SYM;
    /// Grants for read-only roots: reading only, never execute/make.
    const READ_ROOT_ACCESS: i64 = FS_READ_FILE | FS_READ_DIR;

    #[repr(C)]
    struct LandlockPathBeneathAttr {
        allowed_access: i64,
        parent_fd: libc::c_int,
    }

    /// Kernel ABI probe: `create_ruleset(NULL, 0, VERSION)` returns the
    /// highest supported ABI; pre-Landlock kernels fail (ENOSYS).
    pub fn probe_landlock() -> (bool, Option<u32>) {
        let got = unsafe {
            libc::syscall(
                LANDLOCK_CREATE_RULESET,
                std::ptr::null::<libc::c_void>(),
                0usize,
                LANDLOCK_CREATE_RULESET_VERSION,
            )
        };
        if got < 0 {
            (false, None)
        } else {
            (true, Some(got as u32))
        }
    }

    fn open_path_beneath_parent(path: &std::path::Path) -> Result<libc::c_int, std::io::Error> {
        if !path.is_dir() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("sandbox root {} is not a directory", path.display()),
            ));
        }
        let cstr = path.as_os_str().to_str().ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "non-utf8 sandbox root path",
            )
        })?;
        let cpath = std::ffi::CString::new(cstr)
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidInput, "nul in path"))?;
        let fd = unsafe { libc::open(cpath.as_ptr(), libc::O_PATH | libc::O_CLOEXEC) };
        if fd < 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(fd)
    }

    /// Build the Landlock ruleset: write roots granted full v1 access,
    /// extra read roots granted read-only. Runs in the child, before exec.
    /// A required (workspace) root that cannot be seen fails the setup —
    /// the sandbox never silently widens.
    pub fn build_ruleset(res: &ResolvedSandbox) -> Result<libc::c_int, String> {
        let ruleset_fd = unsafe {
            libc::syscall(
                LANDLOCK_CREATE_RULESET,
                std::ptr::null::<libc::c_void>(),
                0usize,
                0, // real ruleset creation (not the version query)
            )
        };
        if ruleset_fd < 0 {
            return Err(format!(
                "landlock_create_ruleset: {}",
                std::io::Error::last_os_error()
            ));
        }
        let ruleset_fd = ruleset_fd as libc::c_int;
        let mut failures: Vec<String> = Vec::new();
        let mut fatal = false;

        let grants: Vec<(&PathBuf, i64, bool)> = res
            .workspace_roots
            .iter()
            .map(|p| (p, WRITE_ROOT_ACCESS, true))
            .chain(res.read_roots.iter().map(|p| (p, READ_ROOT_ACCESS, false)))
            .collect();

        for (path, access, required) in grants {
            let canonical = match std::fs::canonicalize(path) {
                Ok(p) => p,
                Err(e) => {
                    failures.push(format!(
                        "{} {}: {e}",
                        if required { "required" } else { "optional" },
                        path.display()
                    ));
                    if required {
                        fatal = true;
                        break;
                    }
                    continue;
                }
            };
            match open_path_beneath_parent(&canonical) {
                Err(e) => {
                    failures.push(format!(
                        "{} {}: {e}",
                        if required { "required" } else { "optional" },
                        canonical.display()
                    ));
                    if required {
                        fatal = true;
                        break;
                    }
                    continue;
                }
                Ok(parent_fd) => {
                    let mut attr = LandlockPathBeneathAttr {
                        allowed_access: access,
                        parent_fd,
                    };
                    let r = unsafe {
                        libc::syscall(
                            LANDLOCK_ADD_RULE,
                            ruleset_fd,
                            LANDLOCK_RULE_PATH_BENEATH,
                            &mut attr as *mut LandlockPathBeneathAttr,
                            0usize,
                        )
                    };
                    unsafe { libc::close(parent_fd) };
                    if r < 0 {
                        let e = std::io::Error::last_os_error();
                        failures.push(format!(
                            "{} {}: {e}",
                            if required { "required" } else { "optional" },
                            canonical.display()
                        ));
                        if required {
                            required_root_registry.clear();
                            fatal = true;
                            break;
                        }
                    }
                }
            }
        }
        let _ = required_root_registry;
        if fatal {
            unsafe { libc::close(ruleset_fd) };
            return Err(format!("landlock rules: {}", failures.join("; ")));
        }
        Ok(ruleset_fd)
    }

    // ---- seccomp: deny internet sockets --------------------------------------

    /// seccomp_data layout: `{ nr @0 u32, arch @4 u32, ip @8 u64,
    /// args[0] @16 u64 (family lives in its low word on LE) }`.
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct BpfInstr {
        code: u16,
        jt: u8,
        jf: u8,
        k: u32,
    }

    const BPF_LD_W_ABS: u16 = 0x20;
    const BPF_JEQ: u16 = 0x15;
    const BPF_RET_K: u16 = 0x06;

    const OFF_NR: u32 = 0;
    const OFF_ARCH: u32 = 4;
    const OFF_ARG0_LO: u32 = 16;

    const SECCOMP_RET_ALLOW: u32 = 0x7fff_0000;
    const SECCOMP_RET_ERRNO_FLAG: u32 = 0x0005_0000;
    /// Denying internet sockets with -EAFNOSUPPORT keeps the command alive
    /// (curl et al report "unreachable"), matching the daemon's "syscalls
    /// that attempt forbidden operations will fail" posture.
    const EAFNOSUPPORT: u32 = 49;

    #[cfg(target_arch = "x86_64")]
    const AUDIT_ARCH: u32 = 0xC000_003E;
    #[cfg(target_arch = "aarch64")]
    const AUDIT_ARCH: u32 = 0xC000_00B7;

    #[cfg(target_arch = "x86_64")]
    const SECCOMP_SYSCALL_NR: i64 = 317;
    #[cfg(target_arch = "aarch64")]
    const SECCOMP_SYSCALL_NR: i64 = 386;

    #[cfg(target_arch = "x86_64")]
    const SYS_SOCKET: u32 = 41;
    #[cfg(target_arch = "aarch64")]
    const SYS_SOCKET: u32 = 198;

    const AF_INET: u32 = 2;
    const AF_INET6: u32 = 10;
    const AF_PACKET: u32 = 17;

    /// Only these Linux arches ship a compiled-in filter today. Others
    /// degrade with a recorded note (never silent).
    pub const SECCOMP_AVAILABLE: bool = cfg!(any(target_arch = "x86_64", target_arch = "aarch64"));

    /// Build + install the filter: `socket(AF_INET|AF_INET6|AF_PACKET)` ->
    /// -EAFNOSUPPORT; AF_UNIX etc. pass untouched. PR_SET_NO_NEW_PRIVS
    /// must already be set by the caller.
    ///
    /// Verified jump map (JEQ jt/jf count instructions forward from the
    /// next instruction):
    ///   0 LD  arch
    ///   1 JEQ AUDIT_ARCH jt=2->4, jf=0->2   (matching arch? load nr : deny)
    ///   2 RET ERRNO(49)                     (foreign arch: fail-closed)
    ///   3 LD  nr
    ///   4 JEQ SYS_SOCKET jt=2->7, jf=0->5   (socket? check family : allow)
    ///   5 RET ALLOW                         (all non-socket syscalls pass)
    ///   6 LD  args0_lo
    ///   7 JEQ AF_INET  jt=3->11, jf=0->8
    ///   8 JEQ AF_INET6 jt=2->11, jf=0->9
    ///   9 JEQ AF_PACKET jt=1->11, jf=0->10
    ///  10 RET ALLOW                         (AF_UNIX and friends)
    ///  11 RET ERRNO(49)                     (internet sockets denied)
    pub fn install_net_block() -> Result<(), String> {
        if !SECCOMP_AVAILABLE {
            return Err("seccomp: arch not covered by this build".into());
        }
        let program = [
            BpfInstr {
                code: BPF_LD_W_ABS,
                jt: 0,
                jf: 0,
                k: OFF_ARCH,
            },
            BpfInstr {
                code: BPF_JEQ,
                jt: 2,
                jf: 0,
                k: AUDIT_ARCH,
            },
            BpfInstr {
                code: BPF_RET_K,
                jt: 0,
                jf: 0,
                k: SECCOMP_RET_ERRNO_FLAG | EAFNOSUPPORT,
            },
            BpfInstr {
                code: BPF_LD_W_ABS,
                jt: 0,
                jf: 0,
                k: OFF_NR,
            },
            BpfInstr {
                code: BPF_JEQ,
                jt: 2,
                jf: 0,
                k: SYS_SOCKET,
            },
            BpfInstr {
                code: BPF_RET_K,
                jt: 0,
                jf: 0,
                k: SECCOMP_RET_ALLOW,
            },
            BpfInstr {
                code: BPF_LD_W_ABS,
                jt: 0,
                jf: 0,
                k: OFF_ARG0_LO,
            },
            BpfInstr {
                code: BPF_JEQ,
                jt: 3,
                jf: 0,
                k: AF_INET,
            },
            BpfInstr {
                code: BPF_JEQ,
                jt: 2,
                jf: 0,
                k: AF_INET6,
            },
            BpfInstr {
                code: BPF_JEQ,
                jt: 1,
                jf: 0,
                k: AF_PACKET,
            },
            BpfInstr {
                code: BPF_RET_K,
                jt: 0,
                jf: 0,
                k: SECCOMP_RET_ALLOW,
            },
            BpfInstr {
                code: BPF_RET_K,
                jt: 0,
                jf: 0,
                k: SECCOMP_RET_ERRNO_FLAG | EAFNOSUPPORT,
            },
        ];
        unsafe {
            let prog = libc::sock_fprog {
                len: program.len() as u16,
                filter: program.as_ptr().cast_mut().cast(),
            };
            let r = libc::syscall(
                SECCOMP_SYSCALL_NR,
                1isize, // SECCOMP_SET_MODE_FILTER
                0usize, // flags (no_new_privs already set)
                &prog as *const libc::sock_fprog,
            );
            if r < 0 {
                return Err(format!(
                    "seccomp filter: {}",
                    std::io::Error::last_os_error()
                ));
            }
        }
        Ok(())
    }
}

/// Spawn a program under a resolved sandbox on Linux, carrying the full
/// fallback contract:
///   off            → plain spawn, `Off` provenance
///   auto           → enforce; on unsupported host or child-side setup
///                    failure, retry unsandboxed with the reason recorded
///   strict         → enforce; unsupported host never reaches here
///                    (`plan_spawn` already rejected the spawn)
#[cfg(target_os = "linux")]
pub fn spawn_sandboxed(res: &ResolvedSandbox, program: &str, args: &[&str]) -> SpawnOutcome {
    let plan = match plan_spawn(res) {
        Ok(used) => used,
        Err(other) => return other,
    };
    if plan == SandboxUsed::UnsandboxedFallback {
        let mut fallback = std::process::Command::new(program);
        fallback.args(args);
        return match fallback.output() {
            Ok(out) => SpawnOutcome::Success(Spawned {
                sandbox: SandboxUsed::UnsandboxedFallback,
                stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
                stderr: format!(
                    "sandbox unsupported on this host; ran unsandboxed\n{}",
                    String::from_utf8_lossy(&out.stderr)
                ),
                exit_code: out.status.code().unwrap_or(-1),
            }),
            Err(e) => SpawnOutcome::Error {
                message: format!("spawn: {e}"),
            },
        };
    }

    let enforce = plan != SandboxUsed::Off;
    let run_spawn = || {
        let mut cmd = std::process::Command::new(program);
        cmd.args(args);
        if enforce {
            let res = res.clone();
            let want_net_block = plan == SandboxUsed::LandlockSeccomp;
            unsafe {
                use std::os::unix::process::CommandExt;
                cmd.pre_exec(move || {
                    // PR_SET_NO_NEW_PRIVS before restrict_self: the child
                    // can never regain dropped privileges.
                    if libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0 {
                        return Err(std::io::Error::last_os_error());
                    }
                    let ruleset_fd = linux::build_ruleset(&res).map_err(|e| {
                        std::io::Error::new(std::io::ErrorKind::PermissionDenied, e)
                    })?;
                    if libc::syscall(LANDLOCK_RESTRICT_SELF, ruleset_fd, 0usize) < 0 {
                        let e = std::io::Error::last_os_error();
                        libc::close(ruleset_fd);
                        return Err(e);
                    }
                    libc::close(ruleset_fd);
                    if want_net_block {
                        if !linux::SECCOMP_AVAILABLE {
                            // Recorded degradation, not silent: the note
                            // lands in the child's captured stderr.
                            let note = b"prism sandbox: seccomp unavailable on this arch; network block not applied\n";
                            let _ = unsafe {
                                libc::write(
                                    libc::STDERR_FILENO,
                                    note.as_ptr().cast(),
                                    note.len(),
                                )
                            };
                        } else {
                            linux::install_net_block().map_err(|e| {
                                std::io::Error::new(std::io::ErrorKind::PermissionDenied, e)
                            })?;
                        }
                    }
                    // Helper step 7/7: land in the declared workspace.
                    if let Some(root) = res.workspace_roots.first() {
                        let cwd = std::fs::canonicalize(root).unwrap_or_else(|_| root.clone());
                        std::env::set_current_dir(&cwd)?;
                    }
                    Ok(())
                });
            }
        }
        cmd.output()
    };

    match run_spawn() {
        Ok(out) => SpawnOutcome::Success(Spawned {
            sandbox: plan,
            stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
            exit_code: out.status.code().unwrap_or(-1),
        }),
        Err(spawn_error) => {
            if res.mode == SandboxingMode::Auto && enforce {
                // Child-side setup failed (ruleset/restrict). `auto`
                // retries unsandboxed with provenance; `strict` reports.
                let mut retry = std::process::Command::new(program);
                retry.args(args);
                match retry.output() {
                    Ok(out) => SpawnOutcome::Success(Spawned {
                        sandbox: SandboxUsed::UnsandboxedFallback,
                        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
                        stderr: format!(
                            "sandbox install failed ({spawn_error}); ran unsandboxed\n{}",
                            String::from_utf8_lossy(&out.stderr)
                        ),
                        exit_code: out.status.code().unwrap_or(-1),
                    }),
                    Err(e) => SpawnOutcome::Error {
                        message: format!("spawn: {e}"),
                    },
                }
            } else {
                SpawnOutcome::Error {
                    message: format!("spawn: {spawn_error}"),
                }
            }
        }
    }
}

// ---- guarded shell tool ------------------------------------------------------

/// `shell` tool for the agent loop carrying the resolved policy.
/// Guard → denylist rejection → enforced subprocess: the full
/// BackgroundShellSpawnResult surface the agent reads as observations.
#[cfg(all(target_os = "linux", feature = "native-transport"))]
pub struct GuardedShellTool {
    pub res: ResolvedSandbox,
}

#[cfg(all(target_os = "linux", feature = "native-transport"))]
impl crate::agent::Tool for GuardedShellTool {
    fn name(&self) -> &str {
        "shell"
    }

    fn description(&self) -> &str {
        "Run one shell command under the sandbox policy (admin denylist, workspace-only writes, optional network block). Input: the command string."
    }

    fn execute(&self, input: &str) -> String {
        let cmd = input.trim();
        if let Err(reason) = shell_guard(&self.res, cmd) {
            return outcome_str(&SpawnOutcome::Rejected { reason });
        }
        outcome_str(&spawn_sandboxed(&self.res, "/bin/sh", &["-c", cmd]))
    }
}
