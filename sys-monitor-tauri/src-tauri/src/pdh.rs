// ── PDH handles ──────────────────────────────────────────────────────────────
// Extracted so hardware can depend on it without creating a state↔hardware cycle.
// All PDH handles live here. Opened once at startup and never recreated.

use windows::Win32::System::Performance::PdhCloseQuery;

pub struct PdhHandles {
    pub query: Option<isize>,
    pub gpu_3d_counter: Option<isize>,
    pub disk_active_counter: Option<isize>,
    pub disk_read_counter: Option<isize>,
    pub disk_write_counter: Option<isize>,
    pub disk_response_counter: Option<isize>,
}

impl Drop for PdhHandles {
    fn drop(&mut self) {
        if let Some(query) = self.query.take() {
            unsafe {
                PdhCloseQuery(query);
            }
        }
    }
}
