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
import { useReorder } from "../queries.ts";
import { type LinkInfo, moveWithLinks } from "../tasks.ts";
import { TaskItem } from "./TaskItem.tsx";

type Props = { tasks: Task[]; links: Map<string, LinkInfo> };

export function SortableTaskList({ tasks, links }: Props) {
  const reorder = useReorder();
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

  // The drop becomes the whole new order, with linked tasks pulled or pushed along.
  function drop({ active, over }: DragEndEvent) {
    const order =
      over && moveWithLinks(tasks, String(active.id), String(over.id));
    if (order) reorder.mutate(order);
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
            <SortableRow key={task.id} task={task} link={links.get(task.id)} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({ task, link }: { task: Task; link?: LinkInfo }) {
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
      link={link}
      ref={setNodeRef}
      style={{ transform: offset, transition }}
      handle={
        <button
          type="button"
          className="handle"
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
