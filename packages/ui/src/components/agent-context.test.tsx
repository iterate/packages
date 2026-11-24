// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { AgentContext, AgentMessage, SubagentActivities } from "./agent-context.tsx";
import { AgentProgress } from "./agent-chat/agent-chat.tsx";
import {
  liveState,
  request,
  runRequested,
  runSettled,
  said,
  settled,
  succeeded,
} from "#/test-support/agent-log.ts";

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

// THE AGENT'S WORK AND THE CALL'S WORDS: a room's log (typed lines, spoken lines) and its agent's
// own log, which folds into one settled activity (the chat's fixture turn: agent-events.test.ts).
test("a settled activity of the agent sits between the line that asked for it and the answer", async () => {
  using _page = await mount({
    context: { events: [room(1, "typed"), room(30, "typed")], caughtUp: true },
    renderers: roomRenderers,
    agentContext: agentLog(agentTurn(1)),
  });
  expect(kinds()).toEqual(["typed", "activity", "typed"]);
});

test("a press opens the activity in place, and its trace control opens the trace in the state", async () => {
  const onStateChange = vi.fn();
  using _page = await mount({
    context: { events: [room(1, "typed")], caughtUp: true },
    renderers: roomRenderers,
    agentContext: agentLog(agentTurn(1)),
    onStateChange,
  });
  const row = document.querySelector("[data-kind=activity]");
  const toggle = row?.querySelector("button[aria-expanded]");
  expect(toggle?.getAttribute("aria-expanded")).toBe("false");
  await press(toggle);
  expect(toggle?.getAttribute("aria-expanded")).toBe("true");
  await press(row?.querySelector('button[title^="Open this script"]'));
  expect(onStateChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ scriptRun: 5, llmRequest: undefined }),
  );
});

test("a guest's page shows none of the agent's scripts: activityRows={false} draws no activity row and no trace, and still the progress line", async () => {
  using page = await mount({
    context: { events: [room(1, "typed")], caughtUp: true },
    renderers: roomRenderers,
    agentContext: agentLog(agentTurn(1)),
    activityRows: false,
    state: { llmRequest: 2 },
  });
  expect(document.querySelector("[data-kind=activity]")).toBeNull();
  expect(document.querySelector("[role=dialog]")).toBeNull();
  expect(document.body.textContent).not.toContain("itx.kv.put");
  await page.render({
    context: { events: [room(1, "typed")], caughtUp: true },
    renderers: roomRenderers,
    agentContext: agentLog(agentTurn(1), WORKING),
    activityRows: false,
  });
  expect(document.querySelector("[data-testid=agent-progress]")?.textContent).toContain(
    "Thinking · m",
  );
  expect(document.querySelector("[data-kind=activity]")).toBeNull();
});

test("a turn in which the agent only thought is no row: in a room that would be one after almost every line", async () => {
  using _page = await mount({
    context: { events: [room(1, "typed"), room(30, "typed")], caughtUp: true },
    renderers: roomRenderers,
    // the request and its settlement, and no script
    agentContext: agentLog(agentTurn(1).slice(0, 3)),
  });
  expect(kinds()).toEqual(["typed", "typed"]);
});

test("an activity still running is no row: it is the progress line", async () => {
  using _page = await mount({
    context: { events: [room(1, "typed")], caughtUp: true },
    renderers: roomRenderers,
    agentContext: agentLog(
      agentTurn(1).filter((event) => event.type !== "events.iterate.com/itx/run-settled"),
      liveState({ scriptCalls: [{ answered: false }] }),
    ),
  });
  expect(document.querySelector("[data-kind=activity]")).toBeNull();
  expect(document.querySelector("[data-testid=agent-progress]")).not.toBeNull();
});

