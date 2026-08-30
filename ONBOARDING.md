# Fresh-machine onboarding

This is the canonical bootstrap entry point for a new workstation or a fresh coding-agent environment. Complete this document before implementation work. The objective is a reproducible machine that can build, test, inspect, and operate this repository without rediscovering tooling mid-campaign.

## 1. Preflight rule

1. Clone the repository and enter its root.
2. Confirm the intended repository/branch and fetch current `origin/main`.
3. Read the repository control-plane documents before changing code: `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`, `progress.md`, `.agent/`, active OpenSpec state.
4. Install/verify the machine prerequisites below.
5. Enable the committed agent integrations and repository-local skills.
6. Restore dependencies from lockfiles/pins; do not casually upgrade them during bootstrap.
7. Run the baseline validation commands.
8. Only then begin a development campaign. If a prerequisite cannot be satisfied, record it as an environment blocker rather than weakening a gate.

Credentials, API keys, signing material, account logins, licensed assets, and other secrets are machine/user responsibilities. Never commit them.

## 2. Supported host and prerequisites

**Primary host:** Windows is the primary real-hardware target because the Tauri backend uses WMI, Windows performance APIs, NVAPI/NVML; frontend-only checks can run elsewhere.

**Required machine tools**
- Git
- Node.js/npm
- Rust/Cargo toolchain
- Tauri 2 native build prerequisites
- Windows SDK / MSVC build tools on Windows
- Playwright browser dependencies

**Task-dependent / optional tools**
- NVIDIA drivers/runtime for real NVAPI/NVML GPU telemetry
- platform packaging prerequisites when producing installers


## 3. Agent setup

- Load repository instructions before acting. Prefer committed repository state over chat history.
- Repository-local skills: `goal` plus the committed OpenSpec skills: `openspec-propose`, `openspec-apply-change`, `openspec-update-change`, `openspec-sync-specs`, `openspec-archive-change`, `openspec-explore`.
- Discover and use committed agent adapter/config directories in-place; do not duplicate them globally unless the harness cannot load repository-local configuration.
- Relevant committed agent surfaces: `.agent/`, `.agents/`, `.claude/`, `.cline/`, `.codex/`, `.kilocode/`, `.kimi*/`, `.opencode/`.
- MCP policy: No root `.mcp.json` is committed. Do not add a telemetry/system-access MCP as a shortcut around the real Tauri/Rust backend.
- Keep diagnostic/documentation MCPs narrow. An MCP does not grant architecture, publishing, production, or gate-bypass authority.
- Authenticate GitHub and coding-agent CLIs separately on the machine. Never store tokens in tracked files.

## 4. Bootstrap

```powershell
npm ci
npm --prefix sys-monitor-tauri ci
rustup show
cargo fetch --manifest-path sys-monitor-tauri/src-tauri/Cargo.toml
```

The real application lives under `sys-monitor-tauri/`; root npm scripts intentionally forward into that package.


## 5. Editor/LSP baseline

Use the local TypeScript service for the React/Vite side and rust-analyzer for `src-tauri`. Windows API/Rust diagnostics should resolve against the actual Windows target.

The editor is optional; reliable language diagnostics are not.

## 6. Baseline verification

```powershell
npm run typecheck
npm test
npm run verify:frontend
npm run verify:rust
npm run verify:fast
# Use npm run verify:full when the machine satisfies all real Tauri/E2E prerequisites.
```

A fresh machine is **development-ready** when all applicable non-external gates pass. Hardware/device/signing/account gates may remain explicitly blocked when repository state already classifies them that way.

## 7. Fresh-agent instruction

> Read `ONBOARDING.md` first. Set up every applicable prerequisite, repository-local skill, MCP/plugin, dependency, browser/device/runtime tool, and validation gate described there. Then read the repository's durable agent state and only start implementation after preflight is green or a genuine environment blocker is recorded. Do not replace pinned tooling, skip gates, or invent work to compensate for a missing machine capability.
