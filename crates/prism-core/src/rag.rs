//! Session-scoped retrieval over local documents.
//!
//! A deliberately small, dependency-free retriever: documents are read
//! from disk, split into paragraph-sized chunks, tokenized and scored
//! with TF-IDF over the session's chunks. It runs everywhere the core
//! runs (including WASM hosts) and needs no embedding endpoint, which
//! makes `/rag` usable offline; hosted embedding stores can be layered
//! on later without changing the [`RagStore`] surface the TUI uses.

use std::collections::HashMap;
use std::path::Path;

/// One indexed chunk.
#[derive(Debug, Clone, PartialEq)]
pub struct Chunk {
    /// 0-based chunk index inside its document.
    pub index: usize,
    pub text: String,
    tokens: Vec<String>,
}

/// One ingested document.
#[derive(Debug, Clone, PartialEq)]
pub struct Document {
    pub id: String,
    pub title: String,
    pub path: String,
    pub chunks: Vec<Chunk>,
}

impl Document {
    pub fn chunk_count(&self) -> usize {
        self.chunks.len()
    }
}

/// A scored chunk from [`RagStore::search`].
#[derive(Debug, Clone)]
pub struct Hit<'a> {
    pub document: &'a Document,
    pub chunk: &'a Chunk,
    pub score: f64,
}

/// In-memory session store. Documents are never mutated after ingest.
#[derive(Debug, Clone, Default)]
pub struct RagStore {
    pub documents: Vec<Document>,
}

impl RagStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_empty(&self) -> bool {
        self.documents.is_empty()
    }

    /// Number of indexed chunks across all documents.
    pub fn chunk_count(&self) -> usize {
        self.documents.iter().map(|d| d.chunks.len()).sum()
    }

    /// Read and index a local file. Re-ingesting the same path replaces
    /// the previous copy so edits do not pile up.
    pub fn ingest_path(&mut self, path: &Path) -> Result<&Document, String> {
        let text =
            std::fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))?;
        let path_text = path.display().to_string();
        let title = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(&path_text)
            .to_string();
        self.ingest(&path_text, &title, &text)
    }

    /// Index text that came from somewhere else (web page, paste).
    pub fn ingest(&mut self, path: &str, title: &str, text: &str) -> Result<&Document, String> {
        let chunks = chunk_document(text);
        if chunks.is_empty() {
            return Err(format!("{title}: no indexable text"));
        }
        self.documents.retain(|d| d.path != path);
        let id = format!("rag_{}", self.documents.len() + 1);
        self.documents.push(Document {
            id,
            title: title.to_string(),
            path: path.to_string(),
            chunks,
        });
        Ok(self.documents.last().expect("just pushed"))
    }

    pub fn clear(&mut self) {
        self.documents.clear();
    }

    /// Best `k` chunks for `query`, highest score first. IDF comes from
    /// the whole session, so terms that appear everywhere (boilerplate)
    /// lose to distinctive ones.
    pub fn search(&self, query: &str, k: usize) -> Vec<Hit<'_>> {
        let terms = tokens(query);
        if terms.is_empty() || k == 0 {
            return Vec::new();
        }
        let total = self.chunk_count().max(1) as f64;
        let mut doc_freq: HashMap<&str, usize> = HashMap::new();
        for doc in &self.documents {
            let mut seen: HashMap<&str, ()> = HashMap::new();
            for chunk in &doc.chunks {
                for token in &chunk.tokens {
                    if terms.contains(token) {
                        seen.insert(token.as_str(), ());
                    }
                }
            }
            for token in seen.keys() {
                *doc_freq.entry(token).or_insert(0) += 1;
            }
        }
        let mut hits: Vec<Hit<'_>> = Vec::new();
        for doc in &self.documents {
            for chunk in &doc.chunks {
                let mut score = 0.0;
                for term in &terms {
                    let tf = chunk.tokens.iter().filter(|t| *t == term).count();
                    if tf == 0 {
                        continue;
                    }
                    let df = *doc_freq.get(term.as_str()).unwrap_or(&1) as f64;
                    let idf = (1.0 + total / df).ln();
                    score += (1.0 + tf as f64).ln() * idf;
                }
                if score > 0.0 {
                    hits.push(Hit {
                        document: doc,
                        chunk,
                        score,
                    });
                }
            }
        }
        hits.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.document.id.cmp(&b.document.id))
                .then_with(|| a.chunk.index.cmp(&b.chunk.index))
        });
        hits.truncate(k);
        hits
    }

    /// Model-facing context block for the top hits, or an empty string
    /// when nothing matched.
    pub fn context(&self, query: &str, k: usize) -> String {
        format_context(&self.search(query, k))
    }
}

