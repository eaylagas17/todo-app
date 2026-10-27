import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { slotAt, sweep } from "./tasks.ts";

/** Pointer movement before a press on a handle becomes a drag, so a tap stays a tap. */
const ACTIVATE_PX = 5;
/** Near the window's top or bottom edge, the page scrolls while dragging. */
const EDGE_PX = 48;
const SCROLL_PX = 10;

type Drag = {
  active: string;
  /** The order when the drag began: every preview is computed from it, never from the last one. */
  start: readonly string[];
  /** Each row's top and height at pick-up, relative to the list. */
  tops: Map<string, number>;
  heights: Map<string, number>;
  listHeight: number;
  /** A pointer drag follows the finger; a keyboard drag moves one slot at a time. */
  pointer: boolean;
  /** Pointer only: where the finger puts the dragged row's top, inside the list. */
  top: number;
  slot: number;
  preview: { order: string[]; block: string[] };
  /** Released and saved: still drawn as previewed until the list holds the new order. */
  dropped?: boolean;
};

type Options = {
  ids: readonly string[];
  waitsFor: Record<string, readonly string[]>;
  titleOf: (id: string) => string;
  /** Called on a drop that changed the order, with the whole new order. */
  onDrop: (order: string[]) => void;
};

/**
 * Drag to reorder, with the snowball (spec §5.1, §5.2): the dragged row follows the pointer
 * inside the list, the others glide out of its way (CSS transitions on their transforms), and the
 * linked tasks it reaches travel with it. The DOM keeps the start order until the drop, so only
 * transforms move during a drag. The keyboard does the same one slot at a time.
 */
