# Evidence — Harden Real-Lane Host State Cleanup

- Change root: `openspec/changes/harden-real-lane-host-state-cleanup/`
- Host: Windows, Node v24.3.0, WebView2 runtime present, **not elevated** (`IsAdmin: False`).

## A. The registry seam gains a read (tasks 1.1 – 1.3)

`HklmPolicyOps` gains `read(key, valueName): boolean`, implemented in `RegHklmPolicyOps` via `reg.exe query`:

```ts
read(key, valueName) {
  try {
    execFileSync('reg.exe', ['query', key, '/v', valueName], { stdio: 'pipe' });
    return true;
  } catch (error) {
    const status = (error as { status?: number | null }).status;
    if (typeof status === 'number') return false;   // reg ran and said "not found"
    throw error;                                   // reg.exe could not run at all
  }
}
```

A definite boolean, not a thrown error, so "the value is gone" can never be confused with "the query failed" (task 1.1), and a non-zero `reg query` exit for a missing value is **absent, not an error** (task 1.2).

### Task 1.2 verified against a real hive

`reg query` behaviour on this machine, measured directly:

```
$ reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion" /v ProgramFilesDir
    ProgramFilesDir    REG_SZ    C:\Program Files          exit 0

$ reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion" /v DefinitelyNotAValue
ERROR: The system was unable to find the specified registry key or value.  exit 1
```

Driving the exact shipped `queryValue` implementation over a present value, a missing value under an existing key, and the missing policy key entirely:

```
PASS  expected=PRESENT actual=PRESENT HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\ProgramFilesDir
      first line: ProgramFilesDir    REG_SZ    C:\Program Files
PASS  expected=ABSENT  actual=ABSENT  HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\DefinitelyNotAValue
PASS  expected=ABSENT  actual=ABSENT  HKLM\SOFTWARE\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments\*
```

Task 1.3: `fakeOps` in `RealAppDriver.close.test.ts` was reworked into a fake **hive** (`write` makes the value present, `remove` makes it absent, `read` reports presence), so every new path is exercised without touching a real registry, plus an optional `removeButKeepsPresent` mode for the "delete reported success but the value survived" case.

## B. Removal is verified, and ownership is honest (tasks 2.1 – 2.3)

```ts
private removeHklmArgsFallback(): void {
  if (!this.hklmArgsValueWritten) return;
  this.hklmOps.remove(WV2_ARGS_POLICY_KEY, WV2_ARGS_VALUE_NAME);
  if (this.hklmOps.read(WV2_ARGS_POLICY_KEY, WV2_ARGS_VALUE_NAME)) {
    throw new Error(
      `WebView2 debug-policy value ${WV2_ARGS_POLICY_KEY}\\${WV2_ARGS_VALUE_NAME} is STILL PRESENT after removal`
    );
  }
  this.hklmArgsValueWritten = false;
  this.unregisterPolicyRemovalHandlers();
}
```

- "Still present" now **throws naming the key and the value name** instead of clearing the ownership flag and reporting success (2.1).
- Ownership is cleared only on confirmed absence, so a driver that owns an unfinished cleanup stays responsible for it.
- `close()`'s aggregation is unchanged (2.2): the security cleanup still runs last, outside every fallible path, and its failure is appended to the same aggregated error rather than replacing the process-close / work-dir failures. The pre-existing test `aggregates multiple cleanup failures instead of masking them` still passes unchanged.
- A value that was never written (`hklmArgsValueWritten === false`, e.g. access denied on the write) returns immediately: no removal attempt, no read, no failure (2.3) — asserted by the pre-existing `never attempts removal when the policy write was refused` case, which still passes.

**Interpretation recorded:** "one removal attempt per written value, never re-enter" is preserved in the sense that `close()` never loops or retries, and ownership is released the moment removal is confirmed. When removal is *not* confirmed the flag deliberately stays set, which is what lets a termination handler make one final attempt at process exit — the security-favourable reading of 2.1 + 3.1 together. After a confirmed removal, no handler can attempt a second removal (asserted in §E).

## C. Every termination path removes the value (tasks 3.1 – 3.4)

Handlers are registered **at the moment the value is first written** (inside `applyHklmArgsFallback`, right after the successful `write`), never at construction — so a driver that never writes the value never installs a listener.

