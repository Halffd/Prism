//! Web search and deep research.
//!
//! The core owns the whole pipeline so every surface (CLI, TUI, Slint)
//! shares one implementation:
//!
//! 1. [`search`] queries a backend (DuckDuckGo HTML or a self-hosted
//!    SearXNG instance) through the injected [`Transport`];
//! 2. [`fetch_page`] downloads a result and reduces the HTML to text;
//! 3. [`deep_search`] runs 1–2, then asks a configured model to
//!    synthesize an answer with citations.
//!
//! Nothing here opens a socket directly, and every parser is a pure
//! function so the fixtures below exercise them without a network.

use crate::client::ChatMessage;
use crate::ensemble::{self, CompletionTarget};
use crate::settings::Settings;
use crate::transport::{HttpRequest, Transport};
use serde::{Deserialize, Serialize};

/// How many characters of an extracted page are kept. Long pages are
/// truncated on a word boundary; the synthesis prompt stays affordable.
pub const MAX_PAGE_CHARS: usize = 12_000;

/// One search hit.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
    /// Backend that produced the hit ("duckduckgo" | "searxng").
    pub source: String,
}

/// A completed search, including failures: callers always get the
/// provider name and any error so they can show partial state.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SearchOutcome {
    pub query: String,
    pub provider: String,
    pub results: Vec<SearchResult>,
    pub error: Option<String>,
}

impl SearchOutcome {
    fn failed(query: &str, provider: &str, error: impl Into<String>) -> Self {
        SearchOutcome {
            query: query.to_string(),
            provider: provider.to_string(),
            results: Vec::new(),
            error: Some(error.into()),
        }
    }

    pub fn ok(&self) -> bool {
        self.error.is_none() && !self.results.is_empty()
    }
}

/// One fetched page.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct PageContent {
    pub title: String,
    pub url: String,
    /// Extracted readable text; `None` when the fetch or extraction
    /// failed (see `error`).
    pub text: Option<String>,
    pub error: Option<String>,
}

/// The result of a deep search: search hits, fetched pages and a model
/// synthesis. `summary` may be empty while `summary_error` explains why.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct DeepSearch {
    pub query: String,
    pub provider: String,
    pub results: Vec<SearchResult>,
    pub pages: Vec<PageContent>,
    pub summary: String,
    pub summary_error: Option<String>,
    pub search_error: Option<String>,
    /// Model that wrote the summary, when one was used.
    pub summary_model: String,
}

/// Selected backend from settings.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SearchProvider {
    DuckDuckGo,
    SearXng,
}

impl SearchProvider {
    pub fn parse(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "searxng" | "searx" => Self::SearXng,
            _ => Self::DuckDuckGo,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::DuckDuckGo => "duckduckgo",
            Self::SearXng => "searxng",
        }
    }
}

/// Backend chosen by `Settings::search_provider`.
pub fn provider(settings: &Settings) -> SearchProvider {
    SearchProvider::parse(&settings.search_provider)
}

fn search_url(settings: &Settings, query: &str) -> Result<String, String> {
    let encoded = percent_encode(query);
    match provider(settings) {
        SearchProvider::DuckDuckGo => Ok(format!(
            "https://html.duckduckgo.com/html/?q={encoded}"
        )),
        SearchProvider::SearXng => {
            let base = settings.searxng_url.trim().trim_end_matches('/');
            if base.is_empty() {
                return Err("searxng_url is empty; set it in settings".into());
            }
            Ok(format!("{base}/search?q={encoded}&format=json"))
        }
    }
}

fn search_headers(settings: &Settings) -> Vec<(String, String)> {
    let mut headers = vec![
        (
            "User-Agent".to_string(),
            "Mozilla/5.0 (X11; Linux x86_64) Prism/0.1".to_string(),
        ),
        ("Accept".to_string(), "text/html,application/json".to_string()),
    ];
    if provider(settings) == SearchProvider::SearXng {
        // A configured key is optional, but pass it when present.
        let key = settings.key_for("searxng");
        if !key.trim().is_empty() {
            headers.push(("X-API-Key".to_string(), key.trim().to_string()));
        }
    }
    headers
}

