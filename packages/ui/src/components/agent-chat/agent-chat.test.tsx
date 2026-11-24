// @vitest-environment jsdom
// The chat's status strip when the agent's live state is not there to read: it says what the
// catalog heard from the agent, or else that it cannot tell, and the log alone then decides when a
// turn is over, instead of waiting for it for good. And the chat with no strip, where the status is
// the feed's last row. And what the feed shows while its log is read, and after. And the chat over
// a log with an earlier version: the current version alone.
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { AgentChat, AgentProgress } from "./agent-chat.tsx";
import { AgentReading } from "./agent-reading.tsx";
import { LogReading } from "#/components/virtual-log/read-progress.tsx";
import {
  apiMessage,
  created,
  fact,
  frame,
  liveState,
  request,
  runRequested,
  runSettled,
  said,
  scriptResult,
  sent,
  settled,
  succeeded,
  summary,
  transcription,
  versionEnded,
} from "#/test-support/agent-log.ts";

// jsdom lays nothing out; the composer's CodeMirror measures text ranges after each change
Object.assign(Range.prototype, {
  getClientRects: () => [],
  getBoundingClientRect: () => new DOMRect(),
});

test("shared-conversation progress shows work and its public summary without response or script content", () => {
  const context: Context = {
    events: [
      request(1, { model: "gpt-test" }),
      frame(2, 1, { thinkingDelta: "PRIVATE_REASONING", textDelta: "PRIVATE_RESPONSE" }),
      summary(3, "Finding the shared file"),
    ],
    caughtUp: true,
    processors: { loaded: true, rows: [] },
    presence: { actors: [], rpcStubs: [] },
    liveState: agentLive({
      llmRequests: [{ requestOffset: 1, purpose: "answer", model: "gpt-test" }],
    }),
  };
  const thinking = renderToStaticMarkup(<AgentProgress context={context} />);
  expect(thinking).toContain("Thinking · gpt-test");
  expect(thinking).toContain("Finding the shared file");
  expect(thinking).toContain('aria-label="Loading"');
  expect(thinking).not.toMatch(/PRIVATE_REASONING|PRIVATE_RESPONSE/);
  context.events = [...context.events, runRequested(4, null, "PRIVATE_SCRIPT")];
  const running = renderToStaticMarkup(<AgentProgress context={context} />);
  expect(running).toContain("Running a script");
  expect(running.match(/Finding the shared file/g)).toHaveLength(1);
  expect(running).not.toMatch(/PRIVATE_REASONING|PRIVATE_RESPONSE|PRIVATE_SCRIPT/);
});

test.for([
  { value: { pendingTriggerOffsets: [9] }, expected: "About to think", working: true },
  {
    value: { scriptCalls: [{ answered: false }] },
    expected: "About to run a script",
    working: true,
  },
  {
    value: { paused: { reason: "Needs input" } },
    expected: "Paused — Needs input",
    working: false,
  },
  { value: {}, expected: "", working: false },
])(
  "shared-conversation progress follows the agent obligation: $expected",
  ({ value, expected, working }) => {
    const context: Context = {
      events: [],
      caughtUp: true,
      processors: { rows: [], loaded: true },
      presence: { actors: [], rpcStubs: [] },
      liveState: agentLive(value),
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
    name: "the agent's live state has an open answer request",
    processors: { rows: [], loaded: true },
    liveState: agentLive({
      llmRequests: [
        { requestOffset: 4, purpose: "summary", model: "openai/gpt-6.2-sol" },
        { requestOffset: 7, purpose: "answer", model: "anthropic/claude-opus-5.5" },
      ],
    }),
    status: "Thinking · anthropic/claude-opus-5.5",
  },
  {
    name: "the agent's live state has inputs that wait for a request",
    processors: { rows: [], loaded: true },
    liveState: agentLive({ pendingTriggerOffsets: [9] }),
    status: "About to think",
  },
  {
    name: "the agent's live state has a script it asked to run",
    processors: { rows: [], loaded: true },
    liveState: agentLive({ scriptCalls: [{ answered: true }, { answered: false }] }),
    status: "About to run a script",
  },
  {
    name: "the agent's live state is paused",
    processors: { rows: [], loaded: true },
    liveState: agentLive({ paused: { reason: "3 requests in a row failed" } }),
    status: "Paused — 3 requests in a row failed",
  },
  {
    name: "the agent's live state holds nothing",
    processors: { rows: [], loaded: true },
    liveState: agentLive({}),
    status: "Idle",
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
    events: [fact(9_000, "itx/woken", {})],
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
    liveState: agentLive({ pendingTriggerOffsets: [4] }),
    events: [request(5)],
  });
  expect(document.querySelector("button[title='Stop generation']")).not.toBeNull();
});

