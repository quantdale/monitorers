//! Persistent collector-error diagnostics.
//!
//! Collector fatal errors are delivered to the frontend via the
//! `collector-error` event and to stderr — but a windowed release build has no
//! console, so after a crash + relaunch there is zero diagnostic trace. This
//! module appends each fatal error as one timestamped line to
//! `collector-error.log` in the app-data directory (size-capped, best-effort:
//! any I/O failure degrades to stderr and never affects collection).

use std::io::Write;
use std::path::Path;

/// Log file name, resolved relative to the app-data directory.
pub const ERROR_LOG_FILE: &str = "collector-error.log";
/// Once the log exceeds this many bytes it is reset before the next append,
/// so a repeating failure can never grow the file without bound.
pub const ERROR_LOG_CAP_BYTES: u64 = 64 * 1024;

/// Format one log line: `<unix-secs> <message>`, with embedded newlines made
/// literal so every error stays exactly one line. The returned string always
/// ends in `\n`.
pub fn format_error_line(unix_secs: u64, msg: &str) -> String {
    // CRLF first so Windows line endings collapse to one separator, not two.
    let without_crlf = msg.replace("\r\n", " ");
    let one_line = without_crlf.replace(['\r', '\n'], " ");
    format!("{unix_secs} {one_line}\n")
}

/// Append `line` to `path`, resetting the file first when it is already at or
/// over `cap_bytes`. Best-effort by design; callers surface the error.
pub fn append_capped(path: &Path, line: &str, cap_bytes: u64) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let over_cap = path
        .metadata()
        .map(|m| m.len() >= cap_bytes)
        .unwrap_or(false);
    if over_cap {
        std::fs::remove_file(path).ok();
    }
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    file.write_all(line.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_error_line_is_single_timestamped_line() {
        let line = format_error_line(1_700_000_000, "metrics collection stopped");
        assert_eq!(line, "1700000000 metrics collection stopped\n");
    }

    #[test]
    fn embedded_newlines_become_spaces_and_line_is_newline_terminated() {
        let line = format_error_line(42, "first\r\nsecond\nthird");
        assert_eq!(line, "42 first second third\n");
    }

    #[test]
    fn append_capped_appends_and_resets_past_cap() {
        let dir =
            std::env::temp_dir().join(format!("sysmon-error-log-test-{}", std::process::id()));
        let path = dir.join("collector-error.log");
        let _ = std::fs::remove_file(&path);

        append_capped(&path, "aaa\n", 10).expect("first append");
        append_capped(&path, "bbb\n", 10).expect("second append");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "aaa\nbbb\n");

        // At cap (8 >= 10? no — 8 < 10), so this stays appended.
        append_capped(&path, "ccc\n", 10).expect("third append");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "aaa\nbbb\nccc\n");

        // Now 12 bytes >= cap of 10 → file resets and only the new line remains.
        append_capped(&path, "ddd\n", 10).expect("fourth append resets");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "ddd\n");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
