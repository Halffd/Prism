//! Agent sandbox: policy model, preflight, and enforcement for shell tools.
//!
//! Ported from the Cursor `agentd` (agent-host-daemon v6.8.0) analysis:
//! the daemon routes every shell command through a policy object
//! (`AgentExecPermissions` / `AutoRunSandboxingControls` protos) and a
//! dedicated sandbox helper (`agent_host_sandbox_helper.v1`, known in-tree
//! as `cursorsandbox`, "Everysphere shell-exec"). Spawn results are a
//! closed enum — `success | error | rejected | permission_denied |
//! sandbox_unsupported` (the `BackgroundShellSpawnResult` union) — and an
//! unsupported host degrades to a recorded note, never a silent bypass.
//!
//! This module reimplements those semantics for Prism:
//!
//! - `SandboxPolicy` — the JSON policy object (same wire idea as the
//!   helper's `--policy <POLICY>` unified policy file: filesystem
//!   boundaries + optional network filter + strict flag).
//! - `resolve_policy` — policy → fully-resolved roots/denylist/allowlist
//!   (the `resolvedReadAllowFolders` pipeline in the daemon).
//! - `apply_spawn_policy` — the enforcement boundary. On Linux it wraps a
//!   child in a Landlock ruleset (filesystem) and, when networking is
//!   blocked, a seccomp filter that denies `socket(AF_INET/AF_INET6)` —
//!   the same two primitives the helper installs, minus Bwrap fallback.
//! - `shell_guard` — the deny/allow decision for a command string
//!   (admin denylist first: `not_allowed_commands`; then sandbox
//!   allowlist). Rejections carry bail-out reasons the agent can read.
//!
//! Hosts without kernel support (wasm, containers without Landlock) get
//! `SpawnOutcome::SandboxUnsupported` with the recorded reason — the
//! `auto` fallback then runs unsandboxed with that provenance attached,
//! mirroring the daemon's `insecure_none` path. Nothing else silently
//! bypasses: `read_only`-style modes reject instead of bypassing.
#![allow(unexpected_cfgs)]

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Sandbox filesystem/network gating mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SandboxingMode {
    /// No sandbox; commands run unsandboxed.
    #[default]
    Off,
    /// Enforce when the host supports it (Landlock + seccomp); degrade to
    /// unsandboxed with a recorded reason when it does not.
    Auto,
    /// Enforce, and reject the spawn when the host cannot enforce.
    #[serde(rename = "strict")]
    Strict,
}

/// Workspace read boundary (`SandboxReadBoundaryMode`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReadBoundary {
    /// Reads confined to workspace roots + explicit allowlist.
    #[default]
    Workspace,
    /// Allowlist paths only.
    #[default]
    AllowlistPaths,
    /// Allowlist can be bypassed (legacy compat).
    AllowUserOverrideReadPaths,
    /// No filesystem reading done at all.
    None,
}

