# Evidence — Harden chart axis readability

Everything below was measured on the running application or computed with the
WCAG 2.x contrast formula. "Before" refers to the branch base
`ae85539266f2a397bad2dafaf2f4663e924e7d83`; "after" refers to this change. The
rendered numbers are reproduced by the E2E spec added in this change
(`e2e/tests/chart-axis-readability.spec.ts`); the contrast numbers are
reproduced by the unit tests (`src/cards/chartLabels.test.ts`).

A post-apply review accepted the work with five corrections; all five are
closed and recorded in sections 2–4 below:

1. "fully inside" reconciled with the measurement (section 2a);
2. axis stroke proven on the rendered card (section 2b);
3. the unit gap test renamed so it cannot be read as a thinning proof
   (section 4, note);
4. the unit test's React roots unmounted (code fix in
   `MetricChart.test.tsx`);
5. the seeded span added to the browser lane (section 3).

## 1. Contrast floors (computed, WCAG 2.x relative luminance)

Card surface for Default/Tile charts: `#1e1e1e` (`src/components/MetricCard.tsx`).

| Color | Role | Ratio vs `#1e1e1e` | Floor | Before? |
| --- | --- | --- | --- | --- |
| `#888` | tick text | **4.703:1** | 4.5:1 (text) | not applied — recharts default `#666` |
| `#7a7a7a` | axis stroke | **3.884:1** | 3:1 (non-text graphical object) | not applied — recharts default `#666` |
| `#666` | chart library default | 2.903:1 | — | this is what rendered before |

Before this change the axis specified only `tick={{ fontSize: 10 }}`, so tick
text and the axis stroke inherited recharts' default gray — the same `#666`
family already measured at 2.90:1 in the October layout campaign. Both colors
now in use (`#888`, `#7a7a7a`) are existing application grays (drag handle,
muted labels), not new palette entries.

## 2. Rendered measurements

Measured on the Vite mock lane (real Chromium via Playwright), 1 Hz commits
frozen via `window.__SIM__.backend.stop()` before measuring, one measurement
per layout frame. Seven charts per configuration (CPU, memory, 2 disks,
network, 2 GPUs). Minimum values across all seven charts:

| Viewport | View | Window | Ticks/chart | Min label gap (edge-to-edge) | Left overflow | Right overflow |
| --- | --- | --- | --- | --- | --- | --- |
| 400×300 | Default | 60s | 3 | 112.37px | 0px (flush) | 0.6px |
| 400×300 | Default | 30s | 3 | 112.37px | 0px | 0.6px |
| 400×300 | Default | 300s (seed) | 3 | 112.41px | 0px | 0.6px |
| 400×300 | Tile | 60s | 3 | 112.37px | 0px | 0.6px |
| 400×300 | Tile | 30s | 3 | 112.37px | 0px | 0.6px |
| 900×1100 | Default | 60s | 5 | 153.37px | 0px | 0px |
| 900×1100 | Default | 30s | 5 | 153.37px | 0px | 0.6px |
| 900×1100 | Tile | 60s | 3 | 143.37px | 0px | 0.6px |
| 900×1100 | Tile | 30s | 3 | 143.37px | 0px | 0.6px |

### 2a. The "fully inside" decision

The spec sentence was **amended** rather than the test loosened: the
requirement now reads "SHALL lie fully inside the chart box — allowing at most
a 1px sub-pixel rounding tolerance on any edge", and the test asserts exactly
that bound (`BOX_TOLERANCE_PX = 1`, checked on all four edges of every label).
Decision basis, re-measured on the Vite mock lane after the corrections:

- The largest measured overhang in any configuration is **0.6px**, on the
  right edge of the last label. The glyph itself paints inside the surface;
  0.6px is fractional layout rounding of a middle-anchored label whose tick
  sits 18.3px inside an 836px-wide plot. It is not a visible clip: no glyph
  pixel is cut, and the worst case would still be a partially-covered
  anti-aliased edge pixel if it were 1px.
