import { useEffect, useState } from "react";
import { applyTheme, getStoredTheme, getSystemTheme, type Theme } from "../lib/theme";

export function useTheme() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = getStoredTheme();
    const currentTheme = stored ?? getSystemTheme();
    setTheme(currentTheme);
    setMounted(true);
  }, []);

  const toggleTheme = (newTheme?: Theme) => {
    const nextTheme = newTheme ?? (theme === "dark" ? "light" : "dark");
    setTheme(nextTheme);
    applyTheme(nextTheme);
  };

  return { theme, toggleTheme, mounted };
}
