# Evidence — Keep the packaged lane's schema assertion in lockstep

## Failure before the change

```
> npm run verify:packaged
[qualify] launching built app: src-tauri/target/release/sys-monitor-tauri.exe
  x  1 e2e\sim\qualify.spec.ts:40:1 › packaged app qualifies end-to-end over real IPC (1.9s)

  Error: real IPC history schema version
  expect(received).toBe(expected) // Object.is equality
  Expected: 5
  Received: 6
    > 130 |     expect(history.schema_version, 'real IPC history schema version').toBe(5);
      1 failed (exit code 1)
```

Triage: the application was correct. The schema pair is **6** on both sides of
the contract (`SCHEMA_VERSION` in `src-tauri/src/collector/snapshot.rs` and
`EXPECTED_SCHEMA_VERSION = 6` in `src/hooks/useMetrics.ts`), and the mock pins
the same value. The lane held a third, stale copy of it — a copy that no gate
keeps in step, because this lane is dispatch/tag only and never runs on a PR.

## Fix

`e2e/sim/qualify.spec.ts` now imports the shared expectation:

```ts
// The packaged lane must follow the schema pair, not a copy of it: this assertion
// was hardcoded at 5 and silently went stale when the metrics schema moved to 6
// (`MetricsSnapshot` gained `timestamp_ms`), failing the lane against a correct
// app. Importing the frontend's expectation keeps the two halves in lockstep.
import { EXPECTED_SCHEMA_VERSION } from '../../src/hooks/useMetrics';
...
expect(history.schema_version, 'real IPC history schema version').toBe(EXPECTED_SCHEMA_VERSION);
```

`npm run sim:typecheck` still exits 0 (the sim project owns `e2e/**` and resolves
the import; `mockBackend.ts`'s reason for not importing `useMetrics` — a
bundle-time cycle — does not apply to a Playwright spec, which is never bundled).

## Verification after the change

| Command | Result |
|---|---|
| `npm run sim:typecheck` | exit 0 |
| `npm run verify:packaged` | **1 passed (7.2s)** — `[qualify] PASS: real IPC, live data, isolated settings, clean exit` |
| `npm run assert:webview2-policy-absent` | exit 0 — `HKLM\SOFTWARE\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments\* is absent` |

The run log also records the expected non-elevated-host behaviour: the driver
could not write the HKLM policy (`Access is denied`) and fell back to
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`, which is documented as expected on a
non-elevated host rather than a leak.

## Notes

- The packaged run was executed against the executable built for the
  dependency-queue stage on this branch, so it also evidences that the updated
  stack (React 19.3.0, Vite 8.3.1, Tauri 2.12.0 across both halves) runs in the
  real packaged application over real IPC.
- The lifecycle schema assertion in this lane is separate and was left as-is; the
  lifecycle contract did not change.
