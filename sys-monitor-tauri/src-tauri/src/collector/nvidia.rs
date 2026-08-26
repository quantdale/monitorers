// ── NVML (Nvidia Management Library) ──────────────────────────────────────────
// Modern replacement for NVAPI; provides temperature, power, VRAM, fan, clock.

#[cfg(feature = "nvml")]
use nvml_wrapper::Nvml;

#[cfg(feature = "nvml")]
pub fn init_nvml() -> Option<Nvml> {
    match Nvml::init() {
        Ok(nvml) => {
            eprintln!("[NVML] Initialized successfully");
            Some(nvml)
        }
        Err(e) => {
            eprintln!("[NVML] Init failed: {e}");
            None
        }
    }
}

#[cfg(feature = "nvml")]
#[derive(Clone, Debug)]
pub struct NvmlDeviceReading {
    pub name: String,
    pub uuid: Option<String>,
    pub pci_bus_id: Option<String>,
    pub telemetry: crate::state::NvidiaTelemetry,
}

/// Check whether an NVML device name belongs to an Nvidia GPU.
/// NVML returns full names like "NVIDIA GeForce RTX 3060"; this matches
/// consumer, professional, and datacenter lines.
#[cfg(feature = "nvml")]
fn is_nvml_nvidia_device(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.contains("geforce")
        || lower.contains("rtx")
        || lower.contains("gtx")
        || lower.contains("nvidia")
        || lower.contains("quadro")
        || lower.contains("tesla")
        || lower.contains("nvs")
}

#[cfg(feature = "nvml")]
pub fn query_nvml(nvml: &Nvml) -> Vec<NvmlDeviceReading> {
    use nvml_wrapper::enum_wrappers::device::{Clock, ClockId, TemperatureSensor};

    let count = nvml.device_count().unwrap_or(0);
    let mut readings = Vec::new();
    for idx in 0..count {
        let Ok(device) = nvml.device_by_index(idx) else {
            continue;
        };
        let Ok(name) = device.name() else {
            continue;
        };
        if !is_nvml_nvidia_device(&name) {
            continue;
        }
        let (mem_used_mb, mem_total_mb) = match device.memory_info() {
            Ok(m) => (Some(m.used / 1024 / 1024), Some(m.total / 1024 / 1024)),
            Err(_) => (None, None),
        };
        let pci_bus_id = device.pci_info().ok().map(|info| info.bus_id);
        readings.push(NvmlDeviceReading {
            name,
            uuid: device.uuid().ok(),
            pci_bus_id,
            telemetry: crate::state::NvidiaTelemetry {
                temp_c: device
                    .temperature(TemperatureSensor::Gpu)
                    .ok()
                    .map(|t| t as f64),
                power_w: device.power_usage().ok().map(|mw| mw as f64 / 1000.0),
                mem_used_mb,
                mem_total_mb,
                fan_speed_pct: device.fan_speed(0).ok(),
                clock_mhz: device.clock(Clock::Graphics, ClockId::Current).ok(),
            },
        });
    }
    readings
}

#[cfg(feature = "nvml")]
fn normalized_gpu_name(name: &str) -> String {
    let lower = name.trim().to_ascii_lowercase();
    let without_brand = lower.strip_prefix("nvidia ").unwrap_or(&lower);
    without_brand
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(feature = "nvml")]
fn reading_identity_matches(key: &str, reading: &NvmlDeviceReading) -> bool {
    [reading.uuid.as_deref(), reading.pci_bus_id.as_deref()]
        .into_iter()
        .flatten()
        .any(|identity| {
            !identity.is_empty()
                && (key.eq_ignore_ascii_case(identity)
                    || key
                        .to_ascii_lowercase()
                        .contains(&identity.to_ascii_lowercase()))
        })
}

