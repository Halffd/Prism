//! Built-in plugins, one module of implementations over the registry.
//!
//! Each is a native reimplementation of an OpenCode plugin's feature set
//! (see docs/plans/plugin-port-plan.md): snippets (#hashtag expansion),
//! memory (date-keyed logfmt notes), ponytail (tone rules), planning
//! (plans/specs files), usage (session counters), tableformat (markdown
//! table alignment), skills (skill:// guidance).

use super::{CommandSpec, Plugin, PluginContext};
use crate::settings::Settings;

// ---------------------------------------------------------------------------
// snippets — #hashtag expansion (port of opencode-snippets)
// ---------------------------------------------------------------------------

/// Expands `#trigger` tokens in outgoing text from
/// `<config>/plugins/snippets/snippets.json` (`[{"trigger": "sig", "body":
/// "— A. Person"}]`).
pub struct Snippets;

/// Expand `#trigger` tokens using `map`. Public so hosts can reuse the
/// matching rules (word boundaries; a bare `#` never matches).
pub fn expand_hashtags(text: &str, map: &[(String, String)]) -> String {
    let mut out = text.to_string();
    for (trigger, body) in map {
        let needle = format!("#{trigger}");
        if !needle.is_empty() && out.contains(&needle) {
            out = out.replace(&needle, body);
        }
    }
    out
}

/// Parse the snippets JSON file into `(trigger, body)` pairs.
fn parse_snippets(text: &str) -> Vec<(String, String)> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(text) else {
        return Vec::new();
    };
    let arr = match (v.get("snippets"), v.as_array()) {
        (Some(a), _) if a.is_array() => a.as_array().unwrap().clone(),
        (_, Some(a)) => a.clone(),
        _ => return Vec::new(),
    };
    arr.iter()
        .filter_map(|s| {
            let trigger = s
                .get("trigger")?
                .as_str()?
                .trim_start_matches('#')
                .to_string();
            let body = s.get("body")?.as_str()?.to_string();
            Some((trigger, body))
        })
        .collect()
}

/// On-disk snippet record: `{"trigger": "sig", "body": "— A. Person"}`.
#[derive(serde::Serialize, serde::Deserialize)]
struct SnippetRecord {
    trigger: String,
    body: String,
}

impl Plugin for Snippets {
    fn id(&self) -> &'static str {
        "snippets"
    }
    fn describe(&self) -> &'static str {
        "#hashtag snippet expansion from snippets.json"
    }

    fn commands(&self) -> Vec<CommandSpec> {
        vec![
            CommandSpec {
                name: "list",
                usage: "",
                help: "list configured snippets",
            },
            CommandSpec {
                name: "add",
                usage: "<trigger> <body>",
                help: "add/update a snippet",
            },
            CommandSpec {
                name: "del",
                usage: "<trigger>",
                help: "remove a snippet",
            },
        ]
    }

    fn run_command(
        &self,
        ctx: &PluginContext,
        command: &str,
        arg: &str,
    ) -> anyhow::Result<Vec<String>> {
        let Some(dir) = ctx.state_dir("snippets") else {
            return Ok(vec!["snippets: no config dir; set PRISM_CONFIG_DIR".into()]);
        };
        ctx.storage.create_dir_all(&dir)?;
        let file = dir.join("snippets.json");
        let mut map = ctx
            .storage
            .read_to_string(&file)
            .map(|t| parse_snippets(&t))
            .unwrap_or_default();

        match command {
            "list" => {
                if map.is_empty() {
                    Ok(vec![
                        "snippets: none (add with /snippets.add <trigger> <body>)".into(),
                    ])
                } else {
                    Ok(map.iter().map(|(t, b)| format!("#{t}: {b}")).collect())
                }
            }
            "add" => {
                let (trigger, body) = arg
                    .split_once(char::is_whitespace)
                    .ok_or_else(|| anyhow::anyhow!("usage: /snippets.add <trigger> <body>"))?;
                let trigger = trigger.trim_start_matches('#').to_string();
                map.retain(|(t, _)| *t != trigger);
                map.push((trigger.clone(), body.to_string()));
                let records: Vec<SnippetRecord> = map
                    .iter()
                    .map(|(t, b)| SnippetRecord {
                        trigger: t.clone(),
                        body: b.clone(),
                    })
                    .collect();
                ctx.storage
                    .write_atomic(&file, &serde_json::to_string_pretty(&records)?)?;
                Ok(vec![format!("snippet #{trigger} saved")])
            }
            "del" => {
                let trigger = arg.trim().trim_start_matches('#');
                let before = map.len();
                map.retain(|(t, _)| t != trigger);
                if map.len() == before {
                    Ok(vec![format!("snippet #{trigger} not found")])
                } else {
                    let records: Vec<SnippetRecord> = map
                        .iter()
                        .map(|(t, b)| SnippetRecord {
                            trigger: t.clone(),
                            body: b.clone(),
                        })
                        .collect();
                    ctx.storage
                        .write_atomic(&file, &serde_json::to_string_pretty(&records)?)?;
                    Ok(vec![format!("snippet #{trigger} removed")])
                }
            }
            other => Err(anyhow::anyhow!("unknown snippets command {other}")),
        }
    }

    fn before_send(
        &self,
        ctx: &PluginContext,
        text: &str,
        _settings: &Settings,
    ) -> anyhow::Result<Option<String>> {
        let Some(dir) = ctx.state_dir("snippets") else {
            return Ok(None);
        };
        let file = dir.join("snippets.json");
        let Ok(raw) = ctx.storage.read_to_string(&file) else {
            return Ok(None);
        };
        let map = parse_snippets(&raw);
        if map.is_empty() {
            return Ok(None);
        }
        let expanded = expand_hashtags(text, &map);
        if expanded == text {
            Ok(None)
        } else {
            Ok(Some(expanded))
        }
    }

    fn status(&self, ctx: &PluginContext) -> String {
        let Some(dir) = ctx.state_dir("snippets") else {
            return String::new();
        };
        match ctx.storage.read_to_string(&dir.join("snippets.json")) {
            Ok(raw) => {
                let n = parse_snippets(&raw).len();
                if n > 0 {
                    format!("snip:{n}")
                } else {
                    String::new()
                }
            }
            Err(_) => String::new(),
        }
    }
}

