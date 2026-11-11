// mode-toggle.tsx — LIGHT, DARK, OR AS THE SYSTEM IS. shadcn's own way: the class `dark` on <html>
// (styles/globals.css), set by next-themes, which also keeps the choice in this browser's storage
// and follows the system while the choice is "system". That is the default.
//
// Every app of ours has it through its shell: `AppShell` is inside a `ThemeProvider`, and its
// account menu has the three choices beside Sign out (`ThemeMenuItems`). `ModeToggle` is shadcn's
// button with the same three, for a page with no account menu. A page that draws before React
// does (a no-build app's index.html) puts `themeBootScript` inline in its <head>, so that a
// stored "dark" is there at the first paint.
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import type { ReactNode } from "react";
import { Button } from "#/components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";

/** Where this browser keeps the choice: next-themes's own key, which the boot script reads too. */
const STORAGE_KEY = "theme";

const CHOICES = [
  { value: "light", label: "Light", Icon: SunIcon },
  { value: "dark", label: "Dark", Icon: MoonIcon },
  { value: "system", label: "System", Icon: MonitorIcon },
] as const;

/** The app's theme: the class on <html>, the stored choice, the system's setting. One inside
 *  another changes nothing: the outer one is the app's. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey={STORAGE_KEY}
    >
      {children}
    </NextThemesProvider>
  );
}

/** shadcn's mode toggle: a button that opens Light, Dark and System. */
export function ModeToggle() {
  const { setTheme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="icon" title="Toggle theme">
            <SunIcon className="scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
            <MoonIcon className="absolute scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        {CHOICES.map(({ value, label }) => (
          <DropdownMenuItem key={value} onClick={() => setTheme(value)}>
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The same three choices for a menu that is there already: a group of radio items, the chosen
 *  one checked. */
export function ThemeMenuItems() {
  const { theme, setTheme } = useTheme();
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel className="text-xs text-muted-foreground">Theme</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={theme || "system"} onValueChange={setTheme}>
        {CHOICES.map(({ value, label, Icon }) => (
          <DropdownMenuRadioItem key={value} value={value} data-theme-choice={value}>
            <Icon />
            {label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuGroup>
  );
}

/** What the class on <html> is for a stored choice and a system: "dark" or "light". */
export function themeClassOf(stored: string | null, systemIsDark: boolean): "light" | "dark" {
  if (stored === "light" || stored === "dark") return stored;
  return systemIsDark ? "dark" : "light";
}

/** For a page's <head>, inline, before anything draws: the class that `ThemeProvider` sets once
 *  React runs. A browser that refuses storage follows the system. */
export const themeBootScript = `(() => {
  const themeClassOf = ${themeClassOf.toString()};
  let stored = null;
  try { stored = localStorage.getItem(${JSON.stringify(STORAGE_KEY)}); } catch {}
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(themeClassOf(stored, matchMedia("(prefers-color-scheme: dark)").matches));
})();`;
