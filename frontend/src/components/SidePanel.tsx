import { type ReactNode, useEffect, useRef } from "react";

type Props = { title: string; onClose: () => void; children: ReactNode };

/** A task beside the list on wide screens, and a sheet from the bottom on phones (CSS only). */
export function SidePanel({ title, onClose, children }: Props) {
  const panel = useRef<HTMLElement>(null);

  // Focus moves into the panel when it opens, so the keyboard lands on the title.
  useEffect(() => {
    panel.current?.querySelector("input")?.focus();
  }, []);

  // Escape closes it from anywhere on the page, as it would a dialog.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside className="panel" aria-label="Task details" ref={panel}>
      <header className="panel-head">
        <h2>{title}</h2>
        <button type="button" className="plain" onClick={onClose}>
          Close
        </button>
      </header>
      {children}
    </aside>
  );
}
