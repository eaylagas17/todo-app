import type { Task } from "./api.ts";

// Each midpoint halves a gap, so about 50 moves into the same spot use up a double's 52-bit
// mantissa and two positions become equal. The fix is to renumber the list (1, 2, 3, ...).
export function positionBetween(before?: number, after?: number): number {
  if (after === undefined) return (before ?? 0) + 1;
  if (before === undefined) return after - 1;
  return (before + after) / 2;
}

export function byPosition(tasks: readonly Task[]): Task[] {
  return tasks.toSorted((a, b) => a.position - b.position);
}

// A drop means what it means in dnd-kit: the dragged task takes the slot of the task it was
// dropped on. Returns the dragged task's new position, or null when nothing should change.
export function moveTask(
  tasks: readonly Task[],
  activeId: string,
  overId: string,
): { id: string; position: number } | null {
  const from = tasks.findIndex((t) => t.id === activeId);
  const to = tasks.findIndex((t) => t.id === overId);
  if (from === -1 || to === -1 || from === to) return null;
  const moved = tasks.toSpliced(from, 1).toSpliced(to, 0, tasks[from]);
  return {
    id: activeId,
    position: positionBetween(moved[to - 1]?.position, moved[to + 1]?.position),
  };
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
