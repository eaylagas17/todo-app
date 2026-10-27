import { describe, expect, it } from "vitest";
import type { Task } from "./api.ts";
import {
  byPosition,
  matchesSearch,
  subtaskProgress,
  moveTask,
  positionBetween,
} from "./tasks.ts";

const task = (id: string, position: number, title = id): Task => ({
  id,
  title,
  description: "",
  completed: false,
  position,
  subtasks: [],
});

describe("positionBetween", () => {
  it("returns the midpoint between two neighbours", () =>
    expect(positionBetween(1, 2)).toBe(1.5));
  it("goes one below the first task", () =>
    expect(positionBetween(undefined, 1)).toBe(0));
  it("goes one above the last task", () =>
    expect(positionBetween(2.5, undefined)).toBe(3.5));
  it("starts an empty list at 1, like the server", () =>
    expect(positionBetween()).toBe(1));
});

describe("byPosition", () => {
  it("sorts by position and keeps ties in their original order", () =>
    expect(
      byPosition([
        task("c", 3),
        task("a", 1),
        task("b1", 2),
        task("b2", 2),
      ]).map((t) => t.id),
    ).toEqual(["a", "b1", "b2", "c"]));
  it("does not mutate its input", () => {
    const input = [task("b", 2), task("a", 1)];
    byPosition(input);
    expect(input.map((t) => t.id)).toEqual(["b", "a"]);
  });
});

describe("moveTask", () => {
  const list = [task("a", 1), task("b", 2), task("c", 3)];
  it("places a task between its new neighbours", () =>
    expect(moveTask(list, "c", "b")).toEqual({ id: "c", position: 1.5 }));
  it("moves a task to the top", () =>
    expect(moveTask(list, "c", "a")).toEqual({ id: "c", position: 0 }));
  it("moves a task to the bottom", () =>
    expect(moveTask(list, "a", "c")).toEqual({ id: "a", position: 4 }));
  it("ignores a drop in place", () =>
    expect(moveTask(list, "b", "b")).toBeNull());
  it("ignores unknown ids", () => expect(moveTask(list, "x", "a")).toBeNull());
});

describe("matchesSearch", () => {
  const tasks = [
    task("1", 1, "Buy milk"),
    task("2", 2, "Café run"),
    task("3", 3, "Call mom"),
  ];
  const ids = (query: string) =>
    tasks.filter(matchesSearch(query)).map((t) => t.id);
  it("ignores case", () => expect(ids("MILK")).toEqual(["1"]));
  it("ignores accents either way", () => {
    expect(ids("cafe")).toEqual(["2"]);
    expect(ids("CAFÉ")).toEqual(["2"]);
  });
  it("matches the description too", () =>
    expect(
      matchesSearch("three")({
        ...task("4", 4, "Venue"),
        description: "call three places",
      }),
    ).toBe(true));
  it("matches everything for a blank query", () =>
    expect(ids("  ")).toEqual(["1", "2", "3"]));
});

describe("subtaskProgress", () => {
  it("is null for a task without subtasks", () =>
    expect(subtaskProgress(task("1", 1))).toBeNull());
  it("counts the done ones", () =>
    expect(
      subtaskProgress({
        ...task("1", 1),
        subtasks: [
          { id: "a", title: "a", completed: true },
          { id: "b", title: "b", completed: true },
          { id: "c", title: "c", completed: false },
        ],
      }),
    ).toBe("2 of 3"));
});
