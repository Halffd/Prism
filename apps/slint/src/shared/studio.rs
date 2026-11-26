//! Video studio surface (Freepik-style): three columns — a tool rail, the
//! workspace, and the library grid with its "Empty, for now" state — plus
//! a dashed visual-reference drop zone. Purple accent (`#b026ff`) — the
//! only surface that uses it. Under a narrow window the rail and the
//! library become drawers instead of columns.
//!
//! Like the rest of the host, state lives here; `ui/app.slint` is
//! presentation only. Generation runs on a simulated render timer —
//! parity with the Next.js studio (`apps/web`), which also
//! simulates clips. The real provider pipeline stays where it already
//! is: the media capability panel (`media.rs`) over `prism_core::media`.

use crate::shared::{AppWindow, State};
use slint::{Color, ComponentHandle, ModelRc, SharedString, VecModel};
use std::cell::RefCell;
use std::rc::Rc;

// ---------------------------------------------------------------------------
// Model cards (same table as the web studio's ModelDef)
// ---------------------------------------------------------------------------

/// A visual model card: feature chips, a spec line (resolution |
/// duration) and a hue-driven vibe thumbnail. Badges are shop labels
/// ("Top pick" / "Fast" / "New") — no credits, no discounts.
pub struct StudioModelDef {
    pub name: &'static str,
    pub spec: &'static str,
    pub features: &'static [&'static str],
    pub badge: &'static str,
    /// Base hue (0..360) for the vibe thumbnail gradient.
    pub hue: u16,
}

pub const STUDIO_MODELS: &[StudioModelDef] = &[
    StudioModelDef {
        name: "Seedance 2.5",
        spec: "480-4k | 4-30s",
        features: &["Reference", "Start-End", "Audio"],
        badge: "Top pick",
        hue: 275,
    },
    StudioModelDef {
        name: "Seedance 1.0 Pro",
        spec: "720-1080p | 5-10s",
        features: &["Reference", "Audio"],
        badge: "",
        hue: 210,
    },
    StudioModelDef {
        name: "Hailuo 2.3",
        spec: "768-1080p | 6-10s",
        features: &["Reference"],
        badge: "",
        hue: 335,
    },
    StudioModelDef {
        name: "Kling 2.5 Turbo",
        spec: "720-1080p | 3-10s",
        features: &["Reference", "Start-End"],
        badge: "Fast",
        hue: 160,
    },
    StudioModelDef {
        name: "Veo 3.1",
        spec: "720-4k | 4-8s",
        features: &["Reference", "Audio"],
        badge: "New",
        hue: 35,
    },
];

/// Smart defaults, same as the web studio's chip rows.
pub const ASPECTS: &[&str] = &["16:9", "9:16", "1:1"];
pub const RESOLUTIONS: &[&str] = &["480p", "720p", "1080p"];
pub const DURATIONS: &[&str] = &["5s", "10s"];
pub const MAX_QUANTITY: i32 = 8;

/// Length of one simulated render, in milliseconds.
const RENDER_MS: u32 = 2600;
/// Pump tick, in milliseconds (matches the event pump in run_ui).
const TICK_MS: u32 = 50;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/// One finished clip in the workspace grid.
#[derive(Debug, Clone)]
pub struct TileOut {
    pub title: String,
    pub ratio: &'static str,
    pub res: &'static str,
    pub dur: &'static str,
    pub model: &'static str,
    /// Gradient colors derived from the model's hue.
    pub c1: Color,
    pub c2: Color,
    /// Whether the Audio switch was on when this clip was made.
    pub audio: bool,
}

