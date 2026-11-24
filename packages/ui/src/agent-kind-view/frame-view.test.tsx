// @vitest-environment jsdom
// A kind's view in the frame, built as a mind's kind file builds it (the shell around a `Feed`
// with the kind's own words for an empty chat), while the host reads the agent's log: the words
// for an empty chat wait for the whole log, and a read that failed shows its error alone: no
// spinner, and no words for an empty chat. A kind file that failed to load is no failed read: the
// Events tab that stands in for the view still pages down the log.
// The last test reads a log with the real reader and holds its first read back: from the reader,
// through the bridge's updates, to the kind's view, the words are never there before the answer.
// jsdom runs no frame, so the page's side and the frame's side share one document here.
import { act, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { useIterateContext } from "iterate/react";
import { updateBetween, type AgentKindViewInputs } from "./bridge.ts";
import { InputsStore, type LoadedView } from "./frame.ts";
import { FrameView } from "./frame-view.tsx";
import { agentKindViewKit } from "./kit.ts";
import type { AgentKindViewProps } from "./types.ts";
import { versionOf } from "#/lib/itx-session.ts";

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  // jsdom lays nothing out, so it has no ResizeObserver; the virtual log's scroller asks for one
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
});

test.for<{
  name: string;
  inputs: Partial<AgentKindViewInputs>;
  shown: "reading" | "empty" | "rows" | "nothing";
  error?: string;
}>([
  {
    name: "the host has not connected the log yet",
    inputs: { caughtUp: false, older: pagesLeft() },
    shown: "reading",
  },
  {
    name: "the first read is out",
    inputs: { caughtUp: false, older: { loading: true, exhausted: false } },
    shown: "reading",
  },
  {
    name: "the newest page holds nothing the kind draws and older pages remain",
    inputs: { caughtUp: true, events: [event(9_000, "test/woken")], older: pagesLeft() },
    shown: "reading",
  },
  {
    name: "the whole log is read and holds nothing the kind draws",
    inputs: { caughtUp: true, events: [event(1, "test/woken")], older: null },
    shown: "empty",
  },
  {
    name: "the read answered with words",
    inputs: { caughtUp: true, events: [event(9_000, "test/said")], older: pagesLeft() },
    shown: "rows",
  },
  {
    name: "the first read failed",
    inputs: { caughtUp: false, error: "the read failed", older: pagesLeft() },
    shown: "nothing",
    error: "the read failed",
  },
  {
    name: "the context could not be opened",
    inputs: { caughtUp: false, hostError: "no such context", older: pagesLeft() },
    shown: "nothing",
    error: "no such context",
  },
  {
    name: "an older page failed before any row was read",
    inputs: {
      caughtUp: true,
      events: [event(9_000, "test/woken")],
      error: "the read failed",
      older: pagesLeft(),
    },
    shown: "nothing",
    error: "the read failed",
  },
])("a kind's feed when $name: $shown", async ({ inputs, shown, error }) => {
  using _layout = laidOut();
  using frame = await mount(inputs);
  const log = document.querySelector("[role=log]")!;
  expect(Boolean(log.querySelector("[data-slot=log-reading] [data-slot=spinner]"))).toBe(
    shown === "reading",
  );
  expect(log.textContent?.includes("Nothing said yet.")).toBe(shown === "empty");
  expect(log.textContent?.includes("words at 9000")).toBe(shown === "rows");
  expect(document.querySelector("[data-type=error]")?.textContent).toBe(error);
  // a failed read is not asked for again and again, and says nothing in the feed's place
  if (error) expect(frame.host.loadOlder).not.toHaveBeenCalled();
  if (shown === "nothing") expect(log).toMatchObject({ textContent: "" });
});

test("a page that draws the tabs in its header: the frame's shell draws no strip, the status stands at the feed's foot, and the page's tab is the frame's", async () => {
  {
    using _view = await mount({ caughtUp: true, older: null, tabsInHeader: true });
    expect(document.querySelector("[role=tablist]")).toBeNull();
    expect(document.querySelector("[data-slot=agent-foot-status]")?.textContent).toBe("Idle");
    expect(document.body.textContent).toContain("Nothing said yet.");
  }
  {
    using _view = await mount({
      caughtUp: true,
      older: null,
      tabsInHeader: true,
      state: { view: "events" },
    });
    expect(document.querySelector("[role=tablist]")).toBeNull();
    expect(document.body.textContent).toContain("Nothing has happened on this agent yet.");
  }
  // the default: the strip with its tabs, and no line at the foot
  using _view = await mount({ caughtUp: true, older: null });
  expect(document.querySelectorAll("[role=tablist]")).toHaveLength(1);
  expect(document.querySelector("[data-slot=agent-foot-status]")).toBeNull();
});

