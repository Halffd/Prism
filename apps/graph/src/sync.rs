//! The shared canvas over the API.
//!
//! Every Prism surface reads and writes the same graph document through
//! the bundled native server (`GET/PUT /v1/graph`), so the canvas drawn
//! in Slint is the one this surface opens. The merge that combines two
//! edits lives in `prism-core::graph_store`, not here: this module only
//! drives HTTP, exactly as the browser studio's `media.ts` only drives
//! `fetch`. No sync rule is restated at the seam.
//!
//! Saving is an explicit write, so it stamps `updated_at` with the
//! browser's clock and the server treats the whole document as
//! authoritative. That is last-writer-wins at document granularity: a
//! canvas another app edited *after* this one loaded is overwritten,
//! not merged in by hand. The core's merge still refuses to lose a
//! *newer* peer, so a stale save never rolls anything back.

use prism_core::graph_store::GraphDocument;

/// The bundled Prism server. The same address the browser studio's media
/// panel points at, so both surfaces talk to one backend.
pub const DEFAULT_BASE: &str = "http://127.0.0.1:7861";

fn graph_url(base: &str) -> String {
    format!("{}/v1/graph", base.trim_end_matches('/'))
}

/// Epoch milliseconds, for the `updated_at` a save must carry.
fn now_millis() -> u64 {
    // `std::time` has no clock on wasm, so ask the browser directly.
    js_sys::Date::now() as u64
}

/// Read the shared document.
///
/// An unreachable server, or one that answers with something that is not
/// a Prism graph document, is an error the caller shows — the caller can
/// still draw locally, so a failed sync is never a dead canvas.
pub async fn fetch_document(base: &str) -> Result<GraphDocument, String> {
    let url = graph_url(base);
    let response = gloo_net::http::Request::get(&url)
        .send()
        .await
        .map_err(|error| format!("could not reach {url}: {error:?}"))?;
    if !response.ok() {
        return Err(format!("{} from {url}", response.status()));
    }
    let text = response
        .text()
        .await
        .map_err(|error| format!("could not read {url}: {error:?}"))?;
    GraphDocument::from_json(&text)
        .ok_or_else(|| format!("{url} did not return a Prism graph document"))
}

/// Send this canvas's document, and return what the server persisted.
///
/// The reply is the merged document, so the local copy and the shared
/// one agree without a second read.
pub async fn save_document(
    base: &str,
    document: &GraphDocument,
) -> Result<GraphDocument, String> {
    let mut to_send = document.clone();
    to_send.updated_at = now_millis();

    let response = gloo_net::http::Request::put(&graph_url(base))
        .header("Content-Type", "application/json")
        .body(to_send.to_json())
        .map_err(|error| format!("could not build the graph request: {error:?}"))?
        .send()
        .await
        .map_err(|error| format!("could not reach the Prism server: {error:?}"))?;
    if !response.ok() {
        return Err(format!("{} from the Prism server", response.status()));
    }
    let text = response
        .text()
        .await
        .map_err(|error| format!("could not read the reply: {error:?}"))?;
    GraphDocument::from_json(&text)
        .ok_or_else(|| "the Prism server did not return a graph document".to_string())
}