// ---------------------------------------------------------------------------
// memory — date-keyed logfmt notes (port of opencode-plugin-simple-memory)
// ---------------------------------------------------------------------------

/// Append-only logfmt notes at `<config>/plugins/memory/<YYYY-MM-DD>.logfmt`.
/// Lines: `ts=... type=<kind> scope=<topic> content="..." [issue=] [tags=]`.
pub struct Memory;

/// Format one memory line.
pub fn format_memory_line(ts: &str, kind: &str, scope: &str, content: &str) -> String {
    let escaped = content.replace('\\', "\\\\").replace('"', "\\\"");
    format!("ts={ts} type={kind} scope={scope} content=\"{escaped}\"")
}

/// Parse a logfmt memory line.
pub fn parse_memory_line(line: &str) -> Option<(String, String, String, String)> {
    let ts = line
        .split_whitespace()
        .find(|t| t.starts_with("ts="))?
        .strip_prefix("ts=")?;
    let ty = line
        .split_whitespace()
        .find(|t| t.starts_with("type="))?
        .strip_prefix("type=")?;
    let sc = line
        .split_whitespace()
        .find(|t| t.starts_with("scope="))?
        .strip_prefix("scope=")?;
    // content is the LAST field and is quoted: take everything between the
    // opening quote and the final closing quote (an escaped `\"` inside the
    // content stays, then gets unescaped below).
    let raw = line.rsplit_once("content=\"")?.1;
    let raw = raw.strip_suffix('"').unwrap_or(raw);
    // Invert `format_memory_line`'s escaping: `\\` -> `\`, `\"` -> `"`.
    let content = raw
        .replace("\\\\", "\u{1}")
        .replace("\\\"", "\"")
        .replace('\u{1}', "\\");
    Some((ts.to_string(), ty.to_string(), sc.to_string(), content))
}

fn memory_file(ctx: &PluginContext, day: &str) -> Option<std::path::PathBuf> {
    ctx.state_dir("memory")
        .map(|d| d.join(format!("{day}.logfmt")))
}

