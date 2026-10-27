import type { Task } from "./api.ts";

export function byPosition(tasks: readonly Task[]): Task[] {
  return tasks.toSorted((a, b) => a.position - b.position);
}

const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

export function matchesSearch(query: string): (task: Task) => boolean {
  const needle = normalize(query);
  return (task) =>
    [task.title, task.description].some((text) =>
      normalize(text).includes(needle),
    );
}

/** "1 of 3" for the row and the checklist, or null when there's nothing to count. */
export function subtaskProgress(task: Task): string | null {
  if (task.subtasks.length === 0) return null;
  const done = task.subtasks.filter((subtask) => subtask.completed).length;
  return `${done} of ${task.subtasks.length}`;
}

/** A filter for one category; null means "All". */
export const inCategory =
  (id: string | null) =>
  (task: Task): boolean =>
    id === null || task.category_id === id;

/** Composes filters: an item passes only if it passes every one. allOf() passes everything. */
export const allOf =
  <T>(...tests: ((item: T) => boolean)[]) =>
  (item: T): boolean =>
    tests.every((test) => test(item));

/** Each task's prerequisites, by id: the shape `sweep` reads links in. */
export const waitsForMap = (tasks: readonly Task[]): Record<string, string[]> =>
  Object.fromEntries(tasks.map((task) => [task.id, task.waits_for]));

/**
 * The snowball (spec §5.2): the dragged task lands at `slot`, its index in the result. Going
 * down, a task that waits for anything in the moving block joins it when the block reaches it,
 * and travels right behind; going up is the mirror image, with prerequisites joining on top.
 * Everything else keeps its relative order and flows around the block. If the block can't fit
 * (a wall), the dragged task stops short of `slot`, like a pushed stack.
 *
 * One walk over the other tasks, filling the `room` slots before the block. O(V + E) time, O(V)
 * space. Every link holds: the original order kept them all, relative order is preserved, and the
 * block only overtakes tasks that aren't linked to it.
 */
export function sweep(
  order: readonly string[],
  waitsFor: Record<string, readonly string[]>,
  activeId: string,
  slot: number,
): { order: string[]; block: string[] } {
  const from = order.indexOf(activeId);
  if (slot === from) return { order: [...order], block: [activeId] };
  const down = slot > from;
  const others = order.filter((id) => id !== activeId);
  if (!down) others.reverse();
  const room = down ? slot : order.length - 1 - slot;
  const inBlock = new Set([activeId]);
  // Going up, a task joins if something in the block waits for it: look that up in O(1).
  const neededByBlock = new Set(waitsFor[activeId] ?? []);
  const joins = (id: string) =>
    down
      ? (waitsFor[id] ?? []).some((p) => inBlock.has(p))
      : neededByBlock.has(id);
  const before: string[] = [];
  const members: string[] = [];
  const after: string[] = [];
  for (const id of others) {
    if (before.length >= room) after.push(id);
    else if (joins(id)) {
      inBlock.add(id);
      members.push(id);
      for (const p of waitsFor[id] ?? []) neededByBlock.add(p);
    } else before.push(id);
  }
  if (down)
    return {
      order: [...before, activeId, ...members, ...after],
      block: [activeId, ...members],
    };
  // Walked bottom-up, so each list is reversed back into list order.
  const block = [...members.reverse(), activeId];
  return {
    order: [...after.reverse(), ...block, ...before.reverse()],
    block,
  };
}

/**
 * The whole order, with the tasks the list showed (and the person reordered) put back into the
 * slots they held; every hidden task keeps its index. Safe because a hidden completed task has
 * no link to a shown one (see inMainList), so the merge can't break a link. O(V).
 */
export function mergeOrder(
  all: readonly string[],
  reordered: readonly string[],
): string[] {
  const shown = new Set(reordered);
  let next = 0;
  return all.map((id) => (shown.has(id) ? reordered[next++] : id));
}

/**
 * Which slot a dragged row is over: how many of the other rows (their heights, in list order,
 * the dragged row left out) have their middle above the dragged row's top. O(V).
 */
export function slotAt(top: number, heights: readonly number[]): number {
  let slot = 0;
  let cumulative = 0;
  for (const h of heights) {
    if (top <= cumulative + h / 2) break;
    cumulative += h;
    slot++;
  }
  return slot;
}

// Soft hues (degrees on the colour wheel), in hand-out order: neighbours are far apart, so the
// first few chains are clearly different (blue, orange, green, purple, pink, lime).
const PALETTE = [210, 30, 140, 280, 340, 90];

/** Adds to a key's list in place: O(1). Copying the list on every add would be O(k²) for k. */
function append(lists: Map<string, string[]>, key: string, value: string) {
  const list = lists.get(key);
  if (list) list.push(value);
  else lists.set(key, [value]);
}

/** Links that point at a task in the list; one that points at a deleted task is ignored. */
function presentLinks(tasks: readonly Task[]) {
  const present = new Set(tasks.map((t) => t.id));
  return new Map(
    tasks.map((t) => [t.id, t.waits_for.filter((p) => present.has(p))]),
  );
}

/**
 * Linked tasks form groups (connected components, links taken both ways), found by
 * breadth-first search. Groups are numbered by first appearance in the list.
 *
 * Colours are handed out by age (spec §5.5): the group whose oldest task is oldest gets the first
 * colour, the next the second, and so on (ids are UUIDv7, so the smallest id is the oldest). Up
 * to six chains always differ, and dragging never recolours one, because age doesn't change with
 * order. A chain's colour shifts only when an older chain appears or goes.
 */
