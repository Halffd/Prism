//! Real trained chat inference with Candle (feature `candle-llm`).
//!
//! Unlike [`crate::native_llm`], this module runs actual neural weights: a
//! local GGUF (or GGML) Llama-family model loaded through Candle's quantized
//! llama implementation, plus a tokenizer.json. No network, no Python, no
//! downloads happen here — the host supplies the files.
//!
//! Supported families (through Candle's quantized llama runner) include
//! Llama, Mistral, Mixtral, Qwen and Phi-style GGUFs whose tensor names and
//! metadata follow the llama.cpp convention. The chat prompt wrapper is
//! selectable because the GGUF container does not carry a usable Rust-side
//! chat template:
//!
//! ```text
//! --llm-format auto | chatml | llama3 | llama2 | mistral | zephyr | deepseek | plain
//! ```
//!
//! `auto` guesses from the model filename. Use an explicit format when a
//! quantized model's name does not identify its prompt style. The default
//! preview engine stays active until a host configures `--llm-model`.

use crate::client::ChatMessage;
use crate::native_llm::{self, GenerateRequest, Generated};
use candle_core::quantized::gguf_file;
use candle_core::{Device, Tensor};
use candle_transformers::generation::LogitsProcessor;
use candle_transformers::models::quantized_gemma3;
use candle_transformers::models::quantized_llama::{self, MAX_SEQ_LEN};
use candle_transformers::models::quantized_qwen3;
use std::cmp::Ordering;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::fs;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use tokenizers::Tokenizer;

/// Candle quantized-llama context limit. Prompts are trimmed from the left
/// when they would leave no room for generation.
pub const CONTEXT_LIMIT: usize = MAX_SEQ_LEN;

/// Special endings recognised across common chat GGUFs. Generation stops on
/// the first id present in the tokenizer vocabulary.
pub const EOS_TOKENS: &[&str] = &[
    "</s>",
    "<|end_of_text|>",
    "<|endoftext|>",
    "<|end_of_turn|>",
    "<|eot_id|>",
    "<|im_end|>",
    "<｜end▁of▁sentence｜>",
    "<eos>",
    "<end_of_turn>",
];

/// Prompt wrapper used before tokenizing the chat messages.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChatFormat {
    Auto,
    ChatMl,
    Llama3,
    Llama2,
    Mistral,
    Zephyr,
    DeepSeek,
    Gemma,
    Plain,
}

impl ChatFormat {
    /// Parse an explicit format id.
    pub fn parse(value: &str) -> Result<Self, String> {
        match value.trim().to_ascii_lowercase().replace(['-', '_'], "").as_str() {
            "" | "auto" => Ok(Self::Auto),
            "chatml" | "qwen" => Ok(Self::ChatMl),
            "llama3" | "llama31" | "llama-3" => Ok(Self::Llama3),
            "llama2" | "llama" => Ok(Self::Llama2),
            "mistral" | "mixtral" | "inst" | "instruct" => Ok(Self::Mistral),
            "zephyr" => Ok(Self::Zephyr),
            "deepseek" => Ok(Self::DeepSeek),
            "gemma" | "gemma2" | "gemma3" | "gemma-3" => Ok(Self::Gemma),
            "plain" | "raw" | "none" => Ok(Self::Plain),
            other => Err(format!(
                "unknown chat format '{other}' (use auto, chatml, llama3, llama2, mistral, zephyr, deepseek, gemma, plain)"
            )),
        }
    }

    /// Resolve `auto` from the model path, or return an explicit format.
    pub fn resolve(value: Option<&str>, model: &Path) -> Result<Self, String> {
        match value {
            Some(value) if !value.trim().is_empty() => Self::parse(value),
            _ => Ok(Self::detect(model)),
        }
    }