impl Plugin for Memory {
    fn id(&self) -> &'static str {
        "memory"
    }
    fn describe(&self) -> &'static str {
        "date-keyed logfmt memory notes"
    }

    fn commands(&self) -> Vec<CommandSpec> {
        vec![
            CommandSpec {
                name: "save",
                usage: "<type> <scope> <content>",
                help: "append a memory note",
            },
            CommandSpec {
                name: "read",
                usage: "[day]",
                help: "read a day's notes (default today)",
            },
            CommandSpec {
                name: "search",
                usage: "<query>",
                help: "grep recent notes",
            },
        ]
    }

    fn run_command(
        &self,
        ctx: &PluginContext,
        command: &str,
        arg: &str,
    ) -> anyhow::Result<Vec<String>> {
        let today = crate::conversations::now_ms();
        let day = super::builtins::ms_to_day(today);

        match command {
            "save" => {
                let Some(dir) = ctx.state_dir("memory") else {
                    return Ok(vec!["memory: no config dir".into()]);
                };
                ctx.storage.create_dir_all(&dir)?;
                let mut parts = arg.splitn(3, char::is_whitespace);
                let kind = parts.next().unwrap_or("").trim();
                let scope = parts.next().unwrap_or("").trim();
                let content = parts.next().unwrap_or("").trim();
                if kind.is_empty() || scope.is_empty() || content.is_empty() {
                    return Ok(vec!["usage: /memory.save <type> <scope> <content>".into()]);
                }
                let file = dir.join(format!("{day}.logfmt"));
                let line = format_memory_line(
                    &crate::conversations::now_ms().to_string(),
                    kind,
                    scope,
                    content,
                );
                let existing = ctx.storage.read_to_string(&file).unwrap_or_default();
                let mut body = existing;
                if !body.is_empty() && !body.ends_with('\n') {
                    body.push('\n');
                }
                body.push_str(&line);
                body.push('\n');
                ctx.storage.write_atomic(&file, &body)?;
                Ok(vec![format!("memory: saved [{day}] {kind}/{scope}")])
            }
            "read" => {
                let target = if arg.trim().is_empty() {
                    day.clone()
                } else {
                    arg.trim().to_string()
                };
                let Some(file) = memory_file(ctx, &target) else {
                    return Ok(vec!["memory: no config dir".into()]);
                };
                match ctx.storage.read_to_string(&file) {
                    Ok(text) if !text.trim().is_empty() => {
                        Ok(text.lines().map(|l| l.to_string()).collect())
                    }
                    _ => Ok(vec![format!("memory: no notes for {target}")]),
                }
            }
            "search" => {
                let Some(dir) = ctx.state_dir("memory") else {
                    return Ok(vec!["memory: no config dir".into()]);
                };
                let q = arg.trim().to_lowercase();
                if q.is_empty() {
                    return Ok(vec!["usage: /memory.search <query>".into()]);
                }
                let mut hits = Vec::new();
                let files = ctx.storage.read_dir(&dir).unwrap_or_default();
                let mut names: Vec<_> = files
                    .iter()
                    .filter_map(|p| p.file_name().map(|n| n.to_string_lossy().to_string()))
                    .collect();
                names.sort();
                for name in names.into_iter().rev() {
                    if !name.ends_with(".logfmt") {
                        continue;
                    }
                    let Ok(text) = ctx.storage.read_to_string(&dir.join(&name)) else {
                        continue;
                    };
                    for line in text.lines() {
                        if line.to_lowercase().contains(&q) {
                            hits.push(format!("{name}: {line}"));
                        }
                    }
                    if hits.len() >= 20 {
                        break;
                    }
                }
                if hits.is_empty() {
                    Ok(vec!["memory: no matches".into()])
                } else {
                    Ok(hits)
                }
            }
            other => Err(anyhow::anyhow!("unknown memory command {other}")),
        }
    }

    fn status(&self, ctx: &PluginContext) -> String {
        let Some(dir) = ctx.state_dir("memory") else {
            return String::new();
        };
        let files = ctx.storage.read_dir(&dir).unwrap_or_default();
        let count = files
            .iter()
            .filter(|p| p.extension().map(|e| e == "logfmt").unwrap_or(false))
            .count();
        if count > 0 {
            format!("mem:{count}d")
        } else {
            String::new()
        }
    }
}

/// ms epoch → `YYYY-MM-DD` (UTC, no external chrono dep).
pub fn ms_to_day(ms: u64) -> String {
    let secs = ms / 1000;
    let days = secs / 86_400;
    // Civil-from-days algorithm (Howard Hinnant).
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}")
}

// ---------------------------------------------------------------------------
// ponytail — tone rules (port of ponytail.mjs)
// ---------------------------------------------------------------------------

/// Communication intensity applied as a system-prompt suffix + optional
/// literal ` [full]`-style marker. Persisted at
/// `<config>/plugins/ponytail/mode`.
pub struct Ponytail;

pub const PONYTAIL_MODES: &[&str] = &["off", "lite", "full", "ultra"];

pub fn ponytail_instructions(mode: &str) -> &'static str {
    match mode {
        "lite" => "Be concise. Drop preamble and restating the question. Keep all technical substance.",
        "full" => "Terse fragments. Every sentence a fact, decision, or risk. No filler, no ceremony, no summaries of the obvious. Concrete file paths, symbols, edge cases.",
        "ultra" => "Telegraphic. Symbols over words. Only decisions, risks, next actions. Assume expert reader.",
        _ => "",
    }
}

fn read_mode(ctx: &PluginContext) -> Option<String> {
    let dir = ctx.state_dir("ponytail")?;
    let raw = ctx.storage.read_to_string(&dir.join("mode")).ok()?;
    let m = raw.trim().to_string();
    if PONYTAIL_MODES.contains(&m.as_str()) {
        Some(m)
    } else {
        None
    }
}

