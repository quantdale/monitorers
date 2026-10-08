# Design — Disposition the open dependency queue

## D1. Stage by compatibility domain, never as one lockfile sweep

Each stage is independently revertible and independently qualified, because a
failure must be attributable to one domain rather than to "the dependency
update". The domains follow `dependabot.yml`'s grouping:

1. **Frontend framework / toolchain / test DOM / UI** — `#40`, `#41`, `#38`, `#35`.
   These are all in-range or minor updates of the stack the 2026-08 campaign
   already qualified; the risk is the TypeScript-7 / Vite-8 / jsdom-30 edges,
   which the frontend lane exercises directly.
2. **Tauri cross-language boundary** — `#42` (Rust `tauri`, `tauri-plugin-store`,
   `tauri-build`) **and** `#43` (JS `@tauri-apps/api`, `plugin-store`, CLI) in one
   stage. Evidence for treating them as one boundary: PR #43 alone fails
   `Windows — production executable` (`tauri build` compiles the frontend bundle
   and the Rust crates together), while #42 alone leaves the JS side behind. The
   qualifying command is `npm run verify:tauri` (a real production-executable
   build), not just typecheck/tests.
3. **Supply chain (Actions)** — `#37`. `actions/download-artifact` 4.1.8 → 8.0.1
   changes a security-relevant default (digest mismatch now errors instead of
   warning), so adopting it is a hardening, not churn. Pins must be full commit
   SHAs per the repository policy; the SHAs come from the PR diff, never typed
   by hand.
4. **Collector platform** — `#39` (`nvml-wrapper` 0.13.0). Minor, but it is the
   Nvidia telemetry path, so it is qualified by the full feature matrix
   (`default`, `--no-default-features`, `nvapi` only, `nvml` only, `--all-features`)
   plus clippy and `cargo audit`, exactly as the August campaign's stage G did.
5. **Deferred** — `#44` `@types/node` 26.6.3. See D3.

## D2. Documentation fidelity is part of the adoption

`scripts/check-version.mjs` fails the frontend lane when `.cursorrules` §1's
documented ranges disagree with `package.json` / `Cargo.toml` — and it compares
`major.minor`, so `vite ^8.2.2 → ^8.3.1`, `react ^19.2.8 → ^19.3.0`,
`lucide-react ^1.34.0 → ^1.48.0` and `nvml-wrapper 0.12 → 0.13` all require a
table edit. PR #35 is currently red for exactly this reason. Therefore every
adoption stage updates `.cursorrules` §1 in the **same commit**; the lane is the
proof.

## D3. Why @types/node 26 is deferred, not adopted

- The runtime is Node 24.3.0 locally and `node-version: '24'` in every workflow;
  the previous campaign recorded "adopt 26 only when the Node runtime moves to
  26".
- `dependabot.yml` deliberately leaves `@types/node` **ungrouped** so this major
  stays independently attributable.
- Adopting type definitions for a runtime the project does not run would let
  code compile against APIs that do not exist at runtime — the opposite of the
  gate's purpose.

Deferral is recorded with the PR number and a comment pointing at this design
section, so the next reader sees the decision rather than an unexplained close.

## D4. Verification surface per stage

| Stage | Commands |
|---|---|
| Frontend | `npm run verify:frontend` (version + doc fidelity, dead-code, both audits, two typechecks, `npm test -- --run`, `npm run build`) |
| Frontend behaviour | `npm run e2e`, `npm run sim:typecheck`, `npm run sim` |
| Tauri boundary | `npm run verify:rust` (fmt, 5-matrix `cargo test`, clippy `-D warnings`, `cargo audit`) **and** `npm run verify:tauri` (production executable) |
| Actions | workflow YAML parse + a `workflow_dispatch`-able lane that actually uses the updated action; visual diff of the pin comments |
| nvml | the Rust gate above with `--all-features`, plus the targeted identity/NVML tests |
| Whole change | `npm run verify:fast`, `npx openspec validate --all --strict`, `git diff --check` |
