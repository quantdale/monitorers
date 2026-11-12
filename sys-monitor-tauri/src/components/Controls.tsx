import { motion, useIsPresent } from 'motion/react';
import type { CSSProperties, ReactNode, Ref, AriaRole } from 'react';
import { accent, accentInk, borderBright, controlShell, fontSans, radius, shadowPopover, surfaceGlass, textPrimary, type } from '../design/tokens';
import { popoverVariant, springPop, tapScale } from '../design/motion';

interface ButtonProps {
  children: ReactNode;
  variant?: 'default' | 'primary';
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  'aria-label'?: string;
  'aria-expanded'?: boolean;
  'aria-controls'?: string;
  'data-testid'?: string;
  ref?: Ref<HTMLButtonElement>;
}

/** Shared tactile action; the single filled accent is reserved for selection
 * and primary actions. React 19 forwards refs as ordinary props. */
export function Button({ children, variant = 'default', ref, ...props }: ButtonProps) {
  const primary = variant === 'primary';
  return (
    <motion.button
      {...props}
      ref={ref}
      type="button"
      whileHover={props.disabled ? undefined : { y: -1 }}
      whileTap={props.disabled ? undefined : tapScale}
      transition={springPop}
      style={{
        ...controlShell,
        background: primary ? accent : controlShell.background,
        color: primary ? accentInk : textPrimary,
        border: primary ? `1px solid ${accent}` : controlShell.border,
        padding: '7px 12px',
        minHeight: 36,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        fontSize: type.label,
        fontFamily: fontSans,
        fontWeight: 650,
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        opacity: props.disabled ? 0.55 : 1,
        boxShadow: primary ? '0 4px 18px -6px rgba(200, 247, 81, 0.4)' : undefined,
      }}
    >
      {children}
    </motion.button>
  );
}

interface GlassPanelProps {
  children: ReactNode;
  style?: CSSProperties;
  id: string;
  role: AriaRole;
  tabIndex?: number;
  'aria-label': string;
  panelRef: Ref<HTMLDivElement>;
}

/** Rendered in the caller's body portal, never inside a glass/transform
 * containing block. Exiting content leaves the tab order immediately. */
export function GlassPanel({ children, style, panelRef, ...props }: GlassPanelProps) {
  const present = useIsPresent();
  return (
    <motion.div
      {...props}
      ref={panelRef}
      inert={!present ? true : undefined}
      aria-hidden={!present ? true : undefined}
      variants={popoverVariant}
      initial="hidden"
      animate="visible"
      exit="exit"
      style={{
        background: surfaceGlass,
        backdropFilter: 'blur(18px) saturate(150%)',
        border: borderBright,
        borderRadius: radius.card,
        boxShadow: shadowPopover,
        transformOrigin: 'top right',
        ...style,
      }}
    >
      {children}
    </motion.div>
  );
}