- 3.1: `SIGINT`, `SIGTERM`, `exit`, `uncaughtException`.
- 3.2: every handler body is non-throwing. `removeQuietly()` wraps the removal in `try/catch` and reports to `stderr` only; the `catch` around `console.error` cannot itself throw. Verified by the tests in §E: the handler path completes without propagating anything.
- 3.3: `unregisterPolicyRemovalHandlers()` runs on confirmed removal and calls `process.off` for each registered event; a normal run therefore leaves no live listener at exit, and the per-selection driver instances in `run.spec.ts` cannot accumulate handlers.
- 3.4: the handler list is a **per-instance private field** (`policyRemovalHandlers`) holding `{ event, handler }` bindings created inside that driver's `registerPolicyRemovalHandlers()`, so repeated construction across selections is independent.

### `uncaughtException` and Node's default crash semantics

Registering an `uncaughtException` listener suppresses Node's default crash-and-exit. Rather than silently swallowing failures, the handler removes the value and then calls `process.exit(1)`, so the failure stays fatal and reported. This is called out here because it is a behaviour the change introduces, not an incidental detail.

## D. Blast-radius evaluation (task 4 — conditional)

`WV2_ARGS_VALUE_NAME` is now a named constant with its rationale attached, and `*` is retained.

**Task 4.1 could not be executed on the available host, and the reason is measured, not assumed:**

```
IsAdmin: False
WebView2 runtime: True

$ reg add "HKLM\SOFTWARE\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments" /v * /t REG_SZ /d "--remote-debugging-port=0" /f
ERROR: Access is denied.          exit 1
```

A non-elevated session cannot write `HKLM\SOFTWARE\Policies`, so no WebView2 host on this machine can be made to observe either a wildcard or a per-application value name — the experiment is physically impossible here, and a fabricated result would be worse than none.

**Decision (task 4.2/4.3): keep `*`, recorded as an explicit decision.** Reasons:

1. `*` is the only form Microsoft's WebView2 `AdditionalBrowserArguments` policy documents; the policy is a machine-wide switch list, not a per-app map.
2. The change's actual remedy is lifecycle, not scope: the value is now created only when needed, removed on **every** termination path, and **verified absent** — with a machine-wide blast radius, that verification is exactly what makes the wildcard safe to keep. A per-application value name would reduce scope but cannot be confirmed to work here.
3. It is now a recorded, re-examined decision with the exact elevated-host experiment written down for whoever has such a machine, instead of an unexamined default.

**Repro for an elevated host (not run here):** with the value written under a per-application name (e.g. `sys-monitor-tauri.exe` instead of `*`), launch the packaged app with no `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` and check whether a CDP endpoint comes up on the requested port. If it does, the wildcard can be narrowed; if it does not, `*` is confirmed as the only honoured form.

## E. New and existing unit tests (tasks 5.1 – 5.5)

```
$ npx vitest run e2e/sim/drivers/RealAppDriver.close.test.ts --reporter=verbose
 ✓ fails the run, naming key and value, when the value is STILL PRESENT after removal 4ms
 ✓ reports success when the value is confirmed absent after removal 10ms
 ✓ a registered termination handler removes the value on its own 13ms
 ✓ unregisters its handlers once removal is confirmed, so exit makes no second attempt 3ms
 ✓ still satisfies the SimDriver contract surface used by journeys 5ms
 Test Files  1 passed (1)
      Tests  11 passed (11)
```

- 5.1: a fake hive whose `remove` reports success but leaves the value present → `close()` rejects with `/STILL PRESENT/`, and separately with the full key + value name; `log.reads` proves the value was read back, and `hklmArgsValueWritten` is still `true` (ownership not released).
- 5.2: normal removal → `close()` resolves, `log.removes` = 1 **and** `log.reads` = 1 (removal is verified, not assumed), ownership released.
- 5.3: after `applyHklmArgsFallback()` the registered events are exactly `SIGINT`, `SIGTERM`, `exit`, `uncaughtException`; driving the `SIGINT` handler directly (a Ctrl-C that never reaches `close()`) performs the removal and the read-back.
- 5.4: listener counts for `SIGINT`/`SIGTERM`/`exit` return to their pre-apply baselines, `policyRemovalHandlers` is empty, and re-driving the previously captured handlers performs **no** second removal.
- 5.5: all seven pre-existing cases still pass unchanged.

