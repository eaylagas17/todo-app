import { describe, expect, it } from "vitest";
import type { Task } from "../api.ts";
import {
  CHILD_INDENT,
  COL_GAP,
  type GraphNode,
  layoutGraph,
  NODE_H,
  NODE_W,
} from "./layout.ts";

let n = 0;
const task = (title: string, waitsFor: string[] = [], subtasks = 0): Task => ({
  id: title,
  title,
  description: "",
  completed: false,
  position: ++n,
  subtasks: Array.from({ length: subtasks }, (_, i) => ({
    id: `${title}-${i}`,
    title: `${title} step ${i}`,
    completed: false,
  })),
  category_id: null,
  waits_for: waitsFor,
});

const node = (nodes: GraphNode[], id: string) =>
  nodes.find((candidate) => candidate.id === id)!;

describe("layoutGraph", () => {
  it("puts steps in columns, left to right", () => {
    const { nodes } = layoutGraph(
      [task("A"), task("B", ["A"]), task("C", ["B"])],
      new Set(),
    );
    expect(["A", "B", "C"].map((id) => node(nodes, id).x)).toEqual([
      0,
      NODE_W + COL_GAP,
      2 * (NODE_W + COL_GAP),
    ]);
  });

  it("keeps a column's tasks in list order", () => {
    const { nodes } = layoutGraph(
      [task("A"), task("G"), task("S", ["A", "G"])],
      new Set(),
    );
    expect(node(nodes, "A").x).toBe(node(nodes, "G").x);
    expect(node(nodes, "A").y).toBeLessThan(node(nodes, "G").y);
  });

  it("stacks a task's subtasks below it, indented", () => {
    const { nodes } = layoutGraph([task("A", [], 2)], new Set());
    const [first, second] = [node(nodes, "A-0"), node(nodes, "A-1")];
    expect(first.kind).toBe("subtask");
    expect(first.taskId).toBe("A");
    expect(first.x).toBe(node(nodes, "A").x + CHILD_INDENT);
    expect(first.y).toBeGreaterThanOrEqual(node(nodes, "A").y + NODE_H);
    expect(second.y).toBeGreaterThan(first.y);
  });

  it("folding removes a task's children and their tree lines", () => {
    const { nodes, edges } = layoutGraph([task("A", [], 2)], new Set(["A"]));
    expect(nodes.map((n) => n.id)).toEqual(["A"]);
    expect(edges).toEqual([]);
  });

  it("puts unlinked tasks in the last band", () => {
    const { nodes } = layoutGraph(
      [task("Loose"), task("A"), task("B", ["A"])],
      new Set(),
    );
    const linkedBottom = Math.max(
      ...["A", "B"].map((id) => node(nodes, id).y + node(nodes, id).h),
    );
    expect(node(nodes, "Loose").y).toBeGreaterThan(linkedBottom);
  });

  it("draws one arrow per link and one tree line per subtask", () => {
    const { edges } = layoutGraph(
      [task("A", [], 3), task("G"), task("S", ["A", "G"], 2)],
      new Set(),
    );
    expect(edges.filter((e) => e.kind === "link")).toHaveLength(2);
    expect(edges.filter((e) => e.kind === "tree")).toHaveLength(5);
    expect(edges.find((e) => e.kind === "link")).toMatchObject({
      from: "A",
      to: "S",
    });
  });

  it("never overlaps two nodes", () => {
    const wedding = [
      task("Book the venue", [], 3),
      task("Confirm guest list"),
      task("Send invitations", ["Book the venue", "Confirm guest list"], 2),
      task("Seating plan", ["Send invitations"]),
      task("Renew passport"),
      task("Book flights", ["Renew passport"]),
      task("Order the cake"),
      ...Array.from({ length: 10 }, (_, i) => task(`Loose ${i}`, [], i % 3)),
    ];
    const { nodes, width, height } = layoutGraph(wedding, new Set());
    for (const [i, a] of nodes.entries()) {
      expect(a.x + a.w).toBeLessThanOrEqual(width);
      expect(a.y + a.h).toBeLessThanOrEqual(height);
      for (const b of nodes.slice(i + 1)) {
        const apart =
          a.x + a.w <= b.x ||
          b.x + b.w <= a.x ||
          a.y + a.h <= b.y ||
          b.y + b.h <= a.y;
        expect(apart, `${a.id} overlaps ${b.id}`).toBe(true);
      }
    }
  });
});