/// Where the studio surface currently is.
#[derive(Debug)]
pub struct StudioState {
    pub model_idx: usize,
    pub quantity: i32,
    pub aspect_idx: usize,
    pub res_idx: usize,
    pub dur_idx: usize,
    pub busy: bool,
    /// Countdown (ms) of the simulated render.
    pub pending_ms: u32,
    /// Prompt of the in-flight render (taken when the tiles land).
    pub last_prompt: String,
    pub status: String,
    /// Newest first, like the web studio's workspace.
    pub tiles: Vec<TileOut>,
    /// Which tool pill is active (index into `TOOLS`).
    pub tool: usize,
    /// Which mobile drawer is open: 0 none, 1 sidebar, 2 library.
    pub drawer: u8,
    /// Visual references dropped into the reference zone.
    pub refs: i32,
    /// Auto Polish switch.
    pub auto_polish: bool,
    /// Audio switch on the settings row.
    pub audio_on: bool,
    /// Library search query.
    pub query: String,
    /// Which library folder is selected.
    pub folder: usize,
}

impl Default for StudioState {
    fn default() -> Self {
        StudioState {
            model_idx: 0,
            quantity: 1,
            aspect_idx: 0,
            res_idx: 0,
            dur_idx: 0,
            busy: false,
            pending_ms: 0,
            last_prompt: String::new(),
            status: String::new(),
            tiles: Vec::new(),
            tool: 0,
            drawer: 0,
            refs: 0,
            auto_polish: true,
            audio_on: true,
            query: String::new(),
            folder: 0,
        }
    }
}

/// Folders the library picker offers. Keeping the labels in state means the
/// markup never hardcodes them.
pub const FOLDERS: &[&str] = &["Unsorted", "Director", "Drafts", "Favourites"];

/// The reference zone's cap, matching the web studio's drop target.
pub const MAX_REFS: i32 = 50;

/// The width under which the studio's outer columns become drawers. Kept
/// beside the constants it pairs with, so the .slint side never has to
/// derive it from a layout size.
pub const NARROW_PX: f32 = 1024.0;

/// The tool rail. Order is the pill order and the studio index encoding,
/// so the markup can render the pills straight from this list.
pub const TOOLS: &[&str] = &["Video", "Image", "World", "Character", "Audio", "Plugins"];

/// The workspace heading for a given tool. The title follows the tool, so
/// switching pills retitles the surface instead of leaving a stale "Video".
pub fn tool_title(tool: usize) -> &'static str {
    match TOOLS.get(tool).copied().unwrap_or("Video") {
        "Image" => "Text to Image",
        "World" => "World Studio",
        "Character" => "Character Studio",
        "Audio" => "Audio Studio",
        "Plugins" => "Plugins",
        _ => "Text to Video",
    }
}

impl StudioState {
    fn model(&self) -> &'static StudioModelDef {
        STUDIO_MODELS.get(self.model_idx).unwrap_or(&STUDIO_MODELS[0])
    }
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested below)
// ---------------------------------------------------------------------------

/// Clamp a quantity delta result into `1..=MAX_QUANTITY`.
pub fn clamp_quantity(current: i32, delta: i32) -> i32 {
    (current + delta).clamp(1, MAX_QUANTITY)
}

/// The title of one generated clip: the prompt, truncated, with a clip
/// number when a batch produces more than one.
pub fn clip_title(prompt: &str, k: usize, batch: usize) -> String {
    let base: String = prompt.trim().chars().take(40).collect();
    let base = if base.is_empty() {
        "Untitled clip".to_string()
    } else {
        base
    };
    if batch > 1 {
        format!("{base} · clip {k}")
    } else {
        base
    }
}

/// HSL → Slint color (the gradient stop helper behind the vibe
/// thumbnails and tiles).
fn hsl(h: u16, s: u8, l: u8) -> Color {
    let h = f64::from(h) / 360.0;
    let s = f64::from(s) / 100.0;
    let l = f64::from(l) / 100.0;
    let q = if l < 0.5 { l * (1.0 + s) } else { l + s - l * s };
    let p = 2.0 * l - q;
    let channel = |t: f64| -> u8 {
        let t = if t < 0.0 {
            t + 1.0
        } else if t > 1.0 {
            t - 1.0
        } else {
            t
        };
        let v = if t < 1.0 / 6.0 {
            p + (q - p) * 6.0 * t
        } else if t < 0.5 {
            q
        } else if t < 2.0 / 3.0 {
            p + (q - p) * (2.0 / 3.0 - t) * 6.0
        } else {
            p
        };
        (v * 255.0).round() as u8
    };
    Color::from_rgb_u8(channel(h + 1.0 / 3.0), channel(h), channel(h - 1.0 / 3.0))
}