test.for<{
  name: string;
  value: Parameters<typeof liveState>[0];
  row: string | null;
  spinner: boolean;
}>([
  {
    name: "a request is open and the log holds no step of it",
    value: { llmRequests: [{ requestOffset: 9, purpose: "answer", model: "m" }] },
    row: "Working…",
    spinner: true,
  },
  {
    name: "the agent is paused",
    value: { paused: { reason: "over budget" } },
    row: "Paused — over budget",
    spinner: false,
  },
  { name: "the agent holds no obligation", value: {}, row: null, spinner: false },
])("with no strip, when $name, the feed's last row is $row", async ({ value, row, spinner }) => {
  using _layout = laidOut();
  using chat = await mount(
    {
      processors: { rows: [], loaded: true },
      liveState: agentLive(value),
      events: [said(4, "hello")],
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
      events: [fact(9_000, "itx/woken", {})],
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

test("the agent's composer appends the words as ONE `agent-ui/message-received`, and calls no message()", async () => {
  const appended: unknown[][] = [];
  const onMessage = vi.fn(async () => {});
  using _chat = await mount(
    { processors: { rows: [], loaded: true }, liveState: agentLive({}) },
    { onMessage, onAppend: async (events) => appended.push(events) },
  );
  const composer = await vi.waitFor(() => {
    const found = document.querySelector("[aria-placeholder]");
    expect(found).not.toBe(null);
    return found!;
  });
  // the words, as a paste puts them in the editor (jsdom has no DataTransfer)
  const paste = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(paste, "clipboardData", {
    value: {
      files: [],
      items: [{ kind: "string", type: "text/plain", getAsFile: () => null }],
      getData: (format: string) => (format === "text/plain" ? "hello" : ""),
    },
  });
  await act(async () => composer.dispatchEvent(paste));
  const send = document.querySelector<HTMLButtonElement>('button[title="Send message"]');
  await act(async () => send!.click());
  await vi.waitFor(() => expect(appended).toHaveLength(1));
  expect({ appended, messages: onMessage.mock.calls.length }).toMatchObject({
    appended: [
      [
        {
          type: "events.iterate.com/agent-ui/message-received",
          idempotencyKey: expect.stringMatching(/^agent-ui\/message-received:/),
          payload: { message: "hello", client: "web" },
        },
      ],
    ],
    messages: 0,
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
      { processors: { rows: [], loaded: true }, liveState: agentLive({}) },
      { eventsTab },
    );
    expect(chat.status()).toBe("Idle");
    expect(document.querySelectorAll("[role=tab]")).toHaveLength(tabs);
    expect(document.body.textContent?.includes("Events")).toBe(eventsTab);
  },
);

test("in a voice call an agent with no work shows no status, never Idle", async () => {
  using chat = await mount(
    { processors: { rows: [], loaded: true }, liveState: agentLive({}) },
    { inCall: new Map([["usr_jonas", { camera: false, screen: false }]]) },
  );
  expect(chat.status()).toBeUndefined();
  expect(document.body.textContent?.includes("Idle")).toBe(false);
});

test.for<{ name: string; me: string | undefined; lines: (readonly [string, string] | null)[] }>([
  {
    name: "the viewer by their actor",
    me: "/members/ada",
    lines: [null, ["bo", "bo@example.com"], null],
  },
  {
    name: "the viewer by their address, in another case",
    me: "Ada@Example.com",
    lines: [null, ["bo", "bo@example.com"], null],
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
  "with $name, a line under each bubble that is not the viewer's (typed or by their script): a short name, the full address on hover",
  async ({ me, lines }) => {
    using _layout = laidOut();
    const ada = { actor: "/members/ada", email: "ada@example.com" };
    using _chat = await mount(
      {
        processors: { rows: [], loaded: true },
        liveState: {},
        events: [
          said(1, "mine", { source: { principal: ada } }),
          said(2, "theirs", {
            source: { principal: { actor: "/members/bo", email: "bo@example.com" } },
          }),
          said(3, "my script's", { source: { onBehalfOf: { principal: ada, run: "/@7" } } }),
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

test("another agent's words are one folded quiet row, not a bubble: a subagent's line says it reported, and a press opens and closes its words", async () => {
  using _layout = laidOut();
  const ada = { actor: "/members/ada", email: "ada@example.com" };
  using _chat = await mount(
    {
      processors: { rows: [], loaded: true },
      liveState: {},
      events: [
        said(1, "mine", { source: { principal: ada } }),
        said(2, "theirs", {
          source: { principal: { actor: "/members/bo", email: "bo@example.com" } },
        }),
        // another agent's `message()`, and the mind's transcription of it for the model
        ...report(3, "The site is up.", "/agents/onboarding/website"),
        ...report(5, "A lead came in.", "/agents/sales"),
        ...report(7, "from the root", "/"),
      ],
    },
    { path: "/agents/onboarding", me: "ada@example.com" },
  );
  const bubbles = [...document.querySelectorAll("[data-kind=user]")];
  expect(
    bubbles.map((bubble) => [
      bubble.querySelector(".whitespace-pre-wrap")?.textContent,
      bubble.querySelector("[data-said-by]")?.textContent || null,
    ]),
  ).toEqual([
    ["mine", null],
    ["theirs", "bo"],
    ["from the root", null],
  ]);
  const reports = [...document.querySelectorAll("[data-kind=report]")];
  expect(
    reports.map((report) => ({
      line: report.querySelector("button span")?.firstChild?.textContent,
      title: report.querySelector("button")?.getAttribute("title"),
      expanded: report.querySelector("button")?.getAttribute("aria-expanded"),
      inBubble: Boolean(report.closest("[data-kind=user]")),
    })),
  ).toEqual([
    {
      line: "website reported",
      title: "/agents/onboarding/website",
      expanded: "false",
      inBubble: false,
    },
    { line: "sales wrote", title: "/agents/sales", expanded: "false", inBubble: false },
  ]);
  const page = () => document.body.textContent || "";
  expect(page()).not.toContain("The site is up.");
  const press = () =>
    act(() => document.querySelector<HTMLElement>("[data-kind=report] button")?.click());
  await press();
  expect(page()).toContain("The site is up.");
  await press();
  expect(page()).not.toContain("The site is up.");
});

test("words that wait for the next turn: the panel over the composer holds a person's, never another agent's", async () => {
  using _layout = laidOut();
  const reported = report(3, "The site is up.", "/agents/onboarding/website");
  {
    // a subagent's report alone waits: no panel, and its words are nowhere as the reader's input
    using _chat = await mount(
      {
        processors: { rows: [], loaded: true },
        liveState: {},
        events: [said(1, "go"), request(2), ...reported],
      },
      { path: "/agents/onboarding" },
    );
    expect(document.querySelector("[data-testid=queued-messages-panel]")).toBeNull();
  }
  // a person's words wait beside it: the panel holds theirs alone
  using _chat = await mount(
    {
      processors: { rows: [], loaded: true },
      liveState: {},
      events: [said(1, "go"), request(2), ...reported, said(5, "and make it green")],
    },
    { path: "/agents/onboarding" },
  );
  const panel = document.querySelector("[data-testid=queued-messages-panel]");
  expect(panel?.textContent).toContain("and make it green");
  expect(panel?.textContent).not.toContain("The site is up.");
});

test("a chat whose agent's path starts a new version draws the new conversation alone: no bubble, no round, no timer and no working state of the earlier version", async () => {
  using _layout = laidOut();
  // the earlier version, at work: a round ran a script, the next request streams, and words wait
  const earlier = [
    said(1, "the earlier question"),
    request(2),
    settled(3, 2, succeeded("<codemode>await work()</codemode>")),
    runRequested(4, 2),
    sent(5, "the earlier answer"),
    runSettled(6, 4, { status: "succeeded", result: 1 }),
    request(7, { itemsAdded: [scriptResult(2, "1")] }),
    frame(8, 7, {
      thinkingDelta: "the earlier thinking",
      textDelta: "<codemode>const earlierSecret = 1;</codemode>",
    }),
    said(9, "queued behind the request"),
  ];
  using chat = await mount({
    processors: { rows: [], loaded: true },
    liveState: agentLive({ llmRequests: [{ requestOffset: 7, purpose: "answer", model: "m" }] }),
    events: earlier,
  });
  const page = () => document.body.textContent || "";
  const shown = () => ({
    bubbles: [...document.querySelectorAll("[data-kind=user], [data-kind=assistant]")].map(
      (bubble) => bubble.querySelector(".whitespace-pre-wrap, p")?.textContent?.trim(),
    ),
    rounds: document.querySelectorAll("[data-kind=activity]").length,
    roundSoFar: Boolean(document.querySelector("[data-testid=agent-live-summary]")),
    // the live row's label and its clock
    live: document.querySelector("[data-kind=live] [data-testid=agent-live-status]")?.textContent,
    queued: document.querySelector("[data-testid=queued-messages-panel]")?.textContent,
    stop: Boolean(document.querySelector("button[title='Stop generation']")),
    status: chat.status(),
    tabs: document.querySelector("[role=tablist]")?.textContent,
  });
  expect(shown()).toMatchObject({
    bubbles: ["the earlier question", "the earlier answer"],
    rounds: 0,
    roundSoFar: true,
    live: expect.stringMatching(/^Writing code \d/),
    queued: expect.stringContaining("queued behind the request"),
    stop: true,
    status: "Thinking · m",
  });
  expect(page()).toContain("the earlier thinking");
  expect(page()).not.toContain("earlierSecret");

  // the same live log: the border of the version, and the agent's live state of the new one
  const border = [versionEnded(10, 1), created(11, 2)];
  await chat.update({ liveState: agentLive({}), events: [...earlier, ...border] });
  expect(shown()).toEqual({
    bubbles: [],
    rounds: 0,
    roundSoFar: false,
    live: undefined,
    queued: undefined,
    stop: false,
    status: "Idle",
    // the Events tab is the raw log: every fact of both versions
    tabs: "ChatEvents11",
  });
  expect(page()).not.toMatch(/the earlier|queued behind/);

  // the new version's facts: its question, and its request at work
  const asked = [...earlier, ...border, said(12, "the new question"), request(13, { model: "m2" })];
  await chat.update({
    liveState: agentLive({ llmRequests: [{ requestOffset: 13, purpose: "answer", model: "m2" }] }),
    events: asked,
  });
  expect(shown()).toMatchObject({
    bubbles: ["the new question"],
    rounds: 0,
    roundSoFar: false,
    live: expect.stringMatching(/^Waiting for a response \d/),
    queued: undefined,
    stop: true,
    status: "Thinking · m2",
  });
  expect(page()).not.toMatch(/the earlier|queued behind/);

  // the new request settles: one round, the new version's alone, and nothing works
  await chat.update({
    liveState: agentLive({}),
    events: [...asked, settled(14, 13, succeeded("Hello again."))],
  });
  expect(shown()).toMatchObject({
    bubbles: ["the new question"],
    rounds: 1,
    roundSoFar: false,
    live: undefined,
    queued: undefined,
    stop: false,
    status: "Idle",
  });
  expect(page()).not.toMatch(/the earlier|queued behind/);
});

test("a newest page that holds the border of a version reads no older page: the current version starts there, and nothing has been said in it", async () => {
  const loadOlder = vi.fn();
  using _chat = await mount({
    processors: { rows: [], loaded: true },
    liveState: agentLive({}),
    events: [versionEnded(9_000, 1), created(9_001, 2), fact(9_002, "itx/woken", {})],
    head: 10_000,
    older: { loadOlder, loading: false, exhausted: false },
  });
  expect(loadOlder).not.toHaveBeenCalled();
  expect(document.querySelector("[role=progressbar]")).toBeNull();
  expect(document.querySelector("[role=log]")?.textContent).toContain("Nothing said yet");
});

test("a new version of the path is a new conversation: the trace and the inspected event of the earlier one close, and the person's draft stays", async () => {
  using _layout = laidOut();
  const onStateChange = vi.fn();
  const earlier = [
    said(1, "the earlier question"),
    request(2),
    settled(3, 2, succeeded("the earlier answer")),
  ];
  using chat = await mount(
    {
      processors: { rows: [], loaded: true },
      liveState: agentLive({}),
      events: earlier,
      version: 1,
    },
    { state: { llmRequest: 2, event: 3 }, onStateChange },
  );
  // the person writes, and has not sent
  await paste("words for the next question");
  expect(document.body.textContent).toContain("words for the next question");
  // a reconnect of the same version: the read before its first page says none, and then the same
  await chat.update({ caughtUp: false, events: [] });
  await chat.update({ caughtUp: true, events: earlier });
  expect(onStateChange).not.toHaveBeenCalled();
  // the new version
  await chat.update({ events: [created(5, 2), said(6, "the new question")], version: 2 });
  expect(onStateChange.mock).toMatchObject({
    calls: [[{ llmRequest: undefined, scriptRun: undefined, event: undefined }]],
  });
  expect(document.body.textContent).toContain("words for the next question");
  expect(document.body.textContent).toContain("the new question");
  expect(document.body.textContent).not.toContain("the earlier");
});

test("a saved copy says no version: the read's first word after it is no new conversation, and a link's trace stays open", async () => {
  using _layout = laidOut();
  const onStateChange = vi.fn();
  using chat = await mount(
    {
      processors: { rows: [], loaded: true },
      liveState: agentLive({}),
      events: [said(1, "the saved question")],
      version: 1,
      savedCopy: true,
    },
    { state: { llmRequest: 7 }, onStateChange },
  );
  await chat.update({ events: [created(5, 2), request(7)], version: 2, savedCopy: false });
  expect(onStateChange).not.toHaveBeenCalled();
});

test("a new version is shown from its end, wherever the reader was; a new row of the same version leaves a reader in history where they are", async () => {
  using _layout = laidOut();
  const earlier = Array.from({ length: 30 }, (_, at) => said(at + 1, `question ${String(at + 1)}`));
  using chat = await mount({
    processors: { rows: [], loaded: true },
    liveState: agentLive({}),
    events: earlier,
    version: 1,
  });
  const scroller = document.querySelector<HTMLElement>("[data-slot=virtual-log]")!;
  Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 5_000 });
  const writes = vi.fn();
  scroller.scrollTo = writes;
  // the reader scrolls up, into history
  await act(async () => {
    scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true }));
    scroller.scrollTop = 1_000;
    scroller.dispatchEvent(new Event("scroll"));
  });
  expect(document.querySelector("[aria-label^='Scroll to bottom']")).not.toBe(null);
  writes.mockClear();
  await chat.update({ events: [...earlier, said(31, "one more")] });
  expect(writes).not.toHaveBeenCalled();
  await chat.update({ events: [created(40, 2), said(41, "the new question")], version: 2 });
  // the end: 5,000 high, less the 600 in view
  expect(writes.mock.calls.at(-1)).toMatchObject([{ top: 4_400 }]);
});

type Context = ComponentProps<typeof AgentChat>["context"];

/** A state of the read, and what a feed shows in it. */
type LogCase = {
  name: string;
  context: Partial<Pick<Context, "events" | "head" | "older" | "caughtUp" | "error">>;
  /** The host's own failure, the chat's `error` prop. */
  hostError?: string;
  shown: "reading" | "empty" | "rows" | "error";
};

/** The agent's live state as the chat's context holds it, with nothing open but what `state`
 *  names. */
function agentLive(state: Parameters<typeof liveState>[0]): Context["liveState"] {
  return { agent: { status: "live", value: liveState(state) } };
}

/** Another agent's words at `offset` (its `message()`, with the context that sent them as
 *  `from`), and the mind's transcription of them for the model at `offset + 1`. */
function report(offset: number, words: string, from: string) {
  return [
    apiMessage(offset, words, { source: { origin: "/agents" }, from }),
    transcription(offset + 1, offset, `[from ${from}] ${words}`),
  ];
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

/** The chat mounted in the document over an empty log; `update` draws it again over the context
 *  as it is now (the same live log, grown); disposing unmounts it and clears the page. */
async function mount(
  context: MountedContext,
  props: Partial<ComponentProps<typeof AgentChat>> = {},
) {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  const draw = (now: MountedContext) =>
    act(async () =>
      root.render(
        <AgentChat
          path="/agents/demo"
          context={{
            events: [],
            caughtUp: true,
            presence: { actors: [], rpcStubs: [] },
            ...now,
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
  await draw(context);
  return {
    status: () => document.querySelector("[data-status]")?.textContent,
    update: (now: Partial<MountedContext>) => draw({ ...context, ...now }),
    [Symbol.dispose]: () => {
      act(() => root.unmount());
      document.body.replaceChildren();
    },
  };
}

type MountedContext = Pick<Context, "processors" | "liveState"> &
  Partial<
    Pick<Context, "events" | "head" | "older" | "caughtUp" | "error" | "version" | "savedCopy">
  >;

/** Words into the composer as a paste puts them in the editor (jsdom has no DataTransfer), unsent. */
async function paste(words: string) {
  const composer = await vi.waitFor(() => {
    const found = document.querySelector("[aria-placeholder]");
    expect(found).not.toBe(null);
    return found!;
  });
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      files: [],
      items: [{ kind: "string", type: "text/plain", getAsFile: () => null }],
      getData: (format: string) => (format === "text/plain" ? words : ""),
    },
  });
  await act(async () => composer.dispatchEvent(event));
}
