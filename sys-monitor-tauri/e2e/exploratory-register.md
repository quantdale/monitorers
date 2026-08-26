# Exploratory Register — add-e2e-verification-harness

This register documents scenarios from `add-realistic-usage-test-suite` that remain
genuinely un-drivable by software and the one-line reason why. No scenario is silently
dropped; each has an explicit entry here.

## Update — add-user-simulation-platform (2026-08-04)

The simulation platform (`e2e/sim/`) revisits this register:

- **Made drivable (mock lane, via the simulation bridge):** injected collector
  panic (`collector-error` fault), PDH freeze, disk/GPU ghost/restore (hotplug
  cycle), schema-version mismatch, corrupt settings, slow/failing history load —
  all scripted through `window.__SIM__` with no hardware involved.
- **Made drivable (real lane, via the CDP real-app driver):** real Tauri IPC,
  real `settings.json` persistence (with per-run temp-dir isolation), real
  sensor data, and full app restart — the real backend is no longer
  automation-blind.
- **Still registered (real hardware / OS power events):** see the table below.
- **Real-lane fault injection remains registered**: the real app does not run
  the mock bridge, so scripted faults (collector-error, hotplug) are mock-lane
  only. Real PDH/WMI behavior is whatever the hardware does; CADENCE truth stays
  with `cadence_probe`.

## Update — e2e/sim hardening (2026-08-21)

- **Sidebar reorder is mock-undrivable** (discovered while fixing the dead
  `[data-sb-id]` selectors in `engine/steps.ts`): the browser harness never
  has a hardware profile — `useHardwareProfile` skips
  `get_hardware_profile` when `isTauri()` is false — so sidebar cards and
  their drag handles never render. Registered in the table below;
  `dragSidebarCard` remains available to the real lane.
- The PDH **freeze fault is now exercised** by the `fault-freeze-recovery`
  journey (hold + resume), and view-mode persistence mid-run/restart by
  `layout-persistence`.
- **Free-roam pointer reorder is mock-lane-only by design**: the persona
  free-roam step (`engine/freeroam.ts`) skips `reorderDashboard` on the real
  lane — a CDP-driven pointer drag against the relaunched WebView2 window is
  drivable in principle but unproven, so it logs a skip observation instead of
  gambling the lane's stability. The step itself stays registered here until
  driven once by hand on the real lane.

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
| Sidebar card reorder on the mock lane (dashboard reorder is drivable) | The browser harness has no hardware profile, so sidebar cards never render there; the REAL lane certifies ordering across a true relaunch via the automated `sidebar-relaunch-persistence` journey (see the 2026-08-26 update above) |

## Scenarios converted to driven E2E (see e2e/tests/)

| Scenario | Test file |
|---|---|
| Rendered CPU/GPU readout updates ≥2× within 2s | `rendered-updates.spec.ts` |
| "1 hour" window chart point count grows ~1/s | `chart-fidelity.spec.ts` |
| Drag-to-reorder and keyboard-reorder reorder cards (persistence across relaunch is unit-tested — the mock harness can't write `settings.json`) | `drag-reorder.spec.ts` |
| Hidden-card toggle shows/hides cards and updates the count (persistence is unit-tested) | `hidden-card.spec.ts` |
| Collector-error banner stays absent while the pipeline is healthy (the mock harness can't force a real panic; the panic path is Rust-tested) | `collector-error.spec.ts` |
