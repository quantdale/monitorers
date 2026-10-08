# Evidence — Harden dashboard layout containment and semantic accessibility

Everything below was measured on the running application (Vite mock lane,
`http://127.0.0.1:5180`, real Chromium via Playwright/agent-browser). "Before"
numbers come from the same commands run against `main@b4517f44` before this
change's edits; "after" numbers come from the same commands against the change.
Both sets are reproduced by the E2E spec added in this change.

## 1. Defects recorded before the change

**1.1 A negative percentage was rendered.** In List view, the CPU card showed:

```
CPU    0.0%
Min: -9.9% Max: 69.9%
```

Root cause traced in two steps:
- the current value is safe — `formatPercent` clamps to 0–100
  (`src/cards/formatters.ts`), used by every card's `value` prop;
- the List row's min/max was formatted inline with `toFixed(1)`
  (`src/components/MetricCard.tsx`) with no clamp, over the raw windowed slice.

The value that made it negative came from the mock backend: `cpu.push(30 + 40 *
Math.sin(t * 4))` in `generateHistory()` spans −10…70, and the live snapshot's
`sinAt({ base: 30, amp: 40, … })` does the same. The production collector's PDH
percentage counters cannot report a negative utilization. The same mock file
already clamped disk/GPU/network series with `Math.max(0, …)` while leaving CPU,
memory and the upper bound of GPU utilizations (wave range `base 10–59 ± amp
25–44` → up to 103) unclamped — the file contradicted itself.

**1.2 The Tile grid broke at the product's own minimum window size** (400×300,
`tauri.conf.json`). Measured at a 390 px viewport:

```
gridTemplateColumns: "406.234px 180.703px"
cardWidths:            [406, 181, 406, 181, 406, 181, 406]
dashboard-card-list:   358px wide
```

`1fr 1fr` is `minmax(auto, 1fr)` per track, so one card's min-content width
widened its own track past the container, and cards overflowed their own boxes
(`metric-card-disk_D:`, `metric-card-gpu_sim_gpu_93a2b898` had
`scrollWidth > clientWidth`).

**1.3 List rows clipped information.** Rows were `height: 50` with
`overflow: hidden`; at 390 px the Network card's range pills wrapped:

```
metric-card-network: scrollHeight 72 > clientHeight 50 → clipped
```

The same rows ellipsized their titles (`Netwo…`, `D_:`, `RTX 4050`) because a
30 %-wide label column gave the title ~107 px after the value pill.

**1.4 No landmarks, no heading.** Rendered DOM counts:
`header 0, main 0, nav 0, h1/h2/h3 0`. The product name was a `<span>`.

**1.5 Every chart was an unnamed, focusable `application` widget.** Recharts 3
defaults `accessibilityLayer` on, which renders

```html
<svg role="application" tabindex="0" class="recharts-surface"><title></title><desc></desc>…
```

seven times per dashboard — one empty, meaningless tab stop per card.

**1.6 The collapsed sidebar stayed reachable.** It is hidden by
`width: 0; overflow: hidden`, which does not remove it from the accessibility
tree or the tab order.

**1.7 All seven drag handles were named "Drag to reorder".**

**1.8 The drag-handle glyph was `#666` on `#1e1e1e` = 2.90:1**, below the 3:1
minimum for a non-text UI component.

## 2. What was changed