test("three lines said in a row are one closed rollup; a press opens it, with (you) for the viewer", async () => {
  using _page = await mount({
    context: { events: [room(1, "said"), room(2, "said"), room(3, "said")], caughtUp: true },
    renderers: roomRenderers,
    spokenLine,
    me: "ann@example.com",
  });
  expect(kinds()).toEqual(["rollup"]);
  const toggle = document.querySelector("[data-kind=rollup] button[aria-expanded]");
  expect(toggle?.textContent).toMatch(/3 lines said · /);
  expect(toggle?.getAttribute("aria-expanded")).toBe("false");
  expect(document.body.textContent).not.toContain("said 2");
  await press(toggle);
  expect(toggle?.getAttribute("aria-expanded")).toBe("true");
  expect(document.querySelector("[data-kind=rollup]")?.textContent).toContain("(you)");
});

test("a typed row, and an activity row, each split the spoken lines into two rollups", async () => {
  using page = await mount({
    context: { events: [room(1, "said"), room(2, "typed"), room(3, "said")], caughtUp: true },
    renderers: roomRenderers,
    spokenLine,
  });
  expect(kinds()).toEqual(["rollup", "typed", "rollup"]);
  // the agent's turn starts at second 11; its activity starts with its request, at second 13
  await page.render({
    context: { events: [room(10, "said"), room(30, "said")], caughtUp: true },
    renderers: roomRenderers,
    spokenLine,
    agentContext: agentLog(agentTurn(10)),
  });
  expect(kinds()).toEqual(["rollup", "activity", "rollup"]);
});

test("an opened rollup stays open as lines are said and as older lines load in front of it", async () => {
  const props = (events: ReturnType<typeof room>[]): Partial<Props> => ({
    context: { events, caughtUp: true },
    renderers: roomRenderers,
    spokenLine,
  });
  const now = [room(5, "typed"), room(6, "said"), room(7, "said")];
  using page = await mount(props(now));
  const last = () => [...document.querySelectorAll("[data-kind=rollup] button")].at(-1);
  await press(last());
  expect(last()?.getAttribute("aria-expanded")).toBe("true");
  await page.render(props([...now, room(8, "said"), room(9, "said")]));
  expect(last()?.textContent).toMatch(/^4 lines said/);
  expect(last()?.getAttribute("aria-expanded")).toBe("true");
  await page.render(props([room(2, "said"), room(3, "said"), ...now, room(8, "said")]));
  expect(kinds()).toEqual(["rollup", "typed", "rollup"]);
  expect(last()?.textContent).toMatch(/^3 lines said/);
  expect(last()?.getAttribute("aria-expanded")).toBe("true");
});

test("an opened rollup stays open when the agent's older work lands in front of it, and the part with the opened line when work lands inside it", async () => {
  const props = (agentContext?: Props["agentContext"]): Partial<Props> => ({
    context: { events: [room(20, "said"), room(40, "said")], caughtUp: true },
    renderers: roomRenderers,
    spokenLine,
    agentContext,
  });
  using page = await mount(props());
  const rollups = () => [...document.querySelectorAll("[data-kind=rollup] > button")];
  await press(rollups()[0]);
  expect(rollups().map((button) => button.getAttribute("aria-expanded"))).toEqual(["true"]);
  // the agent's older page arrives: its work of second 5 lands in front of the run, which is
  // then named by that row
  await page.render(props(agentLog(agentTurn(5))));
  expect(kinds()).toEqual(["activity", "rollup"]);
  expect(rollups().map((button) => button.getAttribute("aria-expanded"))).toEqual(["true"]);
  // work that began between the two lines splits the run
  await page.render(props(agentLog(agentTurn(25))));
  expect(kinds()).toEqual(["rollup", "activity", "rollup"]);
  expect(rollups().map((button) => button.getAttribute("aria-expanded"))).toEqual([
    "true",
    "false",
  ]);
  // a press closes it again
  await press(rollups()[0]);
  expect(rollups()[0]?.getAttribute("aria-expanded")).toBe("false");
});

