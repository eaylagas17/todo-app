import { useId } from "react";
import type { Task } from "../api.ts";
import type { LinkInfo } from "../tasks.ts";
import { useLeaving } from "../useLeaving.ts";
import { TaskItem } from "./TaskItem.tsx";

type Props = {
  /** The list's accessible name: "Tasks", "Recently completed", "Completed". */
  label: string;
  tasks: Task[];
  links?: Map<string, LinkInfo>;
  leavingSoon?: ReadonlySet<string>;
  done?: boolean;
  /** Shown above the list, in a section that exists only while the list has rows. */
  heading?: string;
};

/** A plain list of rows (no dragging) whose rows close up and open instead of jumping. */
export function TaskRows({
  label,
  tasks,
  links,
  leavingSoon,
  done,
  heading,
}: Props) {
  const rows = useLeaving(tasks);
  const headingId = useId();
  const list = (
    <ul className="tasks" aria-label={label}>
      {rows.map(({ item, phase }) => (
        <TaskItem
          key={item.id}
          task={item}
          link={links?.get(item.id)}
          done={done}
          phase={phase === "steady" ? undefined : phase}
          leavingSoon={leavingSoon?.has(item.id)}
        />
      ))}
    </ul>
  );
  if (!heading) return list;
  // Counting closing rows too: the section stays until its last row has closed up (and handed
  // focus on), instead of vanishing with it.
  if (rows.length === 0) return null;
  return (
    <section className="recent" aria-labelledby={headingId}>
      <h2 id={headingId}>{heading}</h2>
      {list}
    </section>
  );
}
