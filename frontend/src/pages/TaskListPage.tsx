import { type FormEvent, useState } from "react";
import { TaskItem } from "../components/TaskItem.tsx";
import { useCreateTask, useTaskChangeError, useTasks } from "../queries.ts";
import { matchesSearch } from "../tasks.ts";

export function TaskListPage() {
  const tasks = useTasks();
  const create = useCreateTask();
  const changeError = useTaskChangeError();
  const [description, setDescription] = useState("");
  const [query, setQuery] = useState("");

  function add(event: FormEvent) {
    event.preventDefault();
    create.mutate(description.trim(), { onSuccess: () => setDescription("") });
  }

  return (
    <main className="container">
      <h1>My tasks</h1>
      <form onSubmit={add}>
        <fieldset role="group">
          <input
            aria-label="New task"
            placeholder="New task"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={500}
            required
          />
          <button
            type="submit"
            disabled={!description.trim() || create.isPending}
          >
            Add task
          </button>
        </fieldset>
      </form>
      {create.error && <p role="alert">{create.error.message}</p>}
      <input
        type="search"
        aria-label="Search tasks"
        placeholder="Search tasks"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {changeError && <p role="alert">{changeError.message}</p>}
      <TaskList query={query} tasks={tasks} />
    </main>
  );
}

function TaskList({
  query,
  tasks,
}: {
  query: string;
  tasks: ReturnType<typeof useTasks>;
}) {
  if (tasks.isPending) {
    return (
      <p role="status" aria-busy="true">
        Loading your tasks…
      </p>
    );
  }
  if (tasks.isError) {
    return (
      <>
        <p role="alert">{tasks.error.message}</p>
        <button type="button" onClick={() => tasks.refetch()}>
          Try again
        </button>
      </>
    );
  }
  if (tasks.data.length === 0)
    return <p>No tasks yet. Add your first one above.</p>;
  // Derived, not stored: the visible list is recomputed from the cache and the query.
  const visible = tasks.data.filter(matchesSearch(query));
  if (visible.length === 0) return <p>No tasks match "{query.trim()}".</p>;
  return (
    <ul className="tasks" aria-label="Tasks">
      {visible.map((task) => (
        <TaskItem key={task.id} task={task} />
      ))}
    </ul>
  );
}
