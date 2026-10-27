import { expect, it } from "vitest";
import { arrowPath } from "./useLinkDrag.tsx";

it("draws a line to the pointer, its head pointing along the line", () => {
  // The head: two 10px strokes at ±28° back from the tip, rounded to one decimal.
  expect(arrowPath({ x: 0, y: 0 }, { x: 100, y: 0 })).toEqual({
    line: "M 0 0 L 100 0",
    head: "M 91.2 -4.7 L 100 0 L 91.2 4.7",
  });
  expect(arrowPath({ x: 0, y: 0 }, { x: 0, y: -50 }).head).toBe(
    "M -4.7 -41.2 L 0 -50 L 4.7 -41.2",
  );
});
