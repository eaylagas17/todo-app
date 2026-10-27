import type { CSSProperties, ReactNode, Ref } from "react";
import { Link, useSearchParams } from "react-router";
import type { Task } from "../api.ts";
import { useDeleteTask, useToggleTask } from "../queries.ts";
import { subtaskProgress } from "../tasks.ts";

type Props = {
  task: Task;
  handle?: ReactNode;
  ref?: Ref<HTMLLIElement>;
  style?: CSSProperties;
};

export function TaskItem({ task, handle, ref, style }: Props) {
  const toggle = useToggleTask();
  const remove = useDeleteTask();
  const [params] = useSearchParams();
  // Opening a task changes only ?task, so a filter or a view in the URL stays as it is.
  const panel = new URLSearchParams(params);
  panel.set("task", task.id);
  const preview = task.description.split("\n")[0];
  const progress = subtaskProgress(task);
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
        to={{ search: panel.toString() }}
        className={task.completed ? "done" : undefined}
        aria-current={params.get("task") === task.id ? "true" : undefined}
      >
        <span className="title">{task.title}</span>
        {(preview || progress) && (
          <span className="sub">
            {preview && <span className="preview">{preview}</span>}
            {progress && <span className="progress">{progress}</span>}
          </span>
        )}
      </Link>
      <button
        type="button"
        className="delete"
        aria-label={`Delete ${task.title}`}
        onClick={() => remove.mutate(task.id)}
      >
        Delete
      </button>
    </li>
  );
}
