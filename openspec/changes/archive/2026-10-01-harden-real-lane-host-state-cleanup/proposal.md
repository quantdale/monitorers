## Why

The packaged/real simulation driver writes a **machine-wide HKLM policy that enables remote debugging for every WebView2 host on the machine**, and relies solely on an orderly `close()` call to remove it.

`e2e/sim/drivers/RealAppDriver.ts` documents and does exactly this:

```ts
const WV2_ARGS_POLICY_KEY = 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge\\WebView2\\AdditionalBrowserArguments';
…
this.hklmOps.write(WV2_ARGS_POLICY_KEY, '*', args);
```

The value name is `*`, so the debug switches (`--remote-debugging-port=<p> --remote-allow-origins=*`) apply to **all** WebView2 applications on the host, not just the one under test. The driver's own comment calls the removal "SECURITY-CRITICAL" and places it outside every fallible teardown path — but "every fallible path" only covers failures that reach `close()`. Nothing guarantees `close()` runs:

- `e2e/sim/run.spec.ts` and `e2e/sim/qualify.spec.ts` are Playwright specs. If a developer or CI job interrupts them with **Ctrl-C**, the Playwright worker is terminated and the `try/finally` in `runJourney` (and the spec's own `try/finally`) never runs. The policy value is left behind, machine-wide, until someone manually deletes it.
- A crash, a runner eviction, or a hard job timeout in CI behaves the same way.
- There is no `process.on('SIGINT' | 'SIGTERM' | 'exit' | 'uncaughtException')` handler anywhere in `e2e/` or `src/` (verified by search) that would attempt cleanup, and no separate watchdog process.

Consequence: after an interrupted `npm run sim:real` (an explicitly documented, opt-in **local** command per `AGENTS.md`), any WebView2 app on that machine — Outlook, Teams, Widgets, another Chromium-embedded app — is launched with an open remote-debugging port and wildcard allowed-origins until a human notices and removes the registry value. On a developer workstation that is a persistent, silent exposure with no in-product signal.

A second, narrower instance of the same class: the driver's `removeHklmArgsFallback()` sets `hklmArgsValueWritten = false` in a `finally` *before* reporting whether removal succeeded, and `close()` aggregates the failure only if `remove` throws. If the removal silently no-ops (e.g. a policy refresh race), the run is reported as clean while the value is still present. The current unit tests (`RealAppDriver.close.test.ts`) cover the throw path but not a "reported success, value still present" post-condition.

## What Changes

- **Make the machine-wide policy write survivable**: register a process-level cleanup handler (`SIGINT`, `SIGTERM`, `exit`, and `uncaughtException`) that removes the policy value, and keep it idempotent so it composes with the existing `close()` path rather than replacing it.
- **Verify removal instead of assuming it**: after attempting removal, read the value back and fail (or at minimum record a loud, unmissable diagnostic) if it is still present, so a silent no-op cannot be reported as a clean run.
- **Reduce the blast radius where possible**: the value name `*` is the widest possible scope. Narrow it if WebView2 accepts an app-specific value name for this policy on the target runtimes; if it does not, keep `*` but make the exposure explicitly time-bounded and documented, and ensure the CI/qualification flow (which is where `*` is genuinely justified — ephemeral runners) is the only place it is used unattended.
- **Document the residual risk and the manual recovery command** so a developer who is interrupted knows exactly what to check and how to clean up.

## Capabilities

### New Capabilities
- `verification-lane-host-cleanup`: The contract that any verification lane which mutates machine-wide host state (here: an HKLM WebView2 remote-debugging policy) guarantees removal on every termination path — normal exit, exception, and signal — and verifies the removal rather than assuming it, so an interrupted run cannot silently leave the host in a debuggable state.

### Modified Capabilities
- `user-simulation-platform`: Extends the packaged-lane driver contract so its host-level side effects are bounded and self-cleaning, and so an interrupted packaged run cannot leave a machine-wide debugging policy behind.

## Impact

- **Files (test/harness code only, no product code)**: `sys-monitor-tauri/e2e/sim/drivers/RealAppDriver.ts`, its unit test `RealAppDriver.close.test.ts`, and the runners that host the driver (`e2e/sim/run.spec.ts`, `e2e/sim/qualify.spec.ts`) if handler registration is factored there.
- **CI**: `simulation.yml` (`simulation-real` job) and `release-qualification.yml` both run the packaged lane; a stricter post-condition may need an explicit cleanup/verification step in teardown.
- **Not affected**: the shipped application, `src/**`, `src-tauri/**`, the mock lane, the plain E2E lane.
- **Evidence (reproducible from the committed tree):**
  - `grep -rn "process.on(\|SIGINT\|SIGTERM\|uncaughtException\|beforeExit" sys-monitor-tauri/e2e sys-monitor-tauri/src` → no matches.
  - `RealAppDriver.ts`: `this.hklmOps.write(WV2_ARGS_POLICY_KEY, '*', args)` — value name `*` under `HKLM\SOFTWARE\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments`.
  - `RealAppDriver.ts::removeHklmArgsFallback`: sets `hklmArgsValueWritten = false` in a `finally` and does not re-read the value afterwards.
  - `AGENTS.md`: the real lane is a documented **opt-in local** command (`npm run sim:real`), so this is reachable from a developer's workstation, not only from an ephemeral CI runner.