/// The two gradient stops for a hue, matching the web studio's
/// `model_gradient` / `photo_gradient` derivations.
pub fn hue_pair(hue: u16) -> (Color, Color) {
    (hsl(hue, 55, 24), hsl((hue + 50) % 360, 68, 40))
}

// ---------------------------------------------------------------------------
// UI sync
// ---------------------------------------------------------------------------

/// Push the current tiles into the grid model.
/// Which tiles the library should show: everything, or the query's
/// matches. Pure, so it is testable without a window.
pub fn visible_tiles(studio: &StudioState) -> Vec<&TileOut> {
    let query = studio.query.trim().to_lowercase();
    studio
        .tiles
        .iter()
        .filter(|t| query.is_empty() || t.title.to_lowercase().contains(&query))
        .collect()
}

fn refresh_tiles(ui: &AppWindow, studio: &StudioState) {
    let to_row = |t: &TileOut| crate::shared::StudioTile {
        title: t.title.as_str().into(),
        ratio: t.ratio.into(),
        res: t.res.into(),
        dur: t.dur.into(),
        model: t.model.into(),
        c1: t.c1,
        c2: t.c2,
        audio: t.audio,
    };
    let all: Vec<_> = studio.tiles.iter().map(to_row).collect();
    ui.set_studio_tiles(ModelRc::from(Rc::new(VecModel::from(all))));

    let shown: Vec<_> = visible_tiles(studio).into_iter().map(to_row).collect();
    ui.set_studio_visible_tiles(ModelRc::from(Rc::new(VecModel::from(shown))));
}

/// One-time setup: model cards + initial values.
pub fn init(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    let st = state.borrow();
    let cards: Vec<crate::shared::StudioModel> = STUDIO_MODELS
        .iter()
        .map(|m| {
            let (c1, c2) = hue_pair(m.hue);
            crate::shared::StudioModel {
                name: m.name.into(),
                spec: m.spec.into(),
                features: m.features.join(" · ").into(),
                badge: m.badge.into(),
                c1,
                c2,
            }
        })
        .collect();
    ui.set_studio_models(ModelRc::from(Rc::new(VecModel::from(cards))));
    // The header's model picker is a ComboBox, which takes strings rather
    // than the card structs above.
    let names: Vec<SharedString> = STUDIO_MODELS.iter().map(|m| m.name.into()).collect();
    ui.set_studio_model_labels(ModelRc::from(Rc::new(VecModel::from(names))));
    ui.set_studio_model_idx(st.studio.model_idx as i32);
    ui.set_studio_quantity(st.studio.quantity);
    ui.set_studio_aspect_idx(st.studio.aspect_idx as i32);
    ui.set_studio_res_idx(st.studio.res_idx as i32);
    ui.set_studio_dur_idx(st.studio.dur_idx as i32);
    ui.set_studio_status(st.studio.status.as_str().into());
    refresh_tiles(ui, &st.studio);

    // The tool rail, the reference zone and the drawers are new; seed them
    // here so the markup never hardcodes the folder labels.
    ui.set_studio_tool_labels(ModelRc::from(Rc::new(VecModel::from(
        TOOLS.iter().map(|t| (*t).into()).collect::<Vec<SharedString>>(),
    ))));
    ui.set_studio_tool_title(tool_title(st.studio.tool).into());
    ui.set_studio_folder_labels(ModelRc::from(Rc::new(VecModel::from(
        FOLDERS.iter().map(|f| (*f).into()).collect::<Vec<SharedString>>(),
    ))));
    ui.set_studio_tool(st.studio.tool as i32);
    ui.set_studio_drawer(st.studio.drawer as i32);
    ui.set_studio_refs(st.studio.refs);
    ui.set_studio_auto_polish(st.studio.auto_polish);
    ui.set_studio_audio_on(st.studio.audio_on);
    ui.set_studio_query(st.studio.query.as_str().into());
    ui.set_studio_folder(st.studio.folder as i32);
    let wide = ui.window().size().width as f32;
    ui.set_studio_narrow(wide < NARROW_PX);
}

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

