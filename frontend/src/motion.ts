/** Asked for less motion (jsdom has no matchMedia, so tests get the motion). */
export const reducedMotion = () =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Runs a screen change inside a View Transition, so elements glide to their new places.
 * Without the API (Firefox before 144, jsdom), or with reduced motion asked for, it just runs.
 */
export function withTransition(update: () => void): void {
  if (!("startViewTransition" in document) || reducedMotion()) return update();
  document.startViewTransition(async () => {
    update();
    // TanStack Query tells React about a cache change on the next tick; the new state is
    // captured after it renders.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
