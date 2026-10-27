import { type FormEvent, useState } from "react";
import { hasStatus, type Task } from "../api.ts";
import {
  useAddSubtask,
  useCategories,
  useDeleteSubtask,
  useDeleteTask,
  useSetCategory,
  useToggleSubtask,
  useToggleTask,
  useUpdateTask,
} from "../queries.ts";
import { subtaskProgress } from "../tasks.ts";

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
  const categories = useCategories();
  const file = useSetCategory();
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
  // Like completed: the pending choice shows at once, wherever this editor reads its task from.
  const categoryId = file.isPending
    ? file.variables.category_id
    : task.category_id;
  const error = update.error ?? toggle.error ?? file.error ?? refreshError;

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
        <label>
          Category
          <select
            value={categoryId ?? ""}
            onChange={(event) =>
              file.mutate({
                id: task.id,
                category_id: event.target.value || null,
              })
            }
          >
            <option value="">None</option>
            {categories.data?.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
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
      <Checklist task={task} />
      <button type="button" className="danger" onClick={deleteTask}>
        Delete task
      </button>
    </div>
  );
}

function Checklist({ task }: { task: Task }) {
  const [title, setTitle] = useState("");
  const add = useAddSubtask();
  const tick = useToggleSubtask();
  const remove = useDeleteSubtask();
  const error = add.error ?? tick.error ?? remove.error;
  const progress = subtaskProgress(task);

  function submit(event: FormEvent) {
    event.preventDefault();
    add.mutate(
      { taskId: task.id, title: title.trim() },
      { onSuccess: () => setTitle("") },
    );
  }

  return (
    <section className="checklist" aria-label="Subtasks">
      <h3>Subtasks {progress && <span className="count">{progress}</span>}</h3>
      <ul>
        {task.subtasks.map((subtask) => (
          <li key={subtask.id}>
            <label className="check">
              <input
                type="checkbox"
                // The list cache already holds the change; on the full page, which reads its
                // own copy of the task, the pending value shows until the refetch lands.
                checked={
                  tick.isPending && tick.variables.subtaskId === subtask.id
                    ? tick.variables.completed
                    : subtask.completed
                }
                onChange={(event) =>
                  tick.mutate({
                    taskId: task.id,
                    subtaskId: subtask.id,
                    completed: event.target.checked,
                  })
                }
              />
              {subtask.title}
            </label>
            <button
              type="button"
              className="delete"
              aria-label={`Delete ${subtask.title}`}
              onClick={() =>
                remove.mutate({ taskId: task.id, subtaskId: subtask.id })
              }
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <form className="add" onSubmit={submit}>
        <input
          aria-label="Add subtask"
          placeholder="Add subtask"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={200}
        />
        <button type="submit" disabled={!title.trim() || add.isPending}>
          Add
        </button>
      </form>
      {error && <p role="alert">{error.message}</p>}
    </section>
  );
}
