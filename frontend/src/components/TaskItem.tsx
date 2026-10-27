import { type CSSProperties, type ReactNode, type Ref, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { Task } from "../api.ts";
import {
  useCategories,
  useDeleteTask,
  useLink,
  useToggleTask,
} from "../queries.ts";
import { formatDay, type LinkInfo, subtaskProgress } from "../tasks.ts";
import { useLinger } from "../useLinger.tsx";
import { useLinkDrag } from "../useLinkDrag.tsx";

type Props = {
  task: Task;
  link?: LinkInfo;
  handle?: ReactNode;
  ref?: Ref<HTMLLIElement>;
  style?: CSSProperties;
  /** While dragging: the row being dragged, or one travelling with it. */
  lift?: "lifted" | "swept";
  /** A row in a completed list: when it was done and added, instead of the preview. */
  done?: boolean;
  /** Opening into its list, or closing up on its way out. */
  phase?: "steady" | "entering" | "leaving";
  /** Ticked, and leaves the list when its 5-second window ends: show the draining bar. */
  leavingSoon?: boolean;
  /** Kept on screen by a drag after it left the list (it may already show elsewhere). */
  held?: boolean;
};

export function TaskItem({
  task,
  link,
  handle,
  ref,
  style,
  lift,
  done = false,
  phase,
  leavingSoon = false,
  held = false,
}: Props) {
  const toggle = useToggleTask();
  const linger = useLinger();
  const remove = useDeleteTask();
  const linkTo = useLink();
  const { dotProps, arrow } = useLinkDrag((fromId, toId) =>
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
  const preview = done
    ? `Done ${task.completed_at ? formatDay(task.completed_at) : ""} · added ${formatDay(task.created_at, undefined, undefined, false)}`
    : link?.waitsFor.length
      ? `Waits for: ${link.waitsFor.join(", ")}`
      : task.description.split("\n")[0];
  const leaving = phase === "leaving";
  const progress = subtaskProgress(task);
  const category = useCategories().data?.find((c) => c.id === task.category_id);
  return (
    <li
      className={[
        "task",
        lift,
        leaving && "closing",
        phase === "entering" && "opening",
      ]
        .filter(Boolean)
        .join(" ")}
      ref={ref}
      data-task-id={task.id}
      // A closing row is on its way out: not read, not clickable, not focusable.
      aria-hidden={leaving || undefined}
      inert={leaving}
      style={
        {
          ...style,
          // Accent B: the browser matches each row before and after a reorder by this name.
          // Not on a closing or held row: the same task may already be in Recently completed,
          // and two elements with one name would cancel the transition.
          viewTransitionName: leaving || held ? undefined : `task-${task.id}`,
          "--hue": link?.hue,
        } as CSSProperties
      }
    >
      {/* No handle while searching or filtering: an empty space as wide as one keeps the row's
          steps and circles where they were. Completed rows have no handle column at all. */}
      {handle ??
        (!done && <span className="handle-space" aria-hidden="true" />)}
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
        // A blank step keeps open rows aligned; completed rows have no steps, so no gap.
        !done && <span className="step" />
      )}
      <label className="tap">
        <input
          type="checkbox"
          aria-label={`Complete ${task.title}`}
          checked={task.completed}
          onChange={(event) => {
            const completed = event.target.checked;
            toggle.mutate({ id: task.id, completed });
            // Ticking opens its 5-second undo window; unticking closes it.
            if (completed) linger.start(task.id);
            else linger.stop(task.id);
          }}
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
            {preview && <span>{preview}</span>}
            {progress && <span>{progress}</span>}
          </span>
        )}
        {category && <span className="category">{category.name}</span>}
      </Link>
      {/* A completed row is for unticking and opening; linking and deleting live in the panel. */}
      {!done && (
        <>
          <button
            type="button"
            className="dot"
            aria-label={`Link ${task.title} to another task`}
            {...dotProps(task.id)}
          />
          {arrow}
          <button
            type="button"
            className="delete"
            aria-label={`Delete ${task.title}`}
            onClick={() => remove.mutate(task.id)}
          >
            Delete
          </button>
        </>
      )}
      {leavingSoon && <span className="undo-bar" aria-hidden="true" />}
    </li>
  );
}
