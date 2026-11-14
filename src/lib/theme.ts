export type ThemePreference = "light" | "dark" | "black" | "system";
const KEY = "nyumbatrack-theme";

export function getThemePreference(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "black" || v === "system") return v;
  } catch {}
  return "system";
}

function systemPrefersDark() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyTheme(pref: ThemePreference = getThemePreference()) {
  const black = pref === "black";
  const dark = black || pref === "dark" || (pref === "system" && systemPrefersDark());
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.classList.toggle("black", black);
  root.style.colorScheme = dark ? "dark" : "light";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", black ? "#000000" : dark ? "#101915" : "#166534");
}

export function setThemePreference(pref: ThemePreference) {
  try { localStorage.setItem(KEY, pref); } catch {}
  applyTheme(pref);
  window.dispatchEvent(new Event("nyumbatrack-theme"));
}

/** Call once at startup: follows the device theme while "System" is selected. */
export function initTheme() {
  applyTheme();
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", () => { if (getThemePreference() === "system") applyTheme(); });
}