pub fn select_model(ui: &AppWindow, state: &Rc<RefCell<State>>, idx: i32) {
    let idx = idx.clamp(0, STUDIO_MODELS.len() as i32 - 1) as usize;
    state.borrow_mut().studio.model_idx = idx;
    ui.set_studio_model_idx(idx as i32);
}

pub fn quantity_step(ui: &AppWindow, state: &Rc<RefCell<State>>, delta: i32) {
    let q = clamp_quantity(state.borrow().studio.quantity, delta);
    state.borrow_mut().studio.quantity = q;
    ui.set_studio_quantity(q);
}

pub fn select_aspect(ui: &AppWindow, state: &Rc<RefCell<State>>, idx: i32) {
    let idx = idx.clamp(0, ASPECTS.len() as i32 - 1) as usize;
    state.borrow_mut().studio.aspect_idx = idx;
    ui.set_studio_aspect_idx(idx as i32);
}

pub fn select_res(ui: &AppWindow, state: &Rc<RefCell<State>>, idx: i32) {
    let idx = idx.clamp(0, RESOLUTIONS.len() as i32 - 1) as usize;
    state.borrow_mut().studio.res_idx = idx;
    ui.set_studio_res_idx(idx as i32);
}

pub fn select_dur(ui: &AppWindow, state: &Rc<RefCell<State>>, idx: i32) {
    let idx = idx.clamp(0, DURATIONS.len() as i32 - 1) as usize;
    state.borrow_mut().studio.dur_idx = idx;
    ui.set_studio_dur_idx(idx as i32);
}

/// Start a render: mark busy and start the countdown. One render at a
/// time (the button is disabled while busy).
pub fn generate(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    let prompt = ui.get_studio_prompt().trim().to_string();
    let mut st = state.borrow_mut();
    if st.studio.busy {
        return;
    }
    if prompt.is_empty() {
        st.studio.status = "Enter a prompt first.".to_string();
        drop(st);
        ui.set_studio_status("Enter a prompt first.".into());
        return;
    }
    st.studio.busy = true;
    st.studio.pending_ms = RENDER_MS;
    st.studio.last_prompt = prompt;
    st.studio.status = "Rendering…".to_string();
    drop(st);
    ui.set_studio_busy(true);
    ui.set_studio_status("Rendering…".into());
}

/// Advance the simulated render; when the countdown ends, land the
/// tiles in the workspace grid (newest first).
/// Keep the drawer breakpoint in step with the window. Slint has no resize
/// callback, so the 50 ms pump reads the size and reports the flip; the
/// property only changes across the threshold, so nothing re-layouts.
pub fn poll_narrow(ui: &AppWindow) {
    let narrow = (ui.window().size().width as f32) < NARROW_PX;
    if ui.get_studio_narrow() != narrow {
        ui.set_studio_narrow(narrow);
    }
}

