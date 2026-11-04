// build.rs — Rust build script run before compilation.
// cargo:rustc-link-search tells the linker where to find .lib files.
// We link against the stub nvapi64.lib; the real implementation is in
// nvapi64.dll (installed with the Nvidia driver). The stub resolves symbols at runtime.
fn main() {
    println!(r"cargo:rustc-link-search=native=C:\nvapi-sdk\amd64");
    println!("cargo:rustc-link-lib=nvapi64");
    tauri_build::build();
}
