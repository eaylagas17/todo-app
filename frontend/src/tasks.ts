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

export type Direction = "down" | "up";

export const waitsForMap = (tasks: readonly Task[]): Record<string, string[]> =>
  Object.fromEntries(tasks.map((task) => [task.id, task.waits_for]));

/**
 * The order closest to `desired` that keeps every link (spec §8.3): a stable topological sort.
 * "down" fills from the top, so dependents in the way are pushed below the dragged task; "up"
 * fills from the bottom, so prerequisites in the way are pulled above it. The same algorithm as
 * backend/app/graph.py, tested against the same table (shared/repair-cases.json).
 */
export function repair(
  desired: string[],
  waitsFor: Record<string, string[]>,
  direction: Direction,
): string[] {
  const index = new Map(desired.map((id, i) => [id, i]));
  const before = new Map(
    desired.map((id) => [id, (waitsFor[id] ?? []).filter((p) => index.has(p))]),
  );
  const after = new Map(desired.map((id) => [id, [] as string[]]));
  for (const [id, prerequisites] of before)
    for (const p of prerequisites) after.get(p)!.push(id);
  const [blocking, unblocks] =
    direction === "down" ? [before, after] : [after, before];
  const remaining = new Map(
    desired.map((id) => [id, blocking.get(id)!.length]),
  );
  const available = desired.filter((id) => remaining.get(id) === 0);
  // Down takes the earliest desired index first; up takes the latest.
  const sooner = (a: string, b: string) =>
    direction === "down"
      ? index.get(a)! < index.get(b)!
      : index.get(a)! > index.get(b)!;
  const placed: string[] = [];
  while (available.length > 0) {
    // ponytail: linear scan, a binary heap at thousands of tasks
    let best = 0;
    for (let i = 1; i < available.length; i++)
      if (sooner(available[i], available[best])) best = i;
    const [id] = available.splice(best, 1);
    placed.push(id);
    for (const next of unblocks.get(id)!) {
      remaining.set(next, remaining.get(next)! - 1);
      if (remaining.get(next) === 0) available.push(next);
    }
  }
  if (placed.length !== desired.length) throw new Error("links form a loop");
  return direction === "down" ? placed : placed.reverse();
}

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

// Soft hues (degrees on the colour wheel), one per group.
const PALETTE = [35, 150, 210, 280, 340, 95];

// A small string hash, so any id (a UUID, or "id-3" in the tests) picks a palette entry.
const hash = (text: string) =>
  [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0);

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
 * breadth-first search. Groups are numbered by first appearance in the list. A group's colour
 * comes from its oldest task: ids are UUIDv7, so the smallest id is the oldest.
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
  const groups = new Map<string, { group: number; hue: number }>();
  let group = 0;
  for (const { id } of tasks) {
    if (!neighbours.has(id) || groups.has(id)) continue;
    const members = [id];
    const seen = new Set(members);
    // The members array is the BFS queue: i walks it while new neighbours are appended.
    for (let i = 0; i < members.length; i++)
      for (const n of neighbours.get(members[i])!)
        if (!seen.has(n)) {
          seen.add(n);
          members.push(n);
        }
    const oldest = members.reduce((a, b) => (b < a ? b : a));
    const hue = PALETTE[hash(oldest) % PALETTE.length];
    for (const member of members) groups.set(member, { group, hue });
    group++;
  }
  return groups;
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