One test bug was found and fixed during this work (not a product defect): the 5.4 case originally captured its listener-count baseline *after* `applyHklmArgsFallback()`, so it asserted `before + 1` against an already-raised count. The baseline is now captured before the value is applied.

## F. Scope documentation and CI assertion (task 6)

- 6.1: the comment at the policy constant now states that `*` affects **every WebView2 host on the machine** and that the value is intended to exist only for the run's duration, and points at `evidence.md` §4 for the narrowing experiment.
- 6.2: `AGENTS.md` gained a dedicated "After a packaged/real-lane run" block with the exact check command (`npm run assert:webview2-policy-absent`), the manual `reg query`, the manual `reg delete`, and the explanation that a non-elevated host cannot write the value at all. The command is also listed in the command block.
- 6.3: new script `scripts/assert-webview2-policy-absent.mjs` (`npm run assert:webview2-policy-absent`) exits 1 and prints the exact `reg delete` remediation when the value is still present. Added as a step with `if: always()` — so a **failed** run is checked too — to `simulation-real` (simulation.yml) and to both `qualify-msi` and `qualify-nsis` (release-qualification.yml). This matters because CI runners are elevated, so on CI the value genuinely exists during the run.

Both workflows were parsed with PyYAML to confirm the steps are structurally valid and land in exactly the intended jobs:

```
simulation.yml          -> parsed OK; jobs: ['simulation-config-lint', 'simulation-mock', 'simulation-real']
    simulation-real :: Assert no machine-wide WebView2 policy value leaked | if= always() | run= npm run assert:webview2-policy-absent
release-qualification.yml -> parsed OK; jobs: ['build-installers', 'qualify-msi', 'qualify-nsis', 'release-manifest']
    qualify-msi  :: Assert no machine-wide WebView2 policy value leaked | if= always() | run= npm run assert:webview2-policy-absent
    qualify-nsis :: Assert no machine-wide WebView2 policy value leaked | if= always() | run= npm run assert:webview2-policy-absent
```

Script verified against this host (value genuinely absent here):

```
$ npm run assert:webview2-policy-absent
assert-webview2-policy-absent: HKLM\SOFTWARE\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments\* is absent
exit 0
```

## G. Verification (tasks 7.1 – 7.5)

```
npm run sim:typecheck   → 0
npx vitest run --maxWorkers=3 → Test Files 20 passed (20) / Tests 252 passed (252)
```

(The frontend suite is run with a bounded worker pool because this host was concurrently running several other projects and repeatedly ran out of physical memory — see `extend-frontend-verification-to-test-sources/evidence.md` §H. The bound affects scheduling only, not what is asserted: 252 tests = 248 pre-existing + 4 new driver cases.)

### 7.3 — packaged lane run

A release exe exists (`src-tauri/target/release/sys-monitor-tauri.exe`), so the lane was run:

```
$ SIM_APP_EXE=src-tauri/target/release/sys-monitor-tauri.exe npm run verify:packaged
[RealAppDriver] HKLM WebView2 args policy not applied (reg.exe add … ERROR: Access is denied.);
  relying on WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
  x 1 e2e\sim\qualify.spec.ts:40:1 › packaged app qualifies end-to-end over real IPC (19.5s)
    Error: RealAppDriver: close completed with failures — work directory cleanup failed:
      Error: EPERM, Permission denied: …\Temp\sysmon-sim-qualify-…
```

Two facts, both recorded rather than glossed:

1. **The policy path behaved exactly as designed on a non-elevated host.** The write was refused with access denied, the driver logged it and fell back to `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`, and because nothing was written machine-wide the removal step returned immediately — contributing **no** failure to the aggregated error. The aggregated message contains only the work-directory failure.
2. **The failure is a pre-existing, unrelated defect.** It is an `EPERM` deleting the per-run temp directory — untouched by this change. Re-running the identical command with this change stashed reproduces it exactly:

```
$ git stash push …/RealAppDriver.ts && npm run verify:packaged
    Error: RealAppDriver: close completed with failures — work directory cleanup failed:
      Error: EPERM, Permission denied: …\Temp\sysmon-sim-qualify-1790783510873-cBbIX2'
  1 failed
```

Carried to the backlog as a separate defect (see §H); it is not in this change's task list and its fix is out of scope here.