test("strip={false} is the feed alone: no Events tab over the host's raw log", async () => {
  const props: Partial<Props> = {
    context: { events: [room(5, "typed")], caughtUp: true },
    renderers: roomRenderers,
    status: { text: "Quiet", tone: "muted" },
  };
  using page = await mount(props);
  expect(document.body.textContent).toContain("Events");
  expect(document.body.textContent).toContain("Quiet");
  await page.render({ ...props, strip: false });
  expect(document.body.textContent).not.toContain("Events");
  expect(kinds()).toEqual(["typed"]);
});

test("eventsTab={false} keeps the status line and drops the Events tab: a guest's view of a room", async () => {
  using _page = await mount({
    context: { events: [room(5, "typed")], caughtUp: true },
    renderers: roomRenderers,
    status: { text: "2 speaking", tone: "live" },
    eventsTab: false,
  });
  expect(document.body.textContent).toContain("2 speaking");
  expect(document.body.textContent).not.toContain("Events");
  expect(kinds()).toEqual(["typed"]);
});

test.for([
  { name: "a room row is older than the agent's oldest event", roomAt: 1, reads: true },
  { name: "no room row is older than the agent's oldest event", roomAt: 40, reads: false },
])("the agent's older page is read when $name", async ({ roomAt, reads }) => {
  const loadOlder = vi.fn();
  using _page = await mount({
    context: { events: [room(roomAt, "typed")], caughtUp: true },
    renderers: roomRenderers,
    agentContext: agentLog(agentTurn(20), IDLE, { loading: false, exhausted: false, loadOlder }),
  });
  expect(loadOlder.mock.calls.length > 0).toBe(reads);
});

const T = Date.parse("2026-11-16T12:00:00Z");
const time = (seconds: number) => new Date(T + seconds * 1000).toISOString();

/** A room event at `offset`, `offset` seconds after T. */
const room = (offset: number, type: "typed" | "said", text = `${type} ${String(offset)}`) => ({
  offset,
  type: `room/${type}`,
  createdAt: time(offset),
  payload: { text, who: "ann@example.com" },
});

const roomRenderers: Props["renderers"] = {
  "room/typed": (event) => <p data-kind="typed">{(event.payload as { text: string }).text}</p>,
};

const spokenLine: NonNullable<Props["spokenLine"]> = (event) => {
  if (event.type !== "room/said") return null;
  const { text, who } = event.payload as { text: string; who: string };
  return { key: `line:${String(event.offset)}`, who, at: Date.parse(event.createdAt), text };
};

/** The agent's log: one turn whose script settled, from second `start`, its first event at
 *  offset 1. */
function agentTurn(start: number) {
  return [
    said(1, "store 42"),
    request(2),
    settled(
      3,
      2,
      succeeded(
        "Storing.\n<codemode status=\"Storing\">\nawait itx.kv.put('answer', '42')\n</codemode>",
      ),
    ),
    runRequested(
      5,
      2,
      "async (itx) => { await itx.kv.put('answer', '42'); return { stored: true } }",
    ),
    runSettled(6, 5, { status: "succeeded", result: { stored: true } }),
  ].map((event) => ({ ...event, createdAt: time(start + event.offset) }));
}

const IDLE = liveState();
const WORKING = liveState({ llmRequests: [{ requestOffset: 2, purpose: "answer", model: "m" }] });

/** The agent's context: `events`, its facet's live value, and its older pages. */
const agentLog = (
  events: ReturnType<typeof agentTurn>,
  value = IDLE,
  older?: NonNullable<Props["agentContext"]>["older"],
): NonNullable<Props["agentContext"]> => ({
  events,
  caughtUp: true,
  processors: { rows: [], loaded: true },
  presence: { actors: [], rpcStubs: [] },
  liveState: { agent: { status: "live", value } },
  older,
});

/** The feed's rows, top to bottom, by their kind. */
const kinds = () =>
  [...document.querySelectorAll("[role=log] [data-kind]")]
    .map((row) => row.getAttribute("data-kind"))
    .filter((kind) => kind === "typed" || kind === "activity" || kind === "rollup");

const press = async (element: Element | null | undefined) => {
  if (!(element instanceof HTMLElement)) throw new Error("nothing to press");
  await act(async () => element.click());
};

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
