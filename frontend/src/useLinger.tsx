import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

/** How long a ticked task stays in place, with its draining bar, before it leaves the list. */
export const LINGER_MS = 5000;

type Linger = {
  /** Ids of tasks still inside their window. */
  lingering: ReadonlySet<string>;
  start(id: string): void;
  stop(id: string): void;
};

// Outside a provider (the full task page) there's no window: nothing lingers.
const LingerContext = createContext<Linger>({
  lingering: new Set(),
  start() {},
  stop() {},
});

/**
 * The 5-second undo windows. Each tick starts its own timer, so two ticks a few
 * seconds apart each get their full five seconds; unticking stops it.
 */
export function LingerProvider({ children }: { children: ReactNode }) {
  const [lingering, setLingering] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  // Leaving the page drops the timers, so none fires on a page that's gone.
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const end = (id: string) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setLingering((current) => new Set([...current].filter((x) => x !== id)));
  };
  const value: Linger = {
    lingering,
    start(id) {
      clearTimeout(timers.current.get(id));
      timers.current.set(
        id,
        setTimeout(() => end(id), LINGER_MS),
      );
      setLingering((current) => new Set(current).add(id));
    },
    stop: end,
  };
  return <LingerContext value={value}>{children}</LingerContext>;
}

export const useLinger = () => useContext(LingerContext);
