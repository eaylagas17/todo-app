import {
  type CSSProperties,
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useSearchParams } from "react-router";
import type { Task } from "../api.ts";
import { useCategories, useLink, useToggleSubtask } from "../queries.ts";
import { linkInfo, subtaskProgress } from "../tasks.ts";
import { useLinkDrag } from "../useLinkDrag.ts";
import { layoutGraph } from "./layout.ts";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 1.5;
const ZOOM_STEP = 0.25;
const clamp = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

type Props = {
  /** The tasks to draw (what the list would show). */
  tasks: Task[];
  /** The whole list, which steps, colours and "waiting" are computed from. */
  all: Task[];
};

/** The same tasks as the list, drawn as steps from left to right (spec §10). */
export function GraphView({ tasks, all }: Props) {
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const [zoom, setZoom] = useState(1);
  const { nodes, edges, width, height } = useMemo(
    () => layoutGraph(tasks, folded, all),
    [tasks, folded, all],
  );
  const links = useMemo(() => linkInfo(all), [all]);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const categories = useCategories();
  const [params] = useSearchParams();
  const tick = useToggleSubtask();
  const linkTo = useLink();
  const { dotProps } = useLinkDrag((fromId, toId) =>
    linkTo.mutate({ taskId: fromId, dependsOnId: toId }),
  );
  const scroller = useRef<HTMLDivElement>(null);
  usePanAndZoom(scroller, setZoom);

  // A node opens the panel by changing only ?task, so the graph stays in view.
  const openTask = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("task", id);
    return { search: next.toString() };
  };
  const toggleFold = (id: string) =>
    setFolded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  function fit() {
    const box = scroller.current;
    if (box && width && height)
      setZoom(
        clamp(Math.min(box.clientWidth / width, box.clientHeight / height)),
      );
  }

  return (
    <section className="graph" aria-label="Task graph">
      <div className="zoom">
        <button
          type="button"
          className="secondary"
          aria-label="Zoom out"
          onClick={() => setZoom((z) => clamp(z - ZOOM_STEP))}
        >
          −
        </button>
        <span data-testid="zoom">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          className="secondary"
          aria-label="Zoom in"
          onClick={() => setZoom((z) => clamp(z + ZOOM_STEP))}
        >
          +
        </button>
        <button type="button" className="secondary" onClick={fit}>
          Fit
        </button>
      </div>
      <div className="graph-scroll" ref={scroller}>
        {/* The outer box has the zoomed size, so the scrollbars match what's drawn. */}
        <div style={{ width: width * zoom, height: height * zoom }}>
          <div
            className="graph-canvas"
            style={{ width, height, transform: `scale(${zoom})` }}
          >
            <svg width={width} height={height} aria-hidden="true">
              {edges.map((edge) => (
                <path
                  key={`${edge.kind}:${edge.from}:${edge.to}`}
                  d={edge.d}
                  className={edge.kind}
                  style={{ "--hue": links.get(edge.to)?.hue } as CSSProperties}
                />
              ))}
            </svg>
            {nodes.map((node) => {
              const task = byId.get(node.taskId)!;
              const box = {
                left: node.x,
                top: node.y,
                width: node.w,
                height: node.h,
              };
              if (node.kind === "subtask") {
                const subtask = task.subtasks.find((s) => s.id === node.id)!;
                return (
                  <label key={node.id} className="child" style={box}>
                    <input
                      type="checkbox"
                      checked={subtask.completed}
                      onChange={(event) =>
                        tick.mutate({
                          taskId: task.id,
                          subtaskId: subtask.id,
                          completed: event.target.checked,
                        })
                      }
                    />
                    <span>{subtask.title}</span>
                  </label>
                );
              }
              const info = links.get(task.id);
              const category = categories.data?.find(
                (c) => c.id === task.category_id,
              )?.name;
              const second = [
                info?.waitsFor.length
                  ? `Waits for: ${info.waitsFor.join(", ")}`
                  : null,
                subtaskProgress(task),
                category,
              ].filter(Boolean);
              return (
                <div
                  key={node.id}
                  className={info ? "node linked" : "node"}
                  data-task-id={task.id}
                  style={
                    {
                      ...box,
                      "--hue": info?.hue,
                      // Accent A: the same name as the task's row, so switching views morphs one into the other.
                      viewTransitionName: `task-${task.id}`,
                    } as CSSProperties
                  }
                >
                  {info && (
                    <span
                      role="img"
                      aria-label={`Step ${info.step}, ${info.waiting ? "waiting" : "ready"}`}
                      className="step"
                    >
                      {info.step}
                    </span>
                  )}
                  <Link
                    to={openTask(task.id)}
                    className={task.completed ? "node-text done" : "node-text"}
                  >
                    <span className="title">{task.title}</span>
                    <span className="sub">
                      {info && <span className="chain" aria-hidden="true" />}
                      {second.join(" · ") || (info ? "" : "No links")}
                    </span>
                  </Link>
                  {task.subtasks.length > 0 && (
                    <button
                      type="button"
                      className="fold"
                      aria-expanded={!folded.has(task.id)}
                      aria-label={`Subtasks of ${task.title}`}
                      onClick={() => toggleFold(task.id)}
                    >
                      ▾
                    </button>
                  )}
                  <button
                    type="button"
                    className="dot"
                    aria-label={`Link ${task.title} to another task`}
                    {...dotProps(task.id)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Pan by scrolling, or by dragging the background with one pointer; zoom with Ctrl/⌘ + wheel
 * (a trackpad pinch arrives as one) or by pinching with two fingers. Native listeners, because
 * React's wheel listener is passive and couldn't stop the browser zooming the whole page.
 */
function usePanAndZoom(
  scroller: RefObject<HTMLDivElement | null>,
  setZoom: Dispatch<SetStateAction<number>>,
) {
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    // Every finger counts towards a pinch, wherever it lands (on a phone most land on a node
    // or a link dot); only one that starts on the background pans.
    const pointers = new Map<
      number,
      { x: number; y: number; background: boolean }
    >();
    let pinchFrom = 0;

    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom((z) => clamp(z * (event.deltaY < 0 ? 1.1 : 1 / 1.1)));
    };
    const down = (event: PointerEvent) => {
      const background = !(event.target as Element).closest(".node, .child");
      // Captured only on the background, so a tap on a node or a checkbox still clicks it.
      if (background) box.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
        background,
      });
    };
    const move = (event: PointerEvent) => {
      const last = pointers.get(event.pointerId);
      if (!last) return;
      if (pointers.size === 1 && last.background) {
        box.scrollLeft -= event.clientX - last.x;
        box.scrollTop -= event.clientY - last.y;
      }
      pointers.set(event.pointerId, {
        ...last,
        x: event.clientX,
        y: event.clientY,
      });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        // The ratio is fixed now: React runs the updater later, after pinchFrom has moved on.
        const ratio = pinchFrom ? distance / pinchFrom : 1;
        setZoom((z) => clamp(z * ratio));
        pinchFrom = distance;
      }
    };
    const up = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      pinchFrom = 0;
    };

    box.addEventListener("wheel", wheel, { passive: false });
    box.addEventListener("pointerdown", down);
    box.addEventListener("pointermove", move);
    box.addEventListener("pointerup", up);
    box.addEventListener("pointercancel", up);
    return () => {
      box.removeEventListener("wheel", wheel);
      box.removeEventListener("pointerdown", down);
      box.removeEventListener("pointermove", move);
      box.removeEventListener("pointerup", up);
      box.removeEventListener("pointercancel", up);
    };
  }, [scroller, setZoom]);
}
