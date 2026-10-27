import { useId } from "react";
import { Link, useNavigate } from "react-router";
import { useLoadExample } from "../queries.ts";

type Feature = { title: string; what: string; how: string; to: string };

/** One card per feature (spec §12): what it does, how to try it, and a way there. */
export const FEATURES: Feature[] = [
  {
    title: "Linked tasks",
    what: "Say one task waits for another. Linked tasks share a colour and show their step: 1, 2, 3. An arrow follows your finger while you link.",
    how: "Drag the dot on a task's right edge onto the task it waits for, or use “Waits for” in its panel.",
    to: "/tasks",
  },
  {
    title: "The chain pull",
    what: "A task never sits above what it waits for: drag one, and the linked tasks it reaches join it and travel along, like a snowball.",
    how: "With the example loaded, drag “Book the venue” down to the bottom.",
    to: "/tasks",
  },
  {
    title: "The graph view",
    what: "The same tasks as steps from left to right, with links as arrows and subtasks as branches.",
    how: "Pan by dragging; zoom with the buttons, ⌘ or Ctrl + scroll, or a pinch.",
    to: "/tasks?view=graph",
  },
  {
    title: "Subtasks",
    what: "A checklist inside any task; the list shows how many are done, like “1 of 3”.",
    how: "Open a task and add a few under Subtasks.",
    to: "/tasks",
  },
  {
    title: "AI categories",
    what: "New tasks are filed by TypeSafe's Jev classifier, only when it's confident. Limits: 10 a minute and 100 a day per person, and a monthly budget.",
    how: "Add “Pay the electricity bill” and watch it land in Finance (the server needs a TypeSafe key).",
    to: "/tasks",
  },
  {
    title: "Search",
    what: "Finds tasks by title or description, ignoring case and accents.",
    how: "Type “cafe” to find “Café”.",
    to: "/tasks",
  },
  {
    title: "Drag to reorder",
    what: "Drag a task's handle, or use the keyboard: Space, the arrow keys, Space.",
    how: "Dragging pauses while you search or filter: positions only make sense in the full list.",
    to: "/tasks",
  },
  {
    title: "Completed tasks",
    what: "Ticked tasks wait five seconds so you can undo, then move to Recently completed. Everything done lives under Completed.",
    how: "Tick a task and watch the bar, then untick it from Recently completed or Completed.",
    to: "/tasks?list=completed",
  },
  {
    title: "Side panel and full page",
    what: "A task opens beside the list (a sheet on a phone), or on its own page.",
    how: "Click a task, then “Open as page”.",
    to: "/tasks",
  },
  {
    title: "Status page",
    what: "The running system: its version, which copy answered, the database and the AI budget.",
    how: "It refreshes every 5 seconds; on the cloud, watch the copy change.",
    to: "/status",
  },
  {
    title: "Offline and error handling",
    what: "Changes show at once and roll back with a clear message if the server says no.",
    how: "Turn off your network and tick a task.",
    to: "/tasks",
  },
];

export function FeaturesPage() {
  const load = useLoadExample();
  const navigate = useNavigate();
  return (
    <main className="page">
      <h1>Features</h1>
      <p>
        Every extra, and how to try it. The example tasks are a small wedding
        plan with links, subtasks and categories.
      </p>
      <button
        type="button"
        disabled={load.isPending}
        onClick={() =>
          load.mutate(undefined, { onSuccess: () => navigate("/tasks") })
        }
      >
        Load example tasks
      </button>
      {load.error && <p role="alert">{load.error.message}</p>}
      <div className="features">
        {FEATURES.map((feature) => (
          <FeatureCard key={feature.title} feature={feature} />
        ))}
      </div>
    </main>
  );
}

function FeatureCard({ feature }: { feature: Feature }) {
  const heading = useId();
  return (
    <article className="feature" aria-labelledby={heading}>
      <h2 id={heading}>{feature.title}</h2>
      <p>{feature.what}</p>
      <p className="how">{feature.how}</p>
      {/* The label says where: a screen reader's list of links would otherwise be ten "Show me"s. */}
      <Link to={feature.to} aria-label={`Show me: ${feature.title}`}>
        Show me
      </Link>
    </article>
  );
}
