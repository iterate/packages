// @vitest-environment jsdom
// The chat's status strip when the agent's live state is not there to read: it says what the
// catalog heard from the agent, or else that it cannot tell, and the log alone then decides when a
// turn is over, instead of waiting for it for good. And the chat with no strip, where the status is
// the feed's last row. And what the feed shows while its log is read, and after.
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { AgentChat, AgentProgress } from "./agent-chat.tsx";
import { AgentReading } from "./agent-reading.tsx";
import { LogReading } from "#/components/virtual-log/read-progress.tsx";

test("shared-conversation progress shows work and its public summary without response or script content", () => {
  const context: Context = {
    events: [
      {
        offset: 1,
        createdAt: "2026-11-16T12:00:00Z",
        type: "events.iterate.com/agent/llm-request-requested",
        payload: { model: "gpt-test" },
      },
      {
        offset: 2,
        createdAt: "2026-11-16T12:00:01Z",
        type: "events.iterate.com/agent/llm-response-frame",
        payload: {
          llmRequestOffset: 1,
          sequence: 0,
          thinkingDelta: "PRIVATE_REASONING",
          responseDelta: "PRIVATE_RESPONSE",
        },
      },
      {
        offset: 3,
        createdAt: "2026-11-16T12:00:02Z",
        type: "events.iterate.com/agent/summary-updated",
        payload: { title: "Look up a file", activity: "Finding the shared file" },
      },
    ],
    caughtUp: true,
    processors: { loaded: true, rows: [] },
    presence: { actors: [], rpcStubs: [] },
    liveState: {
      agent: {
        status: "live",
        value: { paused: null, openRequest: { model: "gpt-test" }, pendingLlmRequestTrigger: null },
      },
    },
  };
  const thinking = renderToStaticMarkup(<AgentProgress context={context} />);
  expect(thinking).toContain("Thinking · gpt-test");
  expect(thinking).toContain("Finding the shared file");
  expect(thinking).toContain('aria-label="Loading"');
  expect(thinking).not.toMatch(/PRIVATE_REASONING|PRIVATE_RESPONSE/);
  context.events = [
    ...context.events,
    {
      offset: 4,
      createdAt: "2026-11-16T12:00:03Z",
      type: "events.iterate.com/itx/run-requested",
      payload: { code: "PRIVATE_SCRIPT" },
    },
  ];
  const running = renderToStaticMarkup(<AgentProgress context={context} />);
  expect(running).toContain("Running a script");
  expect(running.match(/Finding the shared file/g)).toHaveLength(1);
  expect(running).not.toMatch(/PRIVATE_REASONING|PRIVATE_RESPONSE|PRIVATE_SCRIPT/);
});

test.for([
  {
    value: { paused: null, openRequest: null, pendingLlmRequestTrigger: {} },
    expected: "About to think",
    working: true,
  },
  {
    value: { paused: null, openRequest: null, pendingLlmRequestTrigger: null, awaitingRun: {} },
    expected: "About to run a script",
    working: true,
  },
  {
    value: { paused: null, openRequest: null, pendingLlmRequestTrigger: null, unnotedRun: 12 },
    expected: "Reading the script&#x27;s result",
    working: true,
  },
  {
    value: { paused: { reason: "Needs input" }, openRequest: null, pendingLlmRequestTrigger: null },
    expected: "Paused — Needs input",
    working: false,
  },
  {
    value: { paused: null, openRequest: null, pendingLlmRequestTrigger: null },
    expected: "",
    working: false,
  },
])(
  "shared-conversation progress follows the agent obligation: $expected",
  ({ value, expected, working }) => {
    const context: Context = {
      events: [],
      caughtUp: true,
      processors: { rows: [], loaded: true },
      presence: { actors: [], rpcStubs: [] },
      liveState: { agent: { status: "live", value } },
    };
    const markup = renderToStaticMarkup(<AgentProgress context={context} />);
    if (expected) expect(markup).toContain(expected);
    else expect(markup).toBe("");
    expect(markup.includes('aria-label="Loading"')).toBe(working);
  },
);

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  // jsdom lays nothing out, so it has no ResizeObserver; the scroll container asks for one
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
});