    /// Guess the wrapper from a GGUF filename. Unknown models get plain
    /// role-labelled text, which still works for base models.
    pub fn detect(model: &Path) -> Self {
        let name = model
            .file_name()
            .map(|name| name.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default();
        if name.contains("zephyr") {
            Self::Zephyr
        } else if name.contains("deepseek") {
            Self::DeepSeek
        } else if name.contains("gemma") {
            Self::Gemma
        } else if name.contains("llama-3") || name.contains("llama3") {
            Self::Llama3
        } else if name.contains("llama-2") || name.contains("llama2") {
            Self::Llama2
        } else if name.contains("mistral")
            || name.contains("mixtral")
            || name.contains("instruct")
        {
            Self::Mistral
        } else {
            Self::Plain
        }
    }

    /// Render messages into the model's expected chat prompt, ending with an
    /// assistant prefix so the next sampled token is the reply.
    pub fn render(&self, messages: &[ChatMessage]) -> String {
        match self {
            Self::Auto => Self::Plain.render(messages),
            Self::ChatMl => render_chatml(messages),
            Self::Llama3 => render_llama3(messages),
            Self::Llama2 => render_llama2(messages),
            Self::Mistral => render_mistral(messages),
            Self::Zephyr => render_zephyr(messages),
            Self::DeepSeek => render_deepseek(messages),
            Self::Gemma => render_gemma(messages),
            Self::Plain => render_plain(messages),
        }
    }
}

fn system_text(messages: &[ChatMessage]) -> String {
    messages
        .iter()
        .filter(|message| message.role.eq_ignore_ascii_case("system"))
        .map(|message| message.content.trim())
        .filter(|content| !content.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn conversation(messages: &[ChatMessage]) -> Vec<&ChatMessage> {
    messages
        .iter()
        .filter(|message| !message.role.eq_ignore_ascii_case("system"))
        .collect()
}

fn role(message: &ChatMessage) -> &str {
    let role = message.role.trim();
    if role.is_empty() {
        "user"
    } else {
        role
    }
}

fn is_user(message: &ChatMessage) -> bool {
    role(message).eq_ignore_ascii_case("user")
}

fn render_chatml(messages: &[ChatMessage]) -> String {
    let mut prompt = String::new();
    let system = system_text(messages);
    if !system.is_empty() {
        prompt.push_str("<|im_start|>system\n");
        prompt.push_str(&system);
        prompt.push_str("<|im_end|>\n");
    }
    for message in conversation(messages) {
        prompt.push_str("<|im_start|>");
        prompt.push_str(role(message));
        prompt.push('\n');
        prompt.push_str(&message.content);
        prompt.push_str("<|im_end|>\n");
    }
    prompt.push_str("<|im_start|>assistant\n");
    prompt
}

fn render_llama3(messages: &[ChatMessage]) -> String {
    let mut prompt = String::from("<|begin_of_text|>");
    let system = system_text(messages);
    if !system.is_empty() {
        prompt.push_str("<|start_header_id|>system<|end_header_id|>\n\n");
        prompt.push_str(&system);
        prompt.push_str("<|eot_id|>");
    }
    for message in conversation(messages) {
        prompt.push_str("<|start_header_id|>");
        prompt.push_str(role(message));
        prompt.push_str("<|end_header_id|>\n\n");
        prompt.push_str(&message.content);
        prompt.push_str("<|eot_id|>");
    }
    prompt.push_str("<|start_header_id|>assistant<|end_header_id|>\n\n");
    prompt
}

fn render_llama2(messages: &[ChatMessage]) -> String {
    let mut prompt = String::from("<s>");
    let system = system_text(messages);
    let turns = conversation(messages);
    for (index, message) in turns.iter().enumerate() {
        if is_user(message) {
            prompt.push_str("[INST] ");
            if index == 0 && !system.is_empty() {
                prompt.push_str("<<SYS>>\n");
                prompt.push_str(&system);
                prompt.push_str("\n<</SYS>>\n\n");
            }
            prompt.push_str(&message.content);
            prompt.push_str(" [/INST] ");
        } else {
            prompt.push_str(&message.content);
            if index + 1 < turns.len() {
                prompt.push_str(" </s><s> ");
            }
        }
    }
    prompt
}

fn render_mistral(messages: &[ChatMessage]) -> String {
    let system = system_text(messages);
    let mut prompt = String::new();
    for (index, message) in conversation(messages).iter().enumerate() {
        if is_user(message) {
            prompt.push_str("[INST] ");
            if index == 0 && !system.is_empty() {
                prompt.push_str(&system);
                prompt.push_str("\n\n");
            }
            prompt.push_str(&message.content);
            prompt.push_str(" [/INST]");
        } else {
            prompt.push(' ');
            prompt.push_str(&message.content);
            prompt.push_str("</s>");
        }
    }
    prompt
}

fn render_zephyr(messages: &[ChatMessage]) -> String {
    let mut prompt = String::from("<|system|>\n");
    prompt.push_str(&system_text(messages));
    prompt.push_str("</s>\n");
    for message in conversation(messages) {
        prompt.push_str(if is_user(message) {
            "<|user|>\n"
        } else {
            "<|assistant|>\n"
        });
        prompt.push_str(&message.content);
        prompt.push_str("</s>\n");
    }
    prompt.push_str("<|assistant|>\n");
    prompt
}

fn render_deepseek(messages: &[ChatMessage]) -> String {
    let mut prompt = String::new();
    let system = system_text(messages);
    if !system.is_empty() {
        prompt.push_str(&system);
        prompt.push('\n');
    }
    for message in conversation(messages) {
        prompt.push_str(if is_user(message) {
            "<｜User｜>"
        } else {
            "<｜Assistant｜>"
        });
        prompt.push_str(&message.content);
    }
    prompt.push_str("<｜Assistant｜>\n");
    prompt
}

/// Gemma's turn markers. The tokenizer's post-processor adds `<bos>`, so the
/// rendered prompt deliberately starts with `<start_of_turn>`. A system
/// message is folded into the first user turn, as Gemma's template expects.
fn render_gemma(messages: &[ChatMessage]) -> String {
    let system = system_text(messages);
    let mut prompt = String::new();
    for (index, message) in conversation(messages).iter().enumerate() {
        prompt.push_str("<start_of_turn>");
        prompt.push_str(if is_user(message) { "user" } else { "model" });
        prompt.push('\n');
        if index == 0 && is_user(message) && !system.is_empty() {
            prompt.push_str("System: ");
            prompt.push_str(&system);
            prompt.push_str("\n\n");
        }
        prompt.push_str(&message.content);
        prompt.push_str("<end_of_turn>\n");
    }
    prompt.push_str("<start_of_turn>model\n");
    prompt
}

fn render_plain(messages: &[ChatMessage]) -> String {
    let mut prompt = String::new();
    let system = system_text(messages);
    if !system.is_empty() {
        prompt.push_str("System: ");
        prompt.push_str(&system);
        prompt.push('\n');
    }
    for message in conversation(messages) {
        let role = role(message);
        let mut chars = role.chars();
        let label = match chars.next() {
            Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
            None => "User".to_string(),
        };
        prompt.push_str(&label);
        prompt.push_str(": ");
        prompt.push_str(&message.content);
        prompt.push('\n');
    }
    prompt.push_str("Assistant: ");
    prompt
}

/// Resolved input files for one local model.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelPaths {
    pub model: PathBuf,
    pub tokenizer: PathBuf,
}

impl ModelPaths {
    /// Accept either a GGUF file or a directory containing exactly one
    /// GGUF/GGML file. The tokenizer is an explicit file/directory, or
    /// `tokenizer.json` next to the weights.
    pub fn resolve(model: &Path, tokenizer: Option<&Path>) -> Result<Self, String> {
        let model = if model.is_dir() {
            discover_weights(model)?
        } else {
            model.to_path_buf()
        };
        if !model.is_file() {
            return Err(format!("LLM model file not found: {}", model.display()));
        }

        let tokenizer = match tokenizer {
            Some(path) if path.is_dir() => path.join("tokenizer.json"),
            Some(path) => path.to_path_buf(),
            None => model
                .parent()
                .unwrap_or_else(|| Path::new("."))
                .join("tokenizer.json"),
        };
        if !tokenizer.is_file() {
            return Err(format!(
                "tokenizer not found: {} (pass --llm-tokenizer or place tokenizer.json beside the GGUF)",
                tokenizer.display()
            ));
        }
        Ok(Self { model, tokenizer })
    }
}

fn discover_weights(dir: &Path) -> Result<PathBuf, String> {
    let mut found: Vec<PathBuf> = fs::read_dir(dir)
        .map_err(|error| format!("cannot read model directory {}: {error}", dir.display()))?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| {
            path.is_file()
                && path
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .is_some_and(|extension| {
                        matches!(extension.to_ascii_lowercase().as_str(), "gguf" | "ggml")
                    })
        })
        .collect();
    found.sort();
    match found.len() {
        0 => Err(format!(
            "no .gguf or .ggml weights in {}",
            dir.display()
        )),
        1 => Ok(found.remove(0)),
        count => Err(format!(
            "found {count} GGUF files in {}; pass --llm-model with an exact path",
            dir.display()
        )),
    }
}

/// Trim a prompt from the left so generation still has context room.
pub fn fit_context(ids: &[u32], max_new: usize) -> Vec<u32> {
    let max_new = max_new.min(CONTEXT_LIMIT - 1);
    let keep = CONTEXT_LIMIT.saturating_sub(max_new + 8).max(1);
    if ids.len() <= keep {
        ids.to_vec()
    } else {
        ids[ids.len() - keep..].to_vec()
    }
}

fn eos_token_ids(tokenizer: &Tokenizer) -> HashSet<u32> {
    let vocab = tokenizer.get_vocab(true);
    EOS_TOKENS
        .iter()
        .filter_map(|token| vocab.get(*token).copied())
        .collect()
}

fn penalize_logits(
    values: &mut [f32],
    counts: &HashMap<u32, usize>,
    frequency: f32,
    presence: f32,
) {
    for (&id, &count) in counts {
        if let Some(value) = values.get_mut(id as usize) {
            *value -= frequency * count as f32 + presence;
        }
    }
}

fn penalize_probs(
    probs: &mut [f32],
    counts: &HashMap<u32, usize>,
    frequency: f32,
    presence: f32,
) {
    for (&id, &count) in counts {
        if let Some(probability) = probs.get_mut(id as usize) {
            let factor = (1.0 + frequency * count as f32) * (1.0 + presence);
            *probability /= factor.max(1.0);
        }
    }
}

fn sample_next(
    logits: &Tensor,
    processor: &mut LogitsProcessor,
    counts: &HashMap<u32, usize>,
    req: &GenerateRequest,
) -> Result<u32, String> {
    let frequency = req.frequency_penalty.max(0.0);
    let presence = req.presence_penalty.max(0.0);

    if req.temperature <= 0.01 {
        // The Candle processor's argmax path ignores its callback, so greedy
        // sampling applies the penalties to logits directly.
        let mut values = logits.to_vec1::<f32>().map_err(error)?;
        penalize_logits(&mut values, counts, frequency, presence);
        let mut best = 0usize;
        for index in 1..values.len() {
            if values[index].total_cmp(&values[best]) == Ordering::Greater {
                best = index;
            }
        }
        return Ok(best as u32);
    }

    processor
        .sample_f(logits, |probs| {
            penalize_probs(probs, counts, frequency, presence)
        })
        .map_err(error)
}

fn earliest_stop(text: &str, stops: &[String]) -> Option<usize> {
    stops
        .iter()
        .filter(|stop| !stop.is_empty())
        .filter_map(|stop| text.find(stop))
        .min()
}

fn error(error: candle_core::Error) -> String {
    error.to_string()
}

/// Tensor dtypes Candle 0.11.1's GGUF reader understands. Newer llama.cpp
/// quantizations (IQ*, TQ*, FP8, ...) fail inside `Content::read` before any
/// architecture dispatch can happen, so check them first and explain the
/// limitation instead of surfacing "unknown dtype for tensor N".
const CANDLE_GGUF_DTYPES: &[u32] = &[
    0, 1, 2, 3, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 30,
];

/// GGUF details inspected before Candle touches the file. This is a small,
/// streaming header read: even a 27B model with a 10 MB metadata block only
/// needs its header scanned, not its tensor data loaded.
#[derive(Debug)]
struct GgufPreflight {
    architecture: String,
    dtypes: BTreeSet<u32>,
}

fn gguf_u32<R: Read>(reader: &mut R) -> Result<u32, String> {
    let mut bytes = [0u8; 4];
    reader
        .read_exact(&mut bytes)
        .map_err(|e| format!("truncated GGUF header: {e}"))?;
    Ok(u32::from_le_bytes(bytes))
}

fn gguf_u64<R: Read>(reader: &mut R) -> Result<u64, String> {
    let mut bytes = [0u8; 8];
    reader
        .read_exact(&mut bytes)
        .map_err(|e| format!("truncated GGUF header: {e}"))?;
    Ok(u64::from_le_bytes(bytes))
}

fn gguf_string<R: Read>(reader: &mut R) -> Result<String, String> {
    let len = gguf_u64(reader)? as usize;
    if len > 16 * 1024 * 1024 {
        return Err("GGUF metadata string is implausibly large".to_string());
    }
    let mut bytes = vec![0u8; len];
    reader
        .read_exact(&mut bytes)
        .map_err(|e| format!("truncated GGUF string: {e}"))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Skip one GGUF metadata value of the given type. Type 9 (array) carries an
/// element type and count, then either fixed-width elements or length-prefixed
/// strings. See `gguf_file::ValueType` in candle-core.
fn skip_gguf_value<R: Read + Seek>(reader: &mut R, value_type: u32) -> Result<(), String> {
    let width = match value_type {
        0 | 1 | 7 => Some(1u64),
        2 | 3 => Some(2),
        4 | 5 | 6 => Some(4),
        10 | 11 | 12 => Some(8),
        8 => {
            let _ = gguf_string(reader)?;
            return Ok(());
        }
        9 => {
            let element = gguf_u32(reader)?;
            let count = gguf_u64(reader)?;
            if count > 16 * 1024 * 1024 {
                return Err("GGUF metadata array is implausibly large".to_string());
            }
            if element == 8 {
                for _ in 0..count {
                    let _ = gguf_string(reader)?;
                }
                return Ok(());
            }
            let size = match element {
                0 | 1 | 7 => 1u64,
                2 | 3 => 2,
                4 | 5 | 6 => 4,
                10 | 11 | 12 => 8,
                other => return Err(format!("unsupported GGUF array element type {other}")),
            };
            reader
                .seek(SeekFrom::Current((count * size) as i64))
                .map_err(|e| format!("cannot skip GGUF metadata array: {e}"))?;
            return Ok(());
        }
        other => return Err(format!("unsupported GGUF metadata value type {other}")),
    };
    reader
        .seek(SeekFrom::Current(width.unwrap_or(0) as i64))
        .map_err(|e| format!("cannot skip GGUF metadata value: {e}"))?;
    Ok(())
}

fn preflight_gguf(path: &Path) -> Result<GgufPreflight, String> {
    let file = fs::File::open(path)
        .map_err(|e| format!("cannot open {}: {e}", path.display()))?;
    preflight_reader(BufReader::new(file))
}

fn preflight_reader<R: Read + Seek>(mut reader: R) -> Result<GgufPreflight, String> {
    let mut magic = [0u8; 4];
    reader
        .read_exact(&mut magic)
        .map_err(|e| format!("cannot read GGUF magic: {e}"))?;
    if &magic != crate::local::GGUF_MAGIC {
        return Err("model file is not a GGUF file".to_string());
    }
    let version = gguf_u32(&mut reader)?;
    if version < 2 || version > 3 {
        return Err(format!("unsupported GGUF version {version}"));
    }
    let tensor_count = gguf_u64(&mut reader)?;
    let kv_count = gguf_u64(&mut reader)?;
    if tensor_count > 100_000 || kv_count > 100_000 {
        return Err("GGUF header counts are implausibly large".to_string());
    }

    let mut architecture = None;
    for _ in 0..kv_count {
        let key = gguf_string(&mut reader)?;
        let value_type = gguf_u32(&mut reader)?;
        if key == "general.architecture" && value_type == 8 {
            architecture = Some(gguf_string(&mut reader)?);
        } else {
            skip_gguf_value(&mut reader, value_type)?;
        }
    }

    let mut dtypes = BTreeSet::new();
    for _ in 0..tensor_count {
        let _name = gguf_string(&mut reader)?;
        let dimensions = gguf_u32(&mut reader)? as usize;
        if dimensions > 4 {
            return Err(format!("GGUF tensor has {dimensions} dimensions (max 4)"));
        }
        // GGUF v1 stores u32 dimensions; v2/v3 store u64.
        let width = if version == 1 { 4 } else { 8 };
        reader
            .seek(SeekFrom::Current((dimensions * width) as i64))
            .map_err(|e| format!("cannot skip GGUF tensor shape: {e}"))?;
        dtypes.insert(gguf_u32(&mut reader)?);
        let _offset = gguf_u64(&mut reader)?;
    }

    Ok(GgufPreflight {
        architecture: architecture
            .map(|value| value.to_ascii_lowercase())
            .unwrap_or_else(|| "llama".to_string()),
        dtypes,
    })
}

fn validate_preflight(preflight: &GgufPreflight) -> Result<(), String> {
    let unsupported: Vec<u32> = preflight
        .dtypes
        .iter()
        .copied()
        .filter(|dtype| !CANDLE_GGUF_DTYPES.contains(dtype))
        .collect();
    if !unsupported.is_empty() {
        return Err(format!(
            "GGUF tensor dtype(s) {:?} are not supported by Candle 0.11.1; \
             re-quantize to Q4_K_M/Q5_K_M/Q8_0 for this backend, or serve the \
             file with llama.cpp and select Prism's `local` chat provider",
            unsupported
        ));
    }
    // Candle's quantized-llama runner accepts llama.cpp's generic `llama.*`
    // metadata for many families (Phi, Mistral, ...). Only reject architectures
    // whose block layout is known to be different and has no Candle runner.
    let arch = preflight.architecture.as_str();
    let unsupported = arch.starts_with("qwen35")
        || arch.starts_with("qwen4")
        || arch.starts_with("qwen3moe")
        || arch.starts_with("qwen2moe")
        || arch.starts_with("qwen3next")
        || arch.starts_with("gemma3n")
        || arch.starts_with("gemma4")
        || arch.starts_with("llama4")
        || arch.starts_with("deepseek")
        || arch.starts_with("glm")
        || arch.starts_with("mamba")
        || arch.starts_with("rwkv")
        || arch.starts_with("jamba");
    if unsupported {
        return Err(format!(
            "GGUF architecture '{arch}' is not supported by Candle 0.11.1; \
             serve the file with llama.cpp and select Prism's `local` chat provider"
        ));
    }
    Ok(())
}

/// GGUF architecture id, lowercased. Missing metadata yields `llama` so older
/// llama.cpp files that omit the key keep working.
fn architecture(content: &gguf_file::Content) -> String {
    content
        .metadata
        .get("general.architecture")
        .and_then(|value| value.to_string().ok())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_else(|| "llama".to_string())
}

/// One of the quantized Candle backends. All three expose the same
/// `forward(tokens, position) -> [batch, vocab]` contract; `clear_kv_cache`
/// is a no-op for Gemma because its `forward` at position 0 overwrites the
/// cached keys/values instead of appending to them.
enum QuantizedModel {
    Llama(quantized_llama::ModelWeights),
    Gemma3(quantized_gemma3::ModelWeights),
    Qwen3(quantized_qwen3::ModelWeights),
}

impl QuantizedModel {
    fn forward(&mut self, tokens: &Tensor, position: usize) -> Result<Tensor, candle_core::Error> {
        match self {
            Self::Llama(model) => model.forward(tokens, position),
            Self::Gemma3(model) => model.forward(tokens, position),
            Self::Qwen3(model) => model.forward(tokens, position),
        }
    }

    fn clear_kv_cache(&mut self) {
        match self {
            Self::Llama(model) => model.clear_kv_cache(),
            Self::Gemma3(_) => {}
            Self::Qwen3(model) => model.clear_kv_cache(),
        }
    }
}

/// A loaded, reusable quantized chat model. Generation takes `&mut self`
/// because Candle keeps a KV cache inside the model; callers must serialize
/// access (the local server does this with a mutex).
pub struct CandleLlm {
    paths: ModelPaths,
    format: ChatFormat,
    device: Device,
    tokenizer: Tokenizer,
    eos_ids: HashSet<u32>,
    model: QuantizedModel,
}

impl CandleLlm {
    /// Load GGUF weights and the separate tokenizer from local files.
    pub fn load(model: &Path, tokenizer: Option<&Path>, format: Option<&str>) -> Result<Self, String> {
        let paths = ModelPaths::resolve(model, tokenizer)?;
        validate_preflight(&preflight_gguf(&paths.model)?)?;
        let format = ChatFormat::resolve(format, &paths.model)?;
        let tokenizer = Tokenizer::from_file(&paths.tokenizer)
            .map_err(|error| format!("cannot load tokenizer: {error}"))?;
        let eos_ids = eos_token_ids(&tokenizer);
        let device = Device::Cpu;

        let mut file = fs::File::open(&paths.model)
            .map_err(|error| format!("cannot open {}: {error}", paths.model.display()))?;
        let content = gguf_file::Content::read(&mut file).map_err(error)?;
        let arch = architecture(&content);
        let model = match arch.as_str() {
            "gemma" | "gemma2" | "gemma3" | "gemma-embedding" => {
                QuantizedModel::Gemma3(
                    quantized_gemma3::ModelWeights::from_gguf(content, &mut file, &device)
                        .map_err(error)?,
                )
            }
            "qwen3" => QuantizedModel::Qwen3(
                quantized_qwen3::ModelWeights::from_gguf(content, &mut file, &device)
                    .map_err(error)?,
            ),
            _ => QuantizedModel::Llama(
                quantized_llama::ModelWeights::from_gguf(content, &mut file, &device)
                    .map_err(error)?,
            ),
        };

        Ok(Self {
            paths,
            format,
            device,
            tokenizer,
            eos_ids,
            model,
        })
    }

    /// Model path used for discovery and error messages.
    pub fn model_path(&self) -> &Path {
        &self.paths.model
    }

    /// Human-readable label for model listings.
    pub fn label(&self) -> String {
        self.paths
            .model
            .file_stem()
            .map(|stem| stem.to_string_lossy().into_owned())
            .unwrap_or_else(|| "candle-llm".to_string())
    }

    /// Run one chat completion. The same seed and request produce the same
    /// tokens (modulo Candle's CPU floating-point determinism).
    pub fn generate(&mut self, req: &GenerateRequest) -> Result<Generated, String> {
        if req.messages.is_empty() {
            return Err("at least one message is required".to_string());
        }
        if req.max_tokens == 0 {
            return Err("max_tokens must be greater than zero".to_string());
        }

        let prompt = self.format.render(&req.messages);
        let prompt_ids = self
            .tokenizer
            .encode(prompt, true)
            .map_err(|error| format!("cannot tokenize prompt: {error}"))?
            .get_ids()
            .to_vec();
        if prompt_ids.is_empty() {
            return Err("prompt tokenized to zero tokens".to_string());
        }
        let prompt_ids = fit_context(&prompt_ids, req.max_tokens);
        let max_new = req
            .max_tokens
            .min(CONTEXT_LIMIT.saturating_sub(prompt_ids.len() + 1));
        if max_new == 0 {
            return Err("prompt exceeds the model context window".to_string());
        }

        let seed = req
            .seed
            .unwrap_or_else(|| native_llm::resolve_seed(req));
        let top_p = if req.top_p >= 1.0 {
            None
        } else {
            Some(req.top_p.clamp(0.0, 1.0) as f64)
        };
        let temperature = if req.temperature <= 0.01 {
            None
        } else {
            Some(req.temperature.max(0.0) as f64)
        };
        let mut processor = LogitsProcessor::new(seed, temperature, top_p);
        let mut counts: HashMap<u32, usize> = HashMap::new();
        let mut generated: Vec<u32> = Vec::new();

        // Independent requests must not share KV cache state.
        self.model.clear_kv_cache();

        let input = Tensor::new(prompt_ids.as_slice(), &self.device)
            .map_err(error)?
            .unsqueeze(0)
            .map_err(error)?;
        let logits = self.model.forward(&input, 0).map_err(error)?.squeeze(0).map_err(error)?;
        let mut next = sample_next(&logits, &mut processor, &counts, req)?;

        let mut finish_reason = "length".to_string();
        let mut text = String::new();
        for index in 0..max_new {
            if self.eos_ids.contains(&next) {
                finish_reason = "stop".to_string();
                break;
            }
            generated.push(next);
            *counts.entry(next).or_insert(0) += 1;
            text = self
                .tokenizer
                .decode(&generated, true)
                .map_err(|error| format!("cannot decode generated tokens: {error}"))?;
            if let Some(cut) = earliest_stop(&text, &req.stop) {
                text.truncate(cut);
                finish_reason = "stop".to_string();
                break;
            }
            if index + 1 == max_new {
                break;
            }

            let input = Tensor::new(&[next], &self.device)
                .map_err(error)?
                .unsqueeze(0)
                .map_err(error)?;
            let logits = self
                .model
                .forward(&input, prompt_ids.len() + index)
                .map_err(error)?
                .squeeze(0)
                .map_err(error)?;
            next = sample_next(&logits, &mut processor, &counts, req)?;
        }

        Ok(Generated {
            text: text.trim().to_string(),
            tokens: generated.len(),
            finish_reason,
            seed,
            model: if req.model.trim().is_empty() {
                self.label()
            } else {
                req.model.trim().to_string()
            },
        })
    }

    /// Stream-safe chunks of already generated text. The neural engine
    /// produces a completion first; hosts can reuse these chunks for SSE or
    /// NDJSON without breaking UTF-8 boundaries.
    pub fn stream_chunks(_req: &GenerateRequest, generated: &Generated) -> Vec<String> {
        native_llm::chunk_text(&generated.text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn messages() -> Vec<ChatMessage> {
        vec![
            ChatMessage::text("system", "Be brief"),
            ChatMessage::text("user", "hello"),
            ChatMessage::text("assistant", "hi"),
            ChatMessage::text("user", "again"),
        ]
    }

    fn push_string(bytes: &mut Vec<u8>, value: &str) {
        bytes.extend_from_slice(&(value.len() as u64).to_le_bytes());
        bytes.extend_from_slice(value.as_bytes());
    }

    /// Minimal GGUF v3 with one architecture string and one tensor entry.
    fn synthetic_gguf(architecture: &str, dtype: u32) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"GGUF");
        bytes.extend_from_slice(&3u32.to_le_bytes());
        bytes.extend_from_slice(&1u64.to_le_bytes()); // tensor count
        bytes.extend_from_slice(&1u64.to_le_bytes()); // metadata count
        push_string(&mut bytes, "general.architecture");
        bytes.extend_from_slice(&8u32.to_le_bytes()); // string value
        push_string(&mut bytes, architecture);
        push_string(&mut bytes, "token_embd.weight");
        bytes.extend_from_slice(&2u32.to_le_bytes()); // two dimensions
        bytes.extend_from_slice(&4096u64.to_le_bytes());
        bytes.extend_from_slice(&256u64.to_le_bytes());
        bytes.extend_from_slice(&dtype.to_le_bytes());
        bytes.extend_from_slice(&0u64.to_le_bytes()); // tensor offset
        bytes
    }

    #[test]
    fn preflight_accepts_supported_gguf_headers() {
        for (architecture, dtype) in [("gemma3", 1u32), ("llama", 12), ("qwen3", 14)] {
            let mut bytes = std::io::Cursor::new(synthetic_gguf(architecture, dtype));
            let info = preflight_reader(&mut bytes).expect("header should parse");
            assert_eq!(info.architecture, architecture);
            assert_eq!(info.dtypes.iter().copied().collect::<Vec<_>>(), vec![dtype]);
            validate_preflight(&info).expect("backend should accept the model");
        }
    }

    #[test]
    fn preflight_explains_unsupported_quantization_and_architecture() {
        let mut bytes = std::io::Cursor::new(synthetic_gguf("qwen35", 21));
        let info = preflight_reader(&mut bytes).expect("header should parse");
        let error = validate_preflight(&info).expect_err("dtype 21 is not supported by Candle");
        assert!(error.contains("21"), "{error}");
        assert!(error.contains("Candle 0.11.1"), "{error}");
        assert!(error.contains("llama.cpp"), "{error}");

        let mut bytes = std::io::Cursor::new(synthetic_gguf("qwen35", 12));
        let info = preflight_reader(&mut bytes).expect("header should parse");
        let error = validate_preflight(&info).expect_err("qwen35 has no Candle runner");
        assert!(error.contains("qwen35"), "{error}");
        assert!(error.contains("local"), "{error}");
    }

    #[test]
    fn preflight_rejects_non_gguf_data() {
        let mut bytes = std::io::Cursor::new(b"not a model".to_vec());
        assert!(preflight_reader(&mut bytes).is_err());
    }

    #[test]
    fn format_ids_and_detection_are_stable() {
        assert_eq!(ChatFormat::parse("chat-ml").unwrap(), ChatFormat::ChatMl);
        assert_eq!(ChatFormat::parse("llama31").unwrap(), ChatFormat::Llama3);
        assert_eq!(ChatFormat::parse(" InStruct ").unwrap(), ChatFormat::Mistral);
        assert_eq!(ChatFormat::parse("gemma3").unwrap(), ChatFormat::Gemma);
        assert_eq!(ChatFormat::parse("raw").unwrap(), ChatFormat::Plain);
        assert!(ChatFormat::parse("magic").is_err());
        assert_eq!(
            ChatFormat::detect(Path::new("/models/zephyr-7b.Q4.gguf")),
            ChatFormat::Zephyr
        );
        assert_eq!(
            ChatFormat::detect(Path::new("/models/gemma-3-1b-it.F16.gguf")),
            ChatFormat::Gemma
        );
        assert_eq!(
            ChatFormat::detect(Path::new("/models/Meta-Llama-3-8B.gguf")),
            ChatFormat::Llama3
        );
        assert_eq!(
            ChatFormat::detect(Path::new("/models/model.gguf")),
            ChatFormat::Plain
        );
    }

    #[test]
    fn chat_formats_wrap_roles_and_end_with_assistant() {
        let messages = messages();
        let chatml = ChatFormat::ChatMl.render(&messages);
        assert!(chatml.starts_with("<|im_start|>system\nBe brief<|im_end|>"));
        assert!(chatml.contains("<|im_start|>user\nhello<|im_end|>"));
        assert!(chatml.ends_with("<|im_start|>assistant\n"));

        let llama3 = ChatFormat::Llama3.render(&messages);
        assert!(llama3.starts_with(
            "<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\nBe brief<|eot_id|>"
        ));
        assert!(llama3.contains("<|start_header_id|>user<|end_header_id|>\n\nhello<|eot_id|>"));
        assert!(llama3.ends_with(
            "<|start_header_id|>assistant<|end_header_id|>\n\n"
        ));

        let llama2 = ChatFormat::Llama2.render(&messages);
        assert!(llama2.contains("<<SYS>>\nBe brief\n<</SYS>>"));
        assert!(llama2.contains("hello [/INST]"));
        assert!(llama2.ends_with("[INST] again [/INST] "));

        let mistral = ChatFormat::Mistral.render(&messages);
        assert!(mistral.starts_with("[INST] Be brief\n\nhello [/INST]"));
        assert!(mistral.ends_with("[INST] again [/INST]"));

        let zephyr = ChatFormat::Zephyr.render(&messages);
        assert!(zephyr.starts_with("<|system|>\nBe brief</s>\n"));
        assert!(zephyr.ends_with("<|assistant|>\n"));

        let deepseek = ChatFormat::DeepSeek.render(&messages);
        assert!(deepseek.contains("<｜User｜>hello"));
        assert!(deepseek.ends_with("<｜Assistant｜>\n"));

        let gemma = ChatFormat::Gemma.render(&messages);
        assert!(gemma.starts_with(
            "<start_of_turn>user\nSystem: Be brief\n\nhello<end_of_turn>\n"
        ));
        assert!(gemma.contains("<start_of_turn>model\nhi<end_of_turn>\n"));
        assert!(gemma.ends_with("<start_of_turn>model\n"));

        let plain = ChatFormat::Plain.render(&messages);
        assert!(plain.starts_with("System: Be brief\nUser: hello\nAssistant: hi\nUser: again\n"));
        assert!(plain.ends_with("Assistant: "));
    }

    #[test]
    fn model_paths_discover_a_single_gguf_and_sibling_tokenizer() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("model.gguf"), b"not-read-here").unwrap();
        fs::write(dir.path().join("tokenizer.json"), b"{}").unwrap();

        let paths = ModelPaths::resolve(dir.path(), None).unwrap();
        assert_eq!(paths.model, dir.path().join("model.gguf"));
        assert_eq!(paths.tokenizer, dir.path().join("tokenizer.json"));

        let explicit = ModelPaths::resolve(
            &dir.path().join("model.gguf"),
            Some(dir.path()),
        )
        .unwrap();
        assert_eq!(explicit.tokenizer, dir.path().join("tokenizer.json"));
    }

