import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { Task } from "../api.ts";
import { useMoveTask } from "../queries.ts";
import { moveTask } from "../tasks.ts";
import { TaskItem } from "./TaskItem.tsx";

export function SortableTaskList({ tasks }: { tasks: Task[] }) {
  const move = useMoveTask();
  const sensors = useSensors(
    // A 5px movement before a drag starts, so a click or a tap on the handle stays a click.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  // Announcements name tasks by their text: an id means nothing to a screen reader user.
  const name = (id: UniqueIdentifier) =>
    tasks.find((task) => task.id === id)?.title;

  function drop({ active, over }: DragEndEvent) {
    const change = over && moveTask(tasks, String(active.id), String(over.id));
    if (change) move.mutate(change);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={drop}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) => `Picked up ${name(active.id)}.`,
          onDragOver: ({ active, over }) =>
            over && over.id !== active.id
              ? `${name(active.id)} is over ${name(over.id)}.`
              : undefined,
          onDragEnd: ({ active, over }) =>
            over && over.id !== active.id
              ? `${name(active.id)} was moved.`
              : `Moving ${name(active.id)} was cancelled.`,
          onDragCancel: ({ active }) =>
            `Moving ${name(active.id)} was cancelled.`,
        },
      }}
    >
      <SortableContext items={tasks} strategy={verticalListSortingStrategy}>
        <ul className="tasks" aria-label="Tasks">
          {tasks.map((task) => (
            <SortableRow key={task.id} task={task} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({ task }: { task: Task }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
  } = useSortable({ id: task.id });
  // Whole pixels, as dnd-kit's own CSS.Translate helper does, so text stays sharp mid-drag.
  const offset = transform
    ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)`
    : undefined;
  return (
    <TaskItem
      task={task}
      ref={setNodeRef}
      style={{ transform: offset, transition }}
      handle={
        <button
          type="button"
          className="handle secondary outline"
          aria-label={`Reorder ${task.title}`}
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
        >
          ⠿
        </button>
      }
    />
  );
}
