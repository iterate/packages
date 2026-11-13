// @vitest-environment jsdom
// A mind's Dash drawn from lists: one list of pages makes the sidebar and the overview's cards, the
// URL names the page shown, a part the mind does not have says "Off", and a page that fails says
// so in its own place.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { BotIcon, ChartLineIcon, LayoutDashboardIcon, ShieldCheckIcon } from "lucide-react";
import { Dash, DashOverview, type DashPage } from "./dash.tsx";
import type { DashPageProps } from "./dash-pages.tsx";

test("one list makes the sidebar and the cards; a mind with no telemetry shows Analytics as Off, and is asked once", async () => {
  await using dash = await draw("/", []);
  const { host } = dash;
  expect(host.querySelector("h1")?.textContent).toBe("example.com");
  // the overview's cards: each page with an `about`, then each group of links
  expect([...host.querySelectorAll("h2")].map((title) => title.textContent)).toEqual([
    "The mind",
    "Access",
  ]);
  expect(host.textContent).toContain("Telemetry is off.");
  expect(host.textContent).not.toContain("The mind's telemetry.");
  // the sidebar's row and the card both lead to ?page=analytics, and both say Off
  expect(linksNamed(host, "Analytics").map((link) => link.getAttribute("href"))).toEqual([
    "?page=analytics",
    "?page=analytics",
  ]);
  expect(host.textContent?.match(/Off/g)).toHaveLength(2);
  expect(linksNamed(host, "Overview")[0]?.getAttribute("href")).toBe("./");
  expect(dash.asked.filter((root) => root === "itx.telemetry")).toHaveLength(1);
});

test("a mind with telemetry has no Off; a click on a page's card shows that page and keeps the sidebar", async () => {
  await using dash = await draw("/", ["itx.telemetry"]);
  const { host } = dash;
  expect(host.textContent).toContain("The mind's telemetry.");
  expect(host.textContent).not.toContain("Off");
  const card = linksNamed(host, "Analytics").at(-1)!;
  await act(() => card.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 })));
  expect(location).toMatchObject({ search: "?page=analytics" });
  expect(host.textContent).toContain("the charts");
  expect(host.querySelector("h1")).toBeNull();
  expect(linksNamed(host, "Overview")).toHaveLength(1);
});

test("a page that did not load says so on its own page alone, with the way to load again", async () => {
  // React reports what an error boundary caught
  vi.spyOn(console, "error").mockImplementation(() => {});
  await using dash = await draw("/?page=broken", []);
  const { host } = dash;
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(
    "This page did not load: Failed to fetch dynamically imported module. Load the page again to try once more.",
  );
  // the sidebar stays, and another page draws as before
  await act(() => linksNamed(host, "Overview")[0]!.click());
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelector("h1")?.textContent).toBe("example.com");
});

test("a page the URL does not name is the first page", async () => {
  await using dash = await draw("/?page=nothing-here", []);
  expect(dash.host.querySelector("h1")?.textContent).toBe("example.com");
});

const pages: DashPage[] = [
  {
    id: "overview",
    name: "Overview",
    icon: LayoutDashboardIcon,
    component: (props: DashPageProps) => (
      <DashOverview {...props} pagesTitle="The mind">
        Signed in.
      </DashOverview>
    ),
  },
  {
    id: "analytics",
    name: "Analytics",
    icon: ChartLineIcon,
    about: "The mind's telemetry.",
    serves: "telemetry",
    offAbout: "Telemetry is off.",
    component: () => <p>the charts</p>,
  },
  {
    id: "broken",
    name: "Broken",
    icon: BotIcon,
    about: "A page that fails.",
    component: () => {
      throw new Error("Failed to fetch dynamically imported module");
    },
  },
];

const links = [
  {
    title: "Access",
    rows: [
      {
        name: "Approvals",
        href: "https://iterate.example.com/secrets/approvals",
        icon: ShieldCheckIcon,
        about: "What waits for your yes.",
        count: "approvals" as const,
      },
    ],
  },
];

/** The Dash at `url`, for a mind that serves the roots `serves` names and has no vault (nothing
 *  waits for approval). The sidebar asks the viewport's width, and the switcher this host's
 *  minds. */
async function draw(url: string, serves: string[]) {
  history.replaceState(null, "", url);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal("fetch", async () =>
    Response.json({ minds: [{ address: "example.com", lastUsedAt: 0 }], lastUsed: "example.com" }),
  );
  const asked: string[] = [];
  const itx = {
    rewriteRules: {
      get: async (root: string) => {
        asked.push(root);
        return serves.includes(root) ? { target: "x" } : null;
      },
    },
  } as unknown as DashPageProps["itx"];
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(() =>
    root.render(
      <Dash
        app="Dash"
        itx={itx}
        mind="example.com"
        principal={{ actor: "/members/a", email: "a@example.com" }}
        pages={pages}
        links={links}
      />,
    ),
  );
  await act(async () => {});
  return {
    host,
    asked,
    [Symbol.asyncDispose]: async () => {
      await act(() => root.unmount());
      host.remove();
    },
  };
}

function linksNamed(host: Element, name: string) {
  return [...host.querySelectorAll("a")].filter((link) => link.textContent?.includes(name));
}
