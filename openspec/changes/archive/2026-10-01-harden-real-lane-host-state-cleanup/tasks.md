## 1. Extend the registry seam so removal can be verified

- [x] 1.1 Add a `read(key, valueName)` operation to the `HklmPolicyOps` interface in `e2e/sim/drivers/RealAppDriver.ts` and implement it against `reg.exe` (`reg query`), returning a definite "present" / "absent" result rather than relying on absence of a thrown error.
- [x] 1.2 Confirm the `read` implementation treats a non-zero `reg query` exit for a missing value as "absent" rather than as an error, so the post-removal check cannot false-positive on a legitimately-removed value.
- [x] 1.3 Provide a test double for `read` in `RealAppDriver.close.test.ts` so every new path is exercised without a real HKLM hive.

## 2. Make removal verified and idempotent

- [x] 2.1 Change `removeHklmArgsFallback()` to read the value back after attempting removal; treat "still present" as a teardown failure that names the key and value name, rather than clearing the ownership flag and reporting success.
- [x] 2.2 Keep the "one removal attempt per written value, never re-enter" rule intact, and preserve the existing `close()` aggregation behaviour so a removal failure is reported alongside (not instead of) process-close and work-dir failures.
- [x] 2.3 Ensure a value that was never written (refused write / access denied) still results in no removal attempt and no spurious failure, as the existing test asserts.

## 3. Remove the value on every termination path

- [x] 3.1 Register per-instance process termination handlers (`SIGINT`, `SIGTERM`, `exit`, `uncaughtException`) at the point the policy value is first written, performing a synchronous removal in each.
- [x] 3.2 Make every handler body non-throwing so a handler can never turn a clean interrupt into an unhandled exception or prevent sibling handlers from running.
- [x] 3.3 Unregister the handlers once the value is confirmed removed, so a normal run has no live handler at exit and `run.spec.ts`'s per-selection driver instances do not accumulate handlers.
- [x] 3.4 Verify the handlers are per-driver-instance (not global) so repeated driver construction across selections behaves correctly.

## 4. Evaluate blast-radius narrowing (conditional)

- [x] 4.1 On a real Windows host with WebView2, test whether a per-application value name is honoured by `AdditionalBrowserArguments` instead of the wildcard `*`.
- [x] 4.2 If a narrower value name works, use it and update the blast-radius comment to state the reduced scope.
- [x] 4.3 If `*` is the only honoured form, keep `*` and record the test result (with the observed behaviour) in this change's `evidence.md` so the wider scope is a recorded decision rather than an unexamined default.

## 5. Extend the driver unit tests

- [x] 5.1 Add a case: removal is attempted, the value is still present afterwards, and the run is failed with the key/value name.
- [x] 5.2 Add a case: removal is attempted and the value is confirmed absent, and teardown reports success.
- [x] 5.3 Add a case: the termination-handler path removes the value (drive the registered handler directly through the test double, or expose a small seam for it).
- [x] 5.4 Add a case: handlers are unregistered after confirmed removal (no removal attempt occurs on a subsequent exit).
- [x] 5.5 Confirm all pre-existing `RealAppDriver.close.test.ts` cases still pass unchanged.

## 6. Document scope and recovery; wire the CI assertion

- [x] 6.1 Update the comment at `WV2_ARGS_POLICY_KEY` to state that the value name `*` affects all WebView2 hosts on the machine and that the value is intended to exist only for the run's duration.
- [x] 6.2 Add the exact verify/remove commands to the developer documentation where a developer looks after a packaged run (`AGENTS.md` and/or the app README's verification-gates section).
- [x] 6.3 Add a post-teardown "policy value absent" assertion to the CI jobs that run the packaged lane (`.github/workflows/simulation.yml` `simulation-real`, and the release-qualification jobs) so a leaked value fails the job.

## 7. Verify

- [x] 7.1 Run `npm test -- --run` and confirm the driver unit tests and the full frontend suite are green.
- [x] 7.2 Run `npm run sim:typecheck`.
- [x] 7.3 If a packaged app is available, run `npm run verify:packaged` once and confirm the teardown reports the policy value as removed.
- [x] 7.4 Run `openspec validate harden-real-lane-host-state-cleanup --strict`.
- [x] 7.5 Confirm `git status --porcelain` shows only harness/test/docs/workflow files and that no product source (`src/**`, `src-tauri/**`) changed.
