import { Link, useNavigate, useParams } from "react-router";
import { hasStatus } from "../api.ts";
import { TaskDetails } from "../components/TaskDetails.tsx";
import { useTask } from "../queries.ts";

const BackLink = () => (
  <Link to="/tasks" className="back">
    Back to my tasks
  </Link>
);

export function TaskDetailPage() {
  const { id = "" } = useParams();
  const task = useTask(id);
  const navigate = useNavigate();
  // Loading by id can only fail validation on the id itself: a garbled link is a missing task.
  if (hasStatus(task.error, 404, 400))
    return (
      <main className="page narrow">
        <h1>Task not found</h1>
        <BackLink />
      </main>
    );
  if (task.data === undefined) {
    if (!task.isError) {
      return (
        <main className="page narrow">
          <p role="status" aria-busy="true">
            Loading the task…
          </p>
        </main>
      );
    }
    return (
      <main className="page narrow">
        <p role="alert">{task.error.message}</p>
        <button type="button" onClick={() => task.refetch()}>
          Try again
        </button>
      </main>
    );
  }
  return (
    <main className="page narrow">
      <BackLink />
      <h1>Task details</h1>
      {/* Keyed by id: opening another task starts a fresh form instead of keeping this one's
          draft. A failed refresh keeps the form, and the draft in it, on screen. */}
      <TaskDetails
        key={task.data.id}
        task={task.data}
        refreshError={task.isError ? task.error : null}
        onDeleted={() => navigate("/tasks", { replace: true })}
      />
    </main>
  );
}
