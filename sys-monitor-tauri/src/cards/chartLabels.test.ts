import { describe, expect, it } from 'vitest';
import { formatAxisTick } from './chartLabels';
import {
  chartAxisStroke,
  chartTickFill,
  dangerText,
  okText,
  surface,
  textMuted,
  textPrimary,
  textSecondary,
  warnText,
} from '../design/tokens';

// The tick formatter is the only thing standing between a one-hour window and
// overlapping labels: precision must follow the visible span, and the width
// must not depend on locale. Both are asserted from the same local `Date`
// fields the helper reads — `toLocaleTimeString` would make the expectation
// as unknowable as the library default it replaced.

/** Builds the expected string from the same local Date fields the helper uses. */
function localHHMMSS(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function localHHMM(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

describe('formatAxisTick', () => {
  // A fixed local timestamp: 2026-10-09 13:07:42 local time. Built from Date
  // fields (not ISO) so the test asserts local-field behavior, not UTC.
  const t = new Date(2026, 9, 9, 13, 7, 42).getTime();

  it('keeps seconds on a short span', () => {
    expect(formatAxisTick(t, 59_000)).toBe(localHHMMSS(t));
    expect(formatAxisTick(t, 299_999)).toBe(localHHMMSS(t));
  });

  // Boundary regression: the 300 s history window's visible span can reach
  // EXACTLY 300 000 ms when its oldest sample lands on the window cutoff, so
  // an exclusive boundary made the five-minute window's label precision
  // depend on the phase of the sample spacing. Exactly five minutes keeps
  // seconds; only strictly beyond drops them.
  it('keeps seconds at exactly five minutes and drops them strictly beyond', () => {
    expect(formatAxisTick(t, 300_000)).toBe(localHHMMSS(t));
    expect(formatAxisTick(t, 300_001)).toBe(localHHMM(t));
    expect(formatAxisTick(t, 3_600_000)).toBe(localHHMM(t));
  });

  it('treats a missing span as short', () => {
    expect(formatAxisTick(t)).toBe(localHHMMSS(t));
  });

  it('treats a single-sample span as short', () => {
    // One committed point: no elapsed time, nothing to compress.
    expect(formatAxisTick(t, 0)).toBe(localHHMMSS(t));
  });

  it('zero-pads every field so label width is constant', () => {
    const early = new Date(2026, 9, 9, 1, 2, 3).getTime();
    expect(formatAxisTick(early, 0)).toBe('01:02:03');
    expect(formatAxisTick(early, 3_600_000)).toBe('01:02');
  });
});

// The axis colors must clear WCAG contrast floors against the card surface
// they are painted on: 4.5:1 for tick text, 3:1 for the graphical axis
// stroke. The colors come from the design tokens — this test is the floor, so
// a future "slightly darker gray" token edit cannot silently reintroduce the
// ~2.90:1 library default.

const srgbToLinear = (channel: number): number => {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

function relativeLuminance(hex: string): number {
  // Expand 3-digit shorthand (#888) to 6 digits before reading channels.
  const full =
    hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  const r = Number.parseInt(full.slice(1, 3), 16);
  const g = Number.parseInt(full.slice(3, 5), 16);
  const b = Number.parseInt(full.slice(5, 7), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Alpha-composites `rgba(r, g, b, a)` over an opaque `#rrggbb` base. */
function blendOver(rgba: string, baseHex: string): string {
  const [r, g, b, a] = rgba
    .replace(/rgba?\(|\)/g, '')
    .split(',')
    .map((part) => Number(part.trim()));
  const base = [1, 3, 5].map((i) => Number.parseInt(baseHex.slice(i, i + 2), 16));
  const mixed = [r, g, b].map((channel, i) => Math.round(channel * a + base[i] * (1 - a)));
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

describe('design-token contrast floors', () => {
  it('chart tick text clears the 4.5:1 text floor on the card surface', () => {
    expect(contrastRatio(chartTickFill, surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('chart axis stroke clears the 3:1 non-text floor on the card surface', () => {
    expect(contrastRatio(chartAxisStroke, surface)).toBeGreaterThanOrEqual(3);
  });

  it('every readable text tier clears AA on the card surface', () => {
    for (const tier of [textPrimary, textSecondary, textMuted]) {
      expect(contrastRatio(tier, surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('status banner text clears AA on the tinted banner surfaces it paints on', () => {
    // Banners are a status tint alpha-blended over the card surface; the
    // blend lightens the background slightly, so AA is proven against the
    // blended value, not the bare surface.
    const cases: [string, string][] = [
      [okText, 'rgba(62, 207, 142, 0.12)'],
      [warnText, 'rgba(245, 166, 35, 0.12)'],
      [dangerText, 'rgba(255, 107, 107, 0.12)'],
    ];
    for (const [textColor, tint] of cases) {
      expect(contrastRatio(textColor, blendOver(tint, surface))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("the chart library's default gray would fail the text floor — the explicit tokens are load-bearing", () => {
    // Recharts' default tick fill is #666; it clears neither the old 3:1
    // stroke floor nor the 4.5:1 text floor on today's surfaces.
    expect(contrastRatio('#666', surface)).toBeLessThan(4.5);
  });
});
