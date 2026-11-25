//! The native, in-process image renderer.
//!
//! No Python, no sockets, no model downloads: a deterministic,
//! seed-driven latent-style renderer that honors the same knobs as the
//! local SD backends (steps, CFG, sampler, scheduler, denoise, size,
//! batch). It is an offline preview engine, not a neural checkpoint
//! runner, so the image UI works on any machine and in the browser.
//!
//! Output is a PNG data URL, which every surface can display: Slint
//! decodes `data:` URIs, and the web app puts it straight into an
//! `<img>` element.

use crate::media::{
    base64_encode, sd_batch, sd_cfg, sd_denoise, sd_sampler, sd_scheduler, sd_size, sd_steps,
    MediaKind, MediaRequest,
};

/// A rendered image in RGBA8, row-major.
#[derive(Debug, Clone, PartialEq)]
pub struct RenderedImage {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

/// Render a request and return a PNG data URL.
pub fn run(kind: MediaKind, req: &MediaRequest) -> Result<String, String> {
    match kind {
        MediaKind::Image => png_data_url(req),
        other => Err(format!(
            "the native backend renders images only (not {other:?})"
        )),
    }
}

/// Render a request and wrap the PNG in a `data:` URL.
pub fn png_data_url(req: &MediaRequest) -> Result<String, String> {
    let image = render(req)?;
    let png = encode_png(image.width, image.height, &image.rgba)?;
    Ok(format!(
        "data:image/png;base64,{}",
        base64_encode(&png)
    ))
}

/// Render a request into RGBA8. A batch is laid out as a contact sheet
/// (square-ish grid) of the requested cell size.
pub fn render(req: &MediaRequest) -> Result<RenderedImage, String> {
    let (cell_w, cell_h) = sd_size(req);
    let batch = sd_batch(req);
    let cols = (batch as f64).sqrt().ceil() as u32;
    let cols = cols.max(1);
    let rows = (batch + cols - 1) / cols;
    let width = cell_w * cols;
    let height = cell_h * rows;
    let base_seed = resolve_seed(req);

    let mut rgba = vec![0u8; width as usize * height as usize * 4];
    for index in 0..batch {
        let cell = render_cell(req, base_seed.wrapping_add(index as u64), cell_w, cell_h);
        let offset_x = (index % cols) * cell_w;
        let offset_y = (index / cols) * cell_h;
        let row_bytes = cell_w as usize * 4;
        for y in 0..cell_h as usize {
            let dst = ((offset_y as usize + y) * width as usize + offset_x as usize) * 4;
            let src = y * row_bytes;
            rgba[dst..dst + row_bytes].copy_from_slice(&cell[src..src + row_bytes]);
        }
    }
    Ok(RenderedImage {
        width,
        height,
        rgba,
    })
}

fn resolve_seed(req: &MediaRequest) -> u64 {
    if let Some(seed) = req.seed {
        return seed;
    }
    let hashed = fnv1a(&req.prompt, 0x9E37_79B9_7F4A_7C15);

    // A blank seed should vary run to run, but `SystemTime::now()` *panics*
    // on wasm32-unknown-unknown ("time not implemented on this platform") —
    // which took the browser's whole render down, since the panic unwound
    // through the async task. There the clock is skipped and the seed is a
    // deterministic function of the prompt, which is the honest answer:
    // an in-process preview with no clock cannot have a time-varying seed.
    #[cfg(not(target_arch = "wasm32"))]
    let clock = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    #[cfg(target_arch = "wasm32")]
    let clock = 0u64;

    clock ^ hashed
}

fn render_cell(req: &MediaRequest, seed: u64, width: u32, height: u32) -> Vec<u8> {
    let prompt_hash = fnv1a(&req.prompt, 0x9E37_79B9_7F4A_7C15);
    let negative_hash = fnv1a(
        req.negative_prompt.as_deref().unwrap_or(""),
        0xC2B2_AE3D_27D4_EB4F,
    );
    let seed = seed ^ prompt_hash.rotate_left(17);

    let hue = (prompt_hash % 360) as f32 / 360.0;
    let hue_span = 0.08 + ((prompt_hash >> 8) % 40) as f32 / 360.0;
    let saturation = 0.55 + ((prompt_hash >> 16) % 30) as f32 / 100.0;
    let negative_shift = ((negative_hash % 17) as f32 - 8.0) / 100.0;

    let cfg = sd_cfg(req) as f32;
    let steps = sd_steps(req);
    let denoise = sd_denoise(req, 1.0) as f32;
    let sampler = sd_sampler(req);
    let scheduler = sd_scheduler(req);

    let w = width as usize;
    let h = height as usize;
    let mut rng = seed | 1;

    // The target field: a smooth, prompt-coloured abstract composition.
    let mut target: Vec<[f32; 3]> = Vec::with_capacity(w * h);
    let mut noise: Vec<f32> = Vec::with_capacity(w * h);
    for y in 0..h {
        for x in 0..w {
            let nx = x as f32 / width as f32;
            let ny = y as f32 / height as f32;
            let n = fbm(nx * 6.0, ny * 6.0, seed);
            let warp = fbm(nx * 3.0 + 11.0, ny * 3.0 + 7.0, seed ^ 0x51);
            let hue_at = hue + hue_span * n + warp * 0.15 + negative_shift;
            let light = 0.22 + 0.55 * n;
            target.push(hsl_to_rgb(hue_at.rem_euclid(1.0), saturation, light));
            noise.push(rand01(&mut rng));
        }
    }

    // Start from the target plus per-pixel noise, then denoise step by
    // step, guided by the target field.
    let mut buf: Vec<[f32; 3]> = target
        .iter()
        .zip(&noise)
        .map(|(c, r)| {
            let k = 0.55 + 0.9 * r;
            [c[0] * k, c[1] * k, c[2] * k]
        })
        .collect();
    let mut prev = buf.clone();
    let mut temp = buf.clone();

    for step in 0..steps {
        let t = step as f32 / steps.max(1) as f32;
        let schedule = match scheduler {
            "karras" => 1.6,
            "exponential" => 2.0,
            "sgm_uniform" => 0.9,
            _ => 1.0,
        };
        let remaining = (1.0 - t).powf(schedule);

        if sampler == "ddim" && step % 2 == 1 {
            continue;
        }
        if sampler == "dpmpp_2m" {
            for i in 0..buf.len() {
                buf[i] = mix(buf[i], prev[i], 0.18);
            }
        }

        blur3(&mut buf, &mut temp, w, h);
        if sampler == "heun" {
            blur3(&mut buf, &mut temp, w, h);
        }

        let guide = 0.06 + 0.16 * remaining;
        for i in 0..buf.len() {
            let mut c = mix(buf[i], target[i], guide);
            if sampler == "euler_ancestral" {
                let jitter = (rand01(&mut rng) - 0.5) * 0.06 * (1.0 - t);
                c = [c[0] + jitter, c[1] - jitter, c[2] + jitter];
            }
            buf[i] = c;
        }
        prev.copy_from_slice(&buf);
    }

    let contrast = (0.75 + cfg / 18.0).clamp(0.5, 2.5);
    let mut out = Vec::with_capacity(w * h * 4);
    for y in 0..h {
        for x in 0..w {
            let mut c = buf[y * w + x];
            for channel in &mut c {
                *channel = (*channel - 0.5) * contrast + 0.5;
            }
            if denoise < 1.0 {
                let g = 0.15 + 0.35 * (x as f32 / width as f32);
                c = mix(c, [g * 0.4, g * 0.5, g * 0.7], 1.0 - denoise);
            }
            let vx = x as f32 / width as f32 - 0.5;
            let vy = y as f32 / height as f32 - 0.5;
            let vignette = 1.0 - 0.45 * (vx * vx + vy * vy).min(1.0);
            let grain = (rand01(&mut rng) - 0.5) * 0.03;
            for channel in c {
                let value = (channel * vignette + grain).clamp(0.0, 1.0);
                out.push((value * 255.0).round() as u8);
            }
            out.push(255);
        }
    }
    out
}

/// A 3×3 box blur with clamped edges. `temp` is scratch space so the
/// render loop does not allocate per step.
fn blur3(buf: &mut [[f32; 3]], temp: &mut [[f32; 3]], width: usize, height: usize) {
    if width == 0 || height == 0 {
        return;
    }
    temp.copy_from_slice(buf);
    for y in 0..height {
        for x in 0..width {
            let mut acc = [0.0f32; 3];
            for dy in -1i32..=1 {
                let yy = (y as i32 + dy).clamp(0, height as i32 - 1) as usize;
                for dx in -1i32..=1 {
                    let xx = (x as i32 + dx).clamp(0, width as i32 - 1) as usize;
                    let p = temp[yy * width + xx];
                    acc[0] += p[0];
                    acc[1] += p[1];
                    acc[2] += p[2];
                }
            }
            buf[y * width + x] = [acc[0] / 9.0, acc[1] / 9.0, acc[2] / 9.0];
        }
    }
}

fn mix(a: [f32; 3], b: [f32; 3], t: f32) -> [f32; 3] {
    [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    ]
}

fn fnv1a(text: &str, seed: u64) -> u64 {
    let mut hash = 0xCBF2_9CE4_8422_2325u64 ^ seed;
    for byte in text.bytes() {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01B3);
    }
    hash
}

