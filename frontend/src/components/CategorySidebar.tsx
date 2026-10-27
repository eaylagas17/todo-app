import { type FormEvent, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { Category, Task } from "../api.ts";
import {
  useCreateCategory,
  useDeleteCategory,
  useRenameCategory,
} from "../queries.ts";

type Props = {
  tasks: Task[];
  categories: Category[];
  selected: string | null;
  /** The Completed page is showing. */
  showingCompleted: boolean;
};

/**
 * Like Notes' folders: All, then each category with its count of open tasks; picking one filters
 * the list. Below them, Completed, with its count, opens every completed task.
 */
export function CategorySidebar({
  tasks,
  categories,
  selected,
  showingCompleted,
}: Props) {
  const [params] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const create = useCreateCategory();

  // Open tasks only: a completed task counts under Completed.
  const counts = new Map<string | null, number>();
  let openCount = 0;
  let doneCount = 0;
  for (const task of tasks)
    if (task.completed) doneCount++;
    else {
      openCount++;
      counts.set(task.category_id, (counts.get(task.category_id) ?? 0) + 1);
    }

  // One selection at a time (All, a category, or Completed); an open task or a view stays.
  const to = (key?: "category" | "list", value = "") => {
    const next = new URLSearchParams(params);
    next.delete("category");
    next.delete("list");
    if (key) next.set(key, value);
    return { search: next.toString() };
  };

  function add(event: FormEvent) {
    event.preventDefault();
    create.mutate(name.trim(), { onSuccess: () => setName("") });
  }

  return (
    <nav
      aria-label="Categories"
      className={open ? "categories open" : "categories"}
    >
      <button
        type="button"
        className="secondary toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Categories
      </button>
      <ul>
        <li>
          <Link
            to={to()}
            aria-current={
              selected === null && !showingCompleted ? "page" : undefined
            }
          >
            <span>All</span> <span className="count">{openCount}</span>
          </Link>
        </li>
        {categories.map((category) => (
          <li key={category.id}>
            {editing ? (
              <EditRow category={category} />
            ) : (
              <Link
                to={to("category", category.id)}
                aria-current={selected === category.id ? "page" : undefined}
              >
                <span>{category.name}</span>{" "}
                <span className="count">{counts.get(category.id) ?? 0}</span>
              </Link>
            )}
          </li>
        ))}
        <li className="completed-entry">
          <Link
            to={to("list", "completed")}
            aria-current={showingCompleted ? "page" : undefined}
          >
            <span>Completed</span> <span className="count">{doneCount}</span>
          </Link>
        </li>
      </ul>
      {!editing && (
        <form className="add" onSubmit={add}>
          <input
            aria-label="New category"
            placeholder="+ New category"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={40}
          />
        </form>
      )}
      {create.error && <p role="alert">{create.error.message}</p>}
      <button
        type="button"
        className="plain"
        onClick={() => setEditing(!editing)}
      >
        {editing ? "Done" : "Edit categories"}
      </button>
    </nav>
  );
}

function EditRow({ category }: { category: Category }) {
  const [name, setName] = useState(category.name);
  const rename = useRenameCategory();
  const remove = useDeleteCategory();
  const error = rename.error ?? remove.error;
  const trimmed = name.trim();

  function save(event: FormEvent) {
    event.preventDefault();
    if (trimmed && trimmed !== category.name)
      rename.mutate({ id: category.id, name: trimmed });
  }

  function deleteCategory() {
    const question = `Delete "${category.name}"? Its tasks stay, without a category.`;
    if (window.confirm(question)) remove.mutate(category.id);
  }

  return (
    <>
      <form className="edit-row" onSubmit={save}>
        <input
          aria-label={`Rename ${category.name}`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={40}
        />
        <button
          type="button"
          className="danger"
          aria-label={`Delete ${category.name}`}
          onClick={deleteCategory}
        >
          Delete
        </button>
      </form>
      {error && <p role="alert">{error.message}</p>}
    </>
  );
}