export function linkGroups(
  tasks: readonly Task[],
): Map<string, { group: number; hue: number }> {
  const neighbours = new Map<string, string[]>();
  for (const [id, prerequisites] of presentLinks(tasks))
    for (const p of prerequisites) {
      append(neighbours, id, p);
      append(neighbours, p, id);
    }
  const groupOf = new Map<string, number>();
  const oldest: string[] = []; // per group
  for (const { id } of tasks) {
    if (!neighbours.has(id) || groupOf.has(id)) continue;
    const members = [id];
    const seen = new Set(members);
    // The members array is the BFS queue: i walks it while new neighbours are appended.
    for (let i = 0; i < members.length; i++)
      for (const n of neighbours.get(members[i])!)
        if (!seen.has(n)) {
          seen.add(n);
          members.push(n);
        }
    for (const member of members) groupOf.set(member, oldest.length);
    oldest.push(members.reduce((a, b) => (b < a ? b : a)));
  }
  // Rank the groups by their oldest task: O(G log G) for G groups.
  const byAge = oldest
    .map((_, g) => g)
    .sort((a, b) => (oldest[a] < oldest[b] ? -1 : 1));
  const hue = new Map(
    byAge.map((g, rank) => [g, PALETTE[rank % PALETTE.length]]),
  );
  return new Map(
    [...groupOf].map(([id, group]) => [id, { group, hue: hue.get(group)! }]),
  );
}

/**
 * Step numbers for linked tasks: 1 if a task waits for nothing, otherwise one more than the
 * highest step it waits for. The longest path, computed in topological order (Kahn).
 */
export function steps(tasks: readonly Task[]): Map<string, number> {
  const links = presentLinks(tasks);
  const linked = new Set<string>();
  const dependents = new Map<string, string[]>();
  for (const [id, prerequisites] of links)
    for (const p of prerequisites) {
      linked.add(id).add(p);
      append(dependents, p, id);
    }
  const pending = new Map([...linked].map((id) => [id, links.get(id)!.length]));
  const order = [...linked].filter((id) => pending.get(id) === 0);
  const step = new Map<string, number>();
  for (let i = 0; i < order.length; i++) {
    const id = order[i];
    step.set(id, 1 + Math.max(0, ...links.get(id)!.map((p) => step.get(p)!)));
    for (const d of dependents.get(id) ?? []) {
      pending.set(d, pending.get(d)! - 1);
      if (pending.get(d) === 0) order.push(d);
    }
  }
  return step;
}

/** Waiting while any task it waits for (and that still exists) isn't done. */
export const isWaiting = (task: Task, byId: Map<string, Task>) =>
  task.waits_for.some((id) => byId.get(id)?.completed === false);

export type LinkInfo = {
  step: number;
  hue: number;
  waiting: boolean;
  waitsFor: string[];
};

/** Everything a row shows about its links, computed once for the whole list. */
export function linkInfo(tasks: readonly Task[]): Map<string, LinkInfo> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const groups = linkGroups(tasks);
  const stepOf = steps(tasks);
  const info = new Map<string, LinkInfo>();
  for (const task of tasks) {
    const group = groups.get(task.id);
    if (!group) continue;
    info.set(task.id, {
      step: stepOf.get(task.id) ?? 1,
      hue: group.hue,
      waiting: isWaiting(task, byId),
      waitsFor: task.waits_for.flatMap((id) => byId.get(id)?.title ?? []),
    });
  }
  return info;
}

/** How many completed tasks show under the list (spec §5.7). */
export const RECENT_LIMIT = 5;

/**
 * The tasks in the main list (spec §5.7), in order: every open task; a completed one while its
 * chain (its link group) is unfinished; and any task inside its 5-second undo window, or whose
 * chain has a task in it, so a finished chain leaves all together. A finished chain has no link
 * to anything that stays, which is what makes hiding it safe for dragging (mergeOrder).
 * One linkGroups call: O(V + E).
 */
export function inMainList(
  tasks: readonly Task[],
  lingering: ReadonlySet<string>,
): Task[] {
  const groups = linkGroups(tasks);
  const stays = (t: Task) => !t.completed || lingering.has(t.id);
  // The chains that stay: any member open, or in its window.
  const held = new Set<number>();
  for (const t of tasks) {
    const chain = groups.get(t.id);
    if (chain && stays(t)) held.add(chain.group);
  }
  return tasks.filter((t) => {
    const chain = groups.get(t.id);
    return stays(t) || (chain !== undefined && held.has(chain.group));
  });
}

/** Completed tasks, the most recently completed first. Compared as times, not text: the server
 * writes "+00:00" and the browser "Z". O(V log V). */
export function newestDone(tasks: readonly Task[]): Task[] {
  const time = (t: Task) => (t.completed_at ? Date.parse(t.completed_at) : 0);
  return tasks.filter((t) => t.completed).toSorted((a, b) => time(b) - time(a));
}

/**
 * A day for a completed row: "today 10:31" (or just "today" without the time), "yesterday",
 * "25 Oct", or "25 Oct 2025" in another year. Calendar days in the browser's time zone; Intl
 * formats in its language.
 */
export function formatDay(
  iso: string,
  now = new Date(),
  locale?: string,
  time = true,
) {
  const date = new Date(iso);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === now.toDateString())
    return time
      ? `today ${new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date)}`
      : "today";
  if (date.toDateString() === yesterday.toDateString()) return "yesterday";
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  }).format(date);
}

/** A full date for the panel: "19 Oct 2026". */
export const formatDate = (iso: string, locale?: string) =>
  new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
