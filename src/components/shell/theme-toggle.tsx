"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem("mcc_theme", theme);
  } catch { /* storage unavailable */ }
}

// Light/dark toggle. The initial class is set pre-paint by the inline script
// in the root layout, so there is no flash of the wrong theme.
export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = React.useState<Theme>("light");
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  };

  return (
    <button
      onClick={toggle}
      className={className ?? "rounded-md p-2 text-body hover:bg-canvas-soft-2 hover:text-ink"}
      aria-label={mounted && theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={mounted && theme === "dark" ? "Light mode" : "Dark mode"}
    >
      {mounted && theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}