/// Split text into paragraph chunks of roughly `MAX_CHARS`, splitting
/// overlong paragraphs on sentence/word boundaries.
fn chunk_document(text: &str) -> Vec<Chunk> {
    const MAX_CHARS: usize = 900;
    let mut chunks: Vec<String> = Vec::new();
    for paragraph in text.split("\n\n") {
        let paragraph = paragraph.trim();
        if paragraph.is_empty() {
            continue;
        }
        // One paragraph = one chunk; overlong paragraphs are split so a
        // single wall of text still retrieves at sentence scale.
        chunks.extend(split_long(paragraph, MAX_CHARS));
    }
    chunks
        .into_iter()
        .enumerate()
        .map(|(index, text)| Chunk {
            index,
            tokens: tokens(&text),
            text,
        })
        .collect()
}

/// Hard-split a paragraph longer than `max` at whitespace boundaries.
fn split_long(text: &str, max: usize) -> Vec<String> {
    if text.chars().count() <= max {
        return vec![text.to_string()];
    }
    let mut out = Vec::new();
    let mut current = String::new();
    let mut len = 0;
    for word in text.split_whitespace() {
        let wlen = word.chars().count();
        if len > 0 && len + 1 + wlen > max {
            out.push(current.trim().to_string());
            current.clear();
            len = 0;
        }
        if len > 0 {
            current.push(' ');
            len += 1;
        }
        current.push_str(word);
        len += wlen;
    }
    if !current.trim().is_empty() {
        out.push(current.trim().to_string());
    }
    out
}

fn tokens(text: &str) -> Vec<String> {
    const STOP: &[&str] = &[
        "the", "and", "for", "with", "this", "that", "from", "into", "your", "you", "are", "was",
        "were", "have", "has", "not", "but", "all", "any", "can", "will", "would", "there",
        "their", "what", "when", "where", "which", "how", "why", "its", "it's",
    ];
    text.split(|c: char| !c.is_alphanumeric())
        .filter_map(|raw| {
            let token = raw.to_lowercase();
            if token.chars().count() < 3 || STOP.contains(&token.as_str()) {
                None
            } else {
                Some(token)
            }
        })
        .collect()
}

/// Format hits for insertion into a prompt. Numbered so a model can
/// cite sources; stable order is the retrieval order.
pub fn format_context(hits: &[Hit<'_>]) -> String {
    if hits.is_empty() {
        return String::new();
    }
    let mut out = String::from("Retrieved context (cite as [n] when used):\n");
    for (i, hit) in hits.iter().enumerate() {
        out.push_str(&format!(
            "\n[{}] {} (chunk {})\n{}\n",
            i + 1,
            hit.document.title,
            hit.chunk.index + 1,
            hit.chunk.text.trim()
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunks_split_paragraphs_and_long_text() {
        let text = format!(
            "{}\n\nshort second paragraph\n\n{}",
            "alpha ".repeat(400),
            "beta ".repeat(50)
        );
        let chunks = chunk_document(&text);
        assert!(chunks.len() >= 3, "{}", chunks.len());
        assert!(chunks.iter().all(|c| c.text.chars().count() <= 950));
        assert!(chunks.iter().all(|c| !c.text.trim().is_empty()));
    }

    #[test]
    fn search_ranks_the_document_that_answers() {
        let mut store = RagStore::new();
        store
            .ingest(
                "a.md",
                "alpha",
                "The reactor coolant loop uses heavy water and boron control rods.",
            )
            .unwrap();
        store
            .ingest(
                "b.md",
                "beta",
                "Sourdough needs flour, water, salt and a starter.",
            )
            .unwrap();
        let hits = store.search("boron control rods reactor", 2);
        assert!(!hits.is_empty());
        assert_eq!(hits[0].document.title, "alpha");
        // An unrelated query scores nothing.
        assert!(store.search("quantum chromodynamics", 3).is_empty());
    }

    #[test]
    fn reingesting_a_path_replaces_the_document() {
        let mut store = RagStore::new();
        store.ingest("p.md", "one", "first body").unwrap();
        store.ingest("p.md", "two", "second body").unwrap();
        assert_eq!(store.documents.len(), 1);
        assert_eq!(store.documents[0].title, "two");
    }

    #[test]
    fn context_is_numbered_and_empty_when_nothing_matches() {
        let mut store = RagStore::new();
        store
            .ingest("d.md", "docs", "Prism stores conversations as JSON files.")
            .unwrap();
        let ctx = store.context("conversations JSON", 1);
        assert!(ctx.contains("[1] docs"), "{ctx}");
        assert!(store.context("zebra", 1).is_empty());
    }
}