| Defect | Change | Files |
|---|---|---|
| 1.1 | `clampPercent` + `formatPercentRange` (one shared, tested formatter); mock emits `clampUtilization` for CPU, memory, disk active-time and GPU util | `src/cards/formatters.ts`, `src/components/MetricCard.tsx`, `src/sim/mockBackend.ts` |
| 1.2 | `repeat(auto-fit, minmax(300px, 1fr))` + `min-width: 0` on the sortable wrapper; the GPU badge row wraps instead of overflowing | `src/App.tsx`, `src/components/SortableCard.tsx`, `src/components/MetricCard.tsx` |
| 1.3 | `min-height: 50` with no outer `overflow: hidden`; label column `flex: 1 1 55%; max-width: 65%` with `overflow: hidden`; value group reflows (inline content, `flex-shrink: 0` on the title) so it wraps instead of overflowing onto the chart; network pills are `inline-block` + `nowrap` so they break between pills only | `src/components/MetricCard.tsx`, `src/cards/renderCardContent.tsx` |
| 1.4 | `header` + `main` landmarks (siblings inside the scroll container) and the product title as `h1` | `src/App.tsx` |
| 1.5 | `role="img"`, `tabIndex={-1}`, `aria-label` on the chart surface; the label carries the card's identity, current value and visible min/max | `src/components/MetricChart.tsx`, `src/components/MetricCard.tsx`, `src/cards/renderCardContent.tsx` (network supplies its own two-series label) |
| 1.6 | `visibility` added to the existing width transition | `src/components/HardwareSidebar.tsx` |
| 1.7 | `aria-label`/`title` = `Reorder <card> card`; E2E asserts the stronger name | `src/components/MetricCard.tsx`, `e2e/tests/accessibility.spec.ts` |
| 1.8 | `#666` → `#7a7a7a` (2.90:1 → 3.88:1) | `src/components/MetricCard.tsx` |
| — | Focus moves into the metric-selector panel on open (Escape still returns it to the trigger) | `src/components/MetricCardSelector.tsx` |

## 3. Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm run typecheck:test` | exit 0 |
| `npm run sim:typecheck` | exit 0 |
| `npm test -- --run` | **281 passed (281)**, 21 files — up from 270 (11 new tests: 2 chart-semantics, 6 percentage-range, 1 mock range-fidelity group, 4 card-label) |
| `npm run build` | exit 0, 2405 modules, `✓ built in 4.12s` |
| `npm run e2e` | **22 passed (22)** — 9 of them in the rewritten `accessibility.spec.ts` (was 3) |
| `npm run verify:frontend` | exit 0 (version+doc consistency, dead-code check, both audits, `tsc --noEmit`, `tsc -p tsconfig.test.json`, unit tests, production build) |
| `npm run sim` (mock lane) | **4 passed (5.0m)** — gpu-hotplug-gap 3/3, ipc-schema-mismatch 3/3, degraded-startup 4/4, fault-freeze-recovery 3/3, layout-persistence 6/6, persona-free-roam glancer 16/16, customizer 38/38 |
| `npx openspec validate 2026-10-08-harden-dashboard-layout-and-semantics --strict --no-interactive` | `is valid` |

New E2E assertions (all passing):

- Tile view has two equal tracks at 900 px and no card wider than its container;
- Tile view resolves to **one** track at 400×300, no card overflows its own box,
  and the document does not scroll sideways (polled, because Recharts'
  `ResponsiveContainer` re-measures asynchronously after the grid change);
- List rows never have `scrollHeight > clientHeight` at 400×300 or 900×1100;
- exactly one `h1`, a visible `banner` and a visible `main` that contains the
  card list;
- every `svg.recharts-surface` is `role="img"` with a non-empty `aria-label` and
  `tabindex="-1"`, and zero surfaces keep `tabindex="0"`;
- no card text matches `-\d+(\.\d+)?%`.

## 4. Visual evidence (before → after)

Screenshots are stored under `sys-monitor-tauri/e2e-results/qa/` (gitignored;
`before-*` captures from the unmodified build are the unprefixed files:
`desktop.png`, `desktop-900.png`, `list-900.png`, `tile-900.png`,
`mobile-400x300.png`, `mobile-390.png`).

| Viewport / mode | Before | After |
|---|---|---|
| 900×1100 List | `Min: -9.9%`, `Netwo…`, `D_:`, `RTX 4050`, Network range clipped (`scrollHeight 72 > 50`) | full titles, `Min: 20.5% Max: 70.0%`, all four Network pills visible, rows 50 px |
| 900×1100 Default | — | unchanged (no regression in the primary view) |
| 900×1100 Tile | tracks `430px 430px` (correct) | tracks `430px 430px` (unchanged) |
| 400×300 Tile | tracks `406.234px 180.703px`, 2 cards overflowing | **one** 368 px track, zero overflowing cards, `document.scrollWidth == clientWidth` |
| 390×844 List | `Dis…` / `Netw…` titles, Network range clipped | titles complete; disk rows 60 px and the Network row 88 px show every pill and range |

