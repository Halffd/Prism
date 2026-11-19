//! Subagent registry: named, task-specific agent profiles and the
//! forced-model resolution order.
//!
//! A named subagent is a registry entry, not a prompt: a profile with
//! its own identity and model resolution order
//!
//! 1. the subagent's own `forced_model` wins (policy override),
//! 2. then the session's host model,
//! 3. then the provider default (`resolve_provider` fallback).
//!
//! Structure not model: a SubagentSpec also carries a tool allowlist
//! (the clamp applied per-agent) and the canonical task-tool name
//! (`task_<name>`) the loop advertises.

use serde::{Deserialize, Serialize};

/// One subagent profile.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SubagentSpec {
    /// Stable identifier, also the task-tool suffix.
    pub name: String,
    /// One-line description the loop injects into the prompt.
    pub description: String,
    /// Policy-forced model id (wins over the session host model).
    #[serde(default)]
    pub forced_model: Option<String>,
    /// When set, the agent may call only these tools.
    #[serde(default)]
    pub tool_allowlist: Vec<String>,
}

/// Which model this run must use, after the forced-resolution order.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ModelResolution {
    pub model: String,
    /// Which resolution tier decided it (provenance for logs).
    pub tier: Tier,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Tier {
    /// From the subagent's `forced_model`.
    SubagentForced,
    /// From the session host model.
    Session,
    /// From the provider default.
    ProviderDefault,
}

/// The registry: shipped set plus caller-added profiles.
pub struct SubagentRegistry {
    specs: Vec<SubagentSpec>,
}

impl Default for SubagentRegistry {
    fn default() -> Self {
        Self {
            specs: default_specs().into_iter().collect(),
        }
    }
}

impl SubagentRegistry {
    /// Register (or replace) a profile by name.
    pub fn upsert(&mut self, spec: SubagentSpec) {
        if let Some(existing) = self.specs.iter_mut().find(|s| s.name == spec.name) {
            *existing = spec;
        } else {
            self.specs.push(spec);
        }
    }

    /// Validate + upsert the `subagents` entries from the shared config
    /// file (`mcp.json` — the same file the MCP servers come from).
    /// Same-name entries replace the shipped spec; a malformed entry is
    /// reported and skipped, never fatal. Returns (applied, errors).
    pub fn upsert_config_specs(&mut self, entries: &[serde_json::Value]) -> (usize, Vec<String>) {
        let mut applied = 0;
        let mut errors = Vec::new();
        for (i, e) in entries.iter().enumerate() {
            let label = format!("subagents[{i}]");
            let name = e.get("name").and_then(|v| v.as_str());
            let valid_name = name
                .map(|n| {
                    let mut chars = n.chars();
                    matches!(chars.next(), Some(c) if c.is_ascii_lowercase())
                        && chars.all(|c| {
                            c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-'
                        })
                })
                .unwrap_or(false);
            if !valid_name {
                errors.push(format!(
                    "{label}: \"name\" must be kebab/snake-case ([a-z][a-z0-9_-]*)"
                ));
                continue;
            }
            let Some(description) = e.get("description").and_then(|v| v.as_str()) else {
                errors.push(format!("{label}: \"description\" must be a string"));
                continue;
            };
            let forced_model = match e.get("forced_model") {
                None | Some(serde_json::Value::Null) => None,
                Some(v) => match v.as_str() {
                    Some(s) => Some(s.to_string()),
                    None => {
                        errors.push(format!("{label}: \"forced_model\" must be a string"));
                        continue;
                    }
                },
            };
            let tool_allowlist = match e.get("tool_allowlist") {
                None => Vec::new(),
                Some(v) => match v.as_array().map(|arr| {
                    arr.iter()
                        .map(|t| t.as_str().map(String::from))
                        .collect::<Option<Vec<String>>>()
                }) {
                    Some(Some(list)) => list,
                    _ => {
                        errors.push(format!(
                            "{label}: \"tool_allowlist\" must be an array of tool names"
                        ));
                        continue;
                    }
                },
            };
            self.upsert(SubagentSpec {
                name: name.unwrap().to_string(),
                description: description.to_string(),
                forced_model,
                tool_allowlist,
            });
            applied += 1;
        }
        (applied, errors)
    }

    pub fn get(&self, name: &str) -> Option<&SubagentSpec> {
        self.specs.iter().find(|s| s.name == name)
    }

    pub fn names(&self) -> Vec<String> {
        self.specs.iter().map(|s| s.name.clone()).collect()
    }

