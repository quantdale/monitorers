//! Read-only adapter catalog diagnostic; run on the Windows qualification host.
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let catalog = sys_monitor_tauri::collector::enumerate_gpu_adapters()?;
    let mut software: Vec<_> = catalog.software_keys.into_iter().collect();
    software.sort();
    println!(
        "{}",
        serde_json::to_string_pretty(&serde_json::json!({
            "physical": catalog.captions,
            "software": software,
        }))?
    );
    Ok(())
}