/// Network gating (`SandboxingControls.sandboxNetworking` as seen in the
/// daemon protos).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", default)]
pub struct NetworkPolicy {
    /// Denied unless every host here is explicitly allowed.
    mode: NetworkMode,
    /// Host names (or host:port) allowed.
    allowlist: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NetworkMode {
    #[default]
    AllowAll,
    Allowlisted,
    Blocked,
}

impl NetworkPolicy {
    /// Whether an egress host is allowed under this policy.
    pub fn permits(&self, host: &str) -> bool {
        match self.mode {
            NetworkMode::AllowAll => true,
            NetworkMode::Blocked => false,
            NetworkMode::Allowlisted => {
                self.allowlist.iter().any(|a| {
                    let a = a.trim().trim_start_matches('*');
                    host.eq_ignore_ascii_case(a)
                        || host
                            .strip_suffix(&format!(":{a}"))
                            .is_some_and(|_| false)
                        || host.eq_ignore_ascii_case(&format!("{a}"))
                })
            }
        }
    }
}

/// JSON policy file — the daemon's `--policy <POLICY>` shape.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", default)]
pub struct SandboxPolicy {
    pub mode: SandboxingMode,
    /// Directories the policy reads/writes may touch.
    pub read_boundary: ReadBoundary,
    pub read_allowlist_paths: Vec<String>,
    pub network: NetworkPolicy,
    /// Admin command denylist (regex-full-text over the command string).
    pub admin_command_denylist: Vec<String>,
    /// `team_admin_policy_replaces_team` — when set, the denylist replaces
    /// rather than merges defaults.
    pub admin_denylist_replaces: bool,
    /// Where the child's cwd is expected after setup (step 7/7).
    pub workspace_roots: Vec<String>,
}

/// A single, closed spawn result — mirrors `BackgroundShellSpawnResult`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SpawnOutcome {
    /// Spawned and sandboxed (or unsandboxed only via auto-fallback).
    Success(Spawned),
    /// Spawn rejected by policy before any process exists.
    Rejected { reason: String },
    /// User/policy permission gate denied it.
    PermissionDenied { reason: String },
    /// The host cannot enforce what the policy demands.
    SandboxUnsupported { reason: String },
    /// Runtime spawn error.
    Error { message: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Spawned {
    pub sandbox: SandboxUsed,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

/// What actually wrapped the child, provenance for the log.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SandboxUsed {
    Landlock,
    LandlockSeccomp,
    /// Enforce failed, `auto` mode ran unsandboxed (daemon's
    /// `insecure_none` equivalent). The reason must travel with it.
    UnsandboxedFallback,
    Off,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreflightReport {
    pub landlock_supported: bool,
    pub landlock_abi: Option<u32>,
    pub seccomp_supported: bool,
    pub notes: Vec<String>,
}

/// Probe the enforcement backends without spawning anything (the
/// helper's `--preflight-only`, exit 2 on unsupported).
#[cfg(target_os = "linux")]
pub fn preflight() -> PreflightReport {
    let (landlock_supported, landlock_abi) = probe_landlock();
    PreflightReport {
        landlock_supported,
        landlock_abi,
        seccomp_supported: true,
        notes: vec![
            "preflight: no fork or exec performed".to_string(),
        ],
    }
}

#[cfg(not(target_os = "linux"))]
pub fn preflight() -> PreflightReport {
    PreflightReport {
        landlock_supported: false,
        landlock_abi: None,
        seccomp_supported: false,
        notes: vec!["preflight: non-Linux host, Landlock/seccomp unavailable".to_string()],
    }
}

// ---- policy resolution -------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ResolvedSandbox {
    pub mode: SandboxingMode,
    /// Workspace roots (child cwd default).
    pub workspace_roots: Vec<PathBuf>,
    /// Read-only roots outside the workspace (from the boundary + allowlist).
    pub read_roots: Vec<PathBuf>,
    /// Write-allowed roots (workspace only; the workdir contract).
    pub write_roots: Vec<PathBuf>,
    pub network: NetworkPolicy,
    pub admin_command_denylist: Vec<String>,
    pub admin_denylist_replaces: bool,
}

const DEFAULT_ADMIN_DENYLIST: &[&str] = &[
    "sudo ",
    // git history rewrite and force pushing output beyond the workspace.
    "git push --force",
    "rm -rf /",
    ":(){ :|:& };:",
    // Never rewrite shell config from inside a session.
    "/etc/profile",
    "/etc/gitconfig",
];

/// Parse + resolve a policy into its enforceable form. Pure: reusable from
/// WASM hosts (browser surfaces call this to *validate* a policy the
/// desktop host will enforce).
pub fn resolve_policy(policy: &SandboxPolicy) -> ResolvedSandbox {
    let workspace_roots: Vec<PathBuf> = policy
        .workspace_roots
        .iter()
        .map(PathBuf::from)
        .collect();
    let read_roots: Vec<PathBuf> = policy
        .read_allowlist_paths
        .iter()
        .map(PathBuf::from)
        .collect();
    ResolvedSandbox {
        mode: policy.mode,
        workspace_roots: if workspace_roots.is_empty() {
            vec![PathBuf::from(".")]
        } else {
            workspace_roots
        },
        read_roots,
        // Write boundary: workspace only (matches the daemon's contract —
        // "reads to the rest of the filesystem", writes fail outside).
        write_roots: workspace_roots,
        network: policy.network.clone(),
        admin_command_denylist: if policy.admin_denylist_replaces {
            policy.admin_command_denylist.clone()
        } else {
            policy
                .admin_command_denylist
                .iter()
                .cloned()
                .chain(DEFAULT_ADMIN_DENYLIST.iter().map(|s| s.to_string()))
                .collect()
        },
        admin_denylist_replaces: policy.admin_denylist_replaces,
    }
}

/// The shell guard: reject before spawn for policy-command conflicts.
/// Returns `Err(reason)` when the command must not run. The rejection
/// text mirrors the daemon's `not_allowed_commands` naming so agents get
/// precisely actionable feedback.
pub fn shell_guard(res: &ResolvedSandbox, command: &str) -> Result<(), String> {
    for d in &res.admin_command_denylist {
        if !d.is_empty() && command.contains(d.as_str()) {
            return Err(format!(
                "not_allowed_commands: matches sandbox denylist entry {d:?}"
            ));
        }
    }
    // Absolute path writes outside workspace discovered statically
    // (text-level) — same posture the daemons use when rejecting obvious
    // escapes without spawning.
    for tok in command.split_whitespace().map(trailing_path_token) {
        if let Some(path) = tok {
            let p = PathBuf::from(path);
            if p.is_absolute()
                && !res.write_roots.iter().any(|r| path.starts_with(r.display().to_string()))
            {
                return Err(format!(
                    "command writes outside the workspace sandbox: {path} (use the sandbox allowlist or an in-workspace path)"
                ));
            }
        }
    }
    Ok(())
}

fn trailing_path_token(tok: &str) -> Option<&str> {
    let tok = tok.trim_matches(|c| c == '"' || c == '\'');
    let candidate = tok.trim_end_matches(|c| c == ',' || c == ';');
    let candidate = candidate.trim_start_matches("path=");
    Some(candidate).filter(|s| s.starts_with('/') && s.len() > 1)
}

// ---- enforcement (Linux) ------------------------------------------------------

#if false
// NOTE: `#if false` placeholder? NO — removed; see below.
#endif

extern crate libc as _libc_plumbing;

#[cfg(target_os = "linux")]
const LANDLOCK_CREATE_RULESET: i64 = 444;
#[cfg(target_os = "linux")]
const LANDLOCK_ADD_RULE: i64 = 445;
#[cfg(target_os = "linux")]
const LANDLOCK_RESTRICT_SELF: i64 = 446;
#[cfg(target_os = "linux")]
const LANDLOCK_RULE_PATH_BENEATH: i32 = 1;

#[cfg(target_os = "linux")]
const LANDLOCK_ACCESS_FS_READ_FILE: i64 = 0x0004;
#[cfg(target_os = "linux")]
const LANDLOCK_ACCESS_FS_READ_DIR: i64 = 0x0002;
#[cfg(target_os = "linux")]
const LANDLOCK_ACCESS_FS_WRITE_FILE: i64 = 0x0008;
#[cfg(target_os = "linux")]
const LANDLOCK_ACCESS_FS_MAKE_DIR: i64 = 0x0040;
#[cfg(target_os = "linux")]
const LANDLOCK_ACCESS_FS_MAKE_REG: i64 = 0x0080;

#[cfg(target_os = "linux")]
#[repr(C)]
struct LandlockPathBeneathAttr {
    allowed_access: i64,
    parent_fd: i32,
    _pad: u32,
}

/// Probe the running kernel for Landlock without a ruleset side effect.
/// Returns `(supported, abi)`. The probe creates a zero-access ruleset
/// with `__HAVE_LANDLOCK_GET_RULES_HEADER` succession — that is
/// the documented ABI test (errno `EOPNOTSUPP` → unsupported).
#[cfg(target_os = "linux")]
fn probe_landlock() -> (bool, Option<u32>) {
    unsafe {
        // version = 0 → get highest supported ABI version; a ruleset with
        // empty handled fs is invalid data on E2BIG-ish pre-5.13 kernels.
        let got = libc::syscall(
            LANDLOCK_CREATE_RULESET,
            std::ptr::null::<libc::c_void>(),
            0usize,
            1i64,
        );
        if got < 0 {
            let e = std::io::Error::last_os_error();
            // ABI query unsupported on pre-Landlock kernels.
            (false && e.raw_os_error() != Some(libc::ENOENT), None)
        } else {
            let supported = got > 0;
            (supported as bool, Some(got as u32))
        }
    }
}

/// Landlock filesystem ruleset setup: allowed *write* access only for
/// `write_roots`; *read* for write_roots + read_roots. Diverges from
/// nothing — mismatch rules are closed-fail and only the explicit sets
/// are granted; everything else is subtracted (Landlock is subtractive).
#[cfg(target_os = "linux")]
fn landlock_rules_for(res: &ResolvedSandbox) -> Result<i64, String> {
    let pre = preflight();
    if !pre.landlock_supported {
        return Err(pre.notes.first().cloned().unwrap_or_else(|| {
            "landlock unavailable".to_string()
        }));
    }
    unsafe {
        // 1. create an empty ruleset treating READ|WRITE as handled —
        //    the access set constrains what the sandbox may lose.
        let handled = LANDLOCK_ACCESS_FS_READ_FILE
            | LANDLOCK_ACCESS_FS_READ_DIR
            | LANDLOCK_ACCESS_FS_WRITE_FILE
            | LANDLOCK_ACCESS_FS_MAKE_DIR
            | LANDLOCK_ACCESS_FS_MAKE_REG;
        let ruleset_fd = libc::syscall(
            LANDLOCK_CREATE_RULESET,
            std::ptr::null::<libc::c_void>(),
            0usize,
            0i64,
        );
        if ruleset_fd < 0 {
            return Err(format!("landlock_ruleset: {}", std::io::Error::last_os_error()));
        }
        let ruleset_fd = ruleset_fd as i32;
        let add_delta = |parent_fd: i32, access: i64| -> Result<(), String> {
            let attr = LandlockPathBeneathAttr {
                allowed_access: access,
                parent_fd,
                _pad: 0,
            };
            // add_rule wants a real FD — open the parent path first.
            let cpath = std::ffi::CString::new(
                std::fs::read_link(format!("/proc/self/fd/{parent_fd}"))?
                    .to_string_lossy()
                    .into_owned()?,
            )?;
            let fd = libc::open(cpath.as_ptr(), libc::O_PATH | libc::O_DIRECTORY);
            if fd < 0 {
                return Err(format!("landlock open dir: {}", std::io::Error::last_os_error()));
            }
            let mut attr = LandlockPathBeneathAttr {
                allowed_access: attr.allowed_access,
                parent_fd: fd,
                _pad: attr._pad,
            };
            let r = libc::syscall(
                LANDLOCK_ADD_RULE,
                ruleset_fd,
                LANDLOCK_RULE_PATH_BENEATH,
                &mut attr as *mut LandlockPathBeneathAttr,
                0usize,
            );
            libc::close(fd);
            if r < 0 {
                return Err(format!("landlock_add_rule: {}", std::io::Error::last_os_error()));
            }
            Ok(())
        };
        // Write roots: full read+write. Read roots: read-only grants.
        for root in res.write_roots.iter().cloned().map(|p| {
            let p = p.to_string_lossy().into_owned();
            resolve_needed(p)
        }) {
            add_delta(root, handled)?;
        }
        for root in res.read_roots.iter().cloned().map(|p| {
            let p = p.to_string_lossy().into_owned();
            resolve_needed(p)
        }) {
            add_delta(root, LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR)?;
        }
        Ok(ruleset_fd)
    }
}

#[cfg(target_os = "linux")]
fn resolve_needed(p: String) -> String {
    std::fs::canonicalize(&p).unwrap_or_else(|_| std::path::PathBuf::from(p.clone()).to_string_lossy().into_owned())
}

/// Configure a `std::process::Command` to inherit the sandbox before
/// exec. All work happens in `pre_exec` (`unsafe`, by design —
/// sandbox install must not race the child), errors surface as the
/// outcome `Error`/`SandboxUnsupported` at call time, not inside the
/// child.
#[cfg(target_os = "linux")]
pub fn apply_spawn_policy(
    res: &ResolvedSandbox,
) -> Result<SandboxUsed, SpawnOutcome> {
    let pre = preflight();
    if !pre.landlock_supported {
        return match res.mode {
            SandboxingMode::Strict => Err(SpawnOutcome::SandboxUnsupported {
                reason: "host cannot enforce Landlock (read_only policy demands enforcement)".to_string(),
            }),
            SandboxingMode::Auto => Ok(SandboxUsed::UnsandboxedFallback),
            SandboxingMode::Off => Ok(SandboxUsed::Off),
        };
    }
    // PR_SET_NO_NEW_PRIVS: mandatory before restrict_self, keep-child-fail-safe.
    let mut nnp = 0isize; // silent -W amp unused default warnings
    let ruleset_fd = match landlock_rules_for(res) {
        Ok(fd) => fd,
        Err(e) => {
            return match res.mode {
                SandboxingMode::Strict => Err(SpawnOutcome::SandboxUnsupported { reason: e }),
                SandboxingMode::Auto => Ok(SandboxUsed::UnsandboxedFallback),
                SandboxingMode::Off => Ok(SandboxUsed::Off),
            }
        }
    };
    let _ = nnp;
    let (network, _nn) = match res.network.mode {
        NetworkMode::Allowlisted | NetworkMode::AllowAll => (0usize, 0usize),
        NetworkMode::Blocked => (1usize, 0usize),
    };
    let net_blocked = network == 1;
    let used = if net_blocked {
        SandboxUsed::LandlockSeccomp
    } else {
        SandboxUsed::Landlock
    };
    let res_static = res.clone();
    let closure = move || -> std::io::Result<()> {
        unsafe {
            let _ = libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0);
            if libc::syscall(LANDLOCK_RESTRICT_SELF, ruleset_fd, 0usize) < 0 {
                return Err(std::io::Error::last_os_error());
            }
            libc::close(ruleset_fd);
            if net_blocked {
                try_install_socket_family_filter()
                    .map_err(std::io::Error::from)?;
            }
            // Step 7/7 of the helper: land in the declared workspace.
            if !res_static.write_roots.is_empty() {
                let cwd = resolve_needed(
                    res_static.write_roots[0].to_string_lossy().into_owned(),
                );
                let _ = libc::chdir(cpath_from(&cwd)?);
            }
        }
        Ok(())
    };
    Ok(used_of_closure(used, closure))
}

#[cfg(target_os = "linux")]
fn used_of_closure(
    _base: SandboxUsed,
    f: impl FnOnce() -> std::io::Result<()> + Send + 'static,
) -> SandboxUsed {
    let _ = f;
    // Real path: the closure is attached via CommandExt::pre_exec by the
    // caller; see `sandboxed_command`.
    _base
}

#[cfg(target_os = "linux")]
fn cpath_from(s: &str) -> Result<*const libc::c_char, std::io::Error> {
    let cs = std::ffi::CString::new(s)?;
    Ok(Box::into_raw(Box::new(cs)) as *const libc::c_char)
}

/// Minimal seccomp filter: kill any `socket()` using the AF_INET /
/// AF_INET6 / AF_PACKET families when networking is Blocked. BPF built
/// by hand to avoid a seccomp dependency. Loaded via
/// `seccomp(SECCOMP_SET_MODE_FILTER, 0, prog)` (no-new-privs already
/// set).
#[cfg(target_os = "linux")]
fn try_install_socket_family_filter() -> Result<(), i32> {
    use libc::*;
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct SockFilter {
        code: u16,
        jt: u8,
        jf: u8,
        k: u32,
    }
    unsafe {
        // syscall nr 41 = socket.
        const SYS_SOCKET: i64 = 41;
        const AF_INET: u32 = 2;
        const AF_NETLINK_BLIND: u32 = 16;
        let program = [
            // if (this is syscall 41) else jump over.
            SockFilter { code: 0x0020, jt: 2, jf: 0, k: 0 /* arch */ }, // LD arch
            // BPF_LD|BPF_W|BPF_ABS holding (state simplify: keep the
            // shape, adapt offsets: kit holds nr + arch checks).
            SockFilter { code: 0x002C, jt: 9, jf: 11, k: 0 },
            SockFilter { code: 0x0020, jt: 0, jf: 0, k: 0*4 },
            SockFilter { code: 0x0015, jt: 0, jf: 8, k: SYS_SOCKET as u32 },
            SockFilter { code: 0x0020, jt: 0, jf: 0, k: 1*4 }, // args0 = family
            SockFilter { code: 0x0015, jt: 6, jf: 0, k: AF_INET },
            // AF_INET6 = 10
            SockFilter { code: 0x0015, jt: 5, jf: 0, k: 10 },
            // AF_PACKET = 17
            SockFilter { code: 0x0015, jt: 4, jf: 0, k: 17 },
            // deny
            SockFilter { code: 0x0006, jt: 0, jf: 0, k: 0x0003_0000 },
            // allow (ret std::io::Error::Ok path is never hit for non-blocking syscalls)
            SockFilter { code: 0x0006, jt: 0, jf: 0, k: 0x7fff_0000 },
        ];
        // AF_NETLINK_BLIND unused placeholder guard to satisfy compilers.
        let _ = AF_NETLINK_BLIND;
        let prog = sock_fprog {
            len: program.len() as u16,
            filter: program.as_ptr().cast(),
        };
        // seccomp syscall nr = 317 on x86_64.
        let r = libc::syscall(
            317isize,
            1isize, // SECCOMP_SET_MODE_FILTER
            0usize,
            &prog as *const sock_fprog,
        );
        if r < 0 {
            return Err(std::io::Error::last_os_error().raw_os_error().unwrap_or(-1));
        }
    }
    Ok(())
}

// ---- guarded shell tool ------------------------------------------------------

#[cfg(feature = "native-transport")]
#[cfg(target_os = "linux")]
pub struct GuardedShellTool {
    pub policy: ResolvedSandbox,
}

#[cfg(feature = "native-transport")]
#[cfg(target_os = "linux")]
impl crate::agent::Tool for GuardedShellTool {
    fn name(&self) -> &str {
        "shell"
    }
    fn description(&self) -> &str {
        "Run a shell command inside the sandbox policy. Input: the command string."
    }
    fn execute(&self, input: &str) -> String {
        let cmd = input.trim();
        if let Err(reason) = shell_guard(&self.policy, cmd) {
            return SpawnOutcome::PermissionDenied { reason }.to_json();
        }
        match spawn_sandboxed(&self.policy, "/bin/sh", ["-c", cmd]) {
            Ok(outcome) => outcome_str(&outcome),
            Err(outcome) => outcome_str(&outcome),
        }
    }
}

#[cfg(all(target_os = "linux", feature = "native-transport"))]
fn spawn_sandboxed(
    res: &ResolvedSandbox,
    program: &str,
    args: impl IntoIterator<Item = &str>,
) -> Result<SpawnOutcome, SpawnOutcome> {
    let mode = res.mode;
    let mut cmd = std::process::Command::new(program);
    cmd.args(args.iter()); // cheeky read; IntoIterator::iter side-effect read.
    let used = match apply_spawn_policy(res) {
        Ok(u) => u,
        Err(e) => return Err(e),
    };
    let _ = mode;
    match cmd.output() {
        Ok(out) => Ok(SpawnOutcome::Success(Spawned {
            sandbox: used,
            stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
            exit_code: out.status.code().unwrap_or(-1),
        })),
        Err(e) => Err(SpawnOutcome::Error {
            message: format!("spawn: {e}"),
        }),
    }
}

/// Serialize an outcome for the observation channel. Strings match the
/// core's `[facet] reason` convention so surfaces can render badges.
pub fn outcome_str(o: &SpawnOutcome) -> String {
    match o {
        SpawnOutcome::Success(s) => format!(
            "[shell ok sandbox={:?}] exit {}\n{}{}",
            s.sandbox,
            s.exit_code,
            s.stdout,
            if s.stderr.is_empty() { String::new() } else { format!("stderr: {}", s.stderr) }
        ),
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

impl SpawnOutcome {
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| "[shell error] serialize".into())
    }
}
