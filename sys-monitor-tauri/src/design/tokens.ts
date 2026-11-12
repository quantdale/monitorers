/**
 * The dashboard's design system: one module owns palette, typography,
 * spacing, radii, borders, elevation and MOTION so the look cannot drift
 * between components and the verification reads the same values it proves
 * (contrast tests import these tokens).
 *
 * Reference lock (2026-11-12): "machine-room exuberance" —
 *   - ClickHouse (olive-black canvas + one fluorescent accent doing all the
 *     work: every CTA, active segment and focus ring is the same lime;
 *     nothing else competes for "interactive").
 *   - LaunchDarkly (near-black stages + acid multi-hue series: the metric
 *     palette is the only chroma, and each card owns a hue).
 *   - Playdate / Tapbots (chunky tactility: big rounded controls, spring
 *     motion, oversized numerals, objects that want to be touched).
 *   - Chargetrip (per-card accent series over faint dotted gridlines — carried
 *     over from the previous lock because it is the correct way to read one
 *     live series against another).
 *
 * Fonts are system stacks only (CSP blocks external fonts); all surfaces are
 * inline styles + global `styles.css` (CSP `style-src 'unsafe-inline'`).
 *
 * CONTRACT: the exported names below are part of the visual contract that
 * `src/cards/chartLabels.test.ts` proves. `textPrimary`/`textSecondary`/
 * `textMuted` must each clear 4.5:1 on `surface`; `chartTickFill` 4.5:1 and
 * `chartAxisStroke` 3:1 on `surface`; the status text tokens must clear 4.5:1
 * on their tints alpha-blended over `surface`. Do not darken them casually.
 */

// ── Surfaces ─────────────────────────────────────────────────────────────────

/** Page canvas — the deepest layer. */
export const pageBg = '#08090C';
/** Card / panel surface, one step up from the canvas. */
export const surface = '#121419';
/** Elevated card hover state. */
export const surfaceHover = '#181C23';
/** Inset wells: chart plots, list-row chart panes, popovers, rails. */
export const surfaceSunken = '#0D0F14';
/** Glass panel used by popovers and the floating toolbar. */
export const surfaceGlass = 'rgba(18, 20, 25, 0.97)';

// ── Text tiers (all ≥ 4.5:1 on `surface`, proven in chartLabels.test.ts) ─────

export const textPrimary = '#F4F7FB';
export const textSecondary = '#B4BCCB';
/** Muted labels and metadata — still AA on card surfaces. */
export const textMuted = '#98A1B2';
/** Decorative only (drag glyphs, icons): ≥ 3:1 on `surface`, never body text. */
export const textFaint = '#6E7787';

// ── Accent & status ──────────────────────────────────────────────────────────

/**
 * The single interactive accent (ClickHouse's highlighter). Buttons, active
 * segments and focus rings. Metric series and health states keep their own hues.
 */
export const accent = '#C8F751';
export const accentTint = 'rgba(200, 247, 81, 0.14)';
/** Ink that reads on top of the accent itself. */
export const accentInk = '#0B0D07';

export const ok = '#3ECF8E';
export const okTint = 'rgba(62, 207, 142, 0.12)';
export const okBorder = 'rgba(62, 207, 142, 0.5)';
export const okText = '#8FE9C2';

export const warn = '#F5A623';
export const warnTint = 'rgba(245, 166, 35, 0.12)';
export const warnBorder = 'rgba(245, 166, 35, 0.55)';
export const warnText = '#FFD89B';

export const danger = '#FF6B6B';
export const dangerTint = 'rgba(255, 107, 107, 0.12)';
export const dangerBorder = 'rgba(255, 107, 107, 0.55)';
export const dangerText = '#FFB3B3';

// ── Series colors (the only other chroma) ────────────────────────────────────

export const cpuSeries = '#5B9BFF';
export const memorySeries = '#3ECF8E';
export const netDownSeries = '#38BDF8';
export const netUpSeries = '#F59E0B';
export const diskSeries = ['#F0883E', '#C084FC', '#FACC15', '#2DD4BF'];
export const gpuSeries = ['#60A5FA', '#34D399', '#FBBF24', '#C084FC'];

// ── Chart axis (floors proven in chartLabels.test.ts) ────────────────────────

/** Tick text: ≥ 4.5:1 on `surface`. */
export const chartTickFill = '#9CA3AF';
/** Axis stroke: ≥ 3:1 on `surface`. */
export const chartAxisStroke = '#6B7280';
/** Faint dotted gridlines — decorative, below any contrast floor. */
export const chartGrid = 'rgba(255, 255, 255, 0.06)';

// ── Typography ───────────────────────────────────────────────────────────────

export const fontSans =
  "'Segoe UI Variable', 'Segoe UI', system-ui, -apple-system, sans-serif";
export const fontMono =
  "'Cascadia Mono', 'Cascadia Code', Consolas, ui-monospace, monospace";

export const type = {
  /** Card titles, toolbar labels. */
  label: 12,
  /** Rows and body copy. */
  body: 13,
  /** The glance-layer live value (Default/Tile cards). */
  metric: 34,
  /** Page title. */
  pageTitle: 22,
  /** Captions, badges, axis text. */
  micro: 11,
} as const;

// ── Shape, borders, elevation ────────────────────────────────────────────────

export const radius = { card: 16, control: 10, chip: 8, pill: 999 } as const;

export const border = '1px solid rgba(255, 255, 255, 0.09)';
export const divider = '1px solid rgba(255, 255, 255, 0.07)';
/** The card rim at rest — a touch brighter than the fill edge. */
export const borderBright = '1px solid rgba(255, 255, 255, 0.16)';

export const shadowCard = '0 1px 2px rgba(0, 0, 0, 0.4)';
export const shadowPopover = '0 24px 64px -12px rgba(0, 0, 0, 0.8)';

/** Standard card shell — every card/panel starts here. */
export const cardShell = {
  backgroundColor: surface,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'rgba(255, 255, 255, 0.09)',
  borderRadius: radius.card,
  boxShadow: shadowCard,
} as const;

/** Compact interactive control (buttons, selects, segmented shells). */
export const controlShell = {
  background: surfaceSunken,
  border,
  borderRadius: radius.control,
  color: textPrimary,
} as const;

// ── Motion ───────────────────────────────────────────────────────────────────
//
// One motion language for the whole app. `springPop` is the default for
// anything the user touches (it overshoots — that is the playfulness);
// `springGlide` for entrances. Viewport-bounded panels use non-overshooting easing.

export const springPop = { type: 'spring', stiffness: 520, damping: 26, mass: 0.9 } as const;
export const springGlide = { type: 'spring', stiffness: 260, damping: 28, mass: 1 } as const;
export const easeOutExpo = [0.22, 1, 0.36, 1] as const;

/** Stagger step for card/row entrances. */
export const STAGGER_STEP = 0.035;
/** Cap so a 9-card dashboard still finishes entering promptly. */
export const MAX_STAGGER_INDEX = 8;

/** True when the OS asks for reduced motion — motion is never mandatory. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
