// ── NVML (Nvidia Management Library) ──────────────────────────────────────────
// Modern replacement for NVAPI; provides temperature, power, VRAM, fan, clock.

#[cfg(feature = "nvml")]
use nvml_wrapper::Nvml;

#[cfg(feature = "nvml")]
pub fn init_nvml() -> Option<Nvml> {
    match Nvml::init() {
        Ok(nvml) => {
            println!("[NVML] Initialized successfully");
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

#[cfg(feature = "nvml")]
pub fn query_nvml(nvml: &Nvml) -> NvmlReadings {
    use nvml_wrapper::enum_wrappers::device::{Clock, ClockId, TemperatureSensor};

    let device = match nvml.device_by_index(0) {
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
    };

    let temp_c = device
        .temperature(TemperatureSensor::Gpu)
        .ok()
        .map(|t| t as f64);

    let power_w = device
        .power_usage()
        .ok()
        .map(|mw| mw as f64 / 1000.0);

    let (mem_used_mb, mem_total_mb) = match device.memory_info() {
        Ok(m) => (
            Some(m.used / 1024 / 1024),
            Some(m.total / 1024 / 1024),
        ),
        Err(_) => (None, None),
    };

    let fan_speed_pct = device.fan_speed(0).ok();

    let clock_mhz = device
        .clock(Clock::Graphics, ClockId::Current)
        .ok();

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

/// Returns GPU core temperature in Celsius, or None if unavailable.
/// Uses NVAPI — Nvidia's proprietary C SDK. Only works on systems with an
/// Nvidia GPU and driver installed. Requires `nvapi` feature.
#[cfg(feature = "nvapi")]
#[cfg_attr(feature = "nvml", allow(dead_code))]
pub fn query_nvidia_gpu_temp(nvapi_initialized: bool) -> Option<f32> {
    // NVAPI must be initialized once per process — same reason as PDH query handle, stateful C API.
    // unsafe: NVAPI is a C library, Rust cannot verify its safety.
    // NVAPI_OK (0): all NVAPI functions return a status code; 0 = success.
    if !nvapi_initialized {
        return None;
    }

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
                // Find GPU core sensor (target == 1 = NVAPI_THERMAL_TARGET_GPU)
                for s in &thermal.sensor {
                    if s.target == nvapi_sys::gpu::thermal::NVAPI_THERMAL_TARGET_GPU
                        && (0..=150).contains(&s.currentTemp)
                    {
                        return Some(s.currentTemp as f32);
                    }
                }
                // Fallback: sensor[0] if no explicit GPU target
                let temp = thermal.sensor[0].currentTemp;
                if (0..=150).contains(&temp) {
                    return Some(temp as f32);
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

    // --- NVAPI helper tests ---

    #[test]
    fn test_nvidia_temp_returns_none_gracefully() {
        // On a system where NVAPI is unavailable or GPU is absent,
        // query_nvidia_gpu_temp() must return None, not panic.
        let collector_state = crate::state::CollectorState::new();
        let _ = query_nvidia_gpu_temp(collector_state.nvapi_initialized);
    }
}