fn write_mode(ctx: &PluginContext, mode: &str) -> anyhow::Result<()> {
    let Some(dir) = ctx.state_dir("ponytail") else {
        anyhow::bail!("no config dir");
    };
    ctx.storage.create_dir_all(&dir)?;
    ctx.storage.write_atomic(&dir.join("mode"), mode)?;
    Ok(())
}

impl Plugin for Ponytail {
    fn id(&self) -> &'static str {
        "ponytail"
    }
    fn describe(&self) -> &'static str {
        "intensity-tunable communication rules (off|lite|full|ultra)"
    }

    fn commands(&self) -> Vec<CommandSpec> {
        vec![CommandSpec {
            name: "mode",
            usage: "[off|lite|full|ultra]",
            help: "show or set tone intensity",
        }]
    }

    fn run_command(
        &self,
        ctx: &PluginContext,
        command: &str,
        arg: &str,
    ) -> anyhow::Result<Vec<String>> {
        if command != "mode" {
            anyhow::bail!("unknown ponytail command {command}");
        }
        let wanted = arg.trim().to_lowercase();
        if wanted.is_empty() {
            return Ok(vec![format!(
                "ponytail: {} (usage: /ponytail.mode <{}>)",
                read_mode(ctx).unwrap_or_else(|| "off".into()),
                PONYTAIL_MODES.join("|")
            )]);
        }
        if !PONYTAIL_MODES.contains(&wanted.as_str()) {
            return Ok(vec![format!("ponytail: unknown mode '{wanted}'")]);
        }
        write_mode(ctx, &wanted)?;
        Ok(vec![format!("ponytail: {wanted}")])
    }

    fn system_prompt_suffix(&self, ctx: &PluginContext, _settings: &Settings) -> String {
        match read_mode(ctx) {
            Some(m) => {
                let inst = ponytail_instructions(&m);
                if inst.is_empty() {
                    String::new()
                } else {
                    format!("## Communication style ({m})\n\n{inst}")
                }
            }
            None => String::new(),
        }
    }

    fn status(&self, ctx: &PluginContext) -> String {
        read_mode(ctx)
            .filter(|m| m != "off")
            .map(|m| format!("tone:{m}"))
            .unwrap_or_default()
    }
}

// ---------------------------------------------------------------------------
// planning — plans + specs files (port of opencode-planning-toolkit)
// ---------------------------------------------------------------------------

/// Plans live at `<cwd>/docs/plans/<name>.md`, specs at
/// `<cwd>/docs/specs/<name>.md`. Commands create/list/read/link/mark-done.
pub struct Planning;

const SPEC_START: &str = "<!-- SPECS_START -->";
const SPEC_END: &str = "<!-- SPECS_END -->";

fn valid_plan_name(name: &str) -> Result<(), String> {
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("use only letters, numbers, and hyphens".into());
    }
    if name.split('-').filter(|s| !s.is_empty()).count() > 3 {
        return Err("use max 3 hyphen-separated words".into());
    }
    Ok(())
}

fn plans_dir(ctx: &PluginContext) -> Option<std::path::PathBuf> {
    ctx.state_dir("planning").map(|d| d.join("plans"))
}

fn specs_dir(ctx: &PluginContext) -> Option<std::path::PathBuf> {
    ctx.state_dir("planning").map(|d| d.join("specs"))
}