/// Reconcile NVML devices to collector GPU keys without guessing. A name-only
/// match is accepted only when it is unique on both sides; duplicate display
/// names remain unavailable unless an underlying key contains the NVML UUID or
/// PCI identity. This makes it impossible for GPU A's telemetry to be shown on
/// GPU B merely because it was enumerated first.
#[cfg(feature = "nvml")]
pub fn reconcile_nvml_readings(
    gpu_updates: &[(String, String, f64)],
    readings: &[NvmlDeviceReading],
) -> std::collections::HashMap<String, crate::state::NvidiaTelemetry> {
    let nvidia_gpus: Vec<_> = gpu_updates
        .iter()
        .filter(|(_, name, _)| crate::collector::is_nvidia_gpu(name))
        .collect();
    let mut result = std::collections::HashMap::new();
    let mut used_keys = std::collections::HashSet::new();
    let mut matched_readings = std::collections::HashSet::new();

    // First consume exact UUID/PCI matches. Enforce one-to-one assignment so a
    // malformed or duplicated NVML identity can never overwrite another card's
    // telemetry.
    for (reading_index, reading) in readings.iter().enumerate() {
        let candidates: Vec<&(String, String, f64)> = nvidia_gpus
            .iter()
            .copied()
            .filter(|(key, _, _)| reading_identity_matches(key, reading))
            .filter(|(key, _, _)| !used_keys.contains(key))
            .collect();
        if candidates.len() == 1 {
            let key = candidates[0].0.clone();
            result.insert(key.clone(), reading.telemetry.clone());
            used_keys.insert(key);
            matched_readings.insert(reading_index);
        }
    }

    // A normalized display-name match is safe only when both the collector and
    // NVML expose exactly one device with that name. This handles NVML's
    // leading "NVIDIA" brand prefix without guessing among identical cards.
    for (reading_index, reading) in readings.iter().enumerate() {
        if matched_readings.contains(&reading_index) {
            continue;
        }
        let normalized = normalized_gpu_name(&reading.name);
        let same_name_readings = readings
            .iter()
            .enumerate()
            .filter(|(index, other)| {
                !matched_readings.contains(index) && normalized_gpu_name(&other.name) == normalized
            })
            .count();
        let candidates: Vec<&(String, String, f64)> = nvidia_gpus
            .iter()
            .copied()
            .filter(|(key, name, _)| {
                !used_keys.contains(key) && normalized_gpu_name(name) == normalized
            })
            .collect();
        if same_name_readings == 1 && candidates.len() == 1 {
            let key = candidates[0].0.clone();
            result.insert(key.clone(), reading.telemetry.clone());
            used_keys.insert(key);
            matched_readings.insert(reading_index);
        }
    }
    result
}

// ── NVAPI GPU TEMPERATURE ────────────────────────────────────────────────────

#[cfg(all(feature = "nvapi", not(feature = "nvml")))]
use std::collections::HashMap;

/// Associate an NVAPI temperature reading with collector GPU keys.
///
/// NVAPI reports one aggregate reading and cannot identify which adapter it
/// came from, so the reading is attached only when exactly one Nvidia-candidate
/// GPU is present; multi-GPU systems intentionally receive no telemetry rather
/// than a guess. Shared by the full-poll path (`collector::poll`) and the GPU
/// sensor provider so the association policy lives in exactly one place.
#[cfg(all(feature = "nvapi", not(feature = "nvml")))]
pub fn nvapi_telemetry_for(
    gpu_updates: &[(String, String, f64)],
    temp: Option<f32>,
) -> Option<HashMap<String, crate::state::NvidiaTelemetry>> {
    let candidates: Vec<_> = gpu_updates
        .iter()
        .filter(|(_, name, _)| crate::collector::is_nvidia_gpu(name))
        .collect();
    Some(match (candidates.as_slice(), temp) {
        ([(key, _, _)], Some(temp)) => std::iter::once((
            key.clone(),
            crate::state::NvidiaTelemetry {
                temp_c: Some(temp as f64),
                ..Default::default()
            },
        ))
        .collect(),
        _ => HashMap::new(),
    })
}