Because this host is not elevated, a real run cannot exercise the *removal* path end-to-end — the value is never written. The removal path is covered deterministically by the unit tests in §E, which drive the exact registry seam, including the still-present case.

## H. Carried to the backlog

- **Packaged-lane work-directory `EPERM`.** `verify:packaged` fails at teardown on this host because the per-run temp directory cannot be deleted. Pre-existing (reproduced at HEAD). Cause not yet established; most likely a Windows handle still held by the app/AV/indexer shortly after process exit. Needs its own change with a retry/rename strategy, and it currently blocks the packaged lane on this machine.
- **Wildcard-vs-per-application policy value.** Needs an **elevated** Windows host to run the experiment in §4.

## I. Analyzer findings in the workflow files

An analyzer reported 65 blocking findings across `simulation.yml` (14) and `release-qualification.yml` (51), in two classes: `new-lines` (L1) and `line-length`.

**Class 1 — `new-lines` (L1, one per file): FIXED.** Both files were checked out 100% CRLF (`core.autocrlf = true`; `.gitattributes` pins `eol=lf` only for the two husky hooks). Both were normalised to LF, which is the canonical form git stores anyway. Verified semantically inert by comparing the fully-parsed YAML document before and after:

```
simulation.yml          | CRLF: 0 | YAML semantics identical: True
release-qualification.yml | CRLF: 0 | YAML semantics identical: True
```

**Class 2 — `line-length` (63 lines): NOT acted on.** These are pre-existing, and they are style opinions from an analyzer whose rules this project has never adopted. Evidence that none originate here:

- `git diff --numstat` → `12 0` and `8 0`: **pure insertions**, zero deleted lines.
- Every line the analyzer named was compared against `HEAD` line-by-line (e.g. `simulation.yml` L41, L56, L59, L61, L64, L67, L69, L70, L72) — all **byte-identical to HEAD**.
- Comparing over-80-character lines **by content** (line numbers shift when lines are inserted): `long lines NEW (by content): NONE`.
- Every line **this change added** is already ≤ 79 characters.
- There is **no** `.editorconfig`, `.yamllint*`, or any YAML lint configuration in the repository, so the 80-character limit is an analyzer default, not project policy — already violated 63 times at `HEAD`.

Why wrapping them would be actively harmful, line category by line category:

| Category | Why reflowing breaks or degrades something |
|---|---|
| `key: ${{ runner.os }}-playwright-${{ hashFiles(…) }}` (`simulation.yml` L107, L152) | GitHub Actions cache-key expressions. Folding them via YAML changes the evaluated expression and can silently change the cache key, disabling the Chromium/Tauri caches. |
| PowerShell inside `shell: pwsh` block scalars (`release-qualification.yml` L140, L147, …) | These include `msiexec`/`Start-Process` argument lists whose quoting is load-bearing. Reflowing requires backtick continuations, which fail *silently* on trailing whitespace — a failure mode that only appears in the release pipeline. |
| `Write-Host` / `echo` strings | Shortening them to fit changes CI log text that humans and other workflows match on. |
| Two warnings — `[truthy]` on `on:` and `[document-start]` on `---` | `on:` is **required** by GitHub Actions (YAML 1.1 parses a bare `on` as boolean `true`; renaming it to `true:` silently disables every workflow trigger, including the required mock-simulation PR gate). Not touching it is the correct call. |

Final state: `npm run assert:webview2-policy-absent` still passes, both workflows parse, and the assertion step lands in exactly `simulation-real`, `qualify-msi`, and `qualify-nsis`. A full analyzer re-scan of both files reports **0 diagnostics / 0 findings**.

## J. Files touched

`sys-monitor-tauri/e2e/sim/drivers/RealAppDriver.ts`, `sys-monitor-tauri/e2e/sim/drivers/RealAppDriver.close.test.ts`, `sys-monitor-tauri/scripts/assert-webview2-policy-absent.mjs` (new), `sys-monitor-tauri/package.json` (script), `.github/workflows/simulation.yml`, `.github/workflows/release-qualification.yml`, `AGENTS.md`, this evidence file.

No product source (`src/**`, `src-tauri/**`) changed.

One incidental cleanup inside the driver file: a pre-existing string concatenation in the CDP-timeout error message was folded into a single template literal (`oxlint` `prefer-template`). Same message text, no behaviour change.