import { expect, it } from "vitest";
import { arrowPath } from "./useLinkDrag.ts";

it("draws a straight line with an arrowhead at the pointer", () =>
  // The head: two 10px strokes at ±28° back from the tip, rounded to one decimal.
  expect(arrowPath({ x: 0, y: 0 }, { x: 100, y: 0 })).toEqual({
    line: "M 0 0 L 100 0",
    head: "M 91.2 -4.7 L 100 0 L 91.2 4.7",
  }));

it("points the head along the line, whatever its direction", () =>
  expect(arrowPath({ x: 0, y: 0 }, { x: 0, y: -50 }).head).toBe(
    "M -4.7 -41.2 L 0 -50 L 4.7 -41.2",
  ));
