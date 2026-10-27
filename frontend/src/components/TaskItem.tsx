import type { CSSProperties, ReactNode, Ref } from "react";
import { Link } from "react-router";
import type { Task } from "../api.ts";
import { useDeleteTask, useToggleTask } from "../queries.ts";

type Props = {
  task: Task;
  handle?: ReactNode;
  ref?: Ref<HTMLLIElement>;
  style?: CSSProperties;
};

export function TaskItem({ task, handle, ref, style }: Props) {
  const toggle = useToggleTask();
  const remove = useDeleteTask();
  return (
    <li className="task" ref={ref} style={style}>
      {handle}
      <label className="tap">
        <input
          type="checkbox"
          aria-label={`Complete ${task.title}`}
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
        <span className="title">{task.title}</span>
        {task.description && (
          <span className="sub">{task.description.split("\n")[0]}</span>
        )}
      </Link>
      <button
        type="button"
        className="secondary outline"
        aria-label={`Delete ${task.title}`}
        onClick={() => remove.mutate(task.id)}
      >
        Delete
      </button>
    </li>
  );
}
