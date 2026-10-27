import { describe, expect, it } from "vitest";
import type { Task } from "./api.ts";
import cases from "../../shared/repair-cases.json";
import {
  allOf,
  byPosition,
  inCategory,
  isWaiting,
  linkGroups,
  matchesSearch,
  moveWithLinks,
  repair,
  slotAt,
  steps,
  subtaskProgress,
  sweep,
} from "./tasks.ts";

const task = (id: string, position: number, title = id): Task => ({
  id,
  title,
  description: "",
  completed: false,
  position,
  subtasks: [],
  category_id: null,
  waits_for: [],
});

const waiting = (id: string, position: number, waitsFor: string[]): Task => ({
  ...task(id, position),
  waits_for: waitsFor,
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

describe("repair", () => {
  // The same table the backend's repair is tested against.
  it.each(cases)("$name", ({ desired, waits_for, direction, expected }) =>
    expect(
      repair(
        desired,
        waits_for as Record<string, string[]>,
        direction as "down" | "up",
      ),
    ).toEqual(expected),
  );
  it("refuses a loop", () =>
    expect(() => repair(["A", "B"], { A: ["B"], B: ["A"] }, "down")).toThrow());
});

describe("moveWithLinks", () => {
  it("pulls a prerequisite up with a dependent dragged above it", () => {
    const list = [
      task("X", 1),
      task("B", 2),
      task("Y", 3),
      waiting("A", 4, ["B"]),
    ];
    expect(moveWithLinks(list, "A", "X")).toEqual(["B", "A", "X", "Y"]);
  });
  it("pushes a dependent down with a prerequisite dragged below it", () => {
    const list = [
      task("B", 1),
      task("X", 2),
      waiting("A", 3, ["B"]),
      task("Y", 4),
    ];
    expect(moveWithLinks(list, "B", "Y")).toEqual(["X", "Y", "B", "A"]);
  });
  it("is the plain move without links", () =>
    expect(
      moveWithLinks([task("a", 1), task("b", 2), task("c", 3)], "c", "a"),
    ).toEqual(["c", "a", "b"]));
  it("ignores a drop in place", () =>
    expect(moveWithLinks([task("a", 1), task("b", 2)], "b", "b")).toBeNull());
});

describe("sweep", () => {
  // B waits for A, and C waits for B.
  const order = ["A", "X", "B", "Y", "C", "Z", "W"];
  const waits = { B: ["A"], C: ["B"] };
  it("lands the dragged task exactly at the slot and brings what it reached", () =>
    expect(sweep(order, waits, "A", 3)).toEqual({
      order: ["X", "Y", "Z", "A", "B", "C", "W"],
      block: ["A", "B", "C"],
    }));
  it("leaves a linked task alone until it is reached", () =>
    expect(sweep(order, waits, "A", 1)).toEqual({
      order: ["X", "A", "B", "Y", "C", "Z", "W"],
      block: ["A"],
    }));
  it("gathers prerequisites going up and stops at the top", () =>
    expect(sweep(order, waits, "C", 0)).toEqual({
      order: ["A", "B", "C", "X", "Y", "Z", "W"],
      block: ["A", "B", "C"],
    }));
  it("stops at the bottom like a pushed stack", () =>
    expect(
      sweep(["V", "K", "G", "I", "S"], { I: ["V", "G"], S: ["I"] }, "V", 4)
        .order,
    ).toEqual(["K", "G", "V", "I", "S"]));
  it("returns the same order for a drop in place", () =>
    expect(sweep(order, waits, "A", 0)).toEqual({ order, block: ["A"] }));
  it("keeps every link for every task and every slot", () => {
    for (const id of order)
      for (let slot = 0; slot < order.length; slot++) {
        const result = sweep(order, waits, id, slot).order;
        const at = (t: string) => result.indexOf(t);
        for (const [t, prerequisites] of Object.entries(waits))
          for (const p of prerequisites) expect(at(p)).toBeLessThan(at(t));
      }
  });
});

describe("slotAt", () => {
  it("counts the rows whose middle is above the top", () =>
    expect([0, 21, 61].map((top) => slotAt(top, [40, 40, 40]))).toEqual([
      0, 1, 2,
    ]));
  it("passes a taller row only after its middle", () =>
    expect([80, 91].map((top) => slotAt(top, [40, 100, 40]))).toEqual([1, 2]));
});

describe("linkGroups", () => {
  const list = [
    task("a", 1),
    waiting("b", 2, ["a"]),
    task("c", 3),
    waiting("d", 4, ["c"]),
    task("e", 5),
  ];
  const groups = linkGroups(list);
  it("numbers groups by first appearance", () => {
    expect(groups.get("a")?.group).toBe(0);
    expect(groups.get("b")?.group).toBe(0);
    expect(groups.get("d")?.group).toBe(1);
  });
  it("gives two separate chains different hues", () =>
    expect(groups.get("a")?.hue).not.toBe(groups.get("c")?.hue));
  it("leaves an unlinked task out", () => expect(groups.has("e")).toBe(false));
});

describe("steps", () => {
  it("counts from 1 along the links", () =>
    expect(steps([task("A", 1), waiting("B", 2, ["A"])])).toEqual(
      new Map([
        ["A", 1],
        ["B", 2],
      ]),
    ));
  it("is one more than the highest step waited for", () =>
    expect(
      steps([task("A", 1), task("G", 2), waiting("S", 3, ["A", "G"])]).get("S"),
    ).toBe(2));
});

describe("groups and steps at scale", () => {
  // One task that 40,000 others wait for: linear work is a few milliseconds; copying the
  // neighbour list on every link (quadratic) takes seconds.
  it("stay linear for a task with many dependents", () => {
    const hub = task("hub", 0);
    const spokes = Array.from({ length: 40_000 }, (_, i) =>
      waiting(`s${i}`, i + 1, ["hub"]),
    );
    const started = performance.now();
    linkGroups([hub, ...spokes]);
    steps([hub, ...spokes]);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("isWaiting", () => {
  const venue = task("A", 1);
  const invites = waiting("B", 2, ["A"]);
  it("is true until every prerequisite is done", () => {
    expect(isWaiting(invites, new Map([["A", venue]]))).toBe(true);
    expect(
      isWaiting(invites, new Map([["A", { ...venue, completed: true }]])),
    ).toBe(false);
  });
  it("ignores a prerequisite that no longer exists", () =>
    expect(isWaiting(invites, new Map())).toBe(false));
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

describe("allOf and inCategory", () => {
  const work = { ...task("1", 1, "Report"), category_id: "work" };
  const home = { ...task("2", 2, "Laundry"), category_id: "home" };
  it("inCategory(null) matches everything", () =>
    expect([work, home].filter(inCategory(null))).toEqual([work, home]));
  it("inCategory(id) matches that category only", () =>
    expect([work, home].filter(inCategory("home"))).toEqual([home]));
  it("allOf passes only what every test passes", () => {
    const both = allOf(inCategory("work"), matchesSearch("rep"));
    expect([work, home].filter(both)).toEqual([work]);
    expect([work, home].filter(allOf<Task>())).toEqual([work, home]);
  });
});