fn rand01(state: &mut u64) -> f32 {
    *state ^= *state >> 12;
    *state ^= *state << 25;
    *state ^= *state >> 27;
    ((state.wrapping_mul(0x2545_F491_4F6C_DD1D) >> 40) as f32) / (1u64 << 24) as f32
}

fn fbm(x: f32, y: f32, seed: u64) -> f32 {
    let mut amplitude = 0.5;
    let mut frequency = 1.0;
    let mut sum = 0.0;
    let mut norm = 0.0;
    for octave in 0..4u64 {
        sum += amplitude * noise2(x * frequency, y * frequency, seed.wrapping_add(octave * 0x9E37));
        norm += amplitude;
        amplitude *= 0.5;
        frequency *= 2.0;
    }
    (sum / norm).clamp(0.0, 1.0)
}

fn noise2(x: f32, y: f32, seed: u64) -> f32 {
    let xi = x.floor() as i64;
    let yi = y.floor() as i64;
    let xf = x - xi as f32;
    let yf = y - yi as f32;
    let u = xf * xf * (3.0 - 2.0 * xf);
    let v = yf * yf * (3.0 - 2.0 * yf);
    let a = hash2(xi, yi, seed);
    let b = hash2(xi + 1, yi, seed);
    let c = hash2(xi, yi + 1, seed);
    let d = hash2(xi + 1, yi + 1, seed);
    let top = a + (b - a) * u;
    let bottom = c + (d - c) * u;
    top + (bottom - top) * v
}