/// Run a web search. Never fails: transport and parse problems land in
/// [`SearchOutcome::error`] so the UI can show them inline.
pub async fn search<T: Transport + ?Sized>(
    transport: &T,
    settings: &Settings,
    query: &str,
    limit: usize,
) -> SearchOutcome {
    let provider = provider(settings);
    let query = query.trim();
    if query.is_empty() {
        return SearchOutcome::failed("", provider.label(), "empty search query");
    }
    let url = match search_url(settings, query) {
        Ok(url) => url,
        Err(e) => return SearchOutcome::failed(query, provider.label(), e),
    };
    let req = HttpRequest {
        url,
        headers: search_headers(settings),
        body: None,
    };
    let raw = match transport.get_body(req).await {
        Ok(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
        Err(e) => return SearchOutcome::failed(query, provider.label(), e),
    };
    let parsed = match provider {
        SearchProvider::DuckDuckGo => parse_ddg(&raw),
        SearchProvider::SearXng => parse_searxng(&raw),
    };
    match parsed {
        Ok(mut results) => {
            let limit = limit.max(1);
            results.truncate(limit);
            SearchOutcome {
                query: query.to_string(),
                provider: provider.label().to_string(),
                results,
                error: None,
            }
        }
        Err(e) => SearchOutcome {
            query: query.to_string(),
            provider: provider.label().to_string(),
            results: Vec::new(),
            error: Some(e),
        },
    }
}

/// Parse DuckDuckGo's no-JS HTML result page.
pub fn parse_ddg(html: &str) -> Result<Vec<SearchResult>, String> {
    let anchors = regex::Regex::new(
        r#"(?is)<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)</a>"#,
    )
    .expect("static regex");
    let snippets = regex::Regex::new(
        r#"(?is)<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>(.*?)</a>"#,
    )
    .expect("static regex");
    let snippet_bits: Vec<String> = snippets
        .captures_iter(html)
        .map(|c| html_to_text(&c[1]))
        .collect();
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for (i, caps) in anchors.captures_iter(html).enumerate() {
        let url = unwrap_ddg_url(&decode_entities(&caps[1]));
        if url.is_empty() || !seen.insert(url.clone()) {
            continue;
        }
        let title = html_to_text(&caps[2]);
        if title.is_empty() {
            continue;
        }
        out.push(SearchResult {
            title,
            url,
            snippet: snippet_bits.get(i).cloned().unwrap_or_default(),
            source: "duckduckgo".into(),
        });
    }
    if out.is_empty() {
        // An empty page is a legitimate "no results"; a page that looks
        // like a block/captcha is an error worth surfacing.
        let lower = html.to_lowercase();
        if lower.contains("captcha") || lower.contains("unusual traffic") {
            return Err("duckduckgo blocked the request (captcha)".into());
        }
        if html.trim().is_empty() {
            return Err("duckduckgo returned an empty page".into());
        }
    }
    Ok(out)
}

/// Parse a SearXNG JSON search response.
pub fn parse_searxng(body: &str) -> Result<Vec<SearchResult>, String> {
    let value: serde_json::Value =
        serde_json::from_str(body).map_err(|e| format!("searxng json: {e}"))?;
    if let Some(error) = value.get("error").and_then(|e| e.as_str()) {
        return Err(error.to_string());
    }
    let Some(items) = value.get("results").and_then(|r| r.as_array()) else {
        return Err("searxng response has no results array".into());
    };
    let mut out = Vec::new();
    for item in items {
        let url = item.get("url").and_then(|u| u.as_str()).unwrap_or("").trim();
        if url.is_empty() {
            continue;
        }
        out.push(SearchResult {
            title: item
                .get("title")
                .and_then(|t| t.as_str())
                .unwrap_or(url)
                .trim()
                .to_string(),
            url: url.to_string(),
            snippet: item
                .get("content")
                .or_else(|| item.get("snippet"))
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .trim()
                .to_string(),
            source: "searxng".into(),
        });
    }
    Ok(out)
}

/// Download one result and extract its readable text.
pub async fn fetch_page<T: Transport + ?Sized>(transport: &T, result: &SearchResult) -> PageContent {
    let req = HttpRequest {
        url: result.url.clone(),
        headers: vec![
            (
                "User-Agent".to_string(),
                "Mozilla/5.0 (X11; Linux x86_64) Prism/0.1".to_string(),
            ),
            ("Accept".to_string(), "text/html,text/plain".to_string()),
        ],
        body: None,
    };
    match transport.get_body(req).await {
        Ok(bytes) => {
            let raw = String::from_utf8_lossy(&bytes);
            let text = truncate_chars(&html_to_text(&raw), MAX_PAGE_CHARS);
            if text.trim().is_empty() {
                PageContent {
                    title: result.title.clone(),
                    url: result.url.clone(),
                    text: None,
                    error: Some("page has no readable text".into()),
                }
            } else {
                PageContent {
                    title: result.title.clone(),
                    url: result.url.clone(),
                    text: Some(text),
                    error: None,
                }
            }
        }
        Err(e) => PageContent {
            title: result.title.clone(),
            url: result.url.clone(),
            text: None,
            error: Some(e),
        },
    }
}

/// Search, fetch the top `fetch_count` pages, then synthesize.
///
/// `target` is the model that writes the summary; when it is `None` the
/// pages are still returned with an explanatory `summary_error` so the
/// caller can show raw research instead of an empty screen.
pub async fn deep_search<T: Transport + ?Sized>(
    transport: &T,
    settings: &Settings,
    target: Option<&CompletionTarget>,
    query: &str,
    limit: usize,
    fetch_count: usize,
) -> DeepSearch {
    let outcome = search(transport, settings, query, limit).await;
    let mut deep = DeepSearch {
        query: outcome.query.clone(),
        provider: outcome.provider.clone(),
        results: outcome.results.clone(),
        pages: Vec::new(),
        summary: String::new(),
        summary_error: outcome.error.clone(),
        search_error: outcome.error.clone(),
        summary_model: target.map(|t| t.model.clone()).unwrap_or_default(),
    };
    if !outcome.ok() {
        if deep.search_error.is_none() {
            deep.search_error = Some("no search results".into());
        }
        if deep.summary_error.is_none() {
            deep.summary_error = Some("no search results to synthesize".into());
        }
        return deep;
    }

    for result in deep.results.iter().take(fetch_count.max(1)) {
        deep.pages.push(fetch_page(transport, result).await);
    }

    let Some(target) = target else {
        deep.summary_error = Some("no model configured for synthesis".into());
        return deep;
    };
    let usable: Vec<&PageContent> = deep
        .pages
        .iter()
        .filter(|p| p.text.as_deref().map(|t| !t.trim().is_empty()).unwrap_or(false))
        .collect();
    if usable.is_empty() {
        deep.summary_error = Some("every fetched page failed".into());
        return deep;
    }

    let mut sources = String::new();
    for (i, page) in usable.iter().enumerate() {
        sources.push_str(&format!(
            "[{}] {}\n{}\n\n{}\n\n",
            i + 1,
            page.title,
            page.url,
            page.text.as_deref().unwrap_or("")
        ));
    }
    let ask = format!(
        "Answer the question using only the sources below. Cite sources as [n] next to the \
         claims they support. If the sources disagree, say so. If they do not answer the \
         question, say that instead of guessing.\n\nQuestion: {query}\n\nSources:\n{sources}"
    );
    match ensemble::complete(
        transport,
        target,
        "You are a careful research assistant.",
        &[ChatMessage::text("user", &ask)],
        Some(900),
    )
    .await
    {
        Ok(text) => {
            deep.summary = text;
            deep.summary_error = None;
        }
        Err(e) => deep.summary_error = Some(e),
    }
    deep
}

/// Extract readable text from HTML: drop scripts/styles, turn block
/// elements into line breaks, strip tags, decode entities, collapse
/// runs of whitespace.
pub fn html_to_text(html: &str) -> String {
    let scripts = regex::Regex::new(
        r"(?is)<script\b[^>]*>.*?</script\s*>|<style\b[^>]*>.*?</style\s*>|<noscript\b[^>]*>.*?</noscript\s*>|<svg\b[^>]*>.*?</svg\s*>|<template\b[^>]*>.*?</template\s*>",
    )
    .expect("static regex");
    let comments = regex::Regex::new(r"(?s)<!--.*?-->").expect("static regex");
    let blocks = regex::Regex::new(
        r"(?i)</?(p|div|br|li|tr|h[1-6]|section|article|header|footer|blockquote|pre|table|ul|ol)\b[^>]*>",
    )
    .expect("static regex");
    let tags = regex::Regex::new(r"(?s)<[^>]+>").expect("static regex");
    let spaces = regex::Regex::new(r"[ \t\f\v\u{00a0}]+").expect("static regex");
    let blank_lines = regex::Regex::new(r"\n[ \t]*(\n[ \t]*)+").expect("static regex");

    let stripped = scripts.replace_all(html, " ");
    let stripped = comments.replace_all(&stripped, " ");
    let spaced = blocks.replace_all(&stripped, "\n");
    let untagged = tags.replace_all(&spaced, "");
    let decoded = decode_entities(&untagged);
    let collapsed = spaces.replace_all(&decoded, " ");
    let lined = blank_lines.replace_all(&collapsed, "\n\n");
    lined
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// Decode the HTML entities search engines and pages actually emit.
pub fn decode_entities(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(pos) = rest.find('&') {
        out.push_str(&rest[..pos]);
        rest = &rest[pos..];
        let Some(end) = rest.find(';') else {
            out.push_str(rest);
            return out;
        };
        let entity = &rest[1..end];
        let replacement = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some(' '),
            "hellip" => Some('…'),
            "mdash" => Some('—'),
            "ndash" => Some('–'),
            "rsquo" => Some('’'),
            "lsquo" => Some('‘'),
            "ldquo" => Some('“'),
            "rdquo" => Some('”'),
            _ => {
                let code = if let Some(hex) = entity.strip_prefix("#x").or_else(|| entity.strip_prefix("#X")) {
                    u32::from_str_radix(hex, 16).ok()
                } else if let Some(dec) = entity.strip_prefix('#') {
                    dec.parse::<u32>().ok()
                } else {
                    None
                };
                code.and_then(char::from_u32)
            }
        };
        match replacement {
            Some(ch) => out.push(ch),
            None => out.push_str(&rest[..=end]),
        }
        rest = &rest[end + 1..];
    }
    out.push_str(rest);
    out
}

/// Percent-encode a query for a URL (RFC 3986 unreserved characters are
/// kept; everything else is escaped byte-wise).
pub fn percent_encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len() * 3);
    for byte in text.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
                match u8::from_str_radix(hex, 16) {
                    Ok(byte) => {
                        out.push(byte);
                        i += 3;
                    }
                    Err(_) => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            byte => {
                out.push(byte);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// DuckDuckGo wraps outbound links: `//duckduckgo.com/l/?uddg=<url>&rut=…`.
fn unwrap_ddg_url(url: &str) -> String {
    let url = url.trim();
    if let Some(pos) = url.find("uddg=") {
        let rest = &url[pos + 5..];
        let end = rest.find('&').unwrap_or(rest.len());
        let decoded = percent_decode(&rest[..end]);
        if !decoded.is_empty() {
            return decoded;
        }
    }
    if let Some(rest) = url.strip_prefix("//") {
        return format!("https://{rest}");
    }
    url.to_string()
}

/// Truncate on a char boundary, preferring the last whitespace.
fn truncate_chars(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let cut: String = text.chars().take(max).collect();
    match cut.rfind(char::is_whitespace) {
        Some(pos) if pos > max / 2 => format!("{}…", cut[..pos].trim_end()),
        _ => format!("{cut}…"),
    }
}

/// Text form shared by every CLI/Slint research panel.
pub fn format_search(outcome: &SearchOutcome) -> String {
    let mut out = format!("Web search: {} ({})\n", outcome.query, outcome.provider);
    if let Some(error) = &outcome.error {
        out.push_str(&format!("error: {error}\n"));
    }
    if outcome.results.is_empty() && outcome.error.is_none() {
        out.push_str("no results\n");
    }
    for (i, result) in outcome.results.iter().enumerate() {
        out.push_str(&format!("\n{}. {}\n   {}\n", i + 1, result.title, result.url));
        if !result.snippet.is_empty() {
            out.push_str(&format!("   {}\n", result.snippet));
        }
    }
    out
}

pub fn format_deep(deep: &DeepSearch) -> String {
    let mut out = format!("Deep search: {} ({})\n", deep.query, deep.provider);
    if let Some(error) = &deep.search_error {
        out.push_str(&format!("search error: {error}\n"));
    }
    out.push_str(&format!("\nSources ({}):\n", deep.results.len()));
    for (i, result) in deep.results.iter().enumerate() {
        out.push_str(&format!("  [{}] {}\n      {}\n", i + 1, result.title, result.url));
    }
    if !deep.summary.trim().is_empty() {
        out.push_str(&format!("\nSummary ({}):\n", deep.summary_model));
        out.push_str(deep.summary.trim());
        out.push('\n');
    }
    if let Some(error) = &deep.summary_error {
        out.push_str(&format!("\nsummary error: {error}\n"));
    }
    let fetched = deep.pages.iter().filter(|p| p.text.is_some()).count();
    out.push_str(&format!(
        "\nfetched {fetched}/{} pages\n",
        deep.pages.len()
    ));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transport::ByteStream;
    use async_trait::async_trait;
    use std::sync::Mutex;

    struct Mock {
        seen: Mutex<Vec<HttpRequest>>,
        answer: Box<dyn Fn(&HttpRequest) -> Result<String, String> + Send + Sync>,
    }

    impl Mock {
        fn new(
            answer: impl Fn(&HttpRequest) -> Result<String, String> + Send + Sync + 'static,
        ) -> Self {
            Mock {
                seen: Mutex::new(Vec::new()),
                answer: Box::new(answer),
            }
        }
    }

    #[async_trait]
    impl Transport for Mock {
        async fn post_stream(&self, _req: HttpRequest) -> Result<ByteStream, String> {
            Err("stream not used".into())
        }
        async fn post_body(&self, req: HttpRequest) -> Result<Vec<u8>, String> {
            self.seen.lock().unwrap().push(req.clone());
            (self.answer)(&req).map(String::into_bytes)
        }
        async fn get_body(&self, req: HttpRequest) -> Result<Vec<u8>, String> {
            self.seen.lock().unwrap().push(req.clone());
            (self.answer)(&req).map(String::into_bytes)
        }
    }

    fn settings(provider: &str) -> Settings {
        Settings {
            search_provider: provider.into(),
            searxng_url: "https://searx.test".into(),
            ..Settings::default()
        }
    }

    const DDG: &str = r##"
<div class="result results_links">
  <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=x">Example &amp; A</a>
  <a class="result__snippet" href="#">First <b>snippet</b>.</a>
</div>
<div class="result results_links">
  <a rel="nofollow" class="result__a" href="https://rust-lang.org/">Rust</a>
  <a class="result__snippet" href="#">Second snippet.</a>
</div>
"##;

    #[test]
    fn parses_duckduckgo_results_and_unwraps_links() {
        let results = parse_ddg(DDG).unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].url, "https://example.com/a");
        assert_eq!(results[0].title, "Example & A");
        assert_eq!(results[0].snippet, "First snippet.");
        assert_eq!(results[1].url, "https://rust-lang.org/");
        assert_eq!(results[0].source, "duckduckgo");
    }

    #[test]
    fn deduplicates_ddg_results() {
        let doubled = format!("{DDG}{DDG}");
        assert_eq!(parse_ddg(&doubled).unwrap().len(), 2);
    }

    #[test]
    fn detects_a_captcha_page() {
        let err = parse_ddg("<html><body>Please solve the CAPTCHA</body></html>").unwrap_err();
        assert!(err.contains("captcha"));
    }

    #[test]
    fn parses_searxng_json() {
        let body = serde_json::json!({
            "results": [
                { "title": "One", "url": "https://one.test", "content": "alpha" },
                { "title": "Two", "url": "https://two.test" }
            ]
        })
        .to_string();
        let results = parse_searxng(&body).unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].snippet, "alpha");
        assert_eq!(results[1].title, "Two");
        assert_eq!(results[0].source, "searxng");
        assert!(parse_searxng("not json").is_err());
        assert!(parse_searxng(r#"{"error":"nope"}"#).unwrap_err().contains("nope"));
    }

    #[test]
    fn html_to_text_drops_markup_and_scripts() {
        let html = "<html><head><style>.x{}</style><script>alert(1)</script></head>\
                    <body><h1>Title</h1><p>Hello &amp; welcome&nbsp;here.</p>\
                    <div>Second   line</div></body></html>";
        let text = html_to_text(html);
        assert!(text.contains("Title"));
        assert!(text.contains("Hello & welcome here."));
        assert!(text.contains("Second line"));
        assert!(!text.contains("alert"));
        assert!(!text.contains("<p>"));
    }

    #[test]
    fn decodes_numeric_entities_and_keeps_unknown() {
        assert_eq!(decode_entities("a&#39;b &#x2014; c"), "a'b — c");
        assert_eq!(decode_entities("keep &bogus; here"), "keep &bogus; here");
        assert_eq!(decode_entities("no entity"), "no entity");
    }

    #[test]
    fn percent_encoding_round_trips() {
        let encoded = percent_encode("a b+c/d?e");
        assert_eq!(encoded, "a+b%2Bc%2Fd%3Fe");
        assert_eq!(percent_decode(&encoded), "a b+c/d?e");
    }

    #[tokio::test]
    async fn search_uses_searxng_when_configured() {
        let mock = Mock::new(|req| {
            assert!(req.url.starts_with("https://searx.test/search?q=rust"));
            Ok(r#"{"results":[{"title":"R","url":"https://r.test","content":"c"}]}"#.into())
        });
        let outcome = search(&mock, &settings("searxng"), "rust lang", 5).await;
        assert_eq!(outcome.provider, "searxng");
        assert_eq!(outcome.results.len(), 1);
        assert!(outcome.error.is_none());
        assert!(format_search(&outcome).contains("https://r.test"));
    }

    #[tokio::test]
    async fn search_reports_missing_searxng_url() {
        let mock = Mock::new(|_| Err("should not fetch".into()));
        let mut s = settings("searxng");
        s.searxng_url.clear();
        let outcome = search(&mock, &s, "q", 5).await;
        assert!(outcome.error.unwrap().contains("searxng_url"));
    }

    #[tokio::test]
    async fn empty_query_never_hits_the_network() {
        let mock = Mock::new(|_| Err("should not fetch".into()));
        let outcome = search(&mock, &settings("duckduckgo"), "   ", 5).await;
        assert_eq!(outcome.error.as_deref(), Some("empty search query"));
    }

    #[tokio::test]
    async fn deep_search_fetches_pages_and_synthesizes() {
        let mock = Mock::new(|req| {
            if req.url.contains("html.duckduckgo.com") {
                return Ok(DDG.into());
            }
            if req.url.contains("example.com") {
                return Ok("<html><body><p>page A content</p></body></html>".into());
            }
            if req.url.contains("rust-lang.org") {
                return Err("offline".into());
            }
            // completion call
            assert!(req.url.contains("/chat/completions"));
            Ok(serde_json::json!({
                "choices": [{ "message": { "content": "Rust is fast [1]." } }]
            })
            .to_string())
        });
        let target = CompletionTarget {
            label: "Test".into(),
            provider: "test".into(),
            base_url: "http://model.test/v1".into(),
            api_key: String::new(),
            model: "test-model".into(),
            temperature: 0.2,
            max_tokens: None,
            headers: Vec::new(),
        };
        let deep = deep_search(
            &mock,
            &settings("duckduckgo"),
            Some(&target),
            "what is rust",
            5,
            2,
        )
        .await;
        assert_eq!(deep.results.len(), 2);
        assert_eq!(deep.pages.len(), 2);
        assert_eq!(deep.pages[0].text.as_deref(), Some("page A content"));
        assert!(deep.pages[1].error.is_some());
        assert_eq!(deep.summary, "Rust is fast [1].");
        assert_eq!(deep.summary_model, "test-model");
        assert!(deep.summary_error.is_none());
        assert!(format_deep(&deep).contains("Summary (test-model)"));
    }

    #[tokio::test]
    async fn deep_search_without_a_model_keeps_pages() {
        let mock = Mock::new(|req| {
            if req.url.contains("html.duckduckgo.com") {
                return Ok(DDG.into());
            }
            Ok("<html><body>page text</body></html>".into())
        });
        let deep = deep_search(&mock, &settings("duckduckgo"), None, "q", 5, 1).await;
        assert_eq!(deep.pages.len(), 1);
        assert_eq!(deep.pages[0].text.as_deref(), Some("page text"));
        assert!(deep.summary.is_empty());
        assert!(deep.summary_error.unwrap().contains("no model"));
    }

    #[tokio::test]
    async fn deep_search_surfaces_search_errors() {
        let mock = Mock::new(|_| Err("network down".into()));
        let deep = deep_search(&mock, &settings("duckduckgo"), None, "q", 5, 2).await;
        assert_eq!(deep.search_error.as_deref(), Some("network down"));
        assert!(deep.results.is_empty());
        assert!(format_deep(&deep).contains("search error"));
    }

    #[test]
    fn truncation_respects_char_boundaries() {
        let text = "é".repeat(10);
        let cut = truncate_chars(&text, 5);
        assert!(cut.ends_with('…'));
        assert_eq!(cut.chars().count(), 6);
    }
}
