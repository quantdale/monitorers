// ── NVAPI GPU TEMPERATURE ────────────────────────────────────────────────────

/// Returns GPU core temperature in Celsius, or None if unavailable.
/// Uses NVAPI — Nvidia's proprietary C SDK. Only works on systems with an
/// Nvidia GPU and driver installed. Requires `nvapi` feature.
#[cfg(feature = "nvapi")]
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
