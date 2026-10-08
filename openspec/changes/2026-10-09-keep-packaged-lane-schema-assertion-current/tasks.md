## Tasks — Keep the packaged lane's schema assertion in lockstep

- [x] 1.1 Run `npm run verify:packaged` on the current build and record the failure (`Expected: 5, Received: 6`).
- [x] 1.2 Confirm the failure is a stale assertion rather than an application defect: the schema pair is 6 in `collector/snapshot.rs`, `useMetrics.ts` and the mock pin.
- [x] 1.3 Replace the literal with `EXPECTED_SCHEMA_VERSION` imported from `src/hooks/useMetrics` and confirm `npm run sim:typecheck` still passes (the sim project owns this file).
- [x] 1.4 Re-run `npm run verify:packaged` and record the pass.
- [x] 1.5 Re-run `npm run assert:webview2-policy-absent` after the real-lane run, per the repository's post-run procedure.
- [x] 1.6 Run `npx openspec validate --strict` for this change.
