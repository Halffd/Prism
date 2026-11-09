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
        Self { specs: default_specs().into_iter().collect() }
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
        let spec = self
            .get(name)
            .ok_or_else(|| format!("unknown subagent {name:?} (known: {})", self.names().join(", ")))?;
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
        match provider_default.map(|d| d.trim().to_string()).filter(|d| !d.is_empty()) {
            Some(default) => Ok(ModelResolution {
                model: default,
                tier: Tier::ProviderDefault,
            }),
            None => Err("no model available (no forced model, empty session model, no provider default)".into()),
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
            tool_allowlist: vec!["read_file".into(), "list_dir".into(), "edit_file".into(), "shell".into()],
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

    #[test]
    fn shipped_set_is_known() {
        let reg = SubagentRegistry::default();
        assert!(reg.names().contains(&"explore".to_string()));
        assert!(reg.names().contains(&"security-review".to_string()));
        assert_eq!(
            SubagentRegistry::task_tool_name("explore"),
            "task_explore"
        );
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
        let r = reg.resolve_model("explore", "premium-model", Some("default-model".into())).unwrap();
        assert_eq!(r.model, "cheap-fast-model");
        assert_eq!(r.tier, Tier::SubagentForced);

        let r = reg.resolve_model("security-review", "premium-model", Some("d".into())).unwrap();
        assert_eq!(r.model, "premium-model");
        assert_eq!(r.tier, Tier::Session);
    }

    #[test]
    fn provider_default_is_last_resort() {
        let reg = SubagentRegistry::default();
        let r = reg.resolve_model("bugbot", "", Some("provider-default".into())).unwrap();
        assert_eq!(r.tier, Tier::ProviderDefault);
        assert!(reg.resolve_model("bugbot", "", None).is_err());
        assert!(reg.resolve_model("ghost", "m", None).is_err());
    }

    #[test]
    fn allowlist_clamps_advertised() {
        let reg = SubagentRegistry::default();
        let adv = vec!["read_file".into(), "list_dir".into(), "edit_file".into(), "shell".into()];
        // explore: allowlist ∩ advertised, unadvertised entries dropped.
        let clamped = reg.clamp_tools("explore", &adv).unwrap();
        assert_eq!(clamped, vec!["read_file".to_string(), "list_dir".to_string()]);

        // Subset allowlist that fully overlaps keeps its entries.
        assert_eq!(
            reg.clamp_tools("security-review", &adv).unwrap(),
            vec!["read_file".to_string(), "list_dir".to_string()]
        );
        // Allowlist intersecting to nothing is a configuration error.
        assert!(reg.clamp_tools("shell-ops", &["calculator".into()]).is_err());
        // Empty allowlist = full surface.
        assert_eq!(reg.clamp_tools("browser-use", &adv).unwrap(), adv);
        assert!(reg.clamp_tools("ghost", &adv).is_err());
    }
}