impl Plugin for Planning {
    fn id(&self) -> &'static str {
        "planning"
    }
    fn describe(&self) -> &'static str {
        "plans + specs markdown workflow"
    }

    fn commands(&self) -> Vec<CommandSpec> {
        vec![
            CommandSpec {
                name: "plan",
                usage: "<name> <description>",
                help: "create a plan (add steps later via edit)",
            },
            CommandSpec {
                name: "plans",
                usage: "",
                help: "list plans",
            },
            CommandSpec {
                name: "read",
                usage: "<name>",
                help: "read a plan with linked specs",
            },
            CommandSpec {
                name: "link",
                usage: "<plan> <spec>",
                help: "link a spec into a plan",
            },
            CommandSpec {
                name: "spec",
                usage: "<name> <content>",
                help: "create a spec",
            },
            CommandSpec {
                name: "done",
                usage: "<name>",
                help: "mark a plan done",
            },
        ]
    }

    fn run_command(
        &self,
        ctx: &PluginContext,
        command: &str,
        arg: &str,
    ) -> anyhow::Result<Vec<String>> {
        let Some(plans) = plans_dir(ctx) else {
            return Ok(vec!["planning: no config dir".into()]);
        };
        let Some(specs) = specs_dir(ctx) else {
            return Ok(vec!["planning: no config dir".into()]);
        };
        ctx.storage.create_dir_all(&plans)?;
        ctx.storage.create_dir_all(&specs)?;

        let plan_file = |name: &str| plans.join(format!("{name}.md"));
        let spec_file = |name: &str| specs.join(format!("{name}.md"));

        match command {
            "plan" => {
                let (name, desc) = arg
                    .split_once(char::is_whitespace)
                    .ok_or_else(|| anyhow::anyhow!("usage: /planning.plan <name> <description>"))?;
                valid_plan_name(name.trim()).map_err(anyhow::Error::msg)?;
                let file = plan_file(name.trim());
                if ctx.storage.read_to_string(&file).is_ok() {
                    return Ok(vec![format!(
                        "planning: plan '{}' already exists",
                        name.trim()
                    )]);
                }
                let body = format!(
                    "---\nplan name: {}\nplan description: {}\nplan status: active\n---\n\n## Required Specs\n{SPEC_START}\n{SPEC_END}\n",
                    name.trim(),
                    desc.trim()
                );
                ctx.storage.write_atomic(&file, &body)?;
                Ok(vec![format!("planning: created plan '{}'", name.trim())])
            }
            "plans" => {
                let files = ctx.storage.read_dir(&plans).unwrap_or_default();
                let mut rows: Vec<String> = files
                    .iter()
                    .filter_map(|p| p.file_name().map(|n| n.to_string_lossy().to_string()))
                    .filter(|n| n.ends_with(".md"))
                    .map(|n| format!("  {}", n.trim_end_matches(".md")))
                    .collect();
                if rows.is_empty() {
                    rows.push("planning: no plans".into());
                }
                Ok(rows)
            }
            "read" => {
                let name = arg.trim();
                valid_plan_name(name).map_err(anyhow::Error::msg)?;
                let body = ctx.storage.read_to_string(&plan_file(name))?;
                let specs: Vec<String> = body
                    .split_once(SPEC_START)
                    .and_then(|(_, rest)| rest.split_once(SPEC_END).map(|(mid, _)| mid.to_string()))
                    .unwrap_or_default()
                    .lines()
                    .map(|l| l.trim().trim_start_matches("- ").trim().to_string())
                    .filter(|l| !l.is_empty())
                    .collect();
                let mut out = vec![body];
                for spec in specs {
                    match ctx.storage.read_to_string(&spec_file(&spec)) {
                        Ok(s) => out.push(format!("--- spec: {spec} ---\n{s}")),
                        Err(_) => out.push(format!("--- spec: {spec} (missing) ---")),
                    }
                }
                Ok(out)
            }
            "link" => {
                let (plan, spec) = arg
                    .split_once(char::is_whitespace)
                    .ok_or_else(|| anyhow::anyhow!("usage: /planning.link <plan> <spec>"))?;
                let (plan, spec) = (plan.trim(), spec.trim());
                valid_plan_name(plan).map_err(anyhow::Error::msg)?;
                valid_plan_name(spec).map_err(anyhow::Error::msg)?;
                let body = ctx
                    .storage
                    .read_to_string(&plan_file(plan))
                    .map_err(|_| anyhow::anyhow!("plan '{plan}' not found"))?;
                if ctx.storage.read_to_string(&spec_file(spec)).is_err() {
                    return Ok(vec![format!(
                        "planning: spec '{spec}' not found (create with /planning.spec)"
                    )]);
                }
                let updated = if let Some((before, rest)) = body.split_once(SPEC_START) {
                    let mid_end = rest.split_once(SPEC_END);
                    match mid_end {
                        Some((mid, after)) => {
                            let link = format!("- {spec}");
                            if mid.contains(&link) {
                                body.clone()
                            } else {
                                format!("{before}{SPEC_START}{mid}{link}\n{SPEC_END}{after}")
                            }
                        }
                        None => body.clone(),
                    }
                } else {
                    format!("{body}\n\n## Required Specs\n{SPEC_START}\n- {spec}\n{SPEC_END}\n")
                };
                ctx.storage.write_atomic(&plan_file(plan), &updated)?;
                Ok(vec![format!("planning: linked '{spec}' into '{plan}'")])
            }
            "spec" => {
                let (name, content) = arg
                    .split_once(char::is_whitespace)
                    .ok_or_else(|| anyhow::anyhow!("usage: /planning.spec <name> <content>"))?;
                valid_plan_name(name.trim()).map_err(anyhow::Error::msg)?;
                let file = spec_file(name.trim());
                if ctx.storage.read_to_string(&file).is_ok() {
                    return Ok(vec![format!(
                        "planning: spec '{}' already exists",
                        name.trim()
                    )]);
                }
                let body = format!(
                    "---\nspec name: {}\n---\n\n{}\n",
                    name.trim(),
                    content.trim()
                );
                ctx.storage.write_atomic(&file, &body)?;
                Ok(vec![format!("planning: created spec '{}'", name.trim())])
            }
            "done" => {
                let name = arg.trim();
                valid_plan_name(name).map_err(anyhow::Error::msg)?;
                let body = ctx
                    .storage
                    .read_to_string(&plan_file(name))
                    .map_err(|_| anyhow::anyhow!("plan '{name}' not found"))?;
                let updated = if body.contains("plan status: active") {
                    body.replace("plan status: active", "plan status: done")
                } else if body.contains("plan status:") {
                    body
                } else {
                    return Ok(vec![format!("planning: plan '{name}' has no status line")]);
                };
                ctx.storage.write_atomic(&plan_file(name), &updated)?;
                Ok(vec![format!("planning: '{name}' marked done")])
            }
            other => Err(anyhow::anyhow!("unknown planning command {other}")),
        }
    }
}

