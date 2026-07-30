## 1. Shared cache-key fallback (DOC-006)

- [ ] 1.1 Read `rust-test`'s cache step (`rust.yml:41,43`, key prefix `cargo-test-`) and `rust-lint`'s cache step (`rust.yml:70,72`, key prefix `cargo-lint-`) in full, confirming both cache the same paths (`~/.cargo/registry`, `~/.cargo/git`, `target`).
- [ ] 1.2 Add a shared base `restore-keys` entry (e.g. `cargo-${{ runner.os }}-`) to both jobs' cache steps, keeping each job's existing exact key (`cargo-test-...`/`cargo-lint-...`) as the primary key so exact-match hits are unaffected.
- [ ] 1.3 Confirm both jobs' primary cache keys remain distinct (so cache writes from each job don't clobber each other) while the new restore-keys entry is genuinely shared between them.

## 2. Add production build verification (DOC-007)

- [ ] 2.1 Add an `npm run build` step to the existing `frontend` CI job, after the existing `tsc --noEmit`/vitest steps.
- [ ] 2.2 Confirm the step fails the job (and therefore the PR check) if the build itself fails, consistent with how the other frontend checks already gate the job.

## 3. Verify

- [ ] 3.1 Review the full updated `rust.yml` for correct YAML syntax and confirm no unrelated job configuration was disturbed.
- [ ] 3.2 If feasible, trigger the workflow (e.g. via a draft PR or workflow_dispatch) to confirm: (a) the new production-build step actually runs and passes against current `main`, (b) the cache steps don't error out with the added `restore-keys` entry.
- [ ] 3.3 No `cargo test`/`npm test` count change expected from this batch — this only touches CI workflow configuration, not source under test.
