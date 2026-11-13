## Why

The native dashboard shows a software renderer as a second RTX 4050 and loses safely matchable Nvidia telemetry. The collector sorts unrelated PDH LUIDs and WMI captions by position, assigns surplus LUIDs the final caption, and drops the high half of each LUID. Actual DXGI enumeration provides adapter names, full identities and software flags without that guesswork.

## What Changes

- Resolve GPU labels by exact DXGI adapter LUID; exclude known software renderers and retain unknown PDH devices conservatively when enrichment is unavailable.
- Cache adapter metadata with bounded refresh and preserve it across transient enumeration errors; keep enumeration outside history locks and preserve PDH handles/cadence.
- Preserve current zero-high-part GPU keys; encode nonzero high parts without collisions and migrate uniquely identifiable legacy low-part layout/visibility IDs, retaining ambiguous orphans.
- Keep duplicate physical models separate with deterministic labels and fail-closed optional Nvidia telemetry.
- Qualify observed hardware inventory, real UI/telemetry, startup/cadence, all Rust feature matrices and persistence; update architecture docs.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `stable-hardware-identity`: exact adapter enrichment, software filtering, full LUID identity and safe legacy layout migration.

## Impact

GPU collector/cache, Windows binding feature configuration, frontend ID reconciliation and regression coverage, native qualification evidence and related architecture documentation. No metrics payload shape or collector/history timing change. Existing common GPU keys and persisted schema remain compatible.
