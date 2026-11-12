import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { MetricCard } from './MetricCard';
import type { ViewMode } from '../utils';
import type { MetricValue } from '../types/metrics';
import { staggerDelay } from '../design/motion';

interface Props {
  id: string;
  title: string;
  subtitle?: string;
  value: string;
  /** Optional small label before the big value (see MetricCard.valueLabel). */
  valueLabel?: string;
  history?: MetricValue[];
  timestamps?: number[];
  color: string;
  yDomain?: [number, number | 'auto'];
  badge?: React.ReactNode;
  viewMode: ViewMode;
  secondaryHistory?: MetricValue[];
  secondaryColor?: string;
  listViewValue?: string | React.ReactNode;
  listViewMinMax?: string | React.ReactNode;
  rangeCaption?: string;
  /** Position in the visible dashboard, for the staggered entrance. */
  index?: number;
}

/** dnd-kit owns the sortable transform; entrance decoration is opacity-only.
 * Keyboard scroll/drop timing is handled separately by useCardSensors. */
export function SortableCard(props: Props) {
  const { index = 0, ...cardProps } = props;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.id });

  const delayMs = Math.round(staggerDelay(index) * 1000);

  return (
    <div
      ref={setNodeRef}
      data-testid={`sortable-card-${props.id}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        // A grid item's automatic minimum size is its min-content width, which is
        // what widened one tile column past its container at narrow viewports.
        minWidth: 0,
        // The dragged card is the one that should feel "picked up".
        zIndex: isDragging ? 5 : undefined,
        position: 'relative',
        animation: `card-enter 260ms cubic-bezier(0.22, 1, 0.36, 1) ${delayMs}ms both`,
      }}
    >
      <MetricCard
        {...cardProps}
        isDragging={isDragging}
        dragHandleProps={{ attributes, listeners }}
      />
    </div>
  );
}