test("a kind file that failed to load is no failed read: the Events tab in its place pages down the log and says it holds a part", async () => {
  using _layout = laidOut();
  using frame = await mount(
    {
      caughtUp: true,
      events: [event(9_000, "test/said")],
      older: pagesLeft(),
      // the host says back what the frame reported of its kind file
      hostError: "agent-kinds/claude.ts: Unexpected token",
    },
    { error: "agent-kinds/claude.ts: Unexpected token" },
  );
  expect(document.querySelector("[data-type=error]")?.textContent).toBe(
    "agent-kinds/claude.ts: Unexpected token",
  );
  expect(frame.host.loadOlder).toHaveBeenCalled();
  expect(document.querySelector("[role=tab]")?.textContent).toBe("Events1+");
  expect(document.body.textContent).toContain("1 loaded of ~10,000 events");
});

test("the frame hands the view the viewer the page names: a kind that draws AgentChat hides their own messages' line", async () => {
  const seen: (string | undefined)[] = [];
  const view: LoadedView = {
    component: (props: AgentKindViewProps) => {
      seen.push(props.me);
      return null;
    },
    ephemeralEvents: [],
  };
  {
    using _view = await mount({ caughtUp: true, older: null, me: "/members/ada" }, view);
    expect(seen.at(-1)).toBe("/members/ada");
  }
  // a page that does not say who looks: the view is told nothing
  using _view = await mount({ caughtUp: true, older: null }, view);
  expect(seen.at(-1)).toBeUndefined();
});

test("the frame hands the view the version a read said: a kind that draws AgentChat closes the trace of the earlier version through the host", async () => {
  using _layout = laidOut();
  const { html, ui } = agentKindViewKit;
  const view: LoadedView = {
    // as the kind `agent` writes its view
    component: (props: AgentKindViewProps) => html`<${ui.AgentChat} ...${props} />`,
    ephemeralEvents: [],
  };
  using frame = await mount(
    {
      caughtUp: true,
      older: null,
      events: [event(1, "test/said")],
      version: 1,
      state: { llmRequest: 1 },
    },
    view,
  );
  expect(frame.host.setState).not.toHaveBeenCalled();
  await act(async () =>
    frame.inputs.apply({ version: 2, events: { reset: [event(5, "test/said")] } }),
  );
  expect(frame.host.setState.mock).toMatchObject({
    calls: [[{ llmRequest: undefined, scriptRun: undefined, event: undefined }]],
  });
});

test("the view's verbs stay the same functions while the host sends updates, so its rows stay drawn and an image is signed once", async () => {
  const signedUrls = new Set<unknown>();
  const view: LoadedView = {
    component: (props: AgentKindViewProps) => {
      signedUrls.add(props.signedUrl);
      return null;
    },
    ephemeralEvents: [],
  };
  using frame = await mount({ caughtUp: true, older: null }, view);
  await act(async () =>
    frame.inputs.apply({ events: { prepend: [], append: [event(1, "test/said")] } }),
  );
  await act(async () =>
    frame.inputs.apply({ events: { prepend: [], append: [event(2, "test/said")] } }),
  );
  expect([...signedUrls]).toHaveLength(1);
});

test.for<{ name: string; offsets: number[]; answered: "rows" | "empty" }>([
  { name: "a session with words", offsets: [1, 2], answered: "rows" },
  { name: "a session in which nothing was said", offsets: [], answered: "empty" },
])(
  "a Claude-kind agent whose first read takes long never says that nothing was said before the read answers: $name",
  async ({ offsets, answered }) => {
    using _layout = laidOut();
    const log = heldLog(offsets);
    // every text the document showed, at any moment
    const said: string[] = [];
    const watcher = new MutationObserver(() => said.push(document.body.textContent || ""));
    watcher.observe(document.body, { childList: true, subtree: true, characterData: true });
    using _frame = await mountLive(log.itx);
    // the read is out: looked at again and again across the wait
    for (let round = 0; round < 15; round++) {
      await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
      expect(document.body.textContent).not.toContain("Nothing said");
      expect(document.querySelectorAll("[data-slot=log-reading] [data-slot=spinner]")).toHaveLength(
        1,
      );
    }
    expect(log.asked()).toBe(1);
    const beforeTheAnswer = said.length;
    log.answer();
    // the log is published at most once a frame
    for (let round = 0; round < 10; round++)
      await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    watcher.disconnect();
    expect(beforeTheAnswer).toBeGreaterThan(0);
    expect(said.slice(0, beforeTheAnswer).filter((text) => text.includes("Nothing said"))).toEqual(
      [],
    );
    // a log that answered empty says so; one with words never did
    expect(document.body.textContent?.includes("Nothing said yet.")).toBe(answered === "empty");
    expect(document.body.textContent?.includes("words at 2")).toBe(answered === "rows");
    expect(said.some((text) => text.includes("Nothing said"))).toBe(answered === "empty");
    expect(document.querySelector("[data-slot=log-reading]")).toBeNull();
  },
);

/** Older pages remain, and none is being read. */
function pagesLeft() {
  return { loading: false, exhausted: false };
}

function event(offset: number, type: string) {
  return { offset, type, createdAt: "2026-11-16T00:00:00.000Z", payload: {} };
}