    #[test]
    fn missing_tokenizer_has_an_actionable_error() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("model.gguf"), b"weights").unwrap();
        let error = ModelPaths::resolve(&dir.path().join("model.gguf"), None).unwrap_err();
        assert!(error.contains("--llm-tokenizer"), "{error}");
        assert!(error.contains("tokenizer.json"), "{error}");
    }

    #[test]
    fn ambiguous_and_empty_model_directories_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let error = ModelPaths::resolve(dir.path(), None).unwrap_err();
        assert!(error.contains("no .gguf"), "{error}");

        fs::write(dir.path().join("a.gguf"), b"a").unwrap();
        fs::write(dir.path().join("b.gguf"), b"b").unwrap();
        let error = ModelPaths::resolve(dir.path(), None).unwrap_err();
        assert!(error.contains("pass --llm-model"), "{error}");
    }

    #[test]
    fn context_trimming_keeps_the_newest_tokens() {
        let ids: Vec<u32> = (0..(CONTEXT_LIMIT + 50) as u32).collect();
        let trimmed = fit_context(&ids, 128);
        assert!(trimmed.len() < CONTEXT_LIMIT);
        assert_eq!(trimmed.last().copied(), ids.last().copied());
        assert_eq!(
            trimmed.first().copied(),
            Some((ids.len() - trimmed.len()) as u32)
        );

        let short = fit_context(&[7, 8, 9], 128);
        assert_eq!(short, vec![7, 8, 9]);
    }

    #[test]
    fn penalties_are_deterministic_and_directional() {
        let counts = HashMap::from([(3u32, 2usize), (9, 1)]);
        let mut logits = vec![0.5f32; 12];
        penalize_logits(&mut logits, &counts, 0.5, 0.2);
        assert!((logits[3] - (-0.7)).abs() < 1e-6);
        assert!((logits[9] - (-0.2)).abs() < 1e-6);
        assert_eq!(logits[4], 0.5);

        let mut probs = vec![0.25f32; 12];
        penalize_probs(&mut probs, &counts, 0.5, 0.2);
        assert!(probs[3] < probs[9]);
        assert!(probs[9] < probs[4]);
    }

    #[test]
    fn stop_sequences_use_the_earliest_match() {
        assert_eq!(
            earliest_stop("hello STOP then END", &["END".to_string(), "STOP".to_string()]),
            Some(6)
        );
        assert_eq!(earliest_stop("hello", &[]), None);
    }

    #[test]
    fn chunks_join_back_to_the_generated_text() {
        let generated = Generated {
            text: "Hello, world — okay".to_string(),
            tokens: 4,
            finish_reason: "stop".to_string(),
            seed: 1,
            model: "m".to_string(),
        };
        let request = GenerateRequest::user("hi");
        assert_eq!(
            CandleLlm::stream_chunks(&request, &generated).concat(),
            generated.text
        );
    }

    #[test]
    fn real_gguf_runs_only_when_weights_are_supplied() {
        let Ok(model) = std::env::var("PRISM_CANDLE_LLM_MODEL") else {
            return;
        };
        let tokenizer = std::env::var("PRISM_CANDLE_LLM_TOKENIZER").ok();
        let format = std::env::var("PRISM_CANDLE_LLM_FORMAT").ok();
        let mut llm = CandleLlm::load(
            Path::new(&model),
            tokenizer.as_deref().map(Path::new),
            format.as_deref(),
        )
        .expect("configured Candle LLM should load");
        let mut request = GenerateRequest::user("Reply with one short sentence.");
        request.temperature = 0.0;
        request.seed = Some(7);
        request.max_tokens = 24;
        let generated = llm.generate(&request).expect("generation should succeed");
        assert!(!generated.text.trim().is_empty());
        assert!(generated.tokens > 0);
    }

    /// Fast compatibility probe for a real GGUF. Set `PRISM_CANDLE_LLM_MODEL`
    /// to any local GGUF to inspect its architecture and tensor dtypes without
    /// loading weights or tokenizing anything.
    #[test]
    fn real_gguf_preflight_when_weights_are_supplied() {
        let Ok(model) = std::env::var("PRISM_CANDLE_LLM_MODEL") else {
            return;
        };
        let info = preflight_gguf(Path::new(&model)).expect("real GGUF should parse");
        println!(
            "preflight: architecture={}, dtypes={:?}, validation={:?}",
            info.architecture,
            info.dtypes.iter().copied().collect::<Vec<_>>(),
            validate_preflight(&info)
        );
        assert!(!info.dtypes.is_empty());
    }

    /// Set `PRISM_GEMMA3_MODEL` and `PRISM_GEMMA3_TOKENIZER` to run a real
    /// Gemma 3 GGUF through Candle's quantized Gemma backend.
    #[test]
    fn real_gemma3_runs_when_weights_are_supplied() {
        let Ok(model) = std::env::var("PRISM_GEMMA3_MODEL") else {
            return;
        };
        let tokenizer = std::env::var("PRISM_GEMMA3_TOKENIZER").ok();
        let mut llm = CandleLlm::load(
            Path::new(&model),
            tokenizer.as_deref().map(Path::new),
            Some("gemma"),
        )
        .expect("configured Gemma Candle LLM should load");
        let mut request = GenerateRequest::user("Reply with one short sentence.");
        request.temperature = 0.0;
        request.seed = Some(7);
        request.max_tokens = 4;
        let generated = llm.generate(&request).expect("generation should succeed");
        assert!(!generated.text.trim().is_empty());
        assert!(generated.tokens > 0);
    }
}
