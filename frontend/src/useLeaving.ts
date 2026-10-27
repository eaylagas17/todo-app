import { useEffect, useState } from "react";
import { reducedMotion } from "./motion.ts";

/** How long a row takes to close up or open, matching the CSS animations. */
export const LEAVE_MS = 300;

type Phase = "steady" | "entering" | "leaving";

/**
 * A list that animates its changes: an item that disappears stays for LEAVE_MS as "leaving", at
 * the index it had, so its row can close up instead of vanishing; an item that appears is
 * "entering" for LEAVE_MS, so its row opens. Nothing enters on the first render, and nothing
 * animates under reduced motion.
 *
 * Focus: if it was in a row that leaves, it moves to the same task's checkbox elsewhere on the
 * page (it usually just moved to Recently completed), else to the next row's, else to the
 * search box; it never falls to the page.
 */
export function useLeaving<T extends { id: string }>(
  items: readonly T[],
): { item: T; phase: Phase }[] {
  const [last, setLast] = useState(items);
  const [leaving, setLeaving] = useState<{ item: T; index: number }[]>([]);
  const [entering, setEntering] = useState<ReadonlySet<string>>(new Set());
  const [refocus, setRefocus] = useState<{ id: string; next?: string }>();

  // State that follows a prop: compare during render, as React's docs recommend.
  if (items !== last) {
    const now = new Set(items.map((item) => item.id));
    const before = new Set(last.map((item) => item.id));
    const gone = last.flatMap((item, index) =>
      now.has(item.id) ? [] : [{ item, index }],
    );
    setLast(items);
    // Read before React removes the row: is focus inside one that's going?
    const focused =
      document.activeElement?.closest<HTMLElement>("[data-task-id]")?.dataset
        .taskId;
    const lost = gone.find(({ item }) => item.id === focused);
    if (lost) setRefocus({ id: lost.item.id, next: items[lost.index]?.id });
    const arrived = items.filter((item) => !before.has(item.id));
    if (!reducedMotion() && (gone.length || arrived.length)) {
      setLeaving((current) => [
        ...current.filter(({ item }) => !now.has(item.id)),
        ...gone,
      ]);
      setEntering(new Set(arrived.map((item) => item.id)));
    }
  }

  useEffect(() => {
    if (!leaving.length && !entering.size) return;
    const done = setTimeout(() => {
      setLeaving([]);
      setEntering(new Set());
    }, LEAVE_MS);
    return () => clearTimeout(done);
  }, [leaving, entering]);

  useEffect(() => {
    if (!refocus) return;
    const checkbox = (id?: string) =>
      id
        ? document.querySelector<HTMLElement>(
            `[data-task-id="${id}"]:not(.closing) input[type="checkbox"]`,
          )
        : null;
    (
      checkbox(refocus.id) ??
      checkbox(refocus.next) ??
      document.querySelector<HTMLElement>('input[type="search"]')
    )?.focus();
  }, [refocus]);

  const result: { item: T; phase: Phase }[] = items.map((item) => ({
    item,
    phase: entering.has(item.id) ? "entering" : "steady",
  }));
  // Put leaving rows back where they were, earliest first, so later indexes stay right.
  for (const { item, index } of leaving.toSorted((a, b) => a.index - b.index))
    result.splice(Math.min(index, result.length), 0, {
      item,
      phase: "leaving",
    });
  return result;
}
