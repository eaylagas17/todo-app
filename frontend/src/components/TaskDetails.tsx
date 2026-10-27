import { type FormEvent, useState } from "react";
import { hasStatus, type Task } from "../api.ts";
import { useDeleteTask, useToggleTask, useUpdateTask } from "../queries.ts";

type Props = {
  task: Task;
  refreshError: Error | null;
  onDeleted: () => void;
};

/** The task editor. One component, three containers: the side panel, the phone sheet, the page. */
export function TaskDetails({ task, refreshError, onDeleted }: Props) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const update = useUpdateTask();
  const toggle = useToggleTask();
  const remove = useDeleteTask();
  const trimmed = title.trim();
  // Only the fields that changed are sent, so a save can't overwrite an edit made elsewhere.
  const changes = {
    ...(trimmed !== task.title && { title: trimmed }),
    ...(description !== task.description && { description }),
  };
  const changed = Object.keys(changes).length > 0;
  // The optimistic toggle writes to the list cache; here the pending value is shown directly.
  const completed = toggle.isPending
    ? toggle.variables.completed
    : task.completed;
  const error = update.error ?? toggle.error ?? refreshError;

  if (hasStatus(update.error, 404) || hasStatus(toggle.error, 404))
    return <h2>Task not found</h2>;

  function save(event: FormEvent) {
    event.preventDefault();
    update.mutate({ id: task.id, changes });
  }

  function deleteTask() {
    if (!window.confirm("Delete this task?")) return;
    // Optimistic: the container closes at once; if the server refuses, the list restores the
    // task and explains why.
    remove.mutate(task.id);
    onDeleted();
  }

  return (
    <div className="details">
      <form onSubmit={save}>
        <label>
          Title
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={200}
            required
          />
        </label>
        <label>
          Description
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={2000}
            rows={4}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={completed}
            onChange={(event) =>
              toggle.mutate({ id: task.id, completed: event.target.checked })
            }
          />
          Done
        </label>
        {error && <p role="alert">{error.message}</p>}
        <div className="actions">
          <button
            type="submit"
            disabled={!changed || !trimmed || update.isPending}
            aria-busy={update.isPending}
          >
            Save
          </button>
          {update.isSuccess && !changed && <p role="status">Saved</p>}
        </div>
      </form>
      <button type="button" className="danger" onClick={deleteTask}>
        Delete task
      </button>
    </div>
  );
}
