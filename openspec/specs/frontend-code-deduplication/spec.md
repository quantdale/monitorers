## Purpose

Defines frontend de-duplication requirements: canonical definition of cross-language constants, a single Tauri-runtime-detection helper, a single card-label fallback formatter, and one shared snapshot state-application path for real and mock data.

## Requirements

### Requirement: History buffer capacity is defined once per language boundary
The frontend and backend each maintain exactly one canonical definition of the history ring-buffer capacity (currently `3600`) on their own side of the IPC boundary. The Rust backend SHALL NOT define this value in more than one location; the TypeScript frontend's independent copy (required because no build-time value-sharing exists across the IPC boundary) SHALL carry a comment cross-referencing the Rust definition, and the Rust definition SHALL carry a comment cross-referencing the TypeScript one.

#### Scenario: Rust-side capacity has one definition
- **WHEN** `collector/mod.rs` or `state.rs` needs the history capacity
- **THEN** both reference the same single `const` rather than each declaring their own literal `3600`

#### Scenario: Cross-language value is discoverable
- **WHEN** a developer changes the capacity on one side of the IPC boundary (Rust or TypeScript)
- **THEN** a comment at that definition site points them to the corresponding definition on the other side, so the two don't silently drift

### Requirement: Tauri runtime detection has a single implementation
The frontend SHALL determine whether it is running inside the Tauri shell (vs. a plain browser/mock-data context) via exactly one shared helper function, not independently reimplemented `window.__TAURI_INTERNALS__` checks in multiple files.

#### Scenario: Shared helper used by settings and metrics hooks
- **WHEN** `useSettings.ts` or `useMetrics.ts` needs to know whether it is running under Tauri
- **THEN** both call the same shared `isTauri()`-equivalent helper rather than each inlining the `window.__TAURI_INTERNALS__` check

### Requirement: Card label fallback formatting has no duplicated logic
`App.tsx`'s card-label derivation SHALL compute its fallback-formatted label (used when no explicit label is configured) via a single code path, not two verbatim copies of the same formatting logic within the same function.

#### Scenario: Single fallback formatter
- **WHEN** `getCardLabel` needs to derive a fallback label for a card id
- **THEN** it calls one internal helper for that formatting, used consistently at every call site that needs a fallback label

### Requirement: Snapshot state application is shared between the real and mock data paths
The frontend's per-`MetricsSnapshot` state-application logic (updating latest-value state, gating history appends on `on_tick`, merging GPU/disk data) SHALL be implemented once and invoked identically from both the real `metrics-update` IPC listener and the browser-mock `setInterval` data-generation path.

#### Scenario: Real and mock paths call the same state-application function
- **WHEN** a `MetricsSnapshot`-shaped payload arrives via either the real Tauri `metrics-update` event or the mock interval's synthetic snapshot
- **THEN** both paths apply it to React state via the same shared function, not two independently maintained copies of the same ~35-40 lines of logic
