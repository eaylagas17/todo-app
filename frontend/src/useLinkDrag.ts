import type { PointerEvent as ReactPointerEvent } from "react";

/**
 * Linking by drag: press the dot on a task's edge, release over another task. The task you
 * drag from waits for the task you drop on. Pointer events cover mouse, touch and pen; the
 * drop target is whatever row or node is under the pointer, found by its data-task-id.
 */
export function useLinkDrag(onLink: (fromId: string, toId: string) => void) {
  const dotProps = (taskId: string) => ({
    onPointerDown(event: ReactPointerEvent) {
      event.preventDefault();
      document.body.classList.add("linking");
      const drop = (up: PointerEvent) => {
        window.removeEventListener("pointerup", drop);
        document.body.classList.remove("linking");
        const target = document
          .elementFromPoint(up.clientX, up.clientY)
          ?.closest<HTMLElement>("[data-task-id]");
        const toId = target?.dataset.taskId;
        if (toId && toId !== taskId) onLink(taskId, toId);
      };
      window.addEventListener("pointerup", drop);
    },
  });
  return { dotProps };
}
