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
};

/** Like Notes' folders: All, then each category with its count. Picking one filters the list. */
export function CategorySidebar({ tasks, categories, selected }: Props) {
  const [params] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const create = useCreateCategory();

  // One pass over the tasks, then a lookup per category: O(n + c), not O(n · c).
  const counts = new Map<string | null, number>();
  for (const task of tasks)
    counts.set(task.category_id, (counts.get(task.category_id) ?? 0) + 1);

  // Changes only ?category, so an open task or a view in the URL stays.
  const filterTo = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("category", id);
    else next.delete("category");
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
            to={filterTo(null)}
            aria-current={selected === null ? "page" : undefined}
          >
            <span>All</span> <span className="count">{tasks.length}</span>
          </Link>
        </li>
        {categories.map((category) => (
          <li key={category.id}>
            {editing ? (
              <EditRow category={category} />
            ) : (
              <Link
                to={filterTo(category.id)}
                aria-current={selected === category.id ? "page" : undefined}
              >
                <span>{category.name}</span>{" "}
                <span className="count">{counts.get(category.id) ?? 0}</span>
              </Link>
            )}
          </li>
        ))}
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
      {(rename.error ?? remove.error) && (
        <p role="alert">{(rename.error ?? remove.error)?.message}</p>
      )}
    </>
  );
}
