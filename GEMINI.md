# GEMINI.md — Antigravity Project Configuration

> **Architecture & invariants**: See `AGENTS.md` (always-loaded alongside this file).
> Where they disagree, trust the source code.

## OpenSpec Workflow

This repo uses **OpenSpec** as its spec-driven change workflow. Non-trivial work goes
through `openspec/changes/`; specs live in `openspec/specs/`; archived changes in
`openspec/changes/archive/`.

The workflow is powered by the openspec CLI (`openspec` command) and a set of
**Antigravity skills** available in `.agents/skills/`:

| Skill                    | When to activate                                                      |
|--------------------------|-----------------------------------------------------------------------|
| `openspec-propose`       | User wants to start a new change / proposal                           |
| `openspec-apply-change`  | User wants to implement tasks from an existing change                 |
| `openspec-explore`       | User wants to think through an idea or problem (no implementation)    |
| `openspec-update-change` | User wants to revise planning artifacts of an existing change         |
| `openspec-sync-specs`    | User wants to sync delta specs from a change into main specs          |
| `openspec-archive-change`| User wants to finalize and archive a completed change                 |

### Triggering skills

Antigravity activates skills automatically based on context. You can also invoke them
explicitly by describing what you want:

- "propose a change for X" → `openspec-propose`
- "apply / implement the Y change" → `openspec-apply-change`
- "let's explore / think through Z" → `openspec-explore`
- "update the change plan" → `openspec-update-change`
- "sync the specs" → `openspec-sync-specs`
- "archive the change" → `openspec-archive-change`

### Slash-command equivalents (reference for migration from other tools)

If you are used to OpenCode (`/opsx-*`) or Claude (`/opsx:*`) slash commands,
the mapping to Antigravity skills is:

| Old command           | Antigravity equivalent                        |
|-----------------------|-----------------------------------------------|
| `/opsx-propose`       | Ask: "propose a change for …"                 |
| `/opsx-apply`         | Ask: "apply/implement the … change"           |
| `/opsx-explore`       | Ask: "let's explore …"                        |
| `/opsx-update`        | Ask: "update the … change plan"               |
| `/opsx-sync`          | Ask: "sync specs for the … change"            |
| `/opsx-archive`       | Ask: "archive the … change"                   |

## CI / Quality Gates

Always pass before committing (see `AGENTS.md` for commands):

- **Rust changed**: `cargo test`, `cargo fmt -- --check`, `cargo clippy -- -D warnings`
- **Frontend changed**: `npx tsc --noEmit`, `npm test -- --run`, `npm run build`
- **Sim code changed**: `npm run sim:typecheck`

Run commands from `sys-monitor-tauri/` (Rust commands from `sys-monitor-tauri/src-tauri/`).
