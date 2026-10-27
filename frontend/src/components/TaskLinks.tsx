import type { Task } from "../api.ts";
import { useLink, useTasks, useUnlink } from "../queries.ts";

/** "Waits for" and "Needed by" for one task: the keyboard and phone way to link (spec §8.1). */
export function TaskLinks({ task }: { task: Task }) {
  const tasks = useTasks();
  const link = useLink();
  const unlink = useUnlink();
  const all = tasks.data ?? [];
  // The list is the fresher copy: a link's answer updates it at once.
  const current = all.find((t) => t.id === task.id) ?? task;
  const waitsFor = all.filter((t) => current.waits_for.includes(t.id));
  const neededBy = all.filter((t) => t.waits_for.includes(task.id));
  const others = all.filter((t) => t.id !== task.id);
  const error = link.error ?? unlink.error;

  return (
    <section className="links" aria-label="Links">
      <h3>Waits for</h3>
      <ul>
        {waitsFor.map((t) => (
          <li key={t.id}>
            <span>{t.title}</span>
            <button
              type="button"
              className="delete"
              aria-label={`Stop waiting for ${t.title}`}
              onClick={() =>
                unlink.mutate({ taskId: task.id, dependsOnId: t.id })
              }
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <select
        aria-label="Add a task it waits for"
        value=""
        onChange={(event) =>
          link.mutate({ taskId: task.id, dependsOnId: event.target.value })
        }
      >
        <option value="">+ Add</option>
        {others
          .filter((t) => !current.waits_for.includes(t.id))
          .map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
      </select>
      <h3>Needed by</h3>
      <ul>
        {neededBy.map((t) => (
          <li key={t.id}>
            <span>{t.title}</span>
            <button
              type="button"
              className="delete"
              aria-label={`${t.title} stops waiting for this`}
              onClick={() =>
                unlink.mutate({ taskId: t.id, dependsOnId: task.id })
              }
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <select
        aria-label="Add a task that waits for this"
        value=""
        onChange={(event) =>
          link.mutate({ taskId: event.target.value, dependsOnId: task.id })
        }
      >
        <option value="">+ Add</option>
        {others
          .filter((t) => !t.waits_for.includes(task.id))
          .map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
      </select>
      {error && <p role="alert">{error.message}</p>}
    </section>
  );
}