/** A kind's chat as a kind file writes one: its rows from the log, in the shell. */
function kindView({ html, useMemo, ui }: typeof agentKindViewKit) {
  return function SessionChat(props: AgentKindViewProps) {
    const rows = useMemo(
      () =>
        props.context.events
          .filter((one) => one.type === "test/said")
          .map((one) => ({ key: String(one.offset), offset: one.offset })),
      [props.context.events],
    );
    return html`
      <${ui.AgentShell} ...${props} status=${{ text: "Idle", tone: "muted" }}>
        <${ui.Feed}
          rows=${rows}
          older=${props.context.older}
          empty=${html`<p>Nothing said yet.</p>`}
          renderRow=${(row: { offset: number }) => html`<p>words at ${row.offset}</p>`}
        />
      </${ui.AgentShell}>
    `;
  };
}

/** A context whose log holds a `test/said` event at each of `offsets`, and whose reads wait for
 *  `answer`. */
function heldLog(offsets: number[]) {
  let asked = 0;
  let answer = () => {};
  const answered = new Promise<void>((resolve) => (answer = resolve));
  const head = offsets.at(-1) ?? 0;
  const itx = {
    subscribe: async () => ({ [Symbol.dispose]() {} }),
    readEvents: async (after = 0) => {
      asked += 1;
      await answered;
      return {
        events: offsets
          .filter((offset) => offset > after)
          .map((offset) => event(offset, "test/said")),
        atHead: true,
        scannedThroughOffset: head,
      };
    },
    subscriptions: { list: async () => [] },
    rpcStubs: { list: async () => [] },
    invoke: async () => ({ offset: head, state: {} }),
  };
  return { itx, asked: () => asked, answer };
}

/** The page's side of a kind's frame, as the Dash's agent view does it: the agent's log read live,
 *  and what changed of it sent on as the bridge's updates. */
function PageSide({
  itx,
  inputs,
  verbs,
}: {
  itx: ReturnType<typeof heldLog>["itx"];
  inputs: InputsStore;
  verbs: { loadOlder(): void };
}) {
  const log = useIterateContext(itx as never, { consumes: ["*"] });
  const sent = useRef<AgentKindViewInputs | undefined>(undefined);
  useEffect(() => {
    verbs.loadOlder = log.older.loadOlder;
    const { loading, exhausted } = log.older;
    const next: AgentKindViewInputs = {
      path: "/agents/session",
      events: log.events,
      caughtUp: log.caughtUp,
      error: log.error,
      head: log.head,
      older: exhausted ? null : { loading, exhausted },
      processors: log.processors,
      presence: log.presence,
      liveState: log.liveState,
      version: versionOf(log),
      hostError: undefined,
      state: {},
      documentClass: "",
    };
    const update = updateBetween(sent.current, next);
    sent.current = next;
    if (update) inputs.apply(update);
  });
  return null;
}

/** The page's side and the frame's view over one live log; disposing unmounts them and clears the
 *  page. */
async function mountLive(itx: ReturnType<typeof heldLog>["itx"]) {
  const inputs = new InputsStore();
  const verbs = { loadOlder: () => {} };
  const host = { loadOlder: () => verbs.loadOlder(), setState: () => {} };
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () =>
    root.render(
      <>
        <PageSide itx={itx} inputs={inputs} verbs={verbs} />
        <FrameView
          inputs={inputs}
          host={host as never}
          view={{ component: kindView(agentKindViewKit), ephemeralEvents: [] }}
        />
      </>,
    ),
  );
  return {
    [Symbol.dispose]: () => {
      act(() => root.unmount());
      document.body.replaceChildren();
    },
  };
}

/** A page with height, which jsdom lacks, so the virtual log draws its rows; disposing takes it
 *  back. */
function laidOut() {
  const sizes = { clientHeight: 600, offsetHeight: 0 };
  const own = Object.keys(sizes).map(
    (name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)] as const,
  );
  for (const [name, value] of Object.entries(sizes))
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get: () => value });
  return {
    [Symbol.dispose]: () => {
      for (const [name, descriptor] of own)
        if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
        else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
    },
  };
}

/** The frame's view over what a host sent; disposing unmounts it and clears the page. */
async function mount(
  { events = [], ...sent }: Partial<AgentKindViewInputs>,
  view: LoadedView = { component: kindView(agentKindViewKit), ephemeralEvents: [] },
) {
  const inputs = new InputsStore();
  inputs.apply({
    path: "/agents/session",
    events: { reset: [...events] },
    error: undefined,
    head: 10_000,
    processors: { rows: [], loaded: true },
    presence: { actors: [], rpcStubs: [] },
    liveState: {},
    hostError: undefined,
    state: {},
    documentClass: "",
    ...sent,
  });
  const host = { loadOlder: vi.fn(), setState: vi.fn() };
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () =>
    root.render(<FrameView inputs={inputs} host={host as never} view={view} />),
  );
  return {
    host,
    inputs,
    [Symbol.dispose]: () => {
      act(() => root.unmount());
      document.body.replaceChildren();
    },
  };
}
