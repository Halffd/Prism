//! Markdown table alignment used by the `tableformat` plugin.
//!
//! Pure string transform: detects contiguous table-row blocks, validates
//! the separator row, and pads cells so every row shares column widths.
//! No regex dependency; no unicode width handling beyond char counts
//! (acceptable for mono-width terminal output; CJK double-width glyphs
//! pad slightly narrow, never corrupt the table).

/// Is this line a markdown table row (`| ... | ... |`)?
fn is_table_row(line: &str) -> bool {
    let t = line.trim();
    t.starts_with('|') && t.ends_with('|') && t.len() >= 2
}

/// Does this block look like a real table (separator row with dashes)?
fn has_separator(rows: &[&str]) -> bool {
    rows.len() >= 2 && {
        let sep = rows[1].trim();
        sep.contains('-')
            && sep
                .chars()
                .all(|c| c == '|' || c == '-' || c == ':' || c.is_whitespace())
    }
}

/// Split one row into trimmed cells.
fn parse_row(line: &str) -> Vec<String> {
    line.trim()
        .trim_start_matches('|')
        .trim_end_matches('|')
        .split('|')
        .map(|c| c.trim().to_string())
        .collect()
}

/// Format a block of table rows into aligned output lines.
fn format_block(rows: &[&str]) -> Vec<String> {
    let parsed: Vec<Vec<String>> = rows.iter().map(|r| parse_row(r)).collect();
    let cols = parsed.iter().map(|r| r.len()).max().unwrap_or(0);
    let mut widths = vec![0usize; cols];
    for row in &parsed {
        for (i, cell) in row.iter().enumerate() {
            widths[i] = widths[i].max(cell.chars().count());
        }
    }
    let mut out = Vec::with_capacity(rows.len());
    for (i, row) in parsed.iter().enumerate() {
        let mut cells = Vec::with_capacity(cols);
        for (c, width) in widths.iter().enumerate().take(cols) {
            let cell = row.get(c).map(String::as_str).unwrap_or("");
            let pad = width.saturating_sub(cell.chars().count());
            if i == 1 {
                // separator row: preserve alignment colons
                let left = cell.starts_with(':');
                let right = cell.ends_with(':');
                let inner = width.saturating_sub(usize::from(left) + usize::from(right));
                let dashes = "-".repeat(inner.max(1));
                cells.push(format!(
                    " {}{}{} ",
                    if left { ":" } else { "" },
                    dashes,
                    if right { ":" } else { "" }
                ));
            } else {
                cells.push(format!(" {cell}{} ", " ".repeat(pad)));
            }
        }
        out.push(format!("|{}|", cells.join("|")));
    }
    out
}

/// Format all valid tables in `text`. Returns `None` when nothing changed
/// so the caller can skip rewrites.
pub fn format_tables(text: &str) -> Option<String> {
    if !text.contains('|') {
        return None;
    }
    let lines: Vec<&str> = text.lines().collect();
    let mut result: Vec<String> = Vec::with_capacity(lines.len() + 4);
    let mut changed = false;
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i];
        if is_table_row(line) {
            let start = i;
            while i < lines.len() && is_table_row(lines[i]) {
                i += 1;
            }
            let block = &lines[start..i];
            if has_separator(block) {
                result.extend(format_block(block));
                changed = true;
            } else {
                result.extend(block.iter().map(|s| s.to_string()));
            }
        } else {
            result.push(line.to_string());
            i += 1;
        }
    }

    if changed {
        Some(result.join("\n"))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aligns_columns() {
        let src = "| a | bb |\n| - | -- |\n| 1 | 2 |\n| x | yy |";
        let out = format_tables(src).unwrap();
        let lines: Vec<&str> = out.lines().collect();
        assert_eq!(lines[0], "| a | bb |");
        assert_eq!(lines[1], "| - | -- |");
        assert_eq!(lines[2], "| 1 | 2  |");
        assert_eq!(lines[3], "| x | yy |");
    }

    #[test]
    fn preserves_colon_alignment() {
        let src = "| l | c | r |\n| :- | :-: | -: |\n| 1 | 2 | 3 |";
        let out = format_tables(src).unwrap();
        let lines: Vec<&str> = out.lines().collect();
        assert_eq!(lines[1], "| :- | :-: | -: |");
    }

    #[test]
    fn skips_invalid_blocks() {
        let src = "| a | b |";
        assert!(format_tables(src).is_none());
        let two = "| a | b |\n| no separator here |";
        assert!(format_tables(two).is_none());
    }

    #[test]
    fn leaves_non_tables_alone() {
        let src = "just | some | text\nsecond line";
        assert!(format_tables(src).is_none());
    }

    #[test]
    fn ragged_rows_padded() {
        let src = "| a | b | c |\n| - | - | - |\n| 1 |";
        let out = format_tables(src).unwrap();
        let lines: Vec<&str> = out.lines().collect();
        assert_eq!(lines[2], "| 1 |   |   |");
    }
}
