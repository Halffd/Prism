//! Local model support: first-class local inference servers, discovery,
//! and GGUF metadata.
//!
//! Local providers are not a special case scattered through the code:
//! they are one registry with a base URL, a health endpoint, and a
//! model-list endpoint. The two shapes:
//!
//! - **Native** (Ollama `/api/tags`, llama.cpp native): a provider with
//!   its own JSON shape and hardware-aware chat options.
//! - **OpenAI-compat** (LM Studio, vLLM, koboldcpp, sglang): reached
//!   through the standard `/v1/models` list and `/v1/chat/completions`
//!   stream.
//!
//! Discovery and health are pure functions over response bytes so they
//! test without a server; the host drives the HTTP.

use serde::{Deserialize, Serialize};

/// A local inference server Prism can talk to.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LocalProvider {
    /// Stable id stored in settings ("ollama", "lmstudio", …).
    pub id: &'static str,
    /// Human label for the UI.
    pub label: &'static str,
    /// Default base URL, including `/v1` for OpenAI-compat servers.
    pub base_url: &'static str,
    /// Which wire shape this server speaks.
    pub wire: LocalWire,
    /// Whether this server honours GPU-layer / context overrides on its
    /// chat path (Ollama native does; compat servers use launch flags).
    pub hardware_overrides: bool,
    /// Whether the server serves GGUF weights from a local models dir.
    pub gguf: bool,
}

/// The request/response shape a local server speaks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LocalWire {
    /// OpenAI-compatible `/v1/models` + `/v1/chat/completions`.
    OpenAiCompat,
    /// Ollama native `/api/tags` + `/api/chat` (NDJSON streaming).
    OllamaNative,
}

impl LocalProvider {
    /// Model-list endpoint for this server.
    pub fn models_url(&self, base_url: &str) -> String {
        match self.wire {
            LocalWire::OpenAiCompat => {
                format!("{}/models", base_url.trim_end_matches('/'))
            }
            LocalWire::OllamaNative => {
                let root = crate::providers::ollama_root_url(base_url);
                format!("{}/api/tags", root)
            }
        }
    }

    /// Cheap health endpoint: the model list is also the liveness probe.
    pub fn health_url(&self, base_url: &str) -> String {
        self.models_url(base_url)
    }
}

/// Every local provider Prism knows, in UI order.
pub const LOCAL_PROVIDERS: &[LocalProvider] = &[
    LocalProvider {
        id: "ollama",
        label: "Ollama",
        base_url: "http://localhost:11434/v1",
        wire: LocalWire::OllamaNative,
        hardware_overrides: true,
        gguf: true,
    },
    LocalProvider {
        id: "lmstudio",
        label: "LM Studio",
        base_url: "http://localhost:1234/v1",
        wire: LocalWire::OpenAiCompat,
        hardware_overrides: false,
        gguf: true,
    },
    LocalProvider {
        id: "llamacpp",
        label: "llama.cpp",
        base_url: "http://localhost:8080/v1",
        wire: LocalWire::OpenAiCompat,
        hardware_overrides: false,
        gguf: true,
    },
    LocalProvider {
        id: "koboldcpp",
        label: "KoboldCpp",
        base_url: "http://localhost:5001/v1",
        wire: LocalWire::OpenAiCompat,
        hardware_overrides: false,
        gguf: true,
    },
    LocalProvider {
        id: "sglang",
        label: "SGLang",
        base_url: "http://localhost:30000/v1",
        wire: LocalWire::OpenAiCompat,
        hardware_overrides: false,
        gguf: false,
    },
    LocalProvider {
        id: "vllm",
        label: "vLLM",
        base_url: "http://localhost:8000/v1",
        wire: LocalWire::OpenAiCompat,
        hardware_overrides: false,
        gguf: false,
    },
];

pub fn find(id: &str) -> Option<&'static LocalProvider> {
    LOCAL_PROVIDERS.iter().find(|p| p.id == id)
}

/// True when the id names a local server.
pub fn is_local(id: &str) -> bool {
    find(id).is_some()
}

/// True when this id carries hardware overrides to the chat path.
pub fn supports_hardware_overrides(id: &str) -> bool {
    find(id).map(|p| p.hardware_overrides).unwrap_or(false)
}

// ---- discovery ------------------------------------------------------------

