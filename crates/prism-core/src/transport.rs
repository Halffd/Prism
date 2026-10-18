//! HTTP boundary of the core.
//!
//! The core never opens sockets itself: hosts inject a `Transport`.
//! The native impl (feature `native-transport`) wraps reqwest; the
//! future WASM impl will wrap `fetch` behind the same trait. Stream
//! decoding happens in `client` decoders, which byte-fixtures replay
//! identically on every target.

use async_trait::async_trait;
use futures_util::Stream;
use std::pin::Pin;

/// A fully-formed HTTP request. Bodies are pre-serialized JSON.
#[derive(Debug, Clone)]
pub struct HttpRequest {
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<String>,
}

/// Response body as a stream of byte chunks. Chunk boundaries are
/// arbitrary; decoders must buffer.
pub type ByteStream = Pin<Box<dyn Stream<Item = Result<Vec<u8>, String>> + Send>>;

#[async_trait]
pub trait Transport: Send + Sync {
    /// POST and stream the response body. Non-2xx responses are
    /// `Err` with the status and a body excerpt.
    async fn post_stream(&self, req: HttpRequest) -> Result<ByteStream, String>;
    /// POST and await the full response body.
    async fn post_body(&self, req: HttpRequest) -> Result<Vec<u8>, String>;
    /// GET and await the full response body.
    async fn get_body(&self, req: HttpRequest) -> Result<Vec<u8>, String>;
}

#[cfg(feature = "native-transport")]
pub use native::ReqwestTransport;

#[cfg(feature = "native-transport")]
mod native {
    use super::{ByteStream, HttpRequest, Transport};
    use async_trait::async_trait;
    use futures_util::StreamExt;

    /// Truncate an error excerpt on a char boundary.
    pub(crate) fn truncate(s: &str, max: usize) -> String {
        if s.len() <= max {
            s.to_string()
        } else {
            let mut cut = max;
            while !s.is_char_boundary(cut) {
                cut -= 1;
            }
            format!("{}…", &s[..cut])
        }
    }

    /// reqwest-backed transport for native hosts (desktop, mobile,
    /// tests). Constructed once per process and shared.
    pub struct ReqwestTransport {
        client: reqwest::Client,
    }

    impl ReqwestTransport {
        pub fn new() -> Self {
            Self {
                client: reqwest::Client::new(),
            }
        }
    }

    impl Default for ReqwestTransport {
        fn default() -> Self {
            Self::new()
        }
    }

    #[async_trait]
    impl Transport for ReqwestTransport {
        async fn post_stream(&self, req: HttpRequest) -> Result<ByteStream, String> {
            let mut http = self.client.post(&req.url);
            if let Some(body) = &req.body {
                http = http.body(body.clone());
            }
            for (k, v) in &req.headers {
                http = http.header(k, v);
            }
            let resp = http
                .send()
                .await
                .map_err(|e| format!("request failed: {e}"))?;
            let status = resp.status();
            if !status.is_success() {
                let text = resp.text().await.unwrap_or_default();
                return Err(format!(
                    "server returned {status}: {}",
                    truncate(&text, 300)
                ));
            }
            Ok(Box::pin(resp.bytes_stream().map(|item| {
                item.map_err(|e| format!("stream read failed: {e}"))
                    .map(|b| b.to_vec())
            })))
        }

        async fn post_body(&self, req: HttpRequest) -> Result<Vec<u8>, String> {
            let mut http = self.client.post(&req.url);
            if let Some(body) = &req.body {
                http = http.body(body.clone());
            }
            for (k, v) in &req.headers {
                http = http.header(k, v);
            }
            let resp = http
                .send()
                .await
                .map_err(|e| format!("request failed: {e}"))?;
            let status = resp.status();
            let text = resp
                .text()
                .await
                .unwrap_or_default();
            if !status.is_success() {
                return Err(format!(
                    "server returned {status}: {}",
                    truncate(&text, 300)
                ));
            }
            Ok(text.into_bytes())
        }

        async fn get_body(&self, req: HttpRequest) -> Result<Vec<u8>, String> {
            let mut http = self.client.get(&req.url);
            for (k, v) in &req.headers {
                http = http.header(k, v);
            }
            let resp = http
                .send()
                .await
                .map_err(|e| format!("request failed: {e}"))?;
            let status = resp.status();
            let text = resp
                .text()
                .await
                .unwrap_or_default();
            if !status.is_success() {
                return Err(format!(
                    "server returned {status}: {}",
                    truncate(&text, 300)
                ));
            }
            Ok(text.into_bytes())
        }
    }

    #[cfg(test)]
    mod tests {
        use super::truncate;

        #[test]
        fn truncates_on_char_boundary() {
            let s = "héllo".repeat(100);
            let t = truncate(&s, 7);
            assert!(t.ends_with('…'));
            // Must not panic and must be valid to slice (checked by assert above).
            assert!(t.chars().count() <= 8);
        }

        #[test]
        fn short_strings_pass_through() {
            assert_eq!(truncate("short", 300), "short");
        }
    }
}
