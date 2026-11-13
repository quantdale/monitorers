import { motion } from 'motion/react';
import { RotateCcw } from 'lucide-react';
import type { Ref } from 'react';
import { Button } from './Controls';
import { dangerBorder, dangerText, dangerTint, radius, type } from '../design/tokens';
import { riseItem } from '../design/motion';

interface Props {
  error: string;
  hasMetrics: boolean;
  pending: boolean;
  onRetry: () => void;
  retryRef: Ref<HTMLButtonElement>;
}

/** One recovery surface for both initial and retained-data connection errors. */
export function MetricsConnectionError({ error, hasMetrics, pending, onRetry, retryRef }: Props) {
  return (
    <motion.div
      data-testid="metrics-connection-error"
      variants={riseItem}
      initial="hidden"
      animate="visible"
      exit="exit"
      style={{
        color: dangerText,
        padding: '12px 14px',
        marginBottom: 12,
        fontSize: type.body,
        lineHeight: 1.5,
        background: dangerTint,
        border: `1px solid ${dangerBorder}`,
        borderRadius: radius.control,
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 12,
      }}
    >
      <div
        role="alert"
        aria-live={hasMetrics ? 'polite' : 'assertive'}
        style={{ flex: '1 1 240px', minWidth: 0, overflowWrap: 'anywhere' }}
      >
        Couldn't {hasMetrics ? 'refresh' : 'load'} metrics — {error}
      </div>
      <Button
        ref={retryRef}
        variant="primary"
        onClick={onRetry}
        disabled={pending}
        aria-label="Retry metrics connection"
        aria-busy={pending}
      >
        <RotateCcw size={14} aria-hidden="true" className={pending ? 'playful-spin' : undefined} />
        {pending ? 'Retrying…' : 'Retry connection'}
      </Button>
      <span
        role="status"
        style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap' }}
      >
        {pending ? 'Retrying metrics connection…' : ''}
      </span>
    </motion.div>
  );
}
