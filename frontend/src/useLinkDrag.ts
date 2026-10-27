import {
  createElement,
  type PointerEvent as ReactPointerEvent,
  useState,
} from "react";
import { createPortal } from "react-dom";

type Point = { x: number; y: number };

/** The arrowhead: two strokes this long, this far either side of the line. */
const HEAD = 10;
const SPREAD = (28 * Math.PI) / 180;
const round = (v: number) => Math.round(v * 10) / 10;

/**
 * The arrow from the dot to the pointer, as two SVG paths: the line (dashed, its dashes march)
 * and the head at the pointer (solid). The head's strokes point back along the line: the line's
 * angle, turned half a circle, then ±28°.
 */
export function arrowPath(
  from: Point,
  to: Point,
): { line: string; head: string } {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const back = (turn: number) => {
    const a = angle + Math.PI + turn;
    return `${round(to.x + HEAD * Math.cos(a))} ${round(to.y + HEAD * Math.sin(a))}`;
  };
  return {
    line: `M ${from.x} ${from.y} L ${to.x} ${to.y}`,
    head: `M ${back(SPREAD)} L ${to.x} ${to.y} L ${back(-SPREAD)}`,
  };
}

/**
 * Linking by drag: press the dot on a task's edge, release over another task. The task you
 * drag from waits for the task you drop on. Pointer events cover mouse, touch and pen; the
 * drop target is whatever row or node is under the pointer, found by its data-task-id.
 *
 * While the pointer is down, an arrow runs from the dot to the pointer and the task under it is
 * outlined, so you can see what you're connecting (spec §5.4). Releasing anywhere removes both.
 */
export function useLinkDrag(onLink: (fromId: string, toId: string) => void) {
  const [drag, setDrag] = useState<{
    fromId: string;
    from: Point;
    to: Point;
  } | null>(null);

  const dotProps = (taskId: string) => ({
    "data-active": drag?.fromId === taskId ? true : undefined,
    onPointerDown(event: ReactPointerEvent) {
      event.preventDefault();
      const box = event.currentTarget.getBoundingClientRect();
      const from = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      setDrag({
        fromId: taskId,
        from,
        to: { x: event.clientX, y: event.clientY },
      });
      document.body.classList.add("linking");
      // A second finger means a pinch, not a link: the drop is then ignored.
      let pinching = false;
      let target: HTMLElement | null = null;
      const under = (e: PointerEvent) =>
        document
          .elementFromPoint(e.clientX, e.clientY)
          ?.closest<HTMLElement>("[data-task-id]") ?? null;
      // One outlined task at most, and never the one dragged from.
      const outline = (next: HTMLElement | null) => {
        const shown = next?.dataset.taskId === taskId ? null : next;
        if (shown === target) return;
        target?.classList.remove("link-target");
        shown?.classList.add("link-target");
        target = shown;
      };
      const second = (other: PointerEvent) => {
        if (other.pointerId !== event.pointerId) pinching = true;
      };
      const move = (e: PointerEvent) => {
        if (e.pointerId !== event.pointerId) return;
        setDrag({ fromId: taskId, from, to: { x: e.clientX, y: e.clientY } });
        outline(under(e));
      };
      const end = (e: PointerEvent) => {
        if (e.pointerId !== event.pointerId) return;
        window.removeEventListener("pointerdown", second);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
        document.body.classList.remove("linking");
        outline(null);
        setDrag(null);
        if (pinching || e.type === "pointercancel") return;
        const toId = under(e)?.dataset.taskId;
        if (toId && toId !== taskId) onLink(taskId, toId);
      };
      window.addEventListener("pointerdown", second);
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
    },
  });

  // In document.body, not in the row or the graph: a transformed ancestor (the zoomed graph, a
  // row mid-drag) would make position: fixed relative to it instead of to the window.
  const path = drag && arrowPath(drag.from, drag.to);
  const arrow =
    path &&
    createPortal(
      createElement(
        "svg",
        { className: "link-arrow", "aria-hidden": true },
        createElement("path", { className: "line", d: path.line }),
        createElement("path", { className: "head", d: path.head }),
      ),
      document.body,
    );
  return { dotProps, arrow };
}
