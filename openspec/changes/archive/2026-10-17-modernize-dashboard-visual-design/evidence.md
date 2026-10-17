# Evidence — modernize the dashboard visual design

Date: 2026-10-17. Machine: Windows (dev host). Commands from
`sys-monitor-tauri/` unless noted.

## Reference lock (Refero MCP research)

- Primary: **Polar** dark admin dashboard (screen `79903407-5d3a-4e9f-a9a8-37898374843f`,
  polar.sh) — near-black canvas, hairline-bordered charcoal cards (radius
  ~12, 16–24px padding, 16px gaps), huge tight metric numerals (36–48px/600+)
  over small muted labels, compact segmented time control, pill buttons,
  faint dotted chart gridlines, subtle hover elevation, Inter/Geist Mono
  typography notes.
- Borrowed: **steel.dev** usage console (`d499ba7e-45e3-4365-be81-a2d756f9f775`)
  — label-over-value metric summary rows, chart-card headers with
  right-aligned annotations; **chargetrip** dark analytics
  (`4abd4a1b-821a-43a8-a8d6-114251f8cbde`) — per-card accent-colored series
  on soft dark cards with faint dotted gridlines and corner micro-labels.
- Rejected: light themes (product is a dark system monitor), purple brand
  identity, external fonts (CSP blocks all external network — system stacks
  only: `Segoe UI Variable`/`Cascadia Mono` fallbacks).
- Full-screen screenshots of all three references were inspected during the
  research phase (Polar full, steel.dev full, chargetrip full).

## Design system (src/design/tokens.ts)

| Role | Token | Value |
|---|---|---|
| Page canvas | `pageBg` | `#0A0C10` |
| Card surface | `surface` | `#15181E` |
| Inset wells | `surfaceSunken` | `#101319` |
| Hover lift | `surfaceHover` | `#1B202A` |
| Primary text | `textPrimary` | `#F2F4F8` |
| Secondary text | `textSecondary` | `#AAB2BE` |
| Muted labels (AA) | `textMuted` | `#99A1AE` |
| Decorative (≥3:1) | `textFaint` | `#7A7A7A` |
| Interactive accent | `accent` | `#4D8DFF` |
| Chart tick text | `chartTickFill` | `#9CA3AF` |
| Chart axis stroke | `chartAxisStroke` | `#6B7280` |
| Series | cpu/memory/net-disk/gpu | `#5B9BFF` / `#3ECF8E` / `#38BDF8` `#F59E0B` / rotated palettes |
| Status | ok/warn/danger + tints | green/amber/red families |

Type: `Segoe UI Variable`/system-ui sans, `Cascadia Mono` numerals; metric
values 30px/600/-0.02em tracking over 12px muted labels (label-over-value
split for composite values — `valueLabel` prop — so the big-number treatment
never overflows the narrowest 300px tile track). Radii 12/8/6/pill; hairline
translucent borders; soft hover elevation.

## Contrast proofs (src/cards/chartLabels.test.ts, 10 tests)

All computed from the token values: tick text 7.06:1 (≥4.5:1 floor), axis
stroke 3.70:1 (≥3:1 floor), all three readable text tiers ≥4.5:1 on the card
surface, status banner texts ≥4.5:1 on their alpha-blended tint surfaces, and
the chart-library default gray proven to still fail the text floor (the
explicit tokens are load-bearing).

## Behavior preserved (verified, not assumed)

- E2E re-pins only moved literal rgb values to the new tokens
  (`chart-axis-readability.spec.ts`: surface `rgb(21, 24, 30)`, tick fill
  `rgb(156, 163, 175)`, stroke `rgb(107, 114, 128)`); every geometry, ARIA,
  landmark, containment, drag and lifecycle assertion passed unmodified in
  meaning. `MetricChart.test.tsx` re-pinned to the token colors.
- All testids, roles, accessible names and text contracts preserved
  (`'Active Time 42.0%'` textContent intact via the `valueLabel` split;
  `Metrics (n/m) ▾` trigger text; `History time range` combobox name;
  `aria-controls`/`aria-expanded` sidebar toggle; Escape focus-return on the
  Metrics dialog; per-card drag handles with focus rings).
- Render fan-out guard still passes (gradient ids via `useId`, memoized).

## Gates (all on the final tree)

- `npx tsc --noEmit` — clean; `npm run typecheck:test` — clean;
  `npm run sim:typecheck` — clean; `npm run lint` — clean.
- `npm test -- --run` — **302 passed (23 files)** (includes the 10 contrast
  proofs).
- `npm run build` — success.
- `npm run e2e` — **33 passed** (exit 0).
- `npm run sim` — mock lane **4 passed** (exit 0) on a clean run. (One
  earlier concurrent run failed 4 journeys with `browser.close timed out` /
  `waitForSelector` timeouts while a second browser session and the dev
  server were saturating the host; the clean re-run passed every journey,
  including the one that had failed — environmental, not a regression.)
- Rendered evidence: 6 screenshots at 400×300 and 900×1100 in Default, Tile
  and List views captured to `e2e-results/qa/visual-overhaul/` (gitignored,
  per the repo's visual-evidence convention) and reviewed against the
  reference lock.

Not run, not claimed: the packaged lane (frontend styling only; mock lane is
the stated verification scope in the proposal).