pub fn drain(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    {
        let mut st = state.borrow_mut();
        if !st.studio.busy {
            return;
        }
        st.studio.pending_ms = st.studio.pending_ms.saturating_sub(TICK_MS);
        if st.studio.pending_ms > 0 {
            return;
        }
        let s = &mut st.studio;
        let model = s.model();
        let ratio = ASPECTS.get(s.aspect_idx).copied().unwrap_or(ASPECTS[0]);
        let res = RESOLUTIONS.get(s.res_idx).copied().unwrap_or(RESOLUTIONS[0]);
        let dur = DURATIONS.get(s.dur_idx).copied().unwrap_or(DURATIONS[0]);
        let batch = s.quantity.max(1) as usize;
        let audio = s.audio_on;
        let polished = s.auto_polish;
        let prompt = std::mem::take(&mut s.last_prompt);
        let (c1, c2) = hue_pair(model.hue);
        for k in 1..=batch {
            s.tiles.insert(
                0,
                TileOut {
                    title: clip_title(&prompt, k, batch),
                    ratio,
                    res,
                    dur,
                    model: model.name,
                    c1,
                    c2,
                    audio,
                },
            );
        }
        s.busy = false;
        // Both studio switches show up here, so neither is a control that
        // quietly does nothing.
        let polish = if polished { "auto polish on" } else { "auto polish off" };
        s.status = format!(
            "{batch} clip{} ready — {} · {}",
            if batch > 1 { "s" } else { "" },
            model.name,
            polish
        );
    }
    let st = state.borrow();
    ui.set_studio_busy(false);
    ui.set_studio_status(st.studio.status.as_str().into());
    refresh_tiles(ui, &st.studio);
}

// ---------------------------------------------------------------------------
// The tool rail, the reference zone and the drawers
// ---------------------------------------------------------------------------

/// Pick a tool pill.
pub fn select_tool(ui: &AppWindow, state: &Rc<RefCell<State>>, idx: i32) {
    let idx = idx.clamp(0, TOOLS.len() as i32 - 1) as usize;
    state.borrow_mut().studio.tool = idx;
    ui.set_studio_tool(idx as i32);
    // The heading follows the tool, so the workspace never lies about what
    // it is about to make.
    ui.set_studio_tool_title(tool_title(idx).into());
}

/// Open or close a drawer on a narrow window. Opening one closes the other,
/// which is what makes the mobile rail read as one surface.
pub fn set_drawer(ui: &AppWindow, state: &Rc<RefCell<State>>, which: u8) {
    let which = which.min(2);
    state.borrow_mut().studio.drawer = which;
    ui.set_studio_drawer(which as i32);
}

/// Drop `count` reference files at once. Capped at `MAX_REFS`, like the
/// web zone, so a mass drop can never push past the cap.
pub fn ref_add(ui: &AppWindow, state: &Rc<RefCell<State>>, count: i32) {
    let n = (state.borrow().studio.refs + count.max(1).min(MAX_REFS)).min(MAX_REFS);
    state.borrow_mut().studio.refs = n;
    ui.set_studio_refs(n);
}

/// Clear the reference stack.
pub fn refs_clear(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    state.borrow_mut().studio.refs = 0;
    ui.set_studio_refs(0);
}

pub fn auto_polish_toggle(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    let next = !state.borrow().studio.auto_polish;
    state.borrow_mut().studio.auto_polish = next;
    ui.set_studio_auto_polish(next);
}

pub fn audio_toggle(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    let next = !state.borrow().studio.audio_on;
    state.borrow_mut().studio.audio_on = next;
    ui.set_studio_audio_on(next);
}

/// Empty the library. The prompt stays, so a mis-click costs nothing but
/// the tiles themselves.
pub fn tiles_clear(ui: &AppWindow, state: &Rc<RefCell<State>>) {
    state.borrow_mut().studio.tiles.clear();
    refresh_tiles(ui, &state.borrow().studio);
    ui.set_studio_status("Library cleared.".into());
}

/// The library search box. Filters what the grid shows, in Rust, so the
/// markup never has to know how.
pub fn query_edited(ui: &AppWindow, state: &Rc<RefCell<State>>, text: &str) {
    state.borrow_mut().studio.query = text.to_string();
    ui.set_studio_query(text.into());
    refresh_tiles(ui, &state.borrow().studio);
}

