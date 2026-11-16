// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { AgentContext, AgentMessage, SubagentActivities } from "./agent-context.tsx";
import { AgentProgress } from "./agent-chat/agent-chat.tsx";

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
});

test("server-supplied progress is rendered without an agent context", () => {
  const html = renderToStaticMarkup(
    <AgentProgress
      progress={{ text: "Running a script", working: true, activity: "Checking the release" }}
    />,
  );
  expect(html).toContain("Running a script");
  expect(html).toContain("Checking the release");
  expect(html).toContain('aria-label="Loading"');
  expect(
    renderToStaticMarkup(
      <AgentProgress progress={{ text: "Idle", working: false, activity: null }} />,
    ),
  ).toBe("");
});
test("subagent activity is one collapsed list of safe labels", () => {
  const html = renderToStaticMarkup(
    <SubagentActivities
      activities={[
        {
          path: "/agents/room/release",
          title: "Release",
          activity: "Checking assets",
          status: "working",
        },
      ]}
    />,
  );
  expect(html).toContain("1 agent active");
  expect(html).toContain("Release");
  expect(html).toContain("Checking assets");
  expect(html).not.toContain(" open=");
  expect(renderToStaticMarkup(<SubagentActivities activities={[]} />)).toBe("");
});
test("incoming messages show the attributed sender path", () => {
  const html = renderToStaticMarkup(
    <AgentMessage
      message={{
        key: "message:90",
        offset: 90,
        createdAt: "2026-01-01",
        from: "/agents/release",
        text: "Published",
      }}
    />,
  );
  expect(html).toContain("/agents/release");
  expect(html).toContain("Published");
});

test("equal-time host batches stay in numeric order before equal-time incoming messages", async () => {
  const at = "2026-11-16T00:00:00Z";
  using _page = await mount({
    context: {
      events: [9, 10, 11].map((offset) => ({
        offset,
        type: "host/row",
        createdAt: at,
        payload: {},
      })),
      caughtUp: true,
    },
    renderers: { "host/row": (event) => <p data-testid="ordered">{event.offset}</p> },
    messages: [
      {
        key: "incoming:1",
        offset: 1,
        createdAt: at,
        from: "/agents/report",
        text: "Incoming report",
      },
    ],
  });
  expect(
    [...document.querySelectorAll("[data-testid=ordered]")].map((row) => row.textContent),
  ).toEqual(["9", "10", "11"]);
  expect(document.querySelector("[role=log]")?.textContent).toMatch(/9.*10.*11.*Incoming report/s);
});

test.for(["none", "idle", "context"])(
  "the empty greeting remains visible with %s progress",
  async (kind) => {
    using _page = await mount({
      empty: <p>Send a message to begin</p>,
      progress: kind === "idle" ? { text: "Idle", working: false, activity: null } : undefined,
      agentContext:
        kind === "context"
          ? {
              events: [],
              caughtUp: true,
              processors: { rows: [], loaded: true },
              presence: { actors: [], rpcStubs: [] },
              liveState: {},
            }
          : undefined,
    });
    expect(document.querySelector("[role=log]")?.textContent).toContain("Send a message to begin");
  },
);

test("a failed history read stops pagination and shows the error until recovery", async () => {
  const loadOlder = vi.fn();
  const context = {
    events: [],
    caughtUp: true,
    error: "History unavailable",
    older: { loading: false, exhausted: false, loadOlder },
  };
  using page = await mount({ context });
  expect(loadOlder).not.toHaveBeenCalled();
  expect(document.querySelector("[data-type=error]")?.textContent).toBe("History unavailable");
  expect(document.body.textContent?.match(/History unavailable/g)).toHaveLength(1);
  await page.render({ context: { ...context, error: undefined } });
  expect(loadOlder).toHaveBeenCalledOnce();
  expect(document.querySelector("[data-type=error]")).toBeNull();
});

test.for([
  { name: "initial read", caughtUp: false },
  { name: "failed history", caughtUp: true, error: "History unavailable" },
  {
    name: "older pages available",
    caughtUp: true,
    older: { exhausted: false, loading: false, loadOlder: () => {} },
  },
  {
    name: "older page loading",
    caughtUp: true,
    older: { exhausted: false, loading: true, loadOlder: () => {} },
  },
])("the empty greeting waits during $name", async ({ name: _name, ...context }) => {
  using _page = await mount({
    context: { events: [], ...context },
    empty: <p>Send a message to begin</p>,
  });
  expect(document.querySelector("[role=log]")?.textContent).not.toContain(
    "Send a message to begin",
  );
});

type Props = ComponentProps<typeof AgentContext>;

/** Give the virtual log a measured height in jsdom. */
function laidOut() {
  const sizes = { clientHeight: 600, offsetHeight: 0 };
  const own = Object.keys(sizes).map(
    (name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)] as const,
  );
  for (const [name, value] of Object.entries(sizes))
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get: () => value });
  return {
    [Symbol.dispose]: () => {
      for (const [name, descriptor] of own) {
        if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
        else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
      }
    },
  };
}

async function mount(patch: Partial<Props>) {
  const layout = laidOut();
  const div = document.createElement("div");
  document.body.append(div);
  const root = createRoot(div);
  const defaults: Props = {
    path: "/conversation/test",
    context: { events: [], caughtUp: true },
    state: {},
    onStateChange: () => {},
    onMessage: async () => {},
    renderers: {},
  };
  const render = async (next: Partial<Props>) => {
    await act(async () => root.render(<AgentContext {...defaults} {...next} />));
  };
  await render(patch);
  return {
    render,
    [Symbol.dispose]: () => {
      act(() => root.unmount());
      div.remove();
      layout[Symbol.dispose]();
    },
  };
}
