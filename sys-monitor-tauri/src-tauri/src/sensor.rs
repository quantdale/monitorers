use crate::state::{CollectorState, HistoryStore, RawPoll};

/// A single sensor source. Implement this trait for each hardware
/// subsystem (CPU, GPU, disk, network, etc.).
pub trait SensorProvider: Send + 'static {
    /// A stable identifier, e.g. "cpu", "nvidia_gpu", "disk".
    #[allow(dead_code)]
    fn id(&self) -> &'static str;

    /// Called once per poll cycle before `commit`. May perform I/O.
    /// `state` and `wmi_con` are provided by the caller (no handle duplication).
    /// Returns a `RawPoll` containing whatever this sensor read.
    fn poll(
        &mut self,
        state: &mut CollectorState,
        wmi_con: Option<&wmi::WMIConnection>,
    ) -> RawPoll;

    /// Called once per poll cycle after all providers have polled.
    /// Writes results into the given `HistoryStore`. Caller holds the store lock.
    /// Default: no-op (for sensors that write directly in `poll`).
    fn commit(&mut self, _store: &mut HistoryStore, _raw: &RawPoll) {}
}

pub struct SensorRegistry {
    providers: Vec<Box<dyn SensorProvider>>,
}

impl SensorRegistry {
    pub fn new() -> Self {
        Self {
            providers: Vec::new(),
        }
    }

    pub fn register(&mut self, provider: impl SensorProvider + 'static) {
        self.providers.push(Box::new(provider));
    }

    /// Poll all providers. Returns a Vec of RawPolls in registration order.
    /// Uses shared `state` and `wmi_con` — no PDH or WMI duplication.
    pub fn poll_all(
        &mut self,
        state: &mut CollectorState,
        wmi_con: Option<&wmi::WMIConnection>,
    ) -> Vec<RawPoll> {
        self.providers
            .iter_mut()
            .map(|p| p.poll(state, wmi_con))
            .collect()
    }

    /// Commit all providers with their corresponding RawPoll results.
    /// Caller must hold the store lock; each provider writes only its slice.
    pub fn commit_all(&mut self, store: &mut HistoryStore, raw_polls: &[RawPoll]) {
        for (provider, raw) in self.providers.iter_mut().zip(raw_polls.iter()) {
            provider.commit(store, raw);
        }
    }

    /// Returns true if any providers are registered.
    pub fn has_providers(&self) -> bool {
        !self.providers.is_empty()
    }
}

impl Default for SensorRegistry {
    fn default() -> Self {
        Self::new()
    }
}