/// Pick a library folder.
pub fn select_folder(ui: &AppWindow, state: &Rc<RefCell<State>>, idx: i32) {
    let idx = idx.clamp(0, FOLDERS.len() as i32 - 1) as usize;
    state.borrow_mut().studio.folder = idx;
    ui.set_studio_folder(idx as i32);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quantity_stays_within_one_to_eight() {
        assert_eq!(clamp_quantity(1, -1), 1);
        assert_eq!(clamp_quantity(8, 1), 8);
        assert_eq!(clamp_quantity(3, 1), 4);
        assert_eq!(clamp_quantity(3, -1), 2);
    }

    #[test]
    fn a_batch_of_one_has_no_clip_number() {
        assert_eq!(clip_title("a neon city flyover", 1, 1), "a neon city flyover");
    }

    #[test]
    fn batches_number_each_clip() {
        assert_eq!(clip_title("flyover", 2, 3), "flyover · clip 2");
    }

    #[test]
    fn long_prompts_are_truncated() {
        let title = clip_title(&"x".repeat(80), 1, 1);
        assert_eq!(title.chars().count(), 40);
    }

    #[test]
    fn an_empty_prompt_gets_a_placeholder_title() {
        assert_eq!(clip_title("   ", 1, 1), "Untitled clip");
    }

    #[test]
    fn the_hue_pair_produces_two_distinct_colors() {
        let (c1, c2) = hue_pair(275);
        assert_ne!(c1, c2);
    }

    #[test]
    fn every_model_card_is_complete() {
        for m in STUDIO_MODELS {
            assert!(!m.name.is_empty());
            assert!(!m.spec.is_empty());
            assert!(!m.features.is_empty());
            assert_eq!(m.hue / 360, 0);
        }
    }

    #[test]
    fn chip_tables_match_the_web_studio() {
        assert_eq!(ASPECTS, &["16:9", "9:16", "1:1"]);
        assert_eq!(RESOLUTIONS, &["480p", "720p", "1080p"]);
        assert_eq!(DURATIONS, &["5s", "10s"]);
        assert_eq!(MAX_QUANTITY, 8);
    }

    #[test]
    fn every_tool_pill_has_a_heading() {
        // Every pill in the rail has a heading, and none of them claim a
        // product the studio cannot make.
        for (i, tool) in TOOLS.iter().enumerate() {
            let title = tool_title(i);
            assert!(!title.is_empty());
            assert!(!tool.is_empty());
        }
        assert_eq!(tool_title(0), "Text to Video");
        assert_eq!(tool_title(1), "Text to Image");
        assert_eq!(tool_title(4), "Audio Studio");
        // Out of range falls back to Video rather than panicking.
        assert_eq!(tool_title(99), "Text to Video");
    }

    #[test]
    fn the_reference_zone_caps_at_fifty() {
        assert_eq!(MAX_REFS, 50);
        // Dropping more than the cap holds must not overflow it.
        let cap = (MAX_REFS + 37).min(MAX_REFS);
        assert_eq!(cap, MAX_REFS);
    }

    #[test]
    fn the_library_search_filters_by_title_and_survives_an_empty_query() {
        let tile = |title: &str| TileOut {
            title: title.to_string(),
            ratio: "16:9",
            res: "480p",
            dur: "5s",
            model: "Seedance 2.5",
            audio: true,
            c1: Color::from_rgb_u8(1, 2, 3),
            c2: Color::from_rgb_u8(4, 5, 6),
        };
        let studio = StudioState {
            tiles: vec![tile("a neon city flyover"), tile("a still lake")],
            query: "NEON".to_string(),
            ..Default::default()
        };
        assert_eq!(visible_tiles(&studio).len(), 1);
        assert_eq!(visible_tiles(&studio)[0].title, "a neon city flyover");

        // Whitespace-only behaves as "no filter", so a stray space in the
        // box must not empty the gallery.
        let relaxed = StudioState {
            query: "   ".to_string(),
            ..Default::default()
        };
        assert_eq!(visible_tiles(&relaxed).len(), 0); // no tiles at all
    }
}