/// Scan the populated thermal sensors (`sensors[..count]`) for a plausible GPU
/// core temperature and return it, or `None` if nothing valid is present.
///
/// Prefers the explicit GPU-core target sensor (`NVAPI_THERMAL_TARGET_GPU`);
/// falls back to the first populated sensor. Never reads past `count`: the
/// caller zero-initializes the settings struct, so unpopulated entries read
/// 0°C, which is not a valid reading — trusting them (or a sensor[0] fallback
/// on `count == 0`) would report a bogus 0°C.
#[cfg(feature = "nvapi")]
fn find_gpu_core_temp(
    sensors: &[nvapi_sys::gpu::thermal::NV_GPU_THERMAL_SETTINGS_SENSOR],
    count: usize,
) -> Option<f32> {
    use nvapi_sys::gpu::thermal::NVAPI_THERMAL_TARGET_GPU;

    let valid = &sensors[..count.min(sensors.len())];
    for s in valid {
        if s.target == NVAPI_THERMAL_TARGET_GPU && (0..=150).contains(&s.currentTemp) {
            return Some(s.currentTemp as f32);
        }
    }
    // Fallback: first populated sensor with a plausible temperature.
    valid.first().and_then(|s| {
        if (0..=150).contains(&s.currentTemp) {
            Some(s.currentTemp as f32)
        } else {
            None
        }
    })
}

/// Returns GPU core temperature in Celsius, or None if unavailable.
/// Uses NVAPI — Nvidia's proprietary C SDK. Only works on systems with an
/// Nvidia GPU and driver installed. Requires `nvapi` feature.
#[cfg(feature = "nvapi")]
#[cfg_attr(feature = "nvml", allow(dead_code))]
pub fn query_nvidia_gpu_temp(nvapi_initialized: bool) -> Option<f32> {
    // NVAPI must be initialized once per process — same reason as PDH query handle, stateful C API.
    // NVAPI_OK (0): all NVAPI functions return a status code; 0 = success.
    if !nvapi_initialized {
        return None;
    }

    // SAFETY: NVAPI is a C library reached via FFI. All buffers passed to it
    // (`gpu_handles`, `thermal`) are stack-local and zero-initialized before use;
    // every call's status code is checked before any output field is read.
    unsafe {
        use nvapi_sys::gpu::thermal::{
            NvAPI_GPU_GetThermalSettings, NVAPI_THERMAL_TARGET_ALL, NV_GPU_THERMAL_SETTINGS,
            NV_GPU_THERMAL_SETTINGS_VER,
        };
        use nvapi_sys::gpu::NvAPI_EnumPhysicalGPUs;
        use nvapi_sys::handles::NvPhysicalGpuHandle;
        use nvapi_sys::status::NVAPI_OK;
        use nvapi_sys::types::NVAPI_MAX_PHYSICAL_GPUS;

        let mut gpu_handles: [NvPhysicalGpuHandle; 64] = std::mem::zeroed();
        let mut gpu_count: u32 = 0;
        let status = NvAPI_EnumPhysicalGPUs(&mut gpu_handles, &mut gpu_count);
        if status != NVAPI_OK || gpu_count == 0 {
            return None;
        }

        // Query thermal settings. Use NVAPI_THERMAL_TARGET_ALL (15) to get all sensors,
        // then pick the GPU core sensor (target == NVAPI_THERMAL_TARGET_GPU).
        let mut thermal: NV_GPU_THERMAL_SETTINGS = std::mem::zeroed();
        thermal.version = NV_GPU_THERMAL_SETTINGS_VER;

        for handle in gpu_handles
            .iter()
            .take((gpu_count as usize).min(NVAPI_MAX_PHYSICAL_GPUS))
        {
            let status = NvAPI_GPU_GetThermalSettings(
                *handle,
                NVAPI_THERMAL_TARGET_ALL as u32,
                &mut thermal,
            );
            if status == NVAPI_OK {
                // honor the driver-reported populated-sensor count; never trust
                // zeroed (unpopulated) entries or a fallback when count is 0
                if let Some(temp) = find_gpu_core_temp(&thermal.sensor, thermal.count as usize) {
                    return Some(temp);
                }
            }
        }
        None
    }
}

