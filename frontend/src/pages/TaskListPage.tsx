import { type FormEvent, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { CategorySidebar } from "../components/CategorySidebar.tsx";
import { SidePanel } from "../components/SidePanel.tsx";
import { SortableTaskList } from "../components/SortableTaskList.tsx";
import { TaskDetails } from "../components/TaskDetails.tsx";
import { TaskItem } from "../components/TaskItem.tsx";
import {
  useCategories,
  useCreateTask,
  useTaskChangeError,
  useTasks,
} from "../queries.ts";
import { allOf, inCategory, matchesSearch } from "../tasks.ts";

export function TaskListPage() {
  const tasks = useTasks();
  const create = useCreateTask();
  const changeError = useTaskChangeError();
  const [title, setTitle] = useState("");
  const [query, setQuery] = useState("");
  const [params, setParams] = useSearchParams();
  const openId = params.get("task");
  const open = tasks.data?.find((task) => task.id === openId);
  const categories = useCategories();
  const wanted = params.get("category");
  // A filter on a category that no longer exists falls back to All (Review Focus 4).
  const category = categories.data?.some((c) => c.id === wanted)
    ? wanted
    : null;

  // Replace, not push: after closing, the back button goes to the page before, not to the
  // panel again. Other params (a filter, a view) are kept.
  function closePanel() {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("task");
        return next;
      },
      { replace: true },
    );
  }

  function add(event: FormEvent) {
    event.preventDefault();
    create.mutate(title.trim(), { onSuccess: () => setTitle("") });
  }

  return (
    <div className={openId ? "layout split" : "layout"}>
      {/* Always rendered, even before the categories load: the grid's columns count on it. */}
      <CategorySidebar
        tasks={tasks.data ?? []}
        categories={categories.data ?? []}
        selected={category}
      />
      <main className="page">
        <h1>My tasks</h1>
        <form className="add" onSubmit={add}>
          <input
            aria-label="New task"
            placeholder="New task"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={200}
            required
          />
          <button type="submit" disabled={!title.trim() || create.isPending}>
            Add task
          </button>
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
        {tasks.isError && tasks.data && (
          <p role="alert">{tasks.error.message}</p>
        )}
        <TaskList query={query} category={category} tasks={tasks} />
      </main>
      {openId && tasks.data && (
        <SidePanel
          key={openId}
          title={open?.title ?? "Task not found"}
          onClose={closePanel}
        >
          {open && (
            <>
              <TaskDetails
                task={open}
                refreshError={null}
                onDeleted={closePanel}
              />
              <Link to={`/tasks/${open.id}`} className="open-page">
                Open as page
              </Link>
            </>
          )}
        </SidePanel>
      )}
    </div>
  );
}

function TaskList({
  query,
  category,
  tasks,
}: {
  query: string;
  category: string | null;
  tasks: ReturnType<typeof useTasks>;
}) {
  // Only a first load can fail with nothing to show. A failed refresh keeps the list on
  // screen; the page shows why above it.
  if (tasks.data === undefined) {
    if (!tasks.isError) {
      return (
        <p role="status" aria-busy="true">
          Loading your tasks…
        </p>
      );
    }
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
  const visible = tasks.data.filter(
    allOf(matchesSearch(query), inCategory(category)),
  );
  if (visible.length === 0) {
    if (query.trim()) return <p>No tasks match "{query.trim()}".</p>;
    return <p>No tasks in this category.</p>;
  }
  // Edge cases E28 and E46: positions only make sense in the full list, so no dragging while
  // searching or filtering by category.
  if (!query.trim() && !category) return <SortableTaskList tasks={visible} />;
  return (
    <ul className="tasks" aria-label="Tasks">
      {visible.map((task) => (
        <TaskItem key={task.id} task={task} />
      ))}
    </ul>
  );
}
