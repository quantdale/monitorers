## Context

See proposal.md. The driver and standalone guard duplicate `reg query` exception handling: any numeric exit status is classified as absence, including access denial. Driver writes use `/f`, and a failed subsequent write clears the ownership bit even though the old value may remain. Tokio 1.53.1 is pinned; RustSec identifies 1.53.3 as patched for RUSTSEC-2026-0386.

## Goals / Non-Goals

**Goals:** truthful policy inspection and ownership, precise dependency remediation.

**Non-Goals:** changing the machine-wide fallback mechanism, silently removing someone else's policy, or migrating Tauri's Linux GTK stack in this Windows-only app.

## Decisions

- Add a shared JavaScript registry-read helper used by the TypeScript driver and Node assertion, with a small declaration file. Invoke PowerShell/.NET's registry API, which returns null for a missing key and throws on access denial. Return only strict boolean output and propagate failed execution. Pass key/value via environment fields, without shell interpolation.
- Before the first driver write, require a confirmed missing value. Existing values and inspection errors are fatal before mutation. Best-effort access-denied write fallback remains valid only when no value was previously owned.
- Preserve ownership after a failed rewrite; throw so the caller's teardown removes the original value. Keep termination cleanup registrations intact.
- Cancel the CDP probe when the launched process exits or fails to spawn, and bound each fetch by the remaining observation deadline. Otherwise a losing `Promise.race` branch keeps polling for up to a minute and a hung HTTP response can outlive the promised timeout.
- Update only Tokio to 1.53.3 through Cargo's in-range resolver. The advisory affects Unix `AsyncFd`, so Windows exploitability is not claimed. The patch still satisfies the existing lockfile advisory contract.

## Risks / Trade-offs

- PowerShell is an additional registry-read process → only runs at verification setup/teardown and has an execution timeout; no application runtime cost.
- Concurrent writers outside this process can race the presence check → verification documents that the fallback requires exclusive host use; this change prevents sequential overwrites and duplicate local driver ownership, without claiming a cross-process registry transaction.
- Remaining GTK/proc-macro warnings lack a compatible patch under Tauri's current GTK dependencies → record Windows-target exclusion and upstream migration dependency.
