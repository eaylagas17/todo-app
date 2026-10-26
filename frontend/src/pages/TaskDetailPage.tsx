import { type FormEvent, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ApiError, type Task } from "../api.ts";
import {
  useDeleteTask,
  useTask,
  useToggleTask,
  useUpdateTask,
} from "../queries.ts";

const isNotFound = (error: unknown) =>
  error instanceof ApiError && error.status === 404;

// Loading by id can only fail validation on the id itself: a garbled link is a missing task.
const isBadId = (error: unknown) =>
  error instanceof ApiError && error.status === 400;

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
  if (isNotFound(task.error) || isBadId(task.error)) return <NotFound />;
  if (task.isPending) {
    return (
      <main className="container">
        <p role="status" aria-busy="true">
          Loading the task…
        </p>
      </main>
    );
  }
  if (task.isError) {
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
  return <TaskForm key={task.data.id} task={task.data} />;
}

function TaskForm({ task }: { task: Task }) {
  const [description, setDescription] = useState(task.description);
  const update = useUpdateTask();
  const toggle = useToggleTask();
  const remove = useDeleteTask();
  const navigate = useNavigate();
  const trimmed = description.trim();
  const changed = trimmed !== task.description;
  // The optimistic toggle writes to the list cache; here the pending value is shown directly.
  const completed = toggle.isPending
    ? toggle.variables.completed
    : task.completed;

  if (isNotFound(update.error) || isNotFound(toggle.error)) return <NotFound />;

  function save(event: FormEvent) {
    event.preventDefault();
    update.mutate({ id: task.id, description: trimmed });
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
          Description
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={500}
            rows={3}
            required
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
        {(update.error ?? toggle.error) && (
          <p role="alert">{(update.error ?? toggle.error)?.message}</p>
        )}
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
