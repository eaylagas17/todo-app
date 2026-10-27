import { useMemo, useState } from "react";
import type { Task } from "../api.ts";
import { useReorder } from "../queries.ts";
import { type LinkInfo, mergeOrder } from "../tasks.ts";
import { useLeaving } from "../useLeaving.ts";
import { useSnowballDrag } from "../useSnowballDrag.ts";
import { TaskItem } from "./TaskItem.tsx";

type Props = {
  tasks: Task[];
  /** The whole saved order, including completed tasks this list doesn't show. */
  allIds: string[];
  links: Map<string, LinkInfo>;
  leavingSoon: ReadonlySet<string>;
};

/** The list in its saved order, reordered by dragging a row's handle. */
export function SortableTaskList({ tasks, allIds, links, leavingSoon }: Props) {
  const reorder = useReorder();
  // While a drag (and its drop) is on screen, the rows it measured stay: a row leaving the list
  // mid-drag (its undo window ending) waits until after the drop, instead of shifting every row
  // under the pointer. The order and membership are held; each task's data stays live.
  const [held, setHeld] = useState<Task[] | null>(null);
  // Memoized: useLeaving compares lists by identity, so a new array every render would loop.
  const shown = useMemo(() => {
    if (!held) return tasks;
    const live = new Map(tasks.map((task) => [task.id, task]));
    return held.map((task) => live.get(task.id) ?? task);
  }, [held, tasks]);
  const rows = useLeaving(shown);
  const live = new Set(tasks.map((task) => task.id));
  const ids = shown.map((task) => task.id);
  // Announcements name tasks by their text: an id means nothing to a screen reader user.
  const titles = new Map(shown.map((task) => [task.id, task.title]));
  const drag = useSnowballDrag({
    ids,
    waitsFor: Object.fromEntries(
      shown.map((task) => [task.id, task.waits_for]),
    ),
    titleOf: (id) => titles.get(id) ?? "",
    // The whole list in its new order, exactly as the drag showed it, with the hidden completed
    // tasks kept in their slots.
    onDrop: (order) =>
      reorder.mutate({ ids: mergeOrder(allIds, order), previous: allIds }),
  });

  if (drag.active && !held) setHeld(tasks);
  if (!drag.active && held) setHeld(null);
  // The drop's new order is in once the tasks both lists share are in a different order.
  if (
    drag.dropped &&
    held &&
    sharedOrder(tasks, held) !== sharedOrder(held, tasks)
  )
    drag.release();

  return (
    <>
      <p id={drag.instructionsId} className="visually-hidden">
        To reorder, press space or enter, move with the arrow keys, then press
        space or enter to drop, or escape to cancel.
      </p>
      <p role="status" className="visually-hidden">
        {drag.announcement}
      </p>
      <ul
        className={drag.dragging ? "tasks dragging" : "tasks"}
        aria-label="Tasks"
      >
        {rows.map(({ item: task, phase }) => (
          <TaskItem
            key={task.id}
            task={task}
            link={links.get(task.id)}
            phase={phase === "steady" ? undefined : phase}
            leavingSoon={leavingSoon.has(task.id)}
            held={!live.has(task.id)}
            {...drag.rowProps(task.id)}
            handle={
              <button
                type="button"
                className="handle"
                aria-label={`Reorder ${task.title}`}
                {...drag.handleProps(task.id)}
              >
                ⠿
              </button>
            }
          />
        ))}
      </ul>
    </>
  );
}

/** The ids of `a` that are also in `b`, in a's order. */
function sharedOrder(a: Task[], b: Task[]) {
  const inB = new Set(b.map((task) => task.id));
  return a
    .filter((task) => inB.has(task.id))
    .map((task) => task.id)
    .join();
}
