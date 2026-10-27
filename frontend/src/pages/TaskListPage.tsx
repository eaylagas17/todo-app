import { type FormEvent, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { CategorySidebar } from "../components/CategorySidebar.tsx";
import { SidePanel } from "../components/SidePanel.tsx";
import { SortableTaskList } from "../components/SortableTaskList.tsx";
import { TaskDetails } from "../components/TaskDetails.tsx";
import { TaskRows } from "../components/TaskRows.tsx";
import { GraphView } from "../graph/GraphView.tsx";
import { withTransition } from "../motion.ts";
import {
  useCategories,
  useCreateTask,
  useTaskChangeError,
  useTasks,
} from "../queries.ts";
import {
  allOf,
  inCategory,
  inMainList,
  linkInfo,
  matchesSearch,
  newestDone,
  RECENT_LIMIT,
} from "../tasks.ts";
import { LingerProvider, useLinger } from "../useLinger.tsx";

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
  // The Completed page (spec §5.7) is this page in another mode, so the panel and search work
  // the same: /tasks?list=completed.
  const showingCompleted = params.get("list") === "completed";

  const view = params.get("view") === "graph" ? "graph" : "list";

  // Accent A: the switch runs inside a View Transition, so each task morphs from its row
  // to its node and back. A push, so the back button returns to the other view.
  function showView(next: "list" | "graph") {
    withTransition(() =>
      setParams((current) => {
        const updated = new URLSearchParams(current);
        if (next === "graph") updated.set("view", "graph");
        else updated.delete("view");
        return updated;
      }),
    );
  }

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
    // The undo windows are shared by the list's rows and the panel's Done box.
    <LingerProvider>
      <div className={openId ? "layout split" : "layout"}>
        {/* Always rendered, even before the categories load: the grid's columns count on it. */}
        <CategorySidebar
          tasks={tasks.data ?? []}
          categories={categories.data ?? []}
          selected={category}
          showingCompleted={showingCompleted}
        />
        <main className="page">
          <h1>{showingCompleted ? "Completed" : "My tasks"}</h1>
          {!showingCompleted && (
            <form className="add" onSubmit={add}>
              <input
                aria-label="New task"
                placeholder="New task"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={200}
                required
              />
              <button
                type="submit"
                disabled={!title.trim() || create.isPending}
              >
                Add task
              </button>
            </form>
          )}
          {create.error && <p role="alert">{create.error.message}</p>}
          <input
            type="search"
            aria-label="Search tasks"
            placeholder="Search tasks"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {!showingCompleted && (
            <div className="views" role="group" aria-label="View">
              <button
                type="button"
                className="secondary"
                aria-pressed={view === "list"}
                onClick={() => showView("list")}
              >
                List
              </button>
              <button
                type="button"
                className="secondary"
                aria-pressed={view === "graph"}
                onClick={() => showView("graph")}
              >
                Graph
              </button>
            </div>
          )}
          {changeError && <p role="alert">{changeError.message}</p>}
          {tasks.isError && tasks.data && (
            <p role="alert">{tasks.error.message}</p>
          )}
          <TaskList
            query={query}
            category={category}
            view={view}
            tasks={tasks}
            completedPage={showingCompleted}
          />
        </main>
        {openId && tasks.data && (
          <SidePanel
            title={open?.title ?? "Task not found"}
            taskId={openId}
            onClose={closePanel}
          >
            {open && (
              <>
                {/* Keyed by task: switching tasks starts its editor afresh. */}
                <TaskDetails
                  key={open.id}
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
    </LingerProvider>
  );
}

function TaskList({
  query,
  category,
  view,
  tasks,
  completedPage,
}: {
  query: string;
  category: string | null;
  view: "list" | "graph";
  tasks: ReturnType<typeof useTasks>;
  completedPage: boolean;
}) {
  const { lingering } = useLinger();
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
  const all = tasks.data;
  if (completedPage) {
    // Every completed task, newest first, including ones still greyed in an unfinished chain.
    const done = newestDone(all.filter(matchesSearch(query)));
    return (
      <>
        <TaskRows label="Completed" tasks={done} done />
        {done.length === 0 && (
          <p>
            {query.trim()
              ? `No tasks match "${query.trim()}".`
              : "No completed tasks yet."}
          </p>
        )}
      </>
    );
  }
  if (all.length === 0) return <p>No tasks yet. Add your first one above.</p>;
  // Derived, not stored: the main list, the visible part and Recently completed are all
  // recomputed from the cache, the undo windows and the query (spec §5.7).
  const main = inMainList(all, lingering);
  const inMain = new Set(main.map((task) => task.id));
  const filter = allOf(matchesSearch(query), inCategory(category));
  const visible = main.filter(filter);
  // A lingering task that leaves when its window ends gets the draining bar; one whose chain is
  // still unfinished stays anyway, so it gets none.
  const settled = new Set(inMainList(all, new Set()).map((task) => task.id));
  const leavingSoon = new Set(
    [...lingering].filter((id) => inMain.has(id) && !settled.has(id)),
  );
  const recent = newestDone(
    all.filter((task) => !inMain.has(task.id)).filter(filter),
  ).slice(0, RECENT_LIMIT);
  // From the main list, not the visible part: a step counts every task before it, and colours
  // rank the chains in the main list.
  const links = linkInfo(main);
  const filtered = Boolean(query.trim() || category);

  let empty: string | null = null;
  if (visible.length === 0)
    empty = query.trim()
      ? `No tasks match "${query.trim()}".`
      : category
        ? "No tasks in this category."
        : "All done.";
  return (
    <>
      {view === "graph" ? (
        // The graph draws what the list would show, so search and the category filter apply.
        <GraphView tasks={visible} all={main} />
      ) : // Edge cases E28 and E46: positions only make sense in the full list, so no dragging
      // while searching or filtering by category. The list stays mounted when empty, so its
      // last row can still close up.
      filtered ? (
        <TaskRows
          label="Tasks"
          tasks={visible}
          links={links}
          leavingSoon={leavingSoon}
        />
      ) : (
        <SortableTaskList
          tasks={visible}
          allIds={all.map((task) => task.id)}
          links={links}
          leavingSoon={leavingSoon}
        />
      )}
      {empty && <p>{empty}</p>}
      {recent.length > 0 && (
        <section className="recent" aria-labelledby="recent-heading">
          <h2 id="recent-heading">Recently completed</h2>
          <TaskRows label="Recently completed" tasks={recent} done />
        </section>
      )}
    </>
  );
}
