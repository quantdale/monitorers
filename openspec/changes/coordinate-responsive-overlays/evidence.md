# Responsive overlay coordination evidence

Start branch `agent/frontend-successor-2026-11-13`, base HEAD `3cee0e9`; predecessor connection recovery is being qualified in the same branch.

Reproduced through agent-browser: at 900x1100 open Hardware (push rail), open Metrics, resize to 400x700. Both `Hardware info` and `Metric card visibility` remain non-inert dialogs. Focus stays on the Metrics checkbox after Tab; screenshot `overlays-resize-before.png` shows the popup over the modal drawer and its scrim. Escape dismisses Metrics first while Hardware remains open. This is a product interaction defect, independent of the predecessor's connection changes.

Design research: existing product/tokens remain the primary lock. The predecessor's full Linear/ClickHouse style research continues to govern restrained surfaces and existing token roles. Refero Workflow settings screen `f86f669a-7911-4208-acc0-a8f4a49492c2` shows a single modal task over a blurred workspace with one dismissal control. It informs visual focus hierarchy only; it does not prove responsive or keyboard behavior. The repo's modal accessibility contract supplies the interaction requirement.

Session artifacts: `D:\Documents\tryPython\_AgentArtifacts\monitorers\sessions\20261113-codex-frontend-audit\`.

## Implementation and verification

`overlay-red.log` first fails because the Metrics dialog remains present after resize. The selector now derives `panelOpen` synchronously from its owned open state and App's modal-disabled condition; portal, positioning and focus listeners suspend immediately. Latent open state clears during suspension and no focus is restored to the inert dashboard trigger. Existing GlassPanel exit inertness is retained. Visibility settings and desktop coexistence are unchanged.

`overlay-green.log`: focused geometry/sidebar suite 9/9. Regression covers hidden CPU retained across reopen, modal Tab/Shift+Tab, Escape and trigger focus, repeated 400/639/900px breakpoint roundtrips, and no stale popup reopening. `exclusive-hardware-modal.png` visually inspected: only the drawer and its focused Close action remain over the dimmed dashboard.

Combined final candidate: `combined-fast.log` exit 0 (370 unit tests, frontend gates/build, five Rust feature matrices/fmt/Clippy/audits); `combined-e2e.log` 61/61; `combined-mock.log` 16/16 journey/persona runs, 4 runner tests at seed 42; `combined-tauri.log` fresh release executable built. Native qualification with the new responsive conflict check is running.

Native combined qualification completed: `combined-packaged.log` 1/1, including the actual hardware-profile modal resize and keyboard cycle, plus real history/listener retry and settings retention. Three real journeys also pass in `combined-real.log`; teardown/store/orphan/policy guards pass. Actual native exclusive-modal screenshot inspected. Source/diff review is clean for this change. A separate GPU caption/identity defect discovered in native screenshot review is becoming a successor campaign; the two completed UI campaigns do not establish overall product completion.

Settled browser axe checks: connection error 0 violations (1 contrast-incomplete rule), Metrics popup 0 violations (2 incomplete rules), hardware modal 0 violations/0 incomplete. Earlier immediate captures reported transitional contrast during entrance opacity; settled reruns and token contrast tests are the scoped evidence. No blanket screen-reader or contrast certification is claimed.
