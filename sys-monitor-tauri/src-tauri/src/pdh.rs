// ── PDH handles ──────────────────────────────────────────────────────────────
// Extracted so hardware can depend on it without creating a state↔hardware cycle.
// All PDH handles live here. Opened once at startup and never recreated.

use std::collections::HashMap;
use windows::Win32::System::Performance::{
    PdhCloseQuery, PdhGetFormattedCounterArrayW, PDH_FMT_COUNTERVALUE_ITEM_W, PDH_FMT_DOUBLE,
    PDH_HCOUNTER, PDH_HQUERY,
};

pub struct PdhHandles {
    pub query: Option<PDH_HQUERY>,
    pub gpu_3d_counter: Option<PDH_HCOUNTER>,
    pub disk_active_counter: Option<PDH_HCOUNTER>,
    pub disk_read_counter: Option<PDH_HCOUNTER>,
    pub disk_write_counter: Option<PDH_HCOUNTER>,
    pub disk_response_counter: Option<PDH_HCOUNTER>,
}

impl Drop for PdhHandles {
    fn drop(&mut self) {
        if let Some(query) = self.query.take() {
            // SAFETY: `query` is an owned PDH_HQUERY handle taken from `self.query`,
            // so it is closed exactly once, at end of life, and never used afterward.
            unsafe {
                PdhCloseQuery(query);
            }
        }
    }
}

// SAFETY: PDH handles are process-global opaque pointers. They are created on and
// used exclusively by the background collector thread, so Send/Sync is sound here.
unsafe impl Send for PdhHandles {}
unsafe impl Sync for PdhHandles {}

/// Read a PDH formatted counter array into an instance-name → value map.
///
/// SAFETY: the returned `HashMap` owns only `String` keys and `f64` values; all
/// pointer indirection through `PDH_FMT_COUNTERVALUE_ITEM_W` happens inside the
/// unsafe block while `backing` is alive.
pub fn read_pdh_counter_array(counter: PDH_HCOUNTER) -> HashMap<String, f64> {
    // SAFETY: `counter` is a valid PDH counter handle opened once in
    // CollectorState::new() and kept alive by the caller's PdhHandles for the
    // whole process. `backing` is a u64 Vec sized to hold at least buffer_size
    // bytes, passed as the PDH_FMT_COUNTERVALUE_ITEM_W output array; the
    // returned items are only read while `backing` is alive (the HashMap owns
    // plain String/f64 values, and each item's CStatus is checked before its
    // value is read).
    unsafe {
        let mut buffer_size: u32 = 0;
        let mut item_count: u32 = 0;

        let _ = PdhGetFormattedCounterArrayW(
            counter,
            PDH_FMT_DOUBLE,
            &mut buffer_size,
            &mut item_count,
            None,
        );

        if buffer_size == 0 || item_count == 0 {
            return HashMap::new();
        }

        let u64_count = (buffer_size as usize * 3).div_ceil(8);
        let mut backing: Vec<u64> = vec![0u64; u64_count];
        let mut actual_buf_size: u32 = (u64_count * 8) as u32;
        let buf_ptr = backing.as_mut_ptr() as *mut PDH_FMT_COUNTERVALUE_ITEM_W;

        let status = PdhGetFormattedCounterArrayW(
            counter,
            PDH_FMT_DOUBLE,
            &mut actual_buf_size,
            &mut item_count,
            Some(buf_ptr),
        );

        if status != 0 {
            return HashMap::new();
        }

        let mut result = HashMap::new();
        for i in 0..item_count as usize {
            let item: &PDH_FMT_COUNTERVALUE_ITEM_W = &*buf_ptr.add(i);

            if item.FmtValue.CStatus > 1 {
                continue;
            }

            let name = item.szName.to_string().unwrap_or_default();
            let value = item.FmtValue.Anonymous.doubleValue;
            result.insert(name, value);
        }

        result
    }
}