/// One discovered model.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LocalModel {
    pub id: String,
    /// Size label when the server reports one ("7B", "4.0GB").
    #[serde(default)]
    pub size: Option<String>,
    /// Whether the server marks it as an embedding model (excluded from
    /// the picker — they cannot chat).
    #[serde(default)]
    pub embedding: bool,
    /// GGUF/weights provenance when the server reports a path.
    #[serde(default)]
    pub path: Option<String>,
}

/// Parse an Ollama `/api/tags` response into models.
pub fn parse_ollama_tags(body: &str) -> Result<Vec<LocalModel>, String> {
    #[derive(Deserialize)]
    struct Tag {
        name: String,
        #[serde(default)]
        size: Option<u64>,
    }
    #[derive(Deserialize)]
    struct Envelope {
        models: Vec<Tag>,
    }
    let env: Envelope =
        serde_json::from_str(body).map_err(|e| format!("ollama tags json: {e}"))?;
    Ok(env
        .models
        .into_iter()
        .map(|t| LocalModel {
            id: t.name,
            size: t.size.map(bytes_label),
            embedding: false,
            path: None,
        })
        .collect())
}

/// Parse an OpenAI-compatible `/v1/models` response into models. Works
/// with the raw OpenAI shape (`{data:[{id,...}]}`) and with the richer
/// LM Studio shape that nests metadata under extra keys.
pub fn parse_openai_models(body: &str) -> Result<Vec<LocalModel>, String> {
    #[derive(Deserialize)]
    struct Entry {
        id: String,
        #[serde(default)]
        size: Option<u64>,
    }
    #[derive(Deserialize)]
    struct Envelope {
        data: Vec<Entry>,
    }
    let env: Envelope = serde_json::from_str(body)
        .map_err(|e| format!("models json: {e}"))?;
    Ok(env
        .data
        .into_iter()
        .map(|e| {
            let embedding = e.id.contains("embed");
            LocalModel {
                id: e.id,
                size: e.size.map(bytes_label),
                embedding,
                path: None,
            }
        })
        .collect())
}

/// Parse whichever shape this provider speaks.
pub fn parse_models(provider: &LocalProvider, body: &str) -> Result<Vec<LocalModel>, String> {
    match provider.wire {
        LocalWire::OllamaNative => parse_ollama_tags(body),
        LocalWire::OpenAiCompat => parse_openai_models(body),
    }
}

/// Human size label for a byte count ("4.0GB", "1.5MB").
pub fn bytes_label(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;
    let (value, unit) = if bytes >= GB {
        (bytes as f64 / GB as f64, "GB")
    } else if bytes >= MB {
        (bytes as f64 / MB as f64, "MB")
    } else if bytes >= KB {
        (bytes as f64 / KB as f64, "KB")
    } else {
        (bytes as f64, "B")
    };
    format!("{value:.1}{unit}")
}

/// Chat-capable models, sorted by id for a stable picker.
pub fn chat_models(models: Vec<LocalModel>) -> Vec<LocalModel> {
    let mut v: Vec<LocalModel> = models.into_iter().filter(|m| !m.embedding).collect();
    v.sort_by(|a, b| a.id.cmp(&b.id));
    v
}

/// Result of one health probe, from any non-2xx or malformed body.
#[derive(Debug, Clone, PartialEq)]
pub enum Health {
    /// Server answered and the model list parsed.
    Up { models: usize },
    /// Server answered but the body was not a model list.
    Degraded { reason: String },
    /// Transport-level failure.
    Down { reason: String },
}

impl Health {
    pub fn reachable(&self) -> bool {
        matches!(self, Health::Up { .. } | Health::Degraded { .. })
    }
}

/// Interpret a model-list response for health purposes.
pub fn health_from_body(provider: &LocalProvider, body: &str) -> Health {
    match parse_models(provider, body) {
        Ok(models) => Health::Up {
            models: models.len(),
        },
        Err(e) => Health::Degraded { reason: e },
    }
}

/// Interpret a transport failure as Down.
pub fn health_from_error(err: String) -> Health {
    Health::Down { reason: err }
}

// ---- GGUF -----------------------------------------------------------------

/// Metadata read from a GGUF header. Fields are best-effort: GGUF keys
/// vary by producer, so anything absent stays None.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct GgufMetadata {
    pub architecture: Option<String>,
    pub name: Option<String>,
    pub context_length: Option<u64>,
    pub parameter_count: Option<String>,
    pub quantization: Option<String>,
    /// Bytes in the file (equals context when streamed from disk).
    pub file_size: Option<u64>,
}

