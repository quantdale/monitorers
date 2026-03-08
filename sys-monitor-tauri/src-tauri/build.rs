fn main() {
    tauri_build::build();
    // nvapi-sys loads nvapi64.dll at runtime from the Nvidia driver; no link directives needed.
}
