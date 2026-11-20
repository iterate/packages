// @vitest-environment jsdom
// The page's side of an agent's tools (./page-tools.tsx): it lends when it is mounted, shows the
// agent's path on what the agent shows, and Stop ends the lend for the tab.
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import type { PageTarget, RuleRow } from "../lib/page-tools.ts";
import { PageTools } from "./page-tools.tsx";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

test("a mounted page lends under the person's name, a banner's first lines are the page's, and Stop ends the lend for the tab", async () => {
  sessionStorage.clear();
  const { itx, lent, appended } = mind();
  await using page = await draw(itx);
  const [name, tools] = [...lent][0]!;
  expect(name).toMatch(/^itx\.page\.jonas\.[a-z2-7]{12}$/);
  expect(layer()?.outerHTML).toBeUndefined();

  let answer: unknown;
  await act(async () => {
    void tools.banner
      .show({
        title: "From iterate Security",
        body: "Type your password",
        buttons: [{ label: "OK" }],
      })
      .then((got) => (answer = got));
  });
  const banner = document.querySelector("[data-slot=page-tools-banner]")!;
  expect([...banner.querySelectorAll("p")].slice(0, 2).map((line) => line.textContent)).toEqual([
    "Helper",
    "/agents/helper",
  ]);
  expect(banner.querySelector("h2")?.textContent).toBe("From iterate Security");
  // the layer never matches a locator: the agent cannot press its own banner
  expect(layer()?.getAttribute("data-page-tools")).toBe("off");
  expect(document.querySelector("[role=status]")?.textContent).toBe(
    "Helper is showing a noticeStop",
  );
  // a name that arrives after the lend is drawn, and is no new lend
  await page.draw("The helper");
  expect(document.querySelector("[role=status]")?.textContent).toBe(
    "The helper is showing a noticeStop",
  );
  expect([...lent.keys()]).toEqual([name]);

  const stop = [...document.querySelectorAll("button")].find((b) => b.textContent === "Stop")!;
  await act(async () => stop.click());
  expect(answer).toEqual({ pressed: null, why: "off" });
  expect([[...lent.keys()], layer()?.outerHTML]).toEqual([[], undefined]);
  await expect(tools.banner.show({ title: "Again" })).rejects.toThrow(/lend ended/);
  expect(appended).toEqual([
    {
      type: "events.iterate.com/page/tool-called",
      payload: { tool: "banner.show", outcome: "done" },
    },
  ]);
  // Stop is the tab's: the page drawn anew lends nothing
  {
    await using _again = await draw(itx);
    expect([...lent.keys()]).toEqual([]);
  }
  sessionStorage.clear();
});

test("Stop ends the lend also where the tab's store refuses to keep it, and a store that cannot be read lends as if nothing was kept", async () => {
  sessionStorage.clear();
  const refuses = () => {
    throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
  };
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(refuses);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(refuses);
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { itx, lent } = mind();
  await using _page = await draw(itx);
  const [, tools] = [...lent][0]!;
  await act(async () => {
    void tools.banner.show({ title: "Look" }).catch(() => {});
  });
  const stop = [...document.querySelectorAll("button")].find((b) => b.textContent === "Stop")!;
  await act(async () => stop.click());
  expect([[...lent.keys()], layer()?.outerHTML]).toEqual([[], undefined]);
});

test("a page that leaves the agent ends its lend, and a jailed agent gets none", async () => {
  sessionStorage.clear();
  const open = mind();
  {
    await using _page = await draw(open.itx);
    expect([...open.lent.keys()]).toHaveLength(1);
  }
  expect([...open.lent.keys()]).toEqual([]);

  const jailed = mind([{ match: "itx.run", target: "itx.builtins.cd('/jails/a/b/c').run" }]);
  await using _page = await draw(jailed.itx, "/agents/guest");
  expect([...jailed.lent.keys()]).toEqual([]);
});

/** A mind whose agent contexts keep what was lent to them, and what was appended. */
function mind(
  rules: RuleRow[] = [
    { match: "itx.run", target: "itx.builtins.run" },
    { match: "itx.cd", target: "itx.builtins.cd" },
  ],
) {
  const lent = new Map<string, PageTarget>();
  const appended: unknown[] = [];
  const itx = {
    cd: async () => ({
      rewriteRules: { list: async () => rules },
      provide: async (match: string, target: unknown) => {
        // the test's mind keeps what it was handed, which is the session's own target
        lent.set(match, target as PageTarget);
        return { [Symbol.dispose]: () => void lent.delete(match) };
      },
      append: async (event: unknown) => void appended.push(event),
      [Symbol.dispose]() {},
    }),
  };
  return { itx, lent, appended };
}

async function draw(itx: ReturnType<typeof mind>["itx"], path = "/agents/helper") {
  document.body.innerHTML = `<main data-page-tools="scope"><div id="app"></div></main>`;
  const root = createRoot(document.getElementById("app")!);
  const drawWith = (agent: string) =>
    act(async () =>
      root.render(
        // Strict mode runs each effect twice: the lend that stands is the second, with tools of its own
        <StrictMode>
          <PageTools
            itx={itx}
            path={path}
            me={{ actor: "/members/a", email: "jonas@example.com" }}
            agent={agent}
          />
        </StrictMode>,
      ),
    );
  await drawWith("Helper");
  return {
    draw: drawWith,
    [Symbol.asyncDispose]: async () => {
      await act(() => root.unmount());
    },
  };
}

const layer = () => document.querySelector("[data-slot=page-tools-layer]");