    /// The task-tool name the loop advertises for a subagent
    /// (`task-tool-name` semantics).
    pub fn task_tool_name(spec_name: &str) -> String {
        format!("task_{spec_name}")
    }

    /// Forced-model resolution order. `session_model` is what the host
    /// surface would run; `provider_default` is the resolved provider's
    /// model when the session has none (may be empty = unresolved).
    pub fn resolve_model(
        &self,
        name: &str,
        session_model: &str,
        provider_default: Option<String>,
    ) -> Result<ModelResolution, String> {
        let spec = self.get(name).ok_or_else(|| {
            format!(
                "unknown subagent {name:?} (known: {})",
                self.names().join(", ")
            )
        })?;
        if let Some(forced) = spec
            .forced_model
            .as_deref()
            .map(str::trim)
            .filter(|m| !m.is_empty())
        {
            return Ok(ModelResolution {
                model: forced.to_string(),
                tier: Tier::SubagentForced,
            });
        }
        if !session_model.trim().is_empty() {
            return Ok(ModelResolution {
                model: session_model.trim().to_string(),
                tier: Tier::Session,
            });
        }
        match provider_default
            .map(|d| d.trim().to_string())
            .filter(|d| !d.is_empty())
        {
            Some(default) => Ok(ModelResolution {
                model: default,
                tier: Tier::ProviderDefault,
            }),
            None => Err(
                "no model available (no forced model, empty session model, no provider default)"
                    .into(),
            ),
        }
    }

    /// Effective tool advertisement for a subagent: the allowlist
    /// intersected with the host surface (unadvertised entries are
    /// dropped — they simply cannot be called). An error is raised only
    /// when a non-empty allowlist intersects to nothing, which means the
    /// subagent could do no work at all; an empty allowlist means "the
    /// full host surface".
    pub fn clamp_tools(&self, name: &str, advertised: &[String]) -> Result<Vec<String>, String> {
        let spec = self
            .get(name)
            .ok_or_else(|| format!("unknown subagent {name:?}"))?;
        if spec.tool_allowlist.is_empty() {
            return Ok(advertised.to_vec());
        }
        let effective: Vec<String> = spec
            .tool_allowlist
            .iter()
            .filter(|t| advertised.contains(t))
            .cloned()
            .collect();
        if effective.is_empty() {
            return Err(format!(
                "subagent {name:?} allowlist {} shares no tool with the advertised surface",
                spec.tool_allowlist.join(", ")
            ));
        }
        Ok(effective)
    }
}