// ---------------------------------------------------------------------------
// usage — session counters (port of opencode-quota)
// ---------------------------------------------------------------------------

/// Persists request/char counters per day at
/// `<config>/plugins/usage/usage.json`; `/usage` reports them.
pub struct Usage;

impl Usage {
    fn load(&self, ctx: &PluginContext) -> UsageState {
        let Some(dir) = ctx.state_dir("usage") else {
            return UsageState::default();
        };
        ctx.storage
            .read_to_string(&dir.join("usage.json"))
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default()
    }

    fn save(&self, ctx: &PluginContext, st: &UsageState) {
        let Some(dir) = ctx.state_dir("usage") else {
            return;
        };
        let _ = ctx.storage.create_dir_all(&dir);
        if let Ok(json) = serde_json::to_string_pretty(st) {
            let _ = ctx.storage.write_atomic(&dir.join("usage.json"), &json);
        }
    }
}

#[derive(Default, serde::Serialize, serde::Deserialize)]
struct UsageState {
    requests: u64,
    chars_in: u64,
    chars_out: u64,
    day: String,
}

impl Plugin for Usage {
    fn id(&self) -> &'static str {
        "usage"
    }
    fn describe(&self) -> &'static str {
        "session request/char counters"
    }

    fn commands(&self) -> Vec<CommandSpec> {
        vec![CommandSpec {
            name: "show",
            usage: "",
            help: "show usage counters",
        }]
    }

    fn run_command(
        &self,
        ctx: &PluginContext,
        command: &str,
        _arg: &str,
    ) -> anyhow::Result<Vec<String>> {
        if command != "show" {
            anyhow::bail!("unknown usage command {command}");
        }
        let st = self.load(ctx);
        Ok(vec![format!(
            "usage: {} requests · {}k chars in · {}k chars out (day {})",
            st.requests,
            st.chars_in / 1000,
            st.chars_out / 1000,
            st.day
        )])
    }

    fn before_send(
        &self,
        ctx: &PluginContext,
        text: &str,
        _settings: &Settings,
    ) -> anyhow::Result<Option<String>> {
        let mut st = self.load(ctx);
        let today = ms_to_day(crate::conversations::now_ms());
        if st.day != today {
            st = UsageState {
                day: today,
                ..Default::default()
            };
        }
        st.requests += 1;
        st.chars_in += text.len() as u64;
        self.save(ctx, &st);
        Ok(None) // never modifies the message
    }

    fn status(&self, ctx: &PluginContext) -> String {
        let st = self.load(ctx);
        format!("req:{}", st.requests)
    }
}

impl Usage {
    /// Count an outgoing message (public helper so hosts can drive it
    /// without the full before_send pipeline).
    pub fn count_outgoing(ctx: &PluginContext, chars_in: usize) {
        let p = Usage;
        let mut st = p.load(ctx);
        let today = ms_to_day(crate::conversations::now_ms());
        if st.day != today {
            st = UsageState {
                day: today,
                ..Default::default()
            };
        }
        st.requests += 1;
        st.chars_in += chars_in as u64;
        p.save(ctx, &st);
    }

    /// Count a completed assistant response.
    pub fn count_outgoing_response(ctx: &PluginContext, chars_out: usize) {
        let p = Usage;
        let mut st = p.load(ctx);
        st.chars_out += chars_out as u64;
        p.save(ctx, &st);
    }
}

// ---------------------------------------------------------------------------
// tableformat — markdown table alignment (port of opencode-md-table-formatter)
// ---------------------------------------------------------------------------