export function useSnowballDrag({ ids, waitsFor, titleOf, onDrop }: Options) {
  const rows = useRef(new Map<string, HTMLLIElement>());
  const current = useRef<Drag | null>(null);
  const stopPointer = useRef<() => void>(() => {});
  const [drag, setDrag] = useState<Drag | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const instructionsId = useId();

  // Leaving the page mid-drag drops the window listeners.
  useEffect(() => () => stopPointer.current(), []);

  // After a drop, the preview stays drawn until the list arrives in its new order (the
  // optimistic update writes it a moment later); otherwise the rows would snap back to where the
  // drag began and glide forward again. Any change to the list ends it.
  if (drag?.dropped && ids.join() !== drag.start.join()) setDrag(null);
  // Should the list never change (an error before the update), stop drawing it after a second.
  useEffect(() => {
    if (!drag?.dropped) return;
    const giveUp = setTimeout(() => setDrag(null), 1000);
    return () => clearTimeout(giveUp);
  }, [drag]);

  function show(next: Drag | null) {
    current.current = next;
    setDrag(next);
  }

  function pickUp(active: string, pointer: boolean): Drag {
    const list = rows.current.get(active)!.parentElement!;
    const listTop = list.getBoundingClientRect().top;
    const tops = new Map<string, number>();
    const heights = new Map<string, number>();
    for (const id of ids) {
      const rect = rows.current.get(id)?.getBoundingClientRect();
      tops.set(id, (rect?.top ?? 0) - listTop);
      heights.set(id, rect?.height ?? 0);
    }
    const listHeight = [...heights.values()].reduce((a, b) => a + b, 0);
    const slot = ids.indexOf(active);
    setAnnouncement(`Picked up ${titleOf(active)}.`);
    return {
      active,
      start: ids,
      tops,
      heights,
      listHeight,
      pointer,
      top: tops.get(active)!,
      slot,
      preview: { order: [...ids], block: [active] },
    };
  }

  // The snowball for a slot, and what to tell a screen reader when the result changed.
  function moveTo(d: Drag, slot: number, top = d.top): Drag {
    const preview = sweep(d.start, waitsFor, d.active, slot);
    const landed = preview.order.indexOf(d.active);
    if (
      landed !== d.preview.order.indexOf(d.active) ||
      preview.block.length !== d.preview.block.length
    ) {
      const others = preview.block.filter((id) => id !== d.active).map(titleOf);
      const travelling = others.length
        ? ` ${others.join(", ")} ${others.length === 1 ? "moves" : "move"} with it.`
        : "";
      setAnnouncement(
        `${titleOf(d.active)} is at position ${landed + 1} of ${d.start.length}.${travelling}`,
      );
    }
    // A keyboard drag stays on the slot it really landed on, so a wall doesn't eat key presses.
    return { ...d, top, slot: d.pointer ? slot : landed, preview };
  }

  // Pointer: the finger's top, kept inside the list (§5.1), decides the slot.
  function follow(d: Drag, top: number): Drag {
    const height = d.heights.get(d.active)!;
    const inside = Math.min(Math.max(top, 0), d.listHeight - height);
    const others = d.start
      .filter((id) => id !== d.active)
      .map((id) => d.heights.get(id)!);
    return moveTo(d, slotAt(inside, others), inside);
  }

  function finish(d: Drag) {
    const moved = d.preview.order.some((id, i) => id !== d.start[i]);
    const others = d.preview.block.filter((id) => id !== d.active).map(titleOf);
    setAnnouncement(
      moved
        ? `${titleOf(d.active)} was moved.${others.length ? ` ${others.join(", ")} moved with it.` : ""}`
        : `Moving ${titleOf(d.active)} was cancelled.`,
    );
    if (!moved) return show(null);
    current.current = null;
    setDrag({ ...d, dropped: true });
    onDrop(d.preview.order);
  }

  function cancel(d: Drag) {
    setAnnouncement(`Moving ${titleOf(d.active)} was cancelled.`);
    show(null);
  }

  const handleProps = (id: string) => ({
    "aria-describedby": instructionsId,
    onPointerDown(event: ReactPointerEvent) {
      if (
        current.current ||
        (event.pointerType === "mouse" && event.button !== 0)
      )
        return;
      event.preventDefault();
      const pointerId = event.pointerId;
      const startY = event.clientY + window.scrollY;
      let clientY = event.clientY;
      let frame = 0;
      const apply = () => {
        const dy = clientY + window.scrollY - startY;
        let d = current.current;
        if (!d) {
          if (Math.abs(dy) < ACTIVATE_PX) return;
          d = pickUp(id, true);
        }
        show(follow(d, d.tops.get(id)! + dy));
      };
      // While the finger is near the window's edge, scroll a little every frame.
      const scroll = () => {
        const page = document.scrollingElement;
        const edge =
          clientY < EDGE_PX
            ? -SCROLL_PX
            : clientY > innerHeight - EDGE_PX
              ? SCROLL_PX
              : 0;
        if (
          current.current &&
          edge &&
          page &&
          page.scrollHeight > innerHeight
        ) {
          window.scrollBy(0, edge);
          apply();
        }
        frame = requestAnimationFrame(scroll);
      };
      const move = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        clientY = e.clientY;
        apply();
      };
      const up = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        stop();
        if (current.current) finish(current.current);
      };
      const lost = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        stop();
        if (current.current) cancel(current.current);
      };
      const escape = (e: KeyboardEvent) => {
        if (e.key !== "Escape") return;
        stop();
        if (current.current) cancel(current.current);
      };
      function stop() {
        cancelAnimationFrame(frame);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", lost);
        window.removeEventListener("keydown", escape);
        stopPointer.current = () => {};
      }
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", lost);
      window.addEventListener("keydown", escape);
      stopPointer.current = stop;
      frame = requestAnimationFrame(scroll);
    },
    onKeyDown(event: ReactKeyboardEvent) {
      const d = current.current;
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        if (!d) show(pickUp(id, false));
        else if (d.active === id && !d.pointer) finish(d);
        return;
      }
      if (!d || d.active !== id || d.pointer) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        const slot = Math.min(Math.max(d.slot + step, 0), d.start.length - 1);
        show(moveTo(d, slot));
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancel(d);
      }
    },
    onBlur() {
      const d = current.current;
      if (d && d.active === id && !d.pointer) cancel(d);
    },
  });

  const layout = drag && layOut(drag);
  const rowProps = (id: string) => ({
    ref: (el: HTMLLIElement | null) => {
      if (el) rows.current.set(id, el);
      else rows.current.delete(id);
    },
    ...layout?.get(id),
  });

  return {
    rowProps,
    handleProps,
    announcement,
    instructionsId,
    dragging: drag !== null && !drag.dropped,
  };
}

type Placed = { style: CSSProperties; lift?: "lifted" | "swept" };

/**
 * Where every row is drawn during a drag, as a transform from where it sat at pick-up: rows
 * making room go to their place in the preview, the dragged row follows the pointer (kept off
 * the walls, so the whole block stays inside the list), and travelling rows stack against it.
 * One pass over the rows: O(V).
 */
function layOut(d: Drag): Map<string, Placed> {
  const height = (t: string) => d.heights.get(t)!;
  const { order, block } = d.preview;
  const top = new Map<string, number>();
  let y = 0;
  for (const t of order) {
    top.set(t, y);
    y += height(t);
  }
  const k = block.indexOf(d.active);
  const above = block.slice(0, k).reduce((sum, t) => sum + height(t), 0);
  const below = block.slice(k + 1).reduce((sum, t) => sum + height(t), 0);
  const activeTop = d.pointer
    ? Math.min(Math.max(d.top, above), d.listHeight - height(d.active) - below)
    : top.get(d.active)!;
  // The block is contiguous in the preview, so stacking it from the dragged row is one shift.
  const shift = activeTop - top.get(d.active)!;
  const inBlock = new Set(block);
  const placed = new Map<string, Placed>();
  for (const t of order) {
    const drawn = inBlock.has(t) ? top.get(t)! + shift : top.get(t)!;
    placed.set(t, {
      style: { transform: `translateY(${drawn - d.tops.get(t)!}px)` },
      lift: t === d.active ? "lifted" : inBlock.has(t) ? "swept" : undefined,
    });
  }
  return placed;
}
