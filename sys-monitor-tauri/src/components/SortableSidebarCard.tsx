import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';

interface Props {
  id: string;
  children: (dragHandle: React.ReactNode) => React.ReactNode;
}

export function SortableSidebarCard({ id, children }: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const dragHandle = (
    <button
      type="button"
      className="sidebar-drag-handle"
      {...attributes}
      {...listeners}
      aria-label="Drag to reorder"
      style={{
        padding: '0 2px',
        cursor: 'grab',
        color: '#555',
        display: 'flex',
        alignItems: 'center',
        flexShrink: 0,
        background: 'transparent',
        border: 0,
      }}
      title="Drag to reorder"
    >
      <GripVertical size={14} aria-hidden="true" />
    </button>
  );

  return (
    <div ref={setNodeRef} style={style} data-sb-id={id}>
      {children(dragHandle)}
    </div>
  );
}