#[cfg(not(feature = "nvapi"))]
pub fn query_nvidia_gpu_temp(_nvapi_initialized: bool) -> Option<f32> {
    None
}

#[cfg(test)]
mod tests {
    #[cfg(any(feature = "nvml", feature = "nvapi"))]
    use super::*;

    // The NVAPI path is only compiled when nvapi is on and nvml is absent (under
    // nvml, the field `nvapi_initialized` is cfg-gated out — see state.rs).
    #[cfg(all(feature = "nvapi", not(feature = "nvml")))]
    #[test]
    fn test_nvidia_temp_returns_none_gracefully() {
        // On a system where NVAPI is unavailable or GPU is absent,
        // query_nvidia_gpu_temp() must return None, not panic.
        let collector_state = crate::state::CollectorState::new();
        let _ = query_nvidia_gpu_temp(collector_state.nvapi_initialized);
    }

    // --- is_nvml_nvidia_device (AUDIT-006) ---

    #[cfg(feature = "nvml")]
    mod nvml_device_match {
        use super::*;

        #[test]
        fn recognizes_geforce() {
            assert!(is_nvml_nvidia_device("NVIDIA GeForce RTX 4070"));
        }

        #[test]
        fn recognizes_quadro() {
            assert!(is_nvml_nvidia_device("NVIDIA Quadro RTX 5000"));
        }

        #[test]
        fn recognizes_tesla() {
            assert!(is_nvml_nvidia_device("NVIDIA Tesla V100"));
        }

        #[test]
        fn recognizes_nvs() {
            assert!(is_nvml_nvidia_device("NVIDIA NVS 810"));
        }

        #[test]
        fn rejects_intel() {
            assert!(!is_nvml_nvidia_device("Intel(R) UHD Graphics 630"));
        }

        #[test]
        fn rejects_amd() {
            assert!(!is_nvml_nvidia_device("AMD Radeon RX 6700 XT"));
        }

        #[test]
        fn case_insensitive() {
            assert!(is_nvml_nvidia_device("nvidia geforce gtx 1660"));
            assert!(is_nvml_nvidia_device("NVIDIA GEFORCE RTX 3060"));
        }
    }

    #[cfg(feature = "nvml")]
    mod nvml_reconcile {
        use super::*;

        fn telemetry(temp_c: f64) -> crate::state::NvidiaTelemetry {
            crate::state::NvidiaTelemetry {
                temp_c: Some(temp_c),
                power_w: Some(temp_c * 2.0),
                ..Default::default()
            }
        }

        fn reading(
            name: &str,
            uuid: Option<&str>,
            pci_bus_id: Option<&str>,
            temp_c: f64,
        ) -> NvmlDeviceReading {
            NvmlDeviceReading {
                name: name.to_string(),
                uuid: uuid.map(str::to_string),
                pci_bus_id: pci_bus_id.map(str::to_string),
                telemetry: telemetry(temp_c),
            }
        }

        #[test]
        fn distinct_names_are_associated_with_their_own_cards() {
            let updates = vec![
                ("luid-a".to_string(), "GeForce RTX 3060".to_string(), 10.0),
                ("luid-b".to_string(), "GeForce RTX 4090".to_string(), 20.0),
            ];
            let readings = vec![
                reading("GeForce RTX 3060", None, None, 51.0),
                reading("GeForce RTX 4090", None, None, 72.0),
            ];
            let mapped = reconcile_nvml_readings(&updates, &readings);
            assert_eq!(mapped["luid-a"].temp_c, Some(51.0));
            assert_eq!(mapped["luid-b"].temp_c, Some(72.0));
        }

