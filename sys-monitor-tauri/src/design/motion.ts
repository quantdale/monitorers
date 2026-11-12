import type { Variants } from 'motion/react';
import { easeOutExpo, MAX_STAGGER_INDEX, prefersReducedMotion, springGlide, springPop, STAGGER_STEP } from './tokens';

export { springPop };

/** Resolve preferences at animation time, including changes while the app runs. */
export const staggerParent = (stagger = STAGGER_STEP, delayChildren = 0): Variants => ({
  hidden: {},
  visible: () => ({
    transition: prefersReducedMotion()
      ? { staggerChildren: 0, delayChildren: 0 }
      : { staggerChildren: stagger, delayChildren },
  }),
});

export const riseItem: Variants = {
  hidden: () => prefersReducedMotion() ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 14, scale: 0.985 },
  visible: () => ({ opacity: 1, y: 0, scale: 1, transition: prefersReducedMotion() ? { duration: 0 } : springGlide }),
  exit: () => ({ opacity: 0, transition: { duration: prefersReducedMotion() ? 0 : 0.14 } }),
};

export const slideInItem: Variants = {
  hidden: () => prefersReducedMotion() ? { opacity: 1, x: 0 } : { opacity: 0, x: -10 },
  visible: () => ({ opacity: 1, x: 0, transition: prefersReducedMotion() ? { duration: 0 } : springGlide }),
};

// A viewport-bounded panel must never overshoot its measured bounds.
export const popoverVariant: Variants = {
  hidden: () => prefersReducedMotion() ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.98 },
  visible: () => ({ opacity: 1, scale: 1, transition: { duration: prefersReducedMotion() ? 0 : 0.16, ease: easeOutExpo } }),
  exit: () => ({ opacity: 0, transition: { duration: prefersReducedMotion() ? 0 : 0.1 } }),
};

export const fadeSwap: Variants = {
  hidden: () => ({ opacity: prefersReducedMotion() ? 1 : 0 }),
  visible: () => ({ opacity: 1, transition: { duration: prefersReducedMotion() ? 0 : 0.2 } }),
  exit: () => ({ opacity: 0, transition: { duration: prefersReducedMotion() ? 0 : 0.1 } }),
};

export const tapScale = { scale: 0.965 } as const;

export function staggerDelay(index: number, step = STAGGER_STEP): number {
  return prefersReducedMotion() ? 0 : Math.min(index, MAX_STAGGER_INDEX) * step;
}
