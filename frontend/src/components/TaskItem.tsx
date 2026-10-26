import type { ReactNode } from "react";
import { Link } from "react-router";
import type { Task } from "../api.ts";
import { useDeleteTask, useToggleTask } from "../queries.ts";

export function TaskItem({ task, handle }: { task: Task; handle?: ReactNode }) {
  const toggle = useToggleTask();
  const remove = useDeleteTask();
  return (
    <li className="task">
      {handle}
      <label className="tap">
        <input
          type="checkbox"
          aria-label={`Complete ${task.description}`}
          checked={task.completed}
          onChange={(event) =>
            toggle.mutate({ id: task.id, completed: event.target.checked })
          }
        />
      </label>
      <Link
        to={`/tasks/${task.id}`}
        className={task.completed ? "done" : undefined}
      >
        {task.description}
      </Link>
      <button
        type="button"
        className="secondary outline"
        aria-label={`Delete ${task.description}`}
        onClick={() => remove.mutate(task.id)}
      >
        Delete
      </button>
    </li>
  );
}
