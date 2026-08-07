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
pub struct NvmlReadings {
    pub temp_c: Option<f64>,
    pub power_w: Option<f64>,
    pub mem_used_mb: Option<u64>,
    pub mem_total_mb: Option<u64>,
    pub fan_speed_pct: Option<u32>,
    pub clock_mhz: Option<u32>,
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
pub fn query_nvml(nvml: &Nvml) -> NvmlReadings {
    use nvml_wrapper::enum_wrappers::device::{Clock, ClockId, TemperatureSensor};

    // Enumerate all NVML devices and find the one that matches an Nvidia GPU.
    // Device index 0 is not guaranteed to be the Nvidia GPU in multi-GPU
    // systems (e.g. Intel iGPU may be at index 0). Fallback to device 0 if
    // no match is found.
    let device = {
        let count = nvml.device_count().unwrap_or(1);
        let mut matched = None;
        for idx in 0..count {
            if let Ok(dev) = nvml.device_by_index(idx) {
                if let Ok(name) = dev.name() {
                    if is_nvml_nvidia_device(&name) {
                        matched = Some(dev);
                        break;
                    }
                }
            }
        }
        match matched {
            Some(d) => d,
            None => match nvml.device_by_index(0) {
                Ok(d) => d,
                Err(e) => {
                    eprintln!("[NVML] device_by_index failed: {e}");
                    return NvmlReadings {
                        temp_c: None,
                        power_w: None,
                        mem_used_mb: None,
                        mem_total_mb: None,
                        fan_speed_pct: None,
                        clock_mhz: None,
                    };
                }
            },
        }
    };

    let temp_c = device
        .temperature(TemperatureSensor::Gpu)
        .ok()
        .map(|t| t as f64);

    let power_w = device.power_usage().ok().map(|mw| mw as f64 / 1000.0);

    let (mem_used_mb, mem_total_mb) = match device.memory_info() {
        Ok(m) => (Some(m.used / 1024 / 1024), Some(m.total / 1024 / 1024)),
        Err(_) => (None, None),
    };

    let fan_speed_pct = device.fan_speed(0).ok();

    let clock_mhz = device.clock(Clock::Graphics, ClockId::Current).ok();

    NvmlReadings {
        temp_c,
        power_w,
        mem_used_mb,
        mem_total_mb,
        fan_speed_pct,
        clock_mhz,
    }
}

// ── NVAPI GPU TEMPERATURE ────────────────────────────────────────────────────

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
