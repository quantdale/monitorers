## Context

See proposal.md. Starting session commit: main@17433c8; original baseline 733e955. Fetch found origin/main@b5ab823 (six additive instruction lines); merged without rewriting either session commit on agent/session-finalization. Current repository instructions require concise UX without redundant helper copy.

Baseline `verify:frontend` fails at the dead-code gate (`sidebarPresentsAsOverlay` is test-only). Browser probes at 400x300 confirmed Shift+Tab from the initial metrics-panel focus lands on the trigger outside the panel, and Tab from the drawer Close button lands on the external scrim. These are reproducible regressions, not aesthetic preferences.

## Goals / Non-Goals

Goals: repair and certify this session's additions, including keyboard lifecycle and realistic content. Non-goals: unrelated collector changes, speculative redesign, dependency upgrades, fabricated hardware or design-reference evidence.

## Decisions

- Keep the media query as the runtime contract; delete the test-only duplicate predicate and assert the actual query/breakpoint in unit/browser tests.
- A small shared focus-boundary hook handles Tab/Shift+Tab and programmatic focus escape using the current DOM, including dynamic controls and zero-control panels. Modal drawer background remains inert; the pointer scrim is decorative, not an out-of-dialog tab stop. Keep keyboard drag Escape owned by dnd-kit; no blanket Escape handler in the focus helper.
- Bound the selector using measured trigger geometry, viewport margins, and scrollable content; reposition on resize/scroll. Avoid adding a floating library or new CSS system. Initial focus goes to a checkbox; Escape/outside dismissal restores focus only when appropriate.
- Keep model and rate text wrapping without truncating live values. Do not equate an empty/all-null window to zero; use unavailable summaries. Preserve chart memoization on scalar ticks.
- Remove newly added speculative wait promises and helper sentences; retain actual metric identity and data labels. Correct archived assertions rather than rewriting historical results to imply checks occurred.

## Risks / Trade-offs

- Focus effects and dnd-kit use document listeners: test real key sequences including drag cancellation, focus cycling, resize, and closed tab order.
- Long CPU/GPU names and high network values are absent from the default mock: exercise production components with real payload fixtures, not screenshots of default short labels alone.
- Production and packaged evidence requires a fresh build: run canonical full and packaged lanes on the corrected code, then check WebView2 policy absence and owned-process teardown.

## Migration Plan

No schema or store migration. Review fix commit on agent/session-finalization; archive truthful artifacts after validation; fast-forward local main and push normally (never force), respecting a refreshed remote main.