test.for<Pick<Context, "processors" | "liveState"> & { name: string; status: string | undefined }>([
  {
    // nothing, while it is not known: the feed's loading state is the one thing that speaks
    name: "the processors table has not loaded yet",
    processors: { rows: [], loaded: false },
    liveState: {},
    status: undefined,
  },
  {
    name: "the processors table could not be read",
    processors: { rows: [], loaded: false, error: "subscriptions.list failed" },
    liveState: {},
    status: "Live state unavailable",
  },
  {
    name: "the processors table loaded without an agent facet",
    processors: { rows: [], loaded: true },
    liveState: {},
    status: "Live state unavailable",
  },
  {
    name: "the agent facet's own subscription failed",
    processors: { rows: [], loaded: true },
    liveState: { agent: { status: "error", value: undefined, error: "no such facet" } },
    status: "Live state unavailable",
  },
  {
    name: "the agent facet holds no obligation",
    processors: { rows: [], loaded: true },
    liveState: {
      agent: {
        status: "live",
        value: { paused: null, openRequest: null, pendingLlmRequestTrigger: null },
      },
    },
    status: "Idle",
  },
  {
    name: "the agent facet holds an answer whose script has not been asked to run",
    processors: { rows: [], loaded: true },
    liveState: {
      agent: {
        status: "live",
        value: {
          paused: null,
          openRequest: null,
          pendingLlmRequestTrigger: null,
          awaitingRun: { callId: "call_1" },
        },
      },
    },
    status: "About to run a script",
  },
  {
    name: "the agent facet holds a settled run whose note has not landed",
    processors: { rows: [], loaded: true },
    liveState: {
      agent: {
        status: "live",
        value: {
          paused: null,
          openRequest: null,
          pendingLlmRequestTrigger: null,
          unnotedRun: 29,
        },
      },
    },
    status: "Reading the script's result",
  },
])("the strip when $name: $status", async ({ processors, liveState, status }) => {
  using chat = await mount({ processors, liveState });
  expect(chat.status()).toBe(status);
});

test("a newest page with nothing to say is no proof of silence: the chat reads on and shows how far, instead of claiming nothing was said", async () => {
  const loadOlder = vi.fn();
  using _chat = await mount({
    processors: { rows: [], loaded: true },
    liveState: {},
    events: [
      {
        offset: 9_000,
        type: "events.iterate.com/itx/woken",
        createdAt: "2026-11-06T00:00:00.000Z",
        payload: {},
      },
    ],
    head: 10_000,
    older: { loadOlder, loading: false, exhausted: false },
  });
  expect(loadOlder).toHaveBeenCalled();
  expect(document.querySelector("[role=progressbar]")?.getAttribute("aria-valuenow")).toBe("10");
  expect(document.body.textContent).not.toContain("Nothing said yet");
});

test("a request the agent facet has not reported yet still shows as running: a pending trigger is an obligation", async () => {
  using _chat = await mount({
    processors: { rows: [], loaded: true },
    liveState: {
      agent: {
        status: "live",
        value: { paused: null, openRequest: null, pendingLlmRequestTrigger: {} },
      },
    },
    events: [
      {
        offset: 5,
        type: "events.iterate.com/agent/llm-request-requested",
        createdAt: "2026-11-06T00:00:00.000Z",
        payload: { model: "m", expiresAt: 9e12, triggerOffset: 4 },
      },
    ],
  });
  expect(document.querySelector("button[title='Stop generation']")).not.toBeNull();
});

