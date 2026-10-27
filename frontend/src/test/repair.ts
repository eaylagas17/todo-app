// The server's order repair (backend/app/graph.py), kept for the fake server: creating a link
// repairs the order there exactly as it does on the server. Drags use `sweep` (tasks.ts).

export type Direction = "down" | "up";

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
