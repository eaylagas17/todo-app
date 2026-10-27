import { type FormEvent, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ApiError, type Task } from "../api.ts";
import {
  useDeleteTask,
  useTask,
  useToggleTask,
  useUpdateTask,
} from "../queries.ts";

const hasStatus = (error: unknown, ...statuses: number[]) =>
  error instanceof ApiError && statuses.includes(error.status);

const BackLink = () => (
  <Link to="/tasks" className="back">
    Back to my tasks
  </Link>
);

function NotFound() {
  return (
    <main className="container">
      <h1>Task not found</h1>
      <BackLink />
    </main>
  );
}

export function TaskDetailPage() {
  const { id = "" } = useParams();
  const task = useTask(id);
  // Loading by id can only fail validation on the id itself: a garbled link is a missing task.
  if (hasStatus(task.error, 404, 400)) return <NotFound />;
  if (task.data === undefined) {
    if (!task.isError) {
      return (
        <main className="container">
          <p role="status" aria-busy="true">
            Loading the task…
          </p>
        </main>
      );
    }
    return (
      <main className="container">
        <p role="alert">{task.error.message}</p>
        <button type="button" onClick={() => task.refetch()}>
          Try again
        </button>
      </main>
    );
  }
  // Keyed by id: opening another task starts a fresh form instead of keeping this one's draft.
  // A failed refresh keeps the form, and the draft in it, on screen.
  return (
    <TaskForm
      key={task.data.id}
      task={task.data}
      refreshError={task.isError ? task.error : null}
    />
  );
}

function TaskForm({
  task,
  refreshError,
}: {
  task: Task;
  refreshError: Error | null;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const update = useUpdateTask();
  const toggle = useToggleTask();
  const remove = useDeleteTask();
  const navigate = useNavigate();
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
    return <NotFound />;

  function save(event: FormEvent) {
    event.preventDefault();
    update.mutate({ id: task.id, changes });
  }

  function deleteTask() {
    if (!window.confirm("Delete this task?")) return;
    // Optimistic: back to the list at once; if the server refuses, the list restores the task
    // and explains why.
    remove.mutate(task.id);
    navigate("/tasks", { replace: true });
  }

  return (
    <main className="container narrow">
      <BackLink />
      <h1>Task details</h1>
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
        <button
          type="submit"
          disabled={!changed || !trimmed || update.isPending}
          aria-busy={update.isPending}
        >
          Save
        </button>
        {update.isSuccess && !changed && <p role="status">Saved</p>}
      </form>
      <button type="button" className="secondary outline" onClick={deleteTask}>
        Delete task
      </button>
    </main>
  );
}