test.for<{ name: string; value: Record<string, unknown>; row: string | null; spinner: boolean }>([
  {
    name: "a request is open and the log holds no step of it",
    value: { paused: null, openRequest: { model: "m" }, pendingLlmRequestTrigger: null },
    row: "Working…",
    spinner: true,
  },
  {
    name: "the agent is paused",
    value: { paused: { reason: "over budget" }, openRequest: null, pendingLlmRequestTrigger: null },
    row: "Paused — over budget",
    spinner: false,
  },
  {
    name: "the agent holds no obligation",
    value: { paused: null, openRequest: null, pendingLlmRequestTrigger: null },
    row: null,
    spinner: false,
  },
])("with no strip, when $name, the feed's last row is $row", async ({ value, row, spinner }) => {
  using _layout = laidOut();
  using chat = await mount(
    {
      processors: { rows: [], loaded: true },
      liveState: { agent: { status: "live", value } },
      events: [
        {
          offset: 4,
          type: "events.iterate.com/agent/context-added",
          createdAt: "2026-11-06T00:00:00.000Z",
          payload: { role: "user", content: "hello", actor: { type: "user" } },
        },
      ],
    },
    { strip: false, state: { view: "events" }, aboveComposer: <p data-testid="above">progress</p> },
  );
  // no strip, and no Events tab even when the state asks for it: the chat and its composer
  expect(chat.status()).toBeUndefined();
  expect(document.querySelector("[role=tab]")).toBeNull();
  expect(document.body.textContent).toContain("hello");
  expect(document.querySelector("[data-testid=above]")?.textContent).toBe("progress");
  const shown = document.querySelector("[data-testid=agent-turn-status]");
  expect(shown ? shown.textContent : null).toBe(row);
  expect(Boolean(shown?.querySelector("[data-slot=spinner]"))).toBe(spinner);
});

test.for<
  LogCase & {
    /** What the Chat tab's feed says, with the page's own greeting and without one. */
    chat: { greeted: string; plain: string };
    /** What the Events tab's feed says. */
    events: string;
  }
>([
  {
    name: "the first read is out",
    context: { caughtUp: false, older: { loadOlder: () => {}, loading: true, exhausted: false } },
    shown: "reading",
    chat: { greeted: "Reading the log…", plain: "Reading the log…" },
    events: "Loading the log…",
  },
  {
    name: "the read answered and the log holds nothing",
    context: { caughtUp: true },
    shown: "empty",
    chat: { greeted: "Good afternoon", plain: "Nothing said yet" },
    events: "Nothing has happened on this agent yet.",
  },
  {
    name: "the read answered with a message",
    context: { caughtUp: true, events: [said(4, "hello")] },
    shown: "rows",
    chat: { greeted: "hello", plain: "hello" },
    events: "agent/context-added",
  },
  {
    name: "the first read failed",
    context: {
      caughtUp: false,
      error: "the read failed",
      older: { loadOlder: () => {}, loading: false, exhausted: false },
    },
    shown: "error",
    chat: { greeted: "", plain: "" },
    events: "",
  },
  {
    name: "the context could not be opened",
    context: { caughtUp: false },
    hostError: "no such context",
    shown: "error",
    chat: { greeted: "", plain: "" },
    events: "",
  },
])("the feed when $name: $shown", async ({ context, hostError, shown, chat, events }) => {
  using _layout = laidOut();
  const error = hostError || context.error;
  const views = [
    { props: { strip: false, empty: <h2>Good afternoon</h2> }, says: chat.greeted },
    { props: {}, says: chat.plain },
    { props: { state: { view: "events" as const } }, says: events },
  ];
  for (const { props, says } of views) {
    using _chat = await mount(
      { processors: { rows: [], loaded: true }, liveState: {}, ...context },
      { error: hostError, ...props },
    );
    const log = document.querySelector("[role=log]")!;
    // a loading state and a failed read say nothing else; rows and empty words have more around them
    if (shown === "rows" || shown === "empty") expect(log.textContent).toContain(says);
    else expect(log.textContent?.trim()).toBe(says);
    expect(log.textContent?.includes("Nothing said yet")).toBe(says === "Nothing said yet");
    // the loading state, which fades in after a wait, and only while the read is out
    const reading = log.querySelector("[data-slot=log-reading]");
    expect(Boolean(reading?.querySelector("[data-slot=spinner]"))).toBe(shown === "reading");
    if (reading)
      expect([...reading.classList]).toEqual(
        // unseen until its wait is 200 ms old (the element's own delay), then it fades in
        expect.arrayContaining(["animate-in", "fade-in-0", "fill-mode-both"]),
      );
    expect(Boolean(log.querySelector("[data-slot=agent-chat-empty] h2"))).toBe(
      shown === "empty" && "empty" in props,
    );
    expect(document.querySelector("[data-type=error]")?.textContent).toBe(error);
  }
});