fn hash2(x: i64, y: i64, seed: u64) -> f32 {
    let mut hash = seed
        ^ (x as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15)
        ^ (y as u64).wrapping_mul(0xC2B2_AE3D_27D4_EB4F);
    hash ^= hash >> 33;
    hash = hash.wrapping_mul(0xFF51_AFD7_ED55_8CCD);
    hash ^= hash >> 33;
    hash = hash.wrapping_mul(0xC4CE_B9FE_1A85_EC53);
    hash ^= hash >> 33;
    (hash >> 40) as f32 / (1u64 << 24) as f32
}

fn hsl_to_rgb(h: f32, s: f32, l: f32) -> [f32; 3] {
    if s <= 0.0 {
        return [l, l, l];
    }
    let q = if l < 0.5 {
        l * (1.0 + s)
    } else {
        l + s - l * s
    };
    let p = 2.0 * l - q;
    [
        hue_to_rgb(p, q, h + 1.0 / 3.0),
        hue_to_rgb(p, q, h),
        hue_to_rgb(p, q, h - 1.0 / 3.0),
    ]
}

fn hue_to_rgb(p: f32, q: f32, t: f32) -> f32 {
    let t = t.rem_euclid(1.0);
    if t < 1.0 / 6.0 {
        p + (q - p) * 6.0 * t
    } else if t < 0.5 {
        q
    } else if t < 2.0 / 3.0 {
        p + (q - p) * (2.0 / 3.0 - t) * 6.0
    } else {
        p
    }
}

/// Encode RGBA8 pixels as a PNG. Uses stored (uncompressed) DEFLATE
/// blocks so the core needs no compression dependency; the files are
/// larger than zlib output but decode everywhere.
pub fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, String> {
    let expected = width as usize * height as usize * 4;
    if rgba.len() != expected {
        return Err(format!(
            "RGBA buffer is {} bytes, expected {expected} for {width}x{height}",
            rgba.len()
        ));
    }

    let mut raw = Vec::with_capacity((width as usize * 4 + 1) * height as usize);
    for row in 0..height as usize {
        raw.push(0); // filter: none
        let start = row * width as usize * 4;
        raw.extend_from_slice(&rgba[start..start + width as usize * 4]);
    }

    let mut zlib = Vec::with_capacity(raw.len() + raw.len() / 65_535 * 5 + 6);
    zlib.extend_from_slice(&[0x78, 0x01]);
    let mut offset = 0;
    while offset < raw.len() {
        let len = (raw.len() - offset).min(65_535);
        let last = offset + len >= raw.len();
        zlib.push(if last { 1 } else { 0 });
        zlib.extend_from_slice(&(len as u16).to_le_bytes());
        zlib.extend_from_slice(&(!(len as u16)).to_le_bytes());
        zlib.extend_from_slice(&raw[offset..offset + len]);
        offset += len;
    }
    zlib.extend_from_slice(&adler32(&raw).to_be_bytes());

    let mut out = Vec::with_capacity(zlib.len() + 128);
    out.extend_from_slice(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);
    let mut ihdr = Vec::with_capacity(13);
    ihdr.extend_from_slice(&width.to_be_bytes());
    ihdr.extend_from_slice(&height.to_be_bytes());
    ihdr.extend_from_slice(&[8, 6, 0, 0, 0]);
    write_chunk(&mut out, b"IHDR", &ihdr);
    write_chunk(&mut out, b"IDAT", &zlib);
    write_chunk(&mut out, b"IEND", &[]);
    Ok(out)
}

