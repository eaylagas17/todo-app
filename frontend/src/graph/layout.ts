import type { Task } from "../api.ts";
import { linkGroups, steps } from "../tasks.ts";

export const NODE_W = 180;
export const NODE_H = 42;
export const CHILD_W = 150;
export const CHILD_H = 24;
export const CHILD_GAP = 6;
export const CHILD_INDENT = 24;
export const COL_GAP = 50;
export const ROW_GAP = 16;
export const BAND_GAP = 28;

export type GraphNode = {
  id: string;
  kind: "task" | "subtask";
  taskId: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

/** A link arrow or a tree line, with its SVG path. */
export type GraphEdge = {
  kind: "link" | "tree";
  from: string;
  to: string;
  d: string;
};

const COL_W = NODE_W + COL_GAP;

/**
 * Where everything goes (spec §10): steps are columns, left to right; each group of linked
 * tasks is a horizontal band; unlinked tasks share a last band. Within a column, tasks keep
 * their list order, each with its subtasks hanging below it unless folded.
 */
export function layoutGraph(
  tasks: readonly Task[],
  folded: ReadonlySet<string>,
): { nodes: GraphNode[]; edges: GraphEdge[]; width: number; height: number } {
  const groups = linkGroups(tasks);
  const stepOf = steps(tasks);
  const children = (task: Task) => (folded.has(task.id) ? [] : task.subtasks);
  const blockHeight = (task: Task) =>
    NODE_H + children(task).length * (CHILD_H + CHILD_GAP);

  // One band per group, in the order groups first appear in the list; then the unlinked.
  const bands: Task[][] = [];
  const loose: Task[] = [];
  for (const task of tasks) {
    const group = groups.get(task.id);
    if (group) (bands[group.group] ??= []).push(task);
    else loose.push(task);
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  function place(task: Task, x: number, y: number) {
    nodes.push({
      id: task.id,
      kind: "task",
      taskId: task.id,
      x,
      y,
      w: NODE_W,
      h: NODE_H,
    });
    children(task).forEach((subtask, i) => {
      const cx = x + CHILD_INDENT;
      const cy = y + NODE_H + CHILD_GAP + i * (CHILD_H + CHILD_GAP);
      nodes.push({
        id: subtask.id,
        kind: "subtask",
        taskId: task.id,
        x: cx,
        y: cy,
        w: CHILD_W,
        h: CHILD_H,
      });
      // An elbow: down from under the parent, then right to the child's middle.
      edges.push({
        kind: "tree",
        from: task.id,
        to: subtask.id,
        d: `M ${x + 12} ${y + NODE_H} V ${cy + CHILD_H / 2} H ${cx}`,
      });
    });
  }

  let top = 0;
  for (const band of bands) {
    // The next free y in each column of this band; the band is as tall as its tallest column.
    const columnTop = new Map<number, number>();
    for (const task of band) {
      const column = stepOf.get(task.id)! - 1;
      const y = columnTop.get(column) ?? top;
      place(task, column * COL_W, y);
      columnTop.set(column, y + blockHeight(task) + ROW_GAP);
    }
    top = Math.max(...columnTop.values()) - ROW_GAP + BAND_GAP;
  }

  // Unlinked tasks flow across as many columns as the widest band, and wrap.
  const columns = Math.max(1, ...stepOf.values());
  for (let i = 0; i < loose.length; i += columns) {
    const row = loose.slice(i, i + columns);
    row.forEach((task, column) => place(task, column * COL_W, top));
    top += Math.max(...row.map(blockHeight)) + ROW_GAP;
  }

  // Arrows run from the prerequisite's right edge to the dependent's left edge, mid-height,
  // as a cubic Bézier that leaves and arrives horizontally, then a small open arrowhead drawn
  // in the same path, so it takes the line's colour.
  const at = new Map(nodes.map((n) => [n.id, n]));
  for (const task of tasks)
    for (const prerequisite of task.waits_for) {
      const from = at.get(prerequisite);
      const to = at.get(task.id);
      if (!from || !to) continue;
      const [x1, y1, x2, y2] = [
        from.x + from.w,
        from.y + NODE_H / 2,
        to.x,
        to.y + NODE_H / 2,
      ];
      const bend = (x2 - x1) / 2;
      edges.push({
        kind: "link",
        from: prerequisite,
        to: task.id,
        d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2} M ${x2 - 6} ${y2 - 4} L ${x2} ${y2} L ${x2 - 6} ${y2 + 4}`,
      });
    }

  const width = Math.max(0, ...nodes.map((n) => n.x + n.w));
  const height = Math.max(0, ...nodes.map((n) => n.y + n.h));
  return { nodes, edges, width, height };
}
