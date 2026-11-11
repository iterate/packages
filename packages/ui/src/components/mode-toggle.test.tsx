// The theme of an app: shadcn's class on <html>, from the person's choice or the system's setting.
import { runInNewContext } from "node:vm";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { ModeToggle, ThemeProvider, themeBootScript, themeClassOf } from "./mode-toggle.tsx";

test("a stored choice of light or dark wins over the system, and anything else follows it", () => {
  expect(themeClassOf("dark", false)).toBe("dark");
  expect(themeClassOf("light", true)).toBe("light");
  expect(themeClassOf("system", true)).toBe("dark");
  expect(themeClassOf(null, false)).toBe("light");
  expect(themeClassOf("purple", true)).toBe("dark");
});

test("the boot script puts that class on <html> before anything draws", () => {
  expect(classAfterBoot(() => "dark", false)).toEqual(["dark"]);
  expect(classAfterBoot(() => null, true)).toEqual(["dark"]);
  expect(classAfterBoot(() => "light", true)).toEqual(["light"]);
});

test("a browser that refuses storage follows the system", () => {
  expect(
    classAfterBoot(() => {
      throw new Error("storage is off");
    }, true),
  ).toEqual(["dark"]);
});

test("the mode toggle renders inside the provider, as shadcn's button", () => {
  const html = renderToStaticMarkup(
    <ThemeProvider>
      <ModeToggle />
    </ThemeProvider>,
  );
  expect(html).toContain("Toggle theme");
});

/** The classes of <html> after the boot script ran in a page that had "light" on it. */
function classAfterBoot(getItem: () => string | null, systemIsDark: boolean) {
  const classes = new Set(["light"]);
  runInNewContext(themeBootScript, {
    localStorage: { getItem },
    matchMedia: () => ({ matches: systemIsDark }),
    document: {
      documentElement: {
        classList: {
          remove: (...names: string[]) => names.forEach((name) => classes.delete(name)),
          add: (name: string) => classes.add(name),
        },
      },
    },
  });
  return [...classes];
}
