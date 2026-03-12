import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { MetricCard } from './MetricCard';
import type { ViewMode } from '../utils';

interface Props {
  id: string;
  title: string;
  value: string;
  history?: number[];
  timestamps?: number[];
  color: string;
  yDomain?: [number, number | 'auto'];
  badge?: React.ReactNode;
  viewMode: ViewMode;
  secondaryHistory?: number[];
  secondaryColor?: string;
  listViewValue?: string | React.ReactNode;
  listViewMinMax?: string | React.ReactNode;
}

export function SortableCard(props: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    >
      <MetricCard
        {...props}
        isDragging={isDragging}
        dragHandleProps={{ attributes, listeners }}
      />
    </div>
  );
}