test.for<{ name: string; context: LogCase["context"]; says: string; error?: string }>([
  {
    name: "older pages remain",
    context: { older: { loadOlder: () => {}, loading: false, exhausted: false } },
    says: "Reading the log… 10%",
  },
  {
    name: "an older page is out",
    context: { older: { loadOlder: () => {}, loading: true, exhausted: false } },
    says: "Reading the log… 10%",
  },
  {
    name: "an older page failed",
    context: {
      error: "the read failed",
      older: { loadOlder: () => {}, loading: false, exhausted: false },
    },
    says: "",
    error: "the read failed",
  },
])(
  "a newest page that holds no message, when $name, says '$says'",
  async ({ context, says, error }) => {
    using _chat = await mount({
      processors: { rows: [], loaded: true },
      liveState: {},
      caughtUp: true,
      events: [
        {
          offset: 9_000,
          type: "events.iterate.com/itx/woken",
          createdAt: "2026-11-06T00:00:00.000Z",
          payload: {},
        },
      ],
      head: 10_000,
      ...context,
    });
    const log = document.querySelector("[role=log]")!;
    expect(log.textContent?.trim()).toBe(says);
    // how far the read has come stands where the first read's spinner stood: one element, so its
    // wait is not counted again
    expect(Boolean(log.querySelector("[data-slot=log-reading] [role=progressbar]"))).toBe(!error);
    expect(document.querySelector("[data-type=error]")?.textContent).toBe(error);
  },
);

test("a loading state stays unseen for 200 ms, and one that takes another's place goes on with its wait", async () => {
  // the clock is the test's, and starts well after any loading state of the tests above
  let now = performance.now() + 60_000;
  const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  const delay = () =>
    document.querySelector<HTMLElement>("[data-slot=log-reading]")?.style.animationDelay;
  try {
    await act(async () => root.render(<LogReading key="page" label="Reading the log" />));
    expect(delay()).toBe("200ms");
    // the page's loading state has stood for half a second when the view's own takes its place:
    // that one is seen at once, its fade long over
    now += 500;
    await act(async () => root.render(<LogReading key="view" label="Reading the log" />));
    expect(delay()).toBe("-300ms");
    // a wait that begins later starts unseen again
    await act(async () => root.render(null));
    now += 5_000;
    await act(async () => root.render(<LogReading key="later" label="Reading the log" />));
    expect(delay()).toBe("200ms");
  } finally {
    act(() => root.unmount());
    document.body.replaceChildren();
    clock.mockRestore();
  }
});

test("a page's loading state before there is a view is the view's own: the same strip and the same line, so the view moves nothing when it comes", async () => {
  // what stands where, by the classes that place it: the strip's row, its tabs, the feed's column
  // and the loading line
  const placed = () => {
    const tabs = document.querySelector("[role=tablist]");
    const line = document.querySelector("[data-slot=log-reading]");
    return {
      strip: tabs?.closest("[data-slot=tabs]")?.parentElement?.className,
      tabs: tabs?.className,
      column: line?.parentElement?.className.match(/mx-auto w-full max-w-3xl px-4 md:px-6/)?.[0],
      line: line?.className,
      // a row's own 8 px under the feed's 8 px start: where the first row will stand
      lineIsWhereARowIs: line?.classList.contains("pt-4"),
    };
  };
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root.render(<AgentReading />));
  const page = placed();
  // the page's strip cannot be pressed, and says no count of events
  expect(Boolean(document.querySelector("[inert] [role=tablist]"))).toBe(true);
  expect(document.querySelector("[role=tablist]")?.textContent).toBe("ChatEvents");
  act(() => root.unmount());
  document.body.replaceChildren();
  using _chat = await mount({
    processors: { rows: [], loaded: false },
    liveState: {},
    caughtUp: false,
  });
  expect(document.querySelector("[role=tablist]")?.textContent).toBe("ChatEvents0");
  expect(placed()).toEqual(page);
  expect(page).toMatchObject({
    column: "mx-auto w-full max-w-3xl px-4 md:px-6",
    lineIsWhereARowIs: true,
  });
});

test("the page's own text for an empty composer", async () => {
  using _chat = await mount(
    { processors: { rows: [], loaded: true }, liveState: {} },
    { strip: false, placeholder: "How can I help you today?" },
  );
  // the composer's editor is a lazy chunk
  await vi.waitFor(() =>
    expect(document.querySelector("[aria-placeholder]")?.getAttribute("aria-placeholder")).toBe(
      "How can I help you today?",
    ),
  );
});

