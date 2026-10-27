// The server's order repair (backend/app/graph.py), for the fake server: creating a link repairs
// the order here exactly as it does there. Drags use `sweep` (tasks.ts).

/**
 * The order closest to `desired` that keeps every link: a stable topological sort. It fills the
 * list from the top, each time taking the task highest in `desired` whose prerequisites are all
 * placed, so a task in the way of one it waits for is pushed below it. Tested against the same
 * table as the backend (shared/repair-cases.json).
 */
export function repair(
  desired: string[],
  waitsFor: Record<string, string[]>,
): string[] {
  const index = new Map(desired.map((id, i) => [id, i]));
  const before = new Map(
    desired.map((id) => [id, (waitsFor[id] ?? []).filter((p) => index.has(p))]),
  );
  const after = new Map(desired.map((id) => [id, [] as string[]]));
  for (const [id, prerequisites] of before)
    for (const p of prerequisites) after.get(p)!.push(id);
  const remaining = new Map(desired.map((id) => [id, before.get(id)!.length]));
  const available = desired.filter((id) => remaining.get(id) === 0);
  const placed: string[] = [];
  while (available.length > 0) {
    // A linear scan for the highest one; the backend uses a heap. Fine for a test's few tasks.
    let best = 0;
    for (let i = 1; i < available.length; i++)
      if (index.get(available[i])! < index.get(available[best])!) best = i;
    const [id] = available.splice(best, 1);
    placed.push(id);
    for (const next of after.get(id)!) {
      remaining.set(next, remaining.get(next)! - 1);
      if (remaining.get(next) === 0) available.push(next);
    }
  }
  if (placed.length !== desired.length) throw new Error("links form a loop");
  return placed;
}
