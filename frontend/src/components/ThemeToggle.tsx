import { useState } from "react";

type Theme = "light" | "dark";

// What the page shows now: the saved choice (index.html puts it on <html> before the first
// paint), else the system's.
const current = (): Theme =>
  (document.documentElement.dataset.theme as Theme | undefined) ??
  (typeof matchMedia === "function" &&
  matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light");

/** Light or dark, remembered. Until someone picks, the page follows the system. */
export function ThemeToggle() {
  const [theme, setTheme] = useState(current);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    // index.html reads this key. Storage can refuse (private windows): it still switches.
    try {
      localStorage.setItem("todo.theme", next);
    } catch {}
    setTheme(next);
  }

  return (
    <button
      type="button"
      className="secondary theme"
      aria-label="Dark mode"
      aria-pressed={theme === "dark"}
      onClick={toggle}
    >
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}
