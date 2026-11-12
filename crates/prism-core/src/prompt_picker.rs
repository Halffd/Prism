//! Random prompt/choice picking: the "shuffle" a surface offers when
//! the user cannot decide what to ask.
//!
//! Pure functions over a `&[String]` set: `pick` and `shuffle` take an
//! explicit `seed` so the result is deterministic under test (the host
//! supplies a clock or counter) and varied in use. No `rand` crate —
//! the xorshift below is sufficient for picking between a handful of
//! prompts and keeps the core dependency-free.

/// xorshift64: small, fast, good enough for shuffling a prompt list.
/// Not cryptographic.
fn xorshift(mut x: u64) -> u64 {
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    x
}

fn advance(seed: u64, i: usize) -> u64 {
    // Fold the index in so consecutive picks differ even for the same
    // seed: a caller reusing one seed for several picks still varies.
    xorshift(seed.wrapping_add(i as u64).wrapping_mul(0x9E3779B97F4A7C15))
}

/// Pick one prompt. Returns None for an empty set. `seed` + `avoid`
/// (the previously picked text, if any) prevent immediate repeats —
/// with a single-element set the pick is that element regardless.
pub fn pick<'a>(prompts: &[&'a str], seed: u64, avoid: Option<&str>) -> Option<&'a str> {
    if prompts.is_empty() {
        return None;
    }
    let first = advance(seed, 0);
    if prompts.len() == 1 {
        return prompts.first().copied();
    }
    let start = (first % prompts.len() as u64) as usize;
    // Walk forward from the start until a non-avoided entry; the whole
    // list is the fallback when everything is avoided.
    for step in 0..prompts.len() {
        let idx = (start + step) % prompts.len();
        if Some(prompts[idx]) != avoid {
            return Some(prompts[idx]);
        }
    }
    prompts.get(start).copied()
}

/// Fisher-Yates shuffle driven by `seed`. Stable, deterministic.
pub fn shuffle<'a>(prompts: &[&'a str], seed: u64) -> Vec<&'a str> {
    let mut v = prompts.to_vec();
    let n = v.len();
    for i in (1..n).rev() {
        let r = advance(seed, n - i);
        let j = (r % (i as u64 + 1)) as usize;
        v.swap(i, j);
    }
    v
}

/// First `n` prompts of a shuffle (a "give me options" surface). `n`
/// is clamped to the set size.
pub fn sample<'a>(prompts: &[&'a str], seed: u64, n: usize) -> Vec<&'a str> {
    shuffle(prompts, seed).into_iter().take(n.min(prompts.len())).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set() -> Vec<&'static str> {
        vec!["tell me a joke", "explain monads", "write a haiku", "debug this"]
    }

    #[test]
    fn pick_none_for_empty() {
        assert!(pick(&[], 42, None).is_none());
    }

    #[test]
    fn pick_is_deterministic_for_a_seed() {
        let s = set();
        let a = pick(&s, 12345, None);
        let b = pick(&s, 12345, None);
        assert_eq!(a, b);
    }

    #[test]
    fn pick_avoids_the_previous_choice() {
        let s = set();
        let first = pick(&s, 7, None).unwrap().to_string();
        let second = pick(&s, 7, Some(&first));
        assert_ne!(second, Some(first.as_str()), "must not repeat immediately");
        assert!(s.contains(&second.unwrap()));
    }

    #[test]
    fn pick_single_element_always_returns_it() {
        let only = vec!["only"];
        assert_eq!(pick(&only, 999, Some("only")), Some("only"));
    }

    #[test]
    fn pick_covers_every_element_across_seeds() {
        let s = set();
        let mut seen: Vec<&str> = Vec::new();
        for seed in 0..64u64 {
            let p = pick(&s, seed, None).unwrap();
            if !seen.contains(&p) {
                seen.push(p);
            }
        }
        assert_eq!(seen.len(), s.len(), "all prompts reachable: {seen:?}");
    }

    #[test]
    fn shuffle_is_deterministic_and_permutes() {
        let s = set();
        let a = shuffle(&s, 99);
        let b = shuffle(&s, 99);
        assert_eq!(a, b);
        assert_eq!(a.len(), s.len());
        let mut a_sorted = a.clone();
        a_sorted.sort();
        let mut s_sorted = s.clone();
        s_sorted.sort();
        assert_eq!(a_sorted, s_sorted, "same elements, reordered");
    }

    #[test]
    fn shuffle_varies_across_seeds() {
        let s = set();
        assert_ne!(shuffle(&s, 1), shuffle(&s, 2));
    }

    #[test]
    fn sample_clamps_to_size() {
        let s = set();
        assert_eq!(sample(&s, 5, 2).len(), 2);
        assert_eq!(sample(&s, 5, 99).len(), s.len());
        assert!(sample(&[], 5, 3).is_empty());
    }

    #[test]
    fn seed_zero_is_usable() {
        let s = set();
        assert!(pick(&s, 0, None).is_some());
        assert_eq!(shuffle(&s, 0).len(), s.len());
    }
}
