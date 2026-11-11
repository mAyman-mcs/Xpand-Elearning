import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import * as Popover from "@radix-ui/react-popover";
import { GripVertical } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Button, cx } from "../../components/ui";

/**
 * The question list as a sortable list: drag a block by its handle (or focus the handle, press
 * Space, move with the arrow keys, Space again). `onMove` gets 0-based positions among `ids`.
 */
export function SortableList({
  ids,
  onMove,
  children,
}: {
  ids: string[];
  onMove: (from: number, to: number) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(
    // A small distance, so clicking the handle without dragging does nothing.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    onMove(ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

/** One list item that can be dragged; `children` gets the drag handle to place in its toolbar. */
export function SortableItem({
  id,
  disabled,
  label,
  className,
  children,
}: {
  id: string;
  /** Not sortable (locked exam, or a case with no questions yet). */
  disabled: boolean;
  /** "question 3", "case 2": for the handle's name. */
  label: string;
  className: string;
  children: (handle: ReactNode) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const handle = disabled ? null : (
    <button
      type="button"
      {...attributes}
      {...listeners}
      aria-label={`Drag ${label} to reorder`}
      className="cursor-grab touch-none rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:outline-none active:cursor-grabbing"
    >
      <GripVertical aria-hidden="true" className="h-4 w-4" />
    </button>
  );
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cx(className, isDragging && "relative z-10 shadow-lg ring-2 ring-teal-500")}
    >
      {children(handle)}
    </li>
  );
}

/** "Move to…": type a position (1 to `count`) and move there in one step. */
export function MoveTo({
  position,
  count,
  label,
  disabled,
  onMove,
}: {
  /** 1-based. */
  position: number;
  count: number;
  label: string;
  disabled?: boolean;
  onMove: (to: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(position));
  const inputId = useId();
  const target = Number(value);
  const valid = Number.isInteger(target) && target >= 1 && target <= count && target !== position;

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setValue(String(position));
      }}
    >
      <Popover.Trigger asChild>
        <Button size="sm" variant="ghost" disabled={disabled || count < 2} aria-label={`Move ${label} to a position`}>
          Move to…
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 w-60 rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-lg"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!valid) return;
              onMove(target);
              setOpen(false);
            }}
            className="space-y-2"
          >
            <label htmlFor={inputId} className="block font-semibold text-slate-700">
              Move {label} to position
            </label>
            <div className="flex items-center gap-2">
              <input
                id={inputId}
                type="number"
                min={1}
                max={count}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 outline-none focus:ring-2 focus:ring-teal-500"
              />
              <span className="text-slate-600">of {count}</span>
              <Button size="sm" type="submit" disabled={!valid} className="ml-auto">
                Move
              </Button>
            </div>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