fn write_chunk(out: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    out.extend_from_slice(kind);
    out.extend_from_slice(data);
    let mut crc = crc32_update(0xFFFF_FFFF, kind);
    crc = crc32_update(crc, data);
    out.extend_from_slice(&(!crc).to_be_bytes());
}

fn crc32_update(mut crc: u32, data: &[u8]) -> u32 {
    for &byte in data {
        crc ^= byte as u32;
        for _ in 0..8 {
            crc = if crc & 1 != 0 {
                (crc >> 1) ^ 0xEDB8_8320
            } else {
                crc >> 1
            };
        }
    }
    crc
}

fn adler32(data: &[u8]) -> u32 {
    let mut a = 1u32;
    let mut b = 0u32;
    for &byte in data {
        a = (a + byte as u32) % 65_521;
        b = (b + a) % 65_521;
    }
    (b << 16) | a
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::MediaRequest;

    fn request(seed: u64) -> MediaRequest {
        MediaRequest {
            provider: crate::media::NATIVE_ID.into(),
            prompt: "a neon city at night".into(),
            width: Some(128),
            height: Some(128),
            seed: Some(seed),
            ..Default::default()
        }
    }

    #[test]
    fn the_same_seed_renders_the_same_pixels() {
        let a = render(&request(42)).unwrap();
        let b = render(&request(42)).unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn different_seeds_render_different_pixels() {
        let a = render(&request(1)).unwrap();
        let b = render(&request(2)).unwrap();
        assert_ne!(a.rgba, b.rgba);
    }

    #[test]
    fn explicit_size_wins_and_is_rounded_to_the_grid() {
        let mut req = request(3);
        req.width = Some(100);
        req.height = Some(70);
        let image = render(&req).unwrap();
        assert_eq!((image.width, image.height), (104, 72));
        assert_eq!(image.rgba.len(), 104 * 72 * 4);
    }

    #[test]
    fn a_batch_becomes_a_contact_sheet() {
        let mut req = request(4);
        req.batch = Some(4);
        let image = render(&req).unwrap();
        assert_eq!((image.width, image.height), (256, 256));
    }

    #[test]
    fn the_png_has_a_signature_and_an_ihdr() {
        let image = render(&request(5)).unwrap();
        let png = encode_png(image.width, image.height, &image.rgba).unwrap();
        assert_eq!(&png[..8], &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);
        assert_eq!(&png[12..16], b"IHDR");
        assert_eq!(
            u32::from_be_bytes([png[16], png[17], png[18], png[19]]),
            image.width
        );
        assert_eq!(
            u32::from_be_bytes([png[20], png[21], png[22], png[23]]),
            image.height
        );
    }

    #[test]
    fn the_data_url_decodes_back_to_the_png() {
        let url = png_data_url(&request(6)).unwrap();
        let payload = url
            .strip_prefix("data:image/png;base64,")
            .expect("png data URL");
        let bytes = crate::media::base64_decode(payload).unwrap();
        assert_eq!(&bytes[..8], &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);
    }

    #[test]
    fn only_images_are_supported() {
        let req = request(7);
        assert!(run(MediaKind::Image, &req).is_ok());
        assert!(run(MediaKind::Video, &req).is_err());
        assert!(run(MediaKind::Inpaint, &req).is_err());
    }

    #[test]
    fn png_rejects_a_wrong_buffer_size() {
        assert!(encode_png(2, 2, &[0; 4]).is_err());
    }

    #[test]
    fn a_named_seed_is_used_and_a_blank_one_still_resolves() {
        let mut req = MediaRequest::default();
        req.prompt = "a fox".into();

        // A named seed wins untouched: the caller asked for it.
        req.seed = Some(4242);
        assert_eq!(resolve_seed(&req), 4242);

        // A blank seed has to land on something usable, and different
        // prompts must not collide. On wasm32-unknown-unknown there is no
        // clock, so this is the whole of the fallback — which is why it has
        // to be prompt-derived rather than empty.
        req.seed = None;
        let first = resolve_seed(&req);
        assert_ne!(first, 0);
        req.prompt = "a different prompt".into();
        assert_ne!(resolve_seed(&req), first);
    }
}