        #[test]
        fn unique_name_match_ignores_nvml_brand_prefix() {
            let updates = vec![("luid-a".to_string(), "GeForce RTX 3060".to_string(), 10.0)];
            let readings = vec![reading("NVIDIA GeForce RTX 3060", None, None, 51.0)];
            let mapped = reconcile_nvml_readings(&updates, &readings);
            assert_eq!(mapped["luid-a"].temp_c, Some(51.0));
        }

        #[test]
        fn duplicate_names_without_a_stable_identity_are_left_unmapped() {
            let updates = vec![
                ("luid-a".to_string(), "GeForce RTX 3060".to_string(), 10.0),
                ("luid-b".to_string(), "GeForce RTX 3060".to_string(), 20.0),
            ];
            let readings = vec![
                reading("GeForce RTX 3060", None, None, 51.0),
                reading("GeForce RTX 3060", None, None, 72.0),
            ];
            assert!(reconcile_nvml_readings(&updates, &readings).is_empty());
        }

        #[test]
        fn uuid_or_pci_identity_wins_for_same_name_cards() {
            let updates = vec![
                (
                    "GPU-uuid-a".to_string(),
                    "GeForce RTX 3060".to_string(),
                    10.0,
                ),
                (
                    "GPU-pci-b".to_string(),
                    "GeForce RTX 3060".to_string(),
                    20.0,
                ),
            ];
            let readings = vec![
                reading("GeForce RTX 3060", Some("GPU-uuid-a"), None, 51.0),
                reading("GeForce RTX 3060", None, Some("GPU-pci-b"), 72.0),
            ];
            let mapped = reconcile_nvml_readings(&updates, &readings);
            assert_eq!(mapped["GPU-uuid-a"].temp_c, Some(51.0));
            assert_eq!(mapped["GPU-pci-b"].temp_c, Some(72.0));
        }

        #[test]
        fn unmapped_reading_is_not_assigned_by_enumeration_order() {
            let updates = vec![
                ("luid-a".to_string(), "GeForce RTX 3060".to_string(), 10.0),
                ("luid-b".to_string(), "GeForce RTX 3060".to_string(), 20.0),
            ];
            let readings = vec![reading("GeForce RTX 3060", Some("GPU-unknown"), None, 51.0)];
            assert!(reconcile_nvml_readings(&updates, &readings).is_empty());
        }

        #[test]
        fn duplicate_direct_identity_is_not_allowed_to_overwrite_a_card() {
            let updates = vec![(
                "GPU-uuid-a".to_string(),
                "GeForce RTX 3060".to_string(),
                10.0,
            )];
            let readings = vec![
                reading("NVIDIA GeForce RTX 3060", Some("GPU-uuid-a"), None, 51.0),
                reading("NVIDIA GeForce RTX 3060", Some("GPU-uuid-a"), None, 72.0),
            ];
            let mapped = reconcile_nvml_readings(&updates, &readings);
            assert_eq!(mapped.len(), 1);
            assert_eq!(mapped["GPU-uuid-a"].temp_c, Some(51.0));
        }
    }

    // --- nvapi_telemetry_for (single-source association policy) ---
    // Only compiled in nvapi-without-nvml builds — the same gate as the
    // function itself, which is absent under default features.

    #[cfg(all(feature = "nvapi", not(feature = "nvml")))]
    mod nvapi_association {
        use super::*;

        #[test]
        fn single_candidate_receives_the_reading() {
            let updates = vec![("luid-a".to_string(), "GeForce RTX 3060".to_string(), 10.0)];
            let mapped = nvapi_telemetry_for(&updates, Some(71.0));
            assert_eq!(mapped.unwrap()["luid-a"].temp_c, Some(71.0));
        }

