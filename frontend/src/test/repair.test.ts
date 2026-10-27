import { describe, expect, it } from "vitest";
import cases from "../../../shared/repair-cases.json";
import { repair } from "./repair.ts";

describe("repair", () => {
  // The same table the backend's repair is tested against.
  it.each(cases)("$name", ({ desired, waits_for, expected }) =>
    expect(repair(desired, waits_for as Record<string, string[]>)).toEqual(
      expected,
    ),
  );
  it("refuses a loop", () =>
    expect(() => repair(["A", "B"], { A: ["B"], B: ["A"] })).toThrow());
});