/// The fixed 4-byte GGUF magic.
pub const GGUF_MAGIC: &[u8] = b"GGUF";

/// True when the buffer looks like a GGUF file. Used by surfaces to
/// label dropped files before any parsing.
pub fn is_gguf(bytes: &[u8]) -> bool {
    bytes.len() >= 4 && &bytes[..4] == GGUF_MAGIC
}

/// Parse the GGUF header's metadata key/values.
///
/// GGUF layout: magic (4) | version (u32 LE) | tensor count (u64) |
/// metadata-kv count (u64) | then count × [key: string | value: type+payload].
/// The reader stops at the first structural error — a truncated or
/// non-GGUF buffer returns the metadata found so far rather than
/// failing, because surfaces show partial info for files still downloading.
pub fn read_gguf_metadata(bytes: &[u8]) -> GgufMetadata {
    let mut meta = GgufMetadata::default();
    meta.file_size = Some(bytes.len() as u64);
    if !is_gguf(bytes) {
        return meta;
    }
    let mut pos = 4usize;
    // version
    if pos + 4 > bytes.len() {
        return meta;
    }
    pos += 4;
    // tensor count
    if pos + 8 > bytes.len() {
        return meta;
    }
    pos += 8;
    // metadata-kv count
    if pos + 8 > bytes.len() {
        return meta;
    }
    let kv_count = u64::from_le_bytes(bytes[pos..pos + 8].try_into().unwrap_or([0; 8]));
    pos += 8;

    for _ in 0..kv_count {
        let Some((key, after_key)) = read_gguf_string(bytes, pos) else {
            break;
        };
        pos = after_key;
        let Some(value_type) = bytes.get(pos).copied() else {
            break;
        };
        pos += 1;
        match value_type {
            8 => {
                if let Some((s, n)) = read_gguf_string(bytes, pos) {
                    assign(&mut meta, &key, Some(s));
                    pos = n;
                } else {
                    break;
                }
            }
            4 | 5 | 6 => {
                let width = if value_type == 4 { 8 } else { 4 };
                if pos + width <= bytes.len() {
                    let v = if width == 8 {
                        u64::from_le_bytes(bytes[pos..pos + 8].try_into().unwrap_or([0; 8]))
                    } else {
                        u32::from_le_bytes(bytes[pos..pos + 4].try_into().unwrap_or([0; 4])) as u64
                    };
                    assign_int(&mut meta, &key, v);
                    pos += width;
                } else {
                    break;
                }
            }
            10 => {
                if let Some((s, n)) = read_gguf_string(bytes, pos) {
                    assign(&mut meta, &key, Some(s));
                    pos = n;
                } else {
                    break;
                }
            }
            _ => break,
        }
    }
    meta
}

/// GGUF string: u64 length + UTF-8 bytes.
fn read_gguf_string(bytes: &[u8], pos: usize) -> Option<(String, usize)> {
    if pos + 8 > bytes.len() {
        return None;
    }
    let len = u64::from_le_bytes(bytes[pos..pos + 8].try_into().unwrap_or([0; 8])) as usize;
    let start = pos + 8;
    if start + len > bytes.len() {
        return None;
    }
    let s = String::from_utf8_lossy(&bytes[start..start + len]).into_owned();
    Some((s, start + len))
}

fn assign(meta: &mut GgufMetadata, key: &str, value: Option<String>) {
    let Some(value) = value else {
        return;
    };
    match key {
        "general.architecture" => meta.architecture = Some(value),
        "general.name" => meta.name = Some(value),
        "general.quantization_version" => meta.quantization = Some(value),
        _ => {}
    }
}

