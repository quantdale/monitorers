## Tasks — Repository maintenance cleanup

> Executor rule: the gate fix comes first, because it is what makes the rest of
> the list verifiable. Never claim a symbol is unused while the checker that
> would say so is the thing being fixed.

## 1. Fix the dead-code scanner

- [x] 1.1 Extract the scanner into `sys-monitor-tauri/scripts/dead-code-scan.mjs`; `check-dead-code.mjs` keeps the CLI contract (allowlist reason floor, exit codes, message text) and imports `scan()`.
- [x] 1.2 Strip comments before counting references, walking characters rather than regexes so double-quoted strings, JS/TS template literals, Rust raw strings, Rust char literals, Rust lifetimes, and same-line-paired JS/TS single-quoted strings are all preserved verbatim.
- [x] 1.3 Keep reported line numbers exact by collapsing a block comment to the newlines it contained instead of to a space.
- [x] 1.4 Change chain attribution from "another unreferenced symbol's reference list mentions my file" to "every file I am referenced from declares only unreferenced symbols"; report `dead` members and label the root `referenced nowhere`.
- [x] 1.5 Delete the two allowlist entries that can never match a symbol (`lib.rs pub use (library facade)`, `disk_display_name`) so the allowlist holds only real exclusions.
- [x] 1.6 Add `scripts/dead-code-scan.test.mjs` covering: comment-only reference reported dead; comment stripping does not delete a real reference; URLs, templates, escaped strings, raw strings, char literals, lifetimes, and JSX apostrophes survive; a test-only reference is reported; a dead chain reports both members with the root labelled; allowlist matching by exact name and substring; and a URL literal not being stripped.
- [x] 1.7 Prove the gate is red-capable on the real tree: append a dead export and confirm a `[dead]` finding with the right line, then confirm a comment-only mention of it is still reported dead. Restore the tree after each probe.

## 2. Remove the symbols the corrected gate exposes

- [x] 2.1 Merge `sliceWindow` (test-only, byte-identical to a private twin) and `sliceWithRange` (the one production code calls) into one exported `sliceByRange(arr, timestampCount, range)`; update the `useMetrics` memo call site.
- [x] 2.2 Replace the four `sliceWindow` tests with direct coverage of `timestampWindowRange` (window selection, everything-when-shorter, empty ring, non-positive/non-finite window, forward-walk to the first real sample, cutoff between samples) and `sliceByRange` (pre-derived range, tail alignment, null range, empty channel, non-overlapping range).
- [x] 2.3 Delete `clearSimScenario` (no caller in `src/`, `e2e/`, or `scripts/`) and correct `readSimScenario`'s doc comment, which claimed journeys call it.
- [x] 2.4 Re-run `node scripts/check-dead-code.mjs` and require `0 unreferenced`.

## 3. Duplicated Rust mapping

- [x] 3.1 Add `hardware::disk_kind_of(&sysinfo::DiskKind) -> DiskKind` as the single mapping and route `disk_infos_from` through it.
- [x] 3.2 Route `main.rs`'s startup profile builder through `disk_kind_of` and import it instead of re-deriving the match.
- [x] 3.3 Add `test_disk_kind_of_is_the_single_sysinfo_mapping` pinning SSD, HDD, and both representative `Unknown` payloads; extend `test_disk_infos_from_projects_sysinfo_kinds` to assert the kind projection.

## 4. Documentation truth

- [x] 4.1 `.cursorrules` §3 module listing and `CLAUDE.md` backend listing: replace the non-existent `detect()` with `detect_with_cpu`, `disk_infos_from`, `disk_kind_of`.
- [x] 4.2 `.cursorrules` windowing bullets and `CLAUDE.md`'s `useMetrics` entry: name `timestampWindowRange` + `sliceByRange`; add the scanner module to the layout listing.
- [x] 4.3 `CONTEXT.md`: place `MAX_CHART_POINTS` in `MetricCard.tsx` and state that `computeChartPoints` takes it as a parameter.
- [x] 4.4 `e2e/exploratory-register.md`: remove the reference to a nonexistent 2026-08-26 update section and point at the journey file plus the archived qualification that evidences it.
- [x] 4.5 `opsx-remediation-evidence.md`: mark the 2026-08-03 report as historical and stop presenting that date's test counts as current.

## 5. Repository clutter

- [x] 5.1 Remove `deep review resolve.txt` (a repository-agnostic prompt, byte-identical to copies in two other repositories, zero inbound references).
- [x] 5.2 Remove the unreferenced `sys-monitor-tauri/src/assets/react.svg` and `sys-monitor-tauri/public/tauri.svg` (and the then-empty `src/assets/` directory).
- [x] 5.3 Root `package.json`: replace the unsatisfiable `"main": "index.js"` (scripts-only package, no such file) with `"private": true`; regenerate the lockfile metadata.
- [x] 5.4 `src/sim/mockBackend.test.ts`: replace the two hard-coded schema literals with `EXPECTED_SCHEMA_VERSION`, matching the sibling parity test.

## 6. Validation

- [x] 6.1 `node scripts/check-dead-code.mjs` → 0 unreferenced, and `npx vitest run scripts/dead-code-scan.test.mjs` → all pass.
- [x] 6.2 Frontend gate: `node scripts/verify.mjs frontend` → exit 0 (version + documentation fidelity, dead-code, both audit scopes, `tsc --noEmit`, `typecheck:test`, oxlint, unit tests, production build).
- [x] 6.3 Rust gate: `node scripts/verify.mjs rust` → exit 0 (fmt, five feature-matrix test runs, clippy `-D warnings`, `cargo audit` with only the three dispositioned informational warnings).
- [x] 6.4 `node scripts/verify.mjs e2e` → exit 0.
- [x] 6.5 `npm run sim:typecheck` and `npm run sim` (mock matrix) → green.
- [x] 6.6 `npx openspec validate --all --strict` → 25/25 before archive; `repo-wide` grep confirms no stale `sliceWindow`/`clearSimScenario`/`detect()` references remain outside `openspec/changes/archive/` and `AUDIT_REPORT.md`.
- [x] 6.7 Record the results (including any pre-existing failure distinguished from this change's own) in `evidence.md`.
