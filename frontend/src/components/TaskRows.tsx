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
};

/** A plain list of rows (no dragging) whose rows close up and open instead of jumping. */
export function TaskRows({ label, tasks, links, leavingSoon, done }: Props) {
  const rows = useLeaving(tasks);
  return (
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
}
