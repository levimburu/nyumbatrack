import { useEffect, useState } from "react";
import { Sun, Moon, MoonStar, Monitor } from "lucide-react";
import { getThemePreference, setThemePreference, type ThemePreference } from "@/lib/theme";

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "black", label: "Black", icon: MoonStar },
  { value: "system", label: "System", icon: Monitor },
];

export function AppearanceSelector() {
  const [pref, setPref] = useState<ThemePreference>(getThemePreference());
  useEffect(() => {
    const sync = () => setPref(getThemePreference());
    window.addEventListener("nyumbatrack-theme", sync);
    return () => window.removeEventListener("nyumbatrack-theme", sync);
  }, []);
  return (
    <div role="radiogroup" aria-label="Appearance" className="grid grid-cols-4 gap-1 rounded-xl bg-muted p-1">
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const on = pref === value;
        return (
          <button
            key={value} type="button" role="radio" aria-checked={on}
            onClick={() => setThemePreference(value)}
            className={`flex flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 text-[11px] font-semibold transition-colors ${on ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        );
      })}
    </div>
  );
}