/// The shipped set — Prism entry points for the agent classes the
/// tool survey of `agent/dist/tools/**` surfaced (read/edit/grep explorers,
/// security review, bug triage, CI investigation, browser use, shell ops).
pub fn default_specs() -> Vec<SubagentSpec> {
    vec![
        SubagentSpec {
            name: "explore".into(),
            description: "Fast read-only exploration of a codebase or workspace".into(),
            forced_model: None,
            tool_allowlist: vec!["read_file".into(), "list_dir".into(), "calculator".into()],
        },
        SubagentSpec {
            name: "security-review".into(),
            description: "Adversarial review of a change for security issues".into(),
            forced_model: None,
            tool_allowlist: vec!["read_file".into(), "list_dir".into()],
        },
        SubagentSpec {
            name: "bugbot".into(),
            description: "Triage a reported bug against the current workspace".into(),
            forced_model: None,
            tool_allowlist: vec!["read_file".into(), "list_dir".into(), "edit_file".into()],
        },
        SubagentSpec {
            name: "ci-investigation".into(),
            description: "Investigate a failing CI run and propose a fix".into(),
            forced_model: None,
            tool_allowlist: vec![
                "read_file".into(),
                "list_dir".into(),
                "edit_file".into(),
                "shell".into(),
            ],
        },
        SubagentSpec {
            name: "browser-use".into(),
            description: "Drive a browser scenario and report observations".into(),
            forced_model: None,
            tool_allowlist: vec![],
        },
        SubagentSpec {
            name: "shell-ops".into(),
            description: "Sandboxed shell work: builds, git, runtime probes".into(),
            forced_model: None,
            tool_allowlist: vec!["shell".into(), "read_file".into(), "list_dir".into()],
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(json: &str) -> serde_json::Value {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn config_specs_upsert_and_replace_shipped_entries() {
        let mut reg = SubagentRegistry::default();
        let (applied, errors) = reg.upsert_config_specs(&[
            entry(r#"{"name":"tui-scout","description":"Quick scout","tool_allowlist":["read_file"]}"#),
            // same name replaces the shipped entry (core upsert semantics)
            entry(r#"{"name":"explore","description":"TUI-tuned explorer","forced_model":"cheap-fast-model","tool_allowlist":[]}"#),
        ]);
        assert_eq!(applied, 2);
        assert!(errors.is_empty());
        let scout = reg.get("tui-scout").unwrap();
        assert_eq!(scout.description, "Quick scout");
        assert_eq!(scout.tool_allowlist, vec!["read_file"]);
        assert_eq!(scout.forced_model, None);
        let explore = reg.get("explore").unwrap();
        assert_eq!(explore.description, "TUI-tuned explorer");
        assert_eq!(explore.forced_model.as_deref(), Some("cheap-fast-model"));
        // The other shipped specs survive untouched.
        assert!(reg.get("shell-ops").is_some());
    }

    #[test]
    fn malformed_config_entries_are_reported_and_skipped() {
        let mut reg = SubagentRegistry::default();
        let (applied, errors) = reg.upsert_config_specs(&[
            entry(r#"{"name":"Bad Name!","description":"x"}"#),
            entry(r#"{"name":"ok-name","description":"fine"}"#),
            entry(r#"{"name":"bad-allow","description":"x","tool_allowlist":"nope"}"#),
            entry(r#"{"name":"bad-model","description":"x","forced_model":42}"#),
            entry(r#"{"name":"ok2","description":"fine"}"#),
        ]);
        assert_eq!(applied, 2);
        assert_eq!(errors.len(), 3);
        assert!(reg.get("ok2").is_some());
        assert!(reg.get("Bad Name!").is_none());
        // The shipped six are untouched by the junk.
        assert!(reg.get("explore").is_some());
        assert_eq!(reg.get("explore").unwrap().forced_model, None);
    }

    #[test]
    fn shipped_set_is_known() {
        let reg = SubagentRegistry::default();
        assert!(reg.names().contains(&"explore".to_string()));
        assert!(reg.names().contains(&"security-review".to_string()));
        assert_eq!(SubagentRegistry::task_tool_name("explore"), "task_explore");
    }

    #[test]
    fn forced_model_wins_over_session() {
        let mut reg = SubagentRegistry::default();
        reg.upsert(SubagentSpec {
            name: "explore".into(),
            description: "…".into(),
            forced_model: Some("cheap-fast-model".into()),
            tool_allowlist: vec![],
        });
        let r = reg
            .resolve_model("explore", "premium-model", Some("default-model".into()))
            .unwrap();
        assert_eq!(r.model, "cheap-fast-model");
        assert_eq!(r.tier, Tier::SubagentForced);

        let r = reg
            .resolve_model("security-review", "premium-model", Some("d".into()))
            .unwrap();
        assert_eq!(r.model, "premium-model");
        assert_eq!(r.tier, Tier::Session);
    }

    #[test]
    fn provider_default_is_last_resort() {
        let reg = SubagentRegistry::default();
        let r = reg
            .resolve_model("bugbot", "", Some("provider-default".into()))
            .unwrap();
        assert_eq!(r.tier, Tier::ProviderDefault);
        assert!(reg.resolve_model("bugbot", "", None).is_err());
        assert!(reg.resolve_model("ghost", "m", None).is_err());
    }

    #[test]
    fn allowlist_clamps_advertised() {
        let reg = SubagentRegistry::default();
        let adv = vec![
            "read_file".into(),
            "list_dir".into(),
            "edit_file".into(),
            "shell".into(),
        ];
        // explore: allowlist ∩ advertised, unadvertised entries dropped.
        let clamped = reg.clamp_tools("explore", &adv).unwrap();
        assert_eq!(
            clamped,
            vec!["read_file".to_string(), "list_dir".to_string()]
        );

        // Subset allowlist that fully overlaps keeps its entries.
        assert_eq!(
            reg.clamp_tools("security-review", &adv).unwrap(),
            vec!["read_file".to_string(), "list_dir".to_string()]
        );
        // Allowlist intersecting to nothing is a configuration error.
        assert!(reg
            .clamp_tools("shell-ops", &["calculator".into()])
            .is_err());
        // Empty allowlist = full surface.
        assert_eq!(reg.clamp_tools("browser-use", &adv).unwrap(), adv);
        assert!(reg.clamp_tools("ghost", &adv).is_err());
    }
}