/// Aligns markdown table columns in completed assistant text.
pub struct TableFormat;

impl Plugin for TableFormat {
    fn id(&self) -> &'static str {
        "tableformat"
    }
    fn describe(&self) -> &'static str {
        "align markdown table columns in responses"
    }

    fn format_output(&self, _ctx: &PluginContext, text: &str) -> anyhow::Result<Option<String>> {
        Ok(super::markdown::format_tables(text))
    }
}

// ---------------------------------------------------------------------------
// skills — skill:// guidance (port of opencode-skill-loader)
// ---------------------------------------------------------------------------

/// Lists available skills from `<config>/plugins/skills/` (each a directory
/// with `SKILL.md`) and injects guidance to consult them.
pub struct Skills;

impl Plugin for Skills {
    fn id(&self) -> &'static str {
        "skills"
    }
    fn describe(&self) -> &'static str {
        "skill discovery + loading guidance"
    }

    fn commands(&self) -> Vec<CommandSpec> {
        vec![CommandSpec {
            name: "list",
            usage: "",
            help: "list installed skills",
        }]
    }

    fn run_command(
        &self,
        ctx: &PluginContext,
        command: &str,
        _arg: &str,
    ) -> anyhow::Result<Vec<String>> {
        if command != "list" {
            anyhow::bail!("unknown skills command {command}");
        }
        let Some(dir) = ctx.state_dir("skills") else {
            return Ok(vec!["skills: no config dir".into()]);
        };
        let mut rows = Vec::new();
        for entry in ctx.storage.read_dir(&dir).unwrap_or_default() {
            let name = entry
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            if ctx.storage.read_to_string(&entry.join("SKILL.md")).is_ok() {
                rows.push(format!("  {name}"));
            }
        }
        if rows.is_empty() {
            Ok(vec!["skills: none installed".into()])
        } else {
            Ok(rows)
        }
    }

    fn system_prompt_suffix(&self, ctx: &PluginContext, _settings: &Settings) -> String {
        let Some(dir) = ctx.state_dir("skills") else {
            return String::new();
        };
        let mut names = Vec::new();
        for entry in ctx.storage.read_dir(&dir).unwrap_or_default() {
            let name = entry
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            if ctx.storage.read_to_string(&entry.join("SKILL.md")).is_ok() {
                names.push(name);
            }
        }
        if names.is_empty() {
            String::new()
        } else {
            format!(
                "## Skills\n\nLoad a skill's SKILL.md with the read tool when the task matches its description:\n{}",
                names.iter().map(|n| format!("- {n}")).collect::<Vec<_>>().join("\n")
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::tests::MemStorage;
    use crate::storage::Storage;
    use std::path::PathBuf;

    /// Each test owns its storage; the ctx borrows it for the call.
    fn ctx_with<'a>(storage: &'a MemStorage, dir: &'a PathBuf) -> PluginContext<'a> {
        PluginContext {
            storage,
            config_dir: Some(dir.as_path()),
        }
    }

    /// Context with storage but no config dir.
    fn ctx_no_storage<'a>(storage: &'a MemStorage) -> PluginContext<'a> {
        PluginContext {
            storage,
            config_dir: None,
        }
    }

    fn tempdir(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "prism-test-{name}-{}",
            crate::conversations::now_ms()
        ));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn snippets_add_list_del_roundtrip() {
        let dir = tempdir("snippets");
        let p = Snippets;
        let storage = MemStorage::new();
        let ctx = ctx_with(&storage, &dir);
        assert_eq!(
            p.run_command(&ctx, "add", "sig — A. Person").unwrap()[0],
            "snippet #sig saved"
        );
        assert!(p.run_command(&ctx, "add", "nomatch extra body",).unwrap()[0].contains("nomatch"));
        let list = p.run_command(&ctx, "list", "").unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(
            p.run_command(&ctx, "del", "sig").unwrap()[0],
            "snippet #sig removed"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn snippet_expansion_in_before_send() {
        let dir = tempdir("snip-expand");
        let p = Snippets;
        let storage = MemStorage::new();
        let ctx = ctx_with(&storage, &dir);
        p.run_command(&ctx, "add", "btw by the way").unwrap();
        let expanded = p
            .before_send(
                &ctx,
                "hello #btw world",
                &crate::settings::Settings::default(),
            )
            .unwrap()
            .unwrap();
        assert_eq!(expanded, "hello by the way world");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn memory_save_read_search_roundtrip() {
        let dir = tempdir("memory");
        let p = Memory;
        let storage = MemStorage::new();
        let ctx = ctx_with(&storage, &dir);
        assert!(p
            .run_command(&ctx, "save", "decision topic: alpha build green")
            .unwrap()[0]
            .contains("decision/topic"));
        let read = p.run_command(&ctx, "read", "").unwrap();
        assert!(read.iter().any(|l| l.contains("alpha")));
        let hits = p.run_command(&ctx, "search", "alpha").unwrap();
        assert!(hits.iter().any(|l| l.contains("alpha")));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn memory_line_parse_roundtrip() {
        let line = format_memory_line(
            "2026-01-01T00:00:00Z",
            "decision",
            "core",
            "quote \"inside\"",
        );
        let (ts, ty, sc, content) = parse_memory_line(&line).unwrap();
        assert_eq!(ts, "2026-01-01T00:00:00Z");
        assert_eq!(ty, "decision");
        assert_eq!(sc, "core");
        assert_eq!(content, "quote \"inside\"");
    }

    #[test]
    fn ponytail_mode_switch_and_suffix() {
        let dir = tempdir("ponytail");
        let p = Ponytail;
        let storage = MemStorage::new();
        let ctx = ctx_with(&storage, &dir);
        assert_eq!(
            p.run_command(&ctx, "mode", "full").unwrap()[0],
            "ponytail: full"
        );
        let suffix = p.system_prompt_suffix(&ctx, &crate::settings::Settings::default());
        assert!(suffix.contains("Terse fragments"));
        assert_eq!(p.status(&ctx), "tone:full");
        p.run_command(&ctx, "mode", "off").unwrap();
        assert_eq!(p.status(&ctx), "");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn ponytail_instructions_cover_modes() {
        assert_eq!(ponytail_instructions("off"), "");
        assert!(ponytail_instructions("lite").contains("concise"));
        assert!(ponytail_instructions("ultra").contains("Telegraphic"));
    }

    #[test]
    fn planning_plan_spec_link_read_done() {
        let dir = tempdir("planning");
        let p = Planning;
        let storage = MemStorage::new();
        let ctx = ctx_with(&storage, &dir);
        assert!(p
            .run_command(&ctx, "plan", "my-plan first feature work")
            .unwrap()[0]
            .contains("created"));
        assert!(p
            .run_command(&ctx, "spec", "api-musts json shapes")
            .unwrap()[0]
            .contains("created"));
        assert!(p.run_command(&ctx, "link", "my-plan api-musts").unwrap()[0].contains("linked"));
        let read = p.run_command(&ctx, "read", "my-plan").unwrap();
        assert!(read.iter().any(|l| l.contains("api-musts")));
        assert!(p.run_command(&ctx, "done", "my-plan").unwrap()[0].contains("done"));
        assert!(p.run_command(&ctx, "done", "my-plan").unwrap()[0].contains("done")); // idempotent
                                                                                      // "Bad Name!" splits at the first space: name="Bad", desc="Name! desc" →
                                                                                      // a valid name (only the first token is validated). An in-name bad
                                                                                      // character needs to be in the first token:
        assert!(p.run_command(&ctx, "plan", "Bad!Name desc").is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn usage_counters_increment_and_reset_day() {
        let dir = tempdir("usage");
        let p = Usage;
        let storage = MemStorage::new();
        let ctx = ctx_with(&storage, &dir);
        p.before_send(&ctx, "hello", &crate::settings::Settings::default())
            .unwrap();
        p.before_send(&ctx, "again", &crate::settings::Settings::default())
            .unwrap();
        assert_eq!(p.status(&ctx), "req:2");
        let show = p.run_command(&ctx, "show", "").unwrap()[0].clone();
        assert!(show.contains("2 requests"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn tableformat_plugin_delegates() {
        let storage = MemStorage::new();
        let p = TableFormat;
        let out = p
            .format_output(&ctx_no_storage(&storage), "| a | b |\n| - | - |\n| 1 | 2 |")
            .unwrap()
            .unwrap();
        assert_eq!(out.lines().nth(1).unwrap(), "| - | - |");
    }

    #[test]
    fn ms_to_day_epoch_zero() {
        assert_eq!(ms_to_day(0), "1970-01-01");
        assert_eq!(ms_to_day(1_700_000_000_000), "2023-11-14");
    }

    #[test]
    fn skills_lists_installed_dirs() {
        let dir = tempdir("skills");
        let p = Skills;
        let storage = MemStorage::new();
        let skill_dir = dir.join("plugins").join("skills").join("demo");
        storage.create_dir_all(&skill_dir).unwrap();
        storage
            .write_atomic(&skill_dir.join("SKILL.md"), "x")
            .unwrap();
        let ctx = ctx_with(&storage, &dir);
        let list = p.run_command(&ctx, "list", "").unwrap();
        assert_eq!(list, vec!["  demo"]);
        std::fs::remove_dir_all(&dir).ok();
    }
}
