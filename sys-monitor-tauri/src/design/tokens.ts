/**
 * The dashboard's design system: one module owns palette, typography,
 * spacing, radii, borders and elevation so the look cannot drift between
 * components (the previous styling was 20+ ad-hoc hex literals) and the
 * verification reads the same values it proves (contrast tests import these
 * tokens).
 *
 * Direction (Refero reference lock, 2026-10-17): Polar's dark-minimal admin
 * language — deep charcoal canvas, hairline-bordered elevated cards, huge
 * tight metric numerals over small muted labels — with steel.dev's
 * label-over-value metric rows and chargetrip's per-card accent series on
 * faint dotted gridlines. Fonts are system stacks only (CSP blocks external
 * fonts); all surfaces are inline styles + global styles.css (CSP
 * `style-src 'unsafe-inline'`).
 */

// ── Surfaces ─────────────────────────────────────────────────────────────────

/** Page canvas — the deepest layer. */
export const pageBg = '#0A0C10';
/** Card / panel surface, one step up from the canvas. */
export const surface = '#15181E';
/** Inset wells: chart plots, list-row chart panes, popovers. */
export const surfaceSunken = '#101319';
/** Hover/active lift for interactive rows. */
export const surfaceHover = '#1B202A';

// ── Text tiers (all ≥ 4.5:1 on `surface`, proven in chartLabels.test.ts) ─────

export const textPrimary = '#F2F4F8';
export const textSecondary = '#AAB2BE';
/** Muted labels and metadata — still AA on card surfaces. */
export const textMuted = '#99A1AE';
/** Decorative only (drag glyphs, icons): ≥ 3:1 on `surface`, never body text. */
export const textFaint = '#7A7A7A';

// ── Accent & status ──────────────────────────────────────────────────────────

/** The single interactive accent: buttons, active segments, focus rings. */
export const accent = '#4D8DFF';
export const accentHover = '#6BA0FF';
export const accentTint = 'rgba(77, 141, 255, 0.16)';
export const accentBorder = 'rgba(77, 141, 255, 0.55)';

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
export const chartGrid = 'rgba(255, 255, 255, 0.05)';

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
  metric: 30,
  /** Page title. */
  pageTitle: 20,
  /** Captions, badges, axis text. */
  micro: 11,
} as const;

// ── Shape, borders, elevation ────────────────────────────────────────────────

export const radius = { card: 12, control: 8, chip: 6, pill: 999 } as const;

export const border = '1px solid rgba(255, 255, 255, 0.08)';
export const borderStrong = '1px solid rgba(255, 255, 255, 0.16)';
export const divider = '1px solid rgba(255, 255, 255, 0.06)';

export const shadowCard = '0 1px 2px rgba(0, 0, 0, 0.25)';
export const shadowLift = '0 6px 24px rgba(0, 0, 0, 0.4)';
export const shadowPopover = '0 12px 32px rgba(0, 0, 0, 0.55)';

/** Standard card shell — every card/panel starts here. */
export const cardShell = {
  background: surface,
  border,
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