        #[test]
        fn multiple_candidates_receive_nothing_rather_than_a_guess() {
            let updates = vec![
                ("luid-a".to_string(), "GeForce RTX 3060".to_string(), 10.0),
                ("luid-b".to_string(), "GeForce RTX 4090".to_string(), 20.0),
            ];
            let mapped = nvapi_telemetry_for(&updates, Some(71.0));
            assert!(mapped.unwrap().is_empty());
        }

        #[test]
        fn non_nvidia_candidates_are_ignored() {
            let updates = vec![("luid-a".to_string(), "Radeon RX 6700 XT".to_string(), 10.0)];
            let mapped = nvapi_telemetry_for(&updates, Some(71.0));
            assert!(mapped.unwrap().is_empty());
        }

        #[test]
        fn failed_reading_yields_empty_map_not_none() {
            let updates = vec![("luid-a".to_string(), "GeForce RTX 3060".to_string(), 10.0)];
            assert!(nvapi_telemetry_for(&updates, None).unwrap().is_empty());
        }
    }

    // --- find_gpu_core_temp (F-3) ---

    #[cfg(feature = "nvapi")]
    mod thermal {
        use super::*;
        use nvapi_sys::gpu::thermal::{
            NVAPI_THERMAL_CONTROLLER_GPU_INTERNAL, NVAPI_THERMAL_TARGET_GPU,
            NVAPI_THERMAL_TARGET_MEMORY, NV_GPU_THERMAL_SETTINGS_SENSOR,
        };

        fn sensor(target: i32, temp: i32) -> NV_GPU_THERMAL_SETTINGS_SENSOR {
            NV_GPU_THERMAL_SETTINGS_SENSOR {
                controller: NVAPI_THERMAL_CONTROLLER_GPU_INTERNAL,
                defaultMinTemp: 0,
                defaultMaxTemp: 0,
                currentTemp: temp,
                target,
            }
        }

        fn zeroed() -> NV_GPU_THERMAL_SETTINGS_SENSOR {
            sensor(0, 0)
        }

        #[test]
        fn prefers_explicit_gpu_target() {
            let sensors = [
                sensor(NVAPI_THERMAL_TARGET_MEMORY, 45),
                sensor(NVAPI_THERMAL_TARGET_GPU, 71),
            ];
            assert_eq!(find_gpu_core_temp(&sensors, 2), Some(71.0));
        }

        #[test]
        fn falls_back_to_first_populated_sensor() {
            let sensors = [
                sensor(NVAPI_THERMAL_TARGET_MEMORY, 45),
                sensor(NVAPI_THERMAL_TARGET_GPU, 200),
            ];
            assert_eq!(find_gpu_core_temp(&sensors, 2), Some(45.0));
        }

        #[test]
        fn returns_none_when_nothing_valid() {
            // count == 0: zeroed entries read 0°C, which is not a valid reading.
            // The old code trusted sensor[0]'s 0°C and returned a bogus 0.
            let sensors = [zeroed(), zeroed(), zeroed()];
            assert_eq!(find_gpu_core_temp(&sensors, 0), None);
        }

        #[test]
        fn rejects_implausible_temperature() {
            let sensors = [
                sensor(NVAPI_THERMAL_TARGET_GPU, 200),
                sensor(NVAPI_THERMAL_TARGET_GPU, -5),
            ];
            assert_eq!(find_gpu_core_temp(&sensors, 2), None);
        }

        #[test]
        fn ignores_entries_beyond_populated_count() {
            // count == 1: the second entry (a "GPU" reading) must not be trusted.
            let sensors = [
                sensor(NVAPI_THERMAL_TARGET_MEMORY, 45),
                sensor(NVAPI_THERMAL_TARGET_GPU, 80),
                zeroed(),
            ];
            assert_eq!(find_gpu_core_temp(&sensors, 1), Some(45.0));
        }

        #[test]
        fn count_larger_than_array_is_clamped() {
            let sensors = [sensor(NVAPI_THERMAL_TARGET_GPU, 62)];
            assert_eq!(find_gpu_core_temp(&sensors, 99), Some(62.0));
        }
    }
}