- Adding a right inset to force 0px was considered and rejected: it would
  shrink the plot on every card to eliminate sub-pixel rounding, which is the
  tail wagging the dog — and the amended sentence forbids reading the 1px
  allowance as a visible clip ("it SHALL NOT be read as permission for a
  visible clip").
- The left edge is flush (0px overhang) in every configuration because
  recharts insets the edge ticks by ~half a label width once it measures the
  text; in jsdom, where no text measurement exists, the edge ticks sit at the
  plot corners — which is why the browser lane, not jsdom, is the containment
  proof.

### 2b. Axis stroke, measured on the rendered card

The browser lane now reads the rendered colors directly, so the contrast
scenario is evaluated against painted pixels, not source constants. In every
Default and Tile configuration above, across all seven charts:

```
computed axis-line stroke: rgb(122, 122, 122)   (#7a7a7a)
computed card background:  rgb(30, 30, 30)      (#1e1e1e, the Default/Tile card surface)
computed tick fill:        rgb(136, 136, 136)   (#888)
```

The pair (stroke vs card surface) crosses the 3:1 floor at **3.884:1**, the
ratio computed from those exact hex values by the unit contrast test
(`chartLabels.test.ts`); the browser test pins that the rendered stroke and
rendered surface are those colors. The unit contrast test was kept.

Representative raw label geometry at 900×1100 Default, 60s:

```
surface:  left 32, right 868, width 836
tick 1:   x=18.34  "09:17:37"  left 32.0   right 69.3   (width 37.3)
tick 3:   x=418    "09:18:07"  left 431.7  right 468.9
tick 5:   x=817.66 "09:18:37"  left 831.3  right 868.6
computed fill: rgb(136, 136, 136)
```

### 2c. Overlap

**No two adjacent labels overlap.** The smallest edge-to-edge gap measured is
112.37px, against a 36.7–37.3px label width. Tick counts fall to 3 at the
narrow viewport and to 3 in Tile at 900px, which is `minTickGap` doing its job
where it matters. **List view draws no tick text at all**
(`showTimeAxis={false}` path): 0 `.recharts-cartesian-axis-tick-value` nodes
at both viewports.

## 3. Seeded-span browser case (closes the design gap)

Design.md Decision 4 said the browser lane must cover the seeded span and the
30-second window; the first pass only selected 30s and 60s. One case now
closes that gap without touching `mockBackend.ts`: 400×300 Default with the
300-second window selected (`WINDOW_SECS_OPTIONS` includes 300), which paints
the whole seeded ring. It self-checks that the visible span really is the seed
via the card's `data-chart-span-ms` attribute (asserted within 5s of the
299,000ms seed), so it cannot silently degenerate into a truncated window.
Measured in that case:

```
first label "10:34:51" → last label "10:39:50"   (span ≈ 299s, the full seed)
labels: HH:MM:SS on every chart (span < five minutes) — asserted in the test
min label gap 112.41px; left overhang 0px; right overhang 0.6px
```

30m/1h remain unselected, as the design requires: the harness cannot paint a
longer span than its seed, and the long-span `HH:MM` rule stays unit-proven
(`formatAxisTick` tests: 59s → seconds, exactly 300000ms and one hour →
`HH:MM`, missing span and single-sample span both short; chart-wiring tests
render 59s and one-hour datasets through the real component). No mock seed
was lengthened.

## 4. Local validation results (final, after all five corrections)

From `sys-monitor-tauri/`:

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | exit 0 |
| `npm run typecheck:test` (`tsc -p tsconfig.test.json --noEmit`) | exit 0 |
| `npm run sim:typecheck` (`tsc -p e2e/tsconfig.sim.json --noEmit`) | exit 0 |
| `npm test -- --run` | 22 files, 295 tests passed |
| `npm run build` | built in 6.13s |
| `npm run e2e` (Playwright mock lane) | 33 tests passed (11 new: 8 containment/overlap, 1 seeded-span, 2 list-view) |
| `git diff --check` | exit 0 |
| `openspec validate harden-chart-axis-readability --strict --no-interactive` | valid |

The `--change` flag form named in tasks.md 4.3 does not exist in the installed
CLI (it reports `unknown option '--change' (Did you mean --changes?)`); the
positional form above is the repository-equivalent current syntax and covers
the same strict validation of this change. The pre-existing chart-fidelity,
layout-containment, semantics and accessibility specs pass unchanged — no
card width, chart height, or reflow assertion regressed from the 16px bottom
margin.

Reproduction notes:

- Ticks render at `fontSize: 10` with the browser default font family
  (recharts default); label width 36.7–37.3px for `HH:MM:SS`.
- The unit gap assertion is a **floor guard, not the thinning proof**. jsdom
  cannot measure text, so recharts skips its `minTickGap` thinning there — a
  probe that removed the prop produced byte-identical jsdom geometry. The test
  was therefore renamed to "renders tick labels no closer than the 80px gap
  floor (layout guard, not the thinning proof)"; the live thinning proof is
  the Playwright lane, where labels are really measured (2c above).
- Font width variance (36.7 vs 37.3px) is proportional-font digit jitter
  between runs; both widths sit far inside the 80px gap budget.

## 5. Not run (explicitly)

- **Packaged/real lane.** Not run and not claimed: an axis-style fix on the
  mock harness needs no Rust or IPC surface (no payload, schema, collector, or
  settings change), and the packaged lane would only re-render the same
  component tree.
- **30m/1h rendered spans.** The mock ring seeds ~300 seconds; those windows
  do not paint a long span. The long-span rule is unit-tested only (section 3).
- **Simulation journeys.** No journey or persona covers axis geometry; the
  plain E2E lane is the correct discriminator for this change and it is green.
- **Rust lane / cargo.** No Rust source changed in this change.