Accessibility tree before → after (rendered):

```
before: 0 header / 0 main / 0 headings; 7 × <svg role="application" tabindex="0"><title></title>
after:  1 h1 ("System Monitor") / 1 banner / 1 main;
        7 × <svg role="img" tabindex="-1" aria-label="CPU trend, now 47.4%, Min: 20.5%  Max: 70.0% over the selected window">
        drag handles named "Reorder <card> card"
```

## 5. Refero MCP research and the decisions it informed

Refero MCP was available and was used before the layout decisions were made.
Searches: "system monitor dashboard CPU memory usage live charts",
"dark theme metrics dashboard card grid with sparkline charts". The screen
retrieved in full was the Weights & Biases system-metrics dashboard
(`eba7517e-dcc0-4a82-891f-548c4489346a`), the closest real-product analogue
(same job-to-be-done: CPU/GPU/memory/disk/network cards, live).

Observed reference facts used (not copied):
- **Uniformly sized cards in equal-width tracks with 16–24 px uniform spacing**,
  in a responsive multi-row grid. → This is the pattern the Tile grid violated;
  `repeat(auto-fit, minmax(300px, 1fr))` restores it and adds the collapse the
  reference implies but this product's fixed 400 px minimum window requires.
- **A dark app header separated from a light scrollable card canvas, with a
  navigation rail on the left.** → Supports the `header`/`main` split and the
  existing collapsible hardware rail; no visual redesign was taken from it.
- Other references consulted for the same question (Chargetrip analytics,
  Polar) confirmed the equal-track card grid and a fixed header + canvas split;
  none of their branding, palette or copy was reused — this product keeps its
  existing dark palette, monospace value typography and inline-style convention.

Not taken from the references: their light canvases, their y-axis/gridline
treatment, and their hero/summary rows. The chart y-domain policy was
deliberately left unchanged (a `[0, 100]` percentage domain stays honest for a
system monitor, and changing it is a product decision, not a defect fix).

## 6. Performance invariant preserved

The chart's accessible name is derived from the chart **data's** latest committed
point, not from the live `value` prop. This is deliberate: live scalars merge on
every ~250 ms tick, so a label built from `value` would change four times a
second and defeat `MetricChart`'s memo — re-mounting the Recharts subtree every
tick is the largest main-thread cost this app has (documented in
`MetricChart.tsx`, guarded by `MetricChart.test.tsx`'s fan-out test).

Guard added for the card side of that contract
(`src/components/MetricCard.test.tsx`, chart body stubbed so the assertion is
about the label rather than Recharts/jsdom):

- four scalar ticks with a new live value each time and an identical history
  array must leave the chart's label byte-identical;
- positive control: extending the committed history must change it
  (`now 12.0%` → `now 77.0%`), so the stability assertion is not vacuous.

No re-measurement of long-task time was performed in this change, so no
performance improvement is claimed — only that the identity contract the earlier
performance campaign relied on is still enforced by a test.

## 7. Limitations

- **The packaged/real lane was not re-run** for this change: it is opt-in,
  needs a built executable, and drives the real Tauri app via CDP. The change is
  frontend-only and every affected behaviour is covered by the mock-lane E2E
  suite; the real lane remains the higher-cost confirmation and was not claimed.
- **A genuinely loaded hardware sidebar was never observed**: in browser
  mode no hardware profile arrives, so the collapsed-sidebar fix is verified by
  the DOM contract (no focusable element inside a 0-width container) rather than
  by a loaded sidebar's tab order.
- At 400×300 the toolbar's view-mode buttons wrap to a second row. This is
  intentional responsive behaviour (`flex-wrap`), not a defect, and was left
  alone rather than redesigned.
- The first PDH reading being 0 % and other backend behaviours are unaffected and
  unverified here; no backend code changed.
