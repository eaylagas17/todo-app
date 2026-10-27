import type { Task } from "../api.ts";
import { useReorder } from "../queries.ts";
import { type LinkInfo, waitsForMap } from "../tasks.ts";
import { useSnowballDrag } from "../useSnowballDrag.ts";
import { TaskItem } from "./TaskItem.tsx";

type Props = { tasks: Task[]; links: Map<string, LinkInfo> };

/** The list in its saved order, reordered by dragging a row's handle (spec §5.1, §5.2). */
export function SortableTaskList({ tasks, links }: Props) {
  const reorder = useReorder();
  const ids = tasks.map((task) => task.id);
  // Announcements name tasks by their text: an id means nothing to a screen reader user.
  const titles = new Map(tasks.map((task) => [task.id, task.title]));
  const drag = useSnowballDrag({
    ids,
    waitsFor: waitsForMap(tasks),
    titleOf: (id) => titles.get(id) ?? "",
    // The whole list in its new order, exactly as the drag showed it.
    onDrop: (order) => reorder.mutate({ ids: order, previous: ids }),
  });

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
        {tasks.map((task) => (
          <TaskItem
            key={task.id}
            task={task}
            link={links.get(task.id)}
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
