// build.rs is a Rust build script that runs before compilation.
// It configures the build environment (e.g. linker search paths).
//
// cargo:rustc-link-search tells the linker where to find .lib files.
// We point it to the NVAPI SDK directory containing nvapi64.lib.
//
// We link against the stub .lib, not the DLL directly: the stub provides
// import symbols that resolve at runtime from nvapi64.dll (installed with
// the Nvidia driver). The actual implementation lives in the driver.
fn main() {
    println!(r"cargo:rustc-link-search=native=C:\nvapi-sdk\amd64");
    println!("cargo:rustc-link-lib=nvapi64");
    tauri_build::build()
}
