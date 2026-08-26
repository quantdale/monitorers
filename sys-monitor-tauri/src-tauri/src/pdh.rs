// ── PDH handles ──────────────────────────────────────────────────────────────
// Extracted so hardware can depend on it without creating a state↔hardware cycle.
// All PDH handles live here. Opened once at startup and never recreated.

use std::cell::RefCell;
use std::collections::HashMap;
use windows::Win32::System::Performance::{
    PdhCloseQuery, PdhGetFormattedCounterArrayW, PDH_FMT_COUNTERVALUE_ITEM_W, PDH_FMT_DOUBLE,
    PDH_HCOUNTER, PDH_HQUERY,
};

thread_local! {
    /// Reusable backing buffer for `PdhGetFormattedCounterArrayW`, keyed by
    /// thread (each collector session owns one thread, so a replaced session's
    /// buffer is freed with its thread instead of lingering).
    ///
    /// The GPU-engine counter array grows with the number of running processes
    /// (hundreds of instances is normal) and is read every ~250ms by the sensor
    /// registry plus four disk counters per full tick. Allocating PDH's 3×
    /// headroom fresh on every read churned megabytes per second for nothing;
    /// reusing the thread's high-water buffer removes that entirely.
    static PDH_SCRATCH: RefCell<Vec<u64>> = const { RefCell::new(Vec::new()) };
}

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
/// The backing buffer is reused across calls via the thread-local scratch:
/// when it already has capacity the read is attempted directly (one FFI call,
/// no allocation), and only a failed direct read falls back to the sizing
/// round-trip with fresh 3× headroom — identical growth policy to the previous
/// allocate-per-call implementation, minus the per-call allocation.
///
/// SAFETY: `counter` is a valid PDH counter handle opened once in
/// CollectorState::new() and kept alive by the caller's PdhHandles for the
/// whole process. The scratch Vec is u64-aligned and sized to at least
/// `buffer_size` bytes before being cast to the item array; returned items are
/// only read while the scratch borrow is alive (the HashMap owns plain
/// String/f64 values, and each item's CStatus is checked before its value is
/// read).
pub fn read_pdh_counter_array(counter: PDH_HCOUNTER) -> HashMap<String, f64> {
    PDH_SCRATCH.with(|cell| {
        let mut scratch = cell.borrow_mut();
        // SAFETY: all pointer indirection through PDH_FMT_COUNTERVALUE_ITEM_W
        // happens below while `scratch` is alive and its length covers the byte
        // size passed to PDH; output values are read only after the status is
        // checked.
        unsafe {
            let mut item_count: u32 = 0;

            // Fast path: reuse the existing buffer without a sizing call.
            if !scratch.is_empty() {
                let mut actual_buf_size =
                    scratch.len().saturating_mul(8).min(u32::MAX as usize) as u32;
                let buf_ptr = scratch.as_mut_ptr() as *mut PDH_FMT_COUNTERVALUE_ITEM_W;
                let status = PdhGetFormattedCounterArrayW(
                    counter,
                    PDH_FMT_DOUBLE,
                    &mut actual_buf_size,
                    &mut item_count,
                    Some(buf_ptr),
                );
                if status == 0 {
                    return parse_counter_items(buf_ptr, item_count);
                }
            }

            // Slow path: sizing round-trip, then grow with the same 3× headroom
            // the allocate-per-call version used (the instance list can grow
            // between the two calls — a new GPU engine process, a hot-plugged
            // disk — and PDH then needs more than the reported size).
            let mut buffer_size: u32 = 0;
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
            scratch.clear();
            scratch.resize(u64_count, 0);
            let mut actual_buf_size: u32 = (u64_count * 8) as u32;
            let buf_ptr = scratch.as_mut_ptr() as *mut PDH_FMT_COUNTERVALUE_ITEM_W;

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

            parse_counter_items(buf_ptr, item_count)
        }
    })
}

/// # Safety
///
/// `buf_ptr` must point to at least `item_count` initialized
/// `PDH_FMT_COUNTERVALUE_ITEM_W` elements backed by a live buffer.
///
/// SAFETY: the returned HashMap owns only plain `String`/`f64` values; every
/// pointer read below happens before the function returns and after each
/// item's CStatus has been validated.
unsafe fn parse_counter_items(
    buf_ptr: *mut PDH_FMT_COUNTERVALUE_ITEM_W,
    item_count: u32,
) -> HashMap<String, f64> {
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
