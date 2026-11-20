// @vitest-environment jsdom
// The kit's pages of a Dash do their own reads: what a page says for a mind that has no vault or no
// integrations, what the secrets page says when the vault refuses, and that the Contexts page
// saves the member's log tails.
import { act, Suspense, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import {
  DashContexts,
  DashIntegrations,
  DashRepo,
  DashSecrets,
  type DashPageProps,
} from "./dash-pages.tsx";
import { savedLogTails } from "#/lib/saved-log-tail.ts";

test("a mind with no vault: the secrets page says so and lists nothing", async () => {
  const { itx, lists } = mind([], async () => []);
  await using page = await draw(DashSecrets, itx);
  expect(page.host).toMatchObject({ textContent: "This mind has no vault for secrets yet." });
  expect(lists()).toBe(0);
});

test("a vault that refuses: the page says its words", async () => {
  const { itx } = mind(["itx.secrets"], () => Promise.reject(new Error("The vault is asleep")));
  await using page = await draw(DashSecrets, itx);
  expect(page.host.querySelector('[role="alert"]')?.textContent).toBe("The vault is asleep");
});

test("a mind with no integrations: the page says so under its title", async () => {
  const { itx } = mind([], async () => []);
  await using page = await draw(DashIntegrations, itx);
  expect(page.host.querySelector("h1")?.textContent).toBe("Integrations");
  expect(page.host.textContent).toContain("This mind has no integrations yet.");
});

test("the Contexts page hands the member's saved tails to the explorer: the log it read is saved for a reload", async () => {
  history.replaceState(null, "", "/contexts/agents/a");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // jsdom lays nothing out: the virtual log's scroller asks for one
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const events = [1, 2].map((offset) => ({
    offset,
    type: "events.iterate.com/agent/context-added",
    createdAt: `2026-11-16T00:00:0${offset}.000Z`,
    path: "/agents/a",
    payload: { role: "user", content: `message ${offset}` },
  }));
  const context = {
    readEvents: async (after: number) => {
      const newer = events.filter((event) => event.offset > after);
      return { events: newer, atHead: true, scannedThroughOffset: 2 };
    },
    subscribe: async () => ({ [Symbol.dispose]() {} }),
    subscriptions: { list: async () => [] },
    rpcStubs: { list: async () => [] },
    invoke: async () => ({ rev: 1, state: {} }),
    [Symbol.dispose]() {},
  };
  const root = {
    cd: async () => context,
    invoke: async () => ({ rev: 1, state: {} }),
    subscribe: async () => ({ [Symbol.dispose]() {} }),
    [Symbol.dispose]() {},
  };
  const itx = { cd: async () => root } as unknown as DashPageProps["itx"];
  await using page = await draw(DashContexts, itx, { actor: "/members/a" });
  const tails = savedLogTails({ mind: "example.com", actor: "/members/a" });
  for (let tick = 0; tick < 80 && !tails.peek("/agents/a")?.tail; tick += 1)
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
  expect(page.host.textContent).toContain("2 events");
  expect(tails.peek("/agents/a")?.tail?.events.map((event) => event.offset)).toEqual([1, 2]);
});

test("the repo page draws no editor before the Dash knows who is signed in: a commit is in that person's name", async () => {
  const { itx } = mind([], async () => []);
  // the mind's root opens, and the account is not there yet
  const root = { subscribe: async () => ({ [Symbol.dispose]() {} }), [Symbol.dispose]() {} };
  const held = Object.assign(itx, { cd: async () => root });
  await using page = await draw(DashRepo, held, "unknown");
  const words = page.host.textContent;
  expect(words).toBe("Opening the mind…");
});

test("the repo page pushes a history entry when commit or file changes, and replaces when toggling sidebars", async () => {
  history.replaceState(null, "", "/repo");
  try {
    const { itx } = mind([], async () => []);
    const repoFacet = {
      listFiles: async () => ({ commitOid: "abc1234", paths: ["worker.ts", "AGENTS.md"] }),
      readFile: async (path: string) => `// ${path}\n`,
      log: async () => [
        {
          oid: "abc1234",
          message: "Initial commit",
          author: { name: "Ada", email: "ada@example.com" },
          timestamp: Date.now(),
          parents: [],
        },
      ],
      modules: async () => ({ "worker.ts": "// worker\n", "AGENTS.md": "# Guide\n" }),
      [Symbol.dispose]() {},
    };
    const root = {
      repos: { get: () => repoFacet },
      subscribe: async () => ({ [Symbol.dispose]() {} }),
      [Symbol.dispose]() {},
    };
    const held = Object.assign(itx, { cd: async () => root });
    await using page = await draw(DashRepo, held, {
      actor: "/members/a",
      email: "a@example.com",
    });
    const historyButton = () =>
      page.host.querySelector<HTMLButtonElement>('button[aria-label="History"]');
    for (let tick = 0; tick < 80 && !historyButton(); tick += 1)
      await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    // switching to the History sidebar replaces (no new history entry)
    const beforeHistory = history.length;
    await act(() => historyButton()!.click());
    expect(history.length).toBe(beforeHistory);
    expect(JSON.parse(new URLSearchParams(location.search).get("view") || "{}")).toEqual({
      history: true,
    });
    const buttonNamed = (name: string) =>
      [...page.host.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
        button.textContent?.includes(name),
      );
    for (let tick = 0; tick < 80 && !buttonNamed("Initial commit"); tick += 1)
      await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    // expanding a commit pushes a history entry
    await act(() => buttonNamed("Initial commit")!.click());
    expect(history.length).toBe(beforeHistory + 1);
    expect(JSON.parse(new URLSearchParams(location.search).get("view") || "{}")).toEqual({
      history: true,
      commit: "abc1234",
    });
    for (let tick = 0; tick < 80 && !buttonNamed("worker.ts"); tick += 1)
      await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    // opening a file pushes a history entry and writes `/repo/config/worker.ts`
    await act(() => buttonNamed("worker.ts")!.click());
    expect(location).toMatchObject({ pathname: "/repo/config/worker.ts" });
    expect(JSON.parse(new URLSearchParams(location.search).get("view") || "{}")).toEqual({
      history: true,
      commit: "abc1234",
    });
    expect(history.length).toBe(beforeHistory + 2);
  } finally {
    history.replaceState(null, "", "/");
  }
});

/** A mind that serves the roots `serves` names, with a vault that lists by `secrets`. */
function mind(serves: string[], secrets: () => Promise<{ path: string }[]>) {
  let lists = 0;
  const itx = {
    rewriteRules: {
      get: async (root: string) => (serves.includes(root) ? { target: "x" } : null),
    },
    secrets: {
      list: () => {
        lists += 1;
        return secrets();
      },
    },
  };
  return { itx: itx as unknown as DashPageProps["itx"], lists: () => lists };
}

/** The page as the Dash's shell draws it, once its part of the kit and its reads are in. */
async function draw(
  Page: (props: DashPageProps) => ReactNode,
  itx: DashPageProps["itx"],
  /** "unknown": the Dash has not heard yet who is signed in */
  principal: DashPageProps["principal"] | "unknown" = null,
) {
  const row = { id: "secrets", name: "Secrets", icon: () => null, component: () => null };
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(() =>
    root.render(
      <Suspense fallback="Loading the page…">
        <Page
          itx={itx}
          mind="example.com"
          principal={principal === "unknown" ? undefined : principal}
          page={row}
          pages={[row]}
          links={[]}
          agents={undefined}
          waiting={0}
          catalog={undefined}
        />
      </Suspense>,
    ),
  );
  // up to four seconds, inside the test's five: under a full test run a page's part takes two to load
  for (let tick = 0; tick < 80 && host.textContent?.match(/Loading|Reading/); tick += 1)
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
  // the root of an account not known yet opens meanwhile
  for (let tick = 0; tick < 4 && principal === "unknown"; tick += 1)
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
  return {
    host,
    [Symbol.asyncDispose]: async () => {
      await act(() => root.unmount());
      host.remove();
    },
  };
}