test.for([
  { eventsTab: true, tabs: 2 },
  { eventsTab: false, tabs: 0 },
])(
  "a strip with eventsTab $eventsTab keeps the agent's status words, and has $tabs tabs",
  async ({ eventsTab, tabs }) => {
    using chat = await mount(
      {
        processors: { rows: [], loaded: true },
        liveState: {
          agent: {
            status: "live",
            value: { paused: null, openRequest: null, pendingLlmRequestTrigger: null },
          },
        },
      },
      { eventsTab },
    );
    expect(chat.status()).toBe("Idle");
    expect(document.querySelectorAll("[role=tab]")).toHaveLength(tabs);
    expect(document.body.textContent?.includes("Events")).toBe(eventsTab);
  },
);

test.for<{ name: string; me: string | undefined; lines: (readonly [string, string] | null)[] }>([
  {
    name: "the viewer by their actor",
    me: "/members/ada",
    lines: [null, ["bo", "bo@example.com"], ["ada (a script)", "ada@example.com"]],
  },
  {
    name: "the viewer by their address, in another case",
    me: "Ada@Example.com",
    lines: [null, ["bo", "bo@example.com"], ["ada (a script)", "ada@example.com"]],
  },
  {
    name: "no viewer",
    me: undefined,
    lines: [
      ["ada", "ada@example.com"],
      ["bo", "bo@example.com"],
      ["ada (a script)", "ada@example.com"],
    ],
  },
])(
  "with $name, a line under each bubble that the viewer did not type: a short name, the full address on hover",
  async ({ me, lines }) => {
    using _layout = laidOut();
    const ada = { actor: "/members/ada", email: "ada@example.com" };
    using _chat = await mount(
      {
        processors: { rows: [], loaded: true },
        liveState: {},
        events: [
          { ...said(1, "mine"), source: { principal: ada } },
          {
            ...said(2, "theirs"),
            source: { principal: { actor: "/members/bo", email: "bo@example.com" } },
          },
          // the cast: the context's event type does not name `onBehalfOf`, which the platform
          // stamps on what a person's script appends
          {
            ...said(3, "my script's"),
            source: { onBehalfOf: { principal: ada, run: "/@7" } },
          } as unknown as Context["events"][number],
        ],
      },
      { me },
    );
    const bubbles = [...document.querySelectorAll("[data-kind=user]")];
    expect(bubbles).toHaveLength(3);
    expect(
      bubbles.map((bubble) => {
        const line = bubble.querySelector("[data-said-by]");
        return line ? [line.textContent, line.getAttribute("title")] : null;
      }),
    ).toEqual(lines);
  },
);

type Context = ComponentProps<typeof AgentChat>["context"];

/** A state of the read, and what a feed shows in it. */
type LogCase = {
  name: string;
  context: Partial<Pick<Context, "events" | "head" | "older" | "caughtUp" | "error">>;
  /** The host's own failure, the chat's `error` prop. */
  hostError?: string;
  shown: "reading" | "empty" | "rows" | "error";
};

/** A person's words in the log. */
function said(offset: number, content: string) {
  return {
    offset,
    type: "events.iterate.com/agent/context-added",
    createdAt: "2026-11-06T00:00:00.000Z",
    payload: { role: "user", content, actor: { type: "user" } },
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

/** The chat mounted in the document over an empty log; disposing
 *  unmounts it and clears the page. */
async function mount(
  context: Pick<Context, "processors" | "liveState"> &
    Partial<Pick<Context, "events" | "head" | "older" | "caughtUp" | "error">>,
  props: Partial<ComponentProps<typeof AgentChat>> = {},
) {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () =>
    root.render(
      <AgentChat
        path="/agents/demo"
        context={{
          events: [],
          caughtUp: true,
          presence: { actors: [], rpcStubs: [] },
          ...context,
        }}
        error={undefined}
        state={{}}
        onStateChange={() => {}}
        onMessage={async () => {}}
        onAppend={async () => {}}
        signedUrl={async () => ""}
        {...props}
      />,
    ),
  );
  return {
    status: () => document.querySelector("[data-status]")?.textContent,
    [Symbol.dispose]: () => {
      act(() => root.unmount());
      document.body.replaceChildren();
    },
  };
}
