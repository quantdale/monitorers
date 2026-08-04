# Exploratory Register — add-e2e-verification-harness

This register documents scenarios from `add-realistic-usage-test-suite` that remain
genuinely un-drivable by software and the one-line reason why. No scenario is silently
dropped; each has an explicit entry here.

## Scenarios that stay exploratory

| Scenario | Reason it stays exploratory |
|---|---|
| Real physical drive hotplug (unplug a USB drive while the app is running) | No software trigger exists — requires a physical hardware change that cannot be simulated in a test harness |
| GPU dock/undock (hot-plug a GPU into the PCIe slot) | No software trigger exists — requires physical hardware insertion/removal |
| External monitor hotplug (connect/disconnect a display) | No software trigger exists — requires physical display hardware change |
| USB device enumeration changes (keyboard, mouse, webcam plugged/unplugged) | No software trigger exists — requires physical USB hardware change |
| Network interface hotplug (unplug Ethernet, disable Wi-Fi) | Can be partially driven via OS-level API, but the Tauri app's network metrics response depends on driver-level state that is not reliably controllable from a webview test |
| Battery state change (laptop unplugged / plugged in) | Requires physical power source change; can be simulated at the OS level on some platforms but not deterministically from a webview harness |
| Lid close/open (laptop sleep/wake) | Requires physical hardware action; cannot be triggered from a webview test |
| Multi-process launch (run a second instance of the app) | The app has no single-instance guard; a second process would launch a second window. This is testable but was deemed low-value since the app doesn't enforce single-instance behavior |

## Scenarios converted to driven E2E (see e2e/tests/)

| Scenario | Test file |
|---|---|
| Rendered CPU/GPU readout updates ≥2× within 2s | `rendered-updates.spec.ts` |
| "1 hour" window chart point count grows ~1/s | `chart-fidelity.spec.ts` |
| Drag-to-reorder and keyboard-reorder reorder cards (persistence across relaunch is unit-tested — the mock harness can't write `settings.json`) | `drag-reorder.spec.ts` |
| Hidden-card toggle shows/hides cards and updates the count (persistence is unit-tested) | `hidden-card.spec.ts` |
| Collector-error banner stays absent while the pipeline is healthy (the mock harness can't force a real panic; the panic path is Rust-tested) | `collector-error.spec.ts` |
