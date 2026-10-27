import { type CSSProperties, type ReactNode, type Ref, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { Task } from "../api.ts";
import {
  useCategories,
  useDeleteTask,
  useLink,
  useToggleTask,
} from "../queries.ts";
import { type LinkInfo, subtaskProgress } from "../tasks.ts";
import { useLinkDrag } from "../useLinkDrag.ts";

type Props = {
  task: Task;
  link?: LinkInfo;
  handle?: ReactNode;
  ref?: Ref<HTMLLIElement>;
  style?: CSSProperties;
  /** While dragging: the row being dragged, or one travelling with it. */
  lift?: "lifted" | "swept";
};

export function TaskItem({ task, link, handle, ref, style, lift }: Props) {
  const toggle = useToggleTask();
  const remove = useDeleteTask();
  const linkTo = useLink();
  const { dotProps } = useLinkDrag((fromId, toId) =>
    linkTo.mutate({ taskId: fromId, dependsOnId: toId }),
  );
  // Accent C: one pulse when the task turns from waiting to ready, never on first render.
  const waiting = link?.waiting ?? false;
  const [wasWaiting, setWasWaiting] = useState(waiting);
  const [pulse, setPulse] = useState(false);
  if (waiting !== wasWaiting) {
    setWasWaiting(waiting);
    setPulse(wasWaiting && !waiting);
  }
  const [params] = useSearchParams();
  // Opening a task changes only ?task, so a filter or a view in the URL stays as it is.
  const panel = new URLSearchParams(params);
  panel.set("task", task.id);
  const preview = link?.waitsFor.length
    ? `Waits for: ${link.waitsFor.join(", ")}`
    : task.description.split("\n")[0];
  const progress = subtaskProgress(task);
  const category = useCategories().data?.find((c) => c.id === task.category_id);
  return (
    <li
      className={lift ? `task ${lift}` : "task"}
      ref={ref}
      data-task-id={task.id}
      style={
        {
          ...style,
          // Accent B: the browser matches each row before and after a reorder by this name.
          viewTransitionName: `task-${task.id}`,
          "--hue": link?.hue,
        } as CSSProperties
      }
    >
      {handle}
      {link ? (
        <span
          role="img"
          aria-label={`Step ${link.step}, ${waiting ? "waiting" : "ready"}`}
          className={pulse ? "step pulse" : "step"}
          onAnimationEnd={() => setPulse(false)}
        >
          {link.step}
        </span>
      ) : (
        <span className="step" />
      )}
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
        {(preview || progress || link) && (
          <span className="sub">
            {link && <span className="chain" aria-hidden="true" />}
            {preview && <span className="preview">{preview}</span>}
            {progress && <span className="progress">{progress}</span>}
          </span>
        )}
        {category && <span className="category">{category.name}</span>}
      </Link>
      <button
        type="button"
        className="dot"
        aria-label={`Link ${task.title} to another task`}
        {...dotProps(task.id)}
      />
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
