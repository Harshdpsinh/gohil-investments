import { createContext, useContext, useState, useEffect } from "react";

const ThemeContext = createContext();

export const ThemeProvider = ({ children }) => {
  // Initialise from localStorage; fall back to OS preference; default to light.
  const [theme, setTheme] = useState(() => {
    try {
      const stored = localStorage.getItem("theme");
      if (stored === "dark" || stored === "light") return stored;
    } catch { /* localStorage unavailable (private browsing, etc.) */ }
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  // Keep <html> class in sync so Tailwind dark: variants work correctly.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try { localStorage.setItem("theme", theme) } catch { /* ignore */ }
  }, [theme]);

  const toggleTheme = () => setTheme(t => (t === "light" ? "dark" : "light"));

  // Expose `dark` boolean as a convenience alias (Sidebar uses `dark`, not `theme`).
  return (
    <ThemeContext.Provider value={{ theme, dark: theme === "dark", toggleTheme, toggle: () => setTheme(t => (t === "light" ? "dark" : "light")) }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
export default ThemeContext;