fn assign_int(meta: &mut GgufMetadata, key: &str, value: u64) {
    match key {
        "llama.context_length" | "qwen.context_length" | "gemma.context_length" => {
            meta.context_length = Some(value)
        }
        "llama.block_count" | "qwen.block_count" => {
            if value > 0 {
                meta.parameter_count = Some(format!("{value} blocks"));
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_covers_expected_locals() {
        for id in ["ollama", "lmstudio", "llamacpp", "koboldcpp", "sglang", "vllm"] {
            assert!(find(id).is_some(), "missing {id}");
        }
        assert!(is_local("llamacpp"));
        assert!(!is_local("openai"));
    }

    #[test]
    fn only_ollama_carries_hardware_overrides() {
        assert!(supports_hardware_overrides("ollama"));
        assert!(!supports_hardware_overrides("lmstudio"));
    }

    #[test]
    fn models_urls_depend_on_wire() {
        let ollama = find("ollama").unwrap();
        assert_eq!(
            ollama.models_url("http://localhost:11434/v1"),
            "http://localhost:11434/api/tags"
        );
        assert_eq!(
            ollama.models_url("http://localhost:11434"),
            "http://localhost:11434/api/tags"
        );
        let lm = find("lmstudio").unwrap();
        assert_eq!(
            lm.models_url("http://localhost:1234/v1"),
            "http://localhost:1234/v1/models"
        );
        assert_eq!(lm.models_url("http://localhost:1234/v1/"), "http://localhost:1234/v1/models");
    }

    #[test]
    fn parses_ollama_tags() {
        let body = r#"{"models":[{"name":"llama3.2","size":4661223976},{"name":"mistral"}]}"#;
        let models = parse_ollama_tags(body).unwrap();
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "llama3.2");
        assert_eq!(models[0].size.as_deref(), Some("4.3GB"));
    }

    #[test]
    fn parses_openai_models_and_flags_embeddings() {
        let body = r#"{"data":[{"id":"llama-3.2-3b","size":1000000},{"id":"all-minilm-embed","size":100}]}"#;
        let models = parse_openai_models(body).unwrap();
        assert_eq!(models.len(), 2);
        assert!(models[1].embedding);
        let chat = chat_models(models);
        assert_eq!(chat.len(), 1);
        assert_eq!(chat[0].id, "llama-3.2-3b");
    }

    #[test]
    fn parse_rejects_non_json() {
        assert!(parse_ollama_tags("<html>").is_err());
        assert!(parse_openai_models("").is_err());
    }

    #[test]
    fn bytes_label_humanizes() {
        assert_eq!(bytes_label(512), "512.0B");
        assert_eq!(bytes_label(1024), "1.0KB");
        assert_eq!(bytes_label(1024 * 1024 * 4), "4.0MB");
        assert_eq!(bytes_label(1024 * 1024 * 1024 * 3), "3.0GB");
    }

    #[test]
    fn health_from_valid_body_is_up() {
        let llm = find("ollama").unwrap();
        let h = health_from_body(llm, r#"{"models":[{"name":"a"},{"name":"b"}]}"#);
        assert_eq!(h, Health::Up { models: 2 });
        assert!(h.reachable());
    }

    #[test]
    fn health_from_broken_body_is_degraded() {
        let lm = find("lmstudio").unwrap();
        let h = health_from_body(lm, "not json");
        assert!(h.reachable());
        assert!(matches!(h, Health::Degraded { .. }));
    }

    #[test]
    fn gguf_magic_and_truncated_header() {
        let good = b"GGUF\x03\x00\x00\x00";
        assert!(is_gguf(good));
        // Header only: counts absent → empty metadata, no panic.
        let meta = read_gguf_metadata(good);
        assert_eq!(meta.file_size, Some(8)); // magic (4) + version (4)
        assert!(meta.architecture.is_none());
        // Truncated → same, best-effort.
        let meta2 = read_gguf_metadata(b"GG");
        assert_eq!(meta2.file_size, Some(2));
        assert!(!is_gguf(b"GG"));
    }

    #[test]
    fn gguf_parses_a_metadata_pair() {
        let mut b = Vec::new();
        b.extend_from_slice(b"GGUF");
        b.extend_from_slice(&3u32.to_le_bytes()); // version
        b.extend_from_slice(&1u64.to_le_bytes()); // tensor count
        b.extend_from_slice(&1u64.to_le_bytes()); // kv count
        // key: "test.name"
        let key = b"test.name";
        b.extend_from_slice(&(key.len() as u64).to_le_bytes());
        b.extend_from_slice(key);
        b.push(8); // string type
        let val = b"hello";
        b.extend_from_slice(&(val.len() as u64).to_le_bytes());
        b.extend_from_slice(val);
        let meta = read_gguf_metadata(&b);
        // "test.name" is not a mapped key, so nothing is read but no crash.
        assert_eq!(meta.file_size, Some(b.len() as u64));
    }
}
