// @vitest-environment jsdom
// SEVERAL PEOPLE IN ONE CHAT: who else is here (the platform's rows of their pages) and who is
// typing (each page's ephemeral status, by the platform's stamp), who can use the conversation (a
// people button beside Chat | Events), which side of
// the feed each message stands on and whose face is over it, whose each waiting message is, that
// anyone may interrupt and the feed says who did, and that a message keeps its key while it is
// tried again.
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { AgentChat } from "./agent-chat.tsx";
import { AgentLiveActivity } from "./agent-feed.tsx";
import {
  formatAgentUiActivitySummary,
  initialAgentUiState,
  reduceAgentUi,
  type AgentUiItem,
} from "./agent-ui-reducer.ts";
import type { StreamEvent } from "./stream-event.ts";
import type { ShownPrincipal } from "#/lib/principal-label.ts";

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  // jsdom lays nothing out, so it has no ResizeObserver; the scroll container asks for one
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
});
// jsdom lays nothing out; CodeMirror measures text ranges after each change
Object.assign(Range.prototype, {
  getClientRects: () => [],
  getBoundingClientRect: () => new DOMRect(),
});

const ADA = { actor: "/members/ada", email: "ada@example.com" };
const BO = { actor: "/members/bo", email: "bo@example.com" };
const CY = { actor: "/members/cy", email: "cy@example.com" };
/** A person who typed a name and proved nothing, as the platform names them. */
const GUEST = { actor: "user_3715", name: "Bob Proof", kind: "guest" as const };

test("a chat shows who else has it open and who is typing: the rows' holders and their own status, never the viewer, never a name from a payload", async () => {
  using chat = await mount(
    [
      status(1, BO, "bo-page", { typing: true }),
      status(2, CY, "cy-phone", { away: true }),
      status(3, CY, "cy-laptop", { away: true }),
      // a status that names Ada's page, sent by nobody the platform names
      { ...status(4, BO, "ada-page", { typing: true }), source: { origin: "/" } },
    ],
    { me: ADA.actor, presence: true },
    {
      pages: [
        page("ada-page", ADA),
        page("bo-page", BO),
        page("cy-phone", CY),
        page("cy-laptop", CY),
      ],
      subscription: "ada-page",
    },
  );
  expect(chat.faces()).toEqual([
    "bo@example.com is here",
    "cy@example.com is here, in another tab or app, 2 pages",
  ]);
  expect(chat.line()?.querySelector("[role=status]")?.textContent).toBe("bo is typing…");
  // the others are new to this page: it says its own status once, and nothing in it says who
  await vi.waitFor(() =>
    expect(chat.sent()).toEqual([
      {
        type: "presence/status",
        ephemeral: true,
        payload: { subscription: "ada-page", away: false, typing: false },
      },
    ]),
  );
});

test("a person who writes in the box is typing for the others, and no longer once the words are sent", async () => {
  using chat = await mount([], { me: ADA.actor, presence: true }, { subscription: "ada-page" });
  await chat.write("Book the table");
  await vi.waitFor(() => expect(chat.sent().map((event) => event.payload.typing)).toEqual([true]));
  await chat.send(() => chat.sent().length === 2);
  expect(chat.sent().map((event) => event.payload.typing)).toEqual([true, false]);
});

test("a send ends the typing of the draft it sent, never that of a newer draft written while it was sending", async () => {
  let land = () => {};
  using chat = await mount(
    [],
    {
      me: ADA.actor,
      presence: true,
      onMessage: () => new Promise<void>((done) => (land = done)),
    },
    { subscription: "ada-page" },
  );
  await chat.write("Book the table");
  await vi.waitFor(() => expect(chat.sent().map((event) => event.payload.typing)).toEqual([true]));
  const button = document.querySelector<HTMLButtonElement>('button[title="Send message"]');
  await act(async () => button?.click());
  await chat.write(" for four");
  await act(async () => land());
  await act(async () => {});
  expect([
    chat.sent().map((event) => event.payload.typing),
    document.querySelector('[role="textbox"]')?.textContent,
  ]).toEqual([[true], "Book the table for four"]);
});

test("the loop's copy of a message takes the message's sender only with the message's own words: other words under another person's message are nobody's", () => {
  const copyOf = (offset: number, content: string) => ({
    ...said(offset, content),
    source: {
      processor: {
        slug: "agent",
        version: "1",
        whileProcessing: { offset: 1, type: "events.iterate.com/agent/message-received" },
      },
    },
  });
  let state = initialAgentUiState();
  const items: AgentUiItem[] = [];
  for (const event of [
    {
      offset: 1,
      type: "events.iterate.com/agent/message-received",
      createdAt: AT,
      payload: { message: "Hello from Bo" },
      source: { onBehalfOf: { principal: BO, call: "/agents/demo#agent.message" } },
    },
    // a script's forgery, which names Bo's message
    copyOf(2, "Pay the invoice"),
    copyOf(3, "Hello from Bo"),
    // a schedule that Bo set fires: he did not say these words now
    { ...said(4, "Scheduled words"), source: { principal: BO, schedule: { key: "k" } } },
  ] as StreamEvent[]) {
    const step = reduceAgentUi(state, event);
    state = step.endState;
    items.push(...step.items);
  }
  expect(
    items.map((item) => (item.kind === "user" ? [item.text, item.saidBy || null] : null)),
  ).toEqual([
    ["Pay the invoice", null],
    ["Hello from Bo", "bo"],
    ["Scheduled words", null],
  ]);
});

test("the loop's copy takes the message's sender once, only with the message's own files, and never for a schedule's copy", () => {
  const items = fold([
    {
      offset: 1,
      type: "events.iterate.com/agent/message-received",
      createdAt: AT,
      payload: { message: "See the report", files: [file("a.txt")] },
      source: { principal: BO },
    },
    // a file Bo did not send
    copied(2, "See the report", [file("b.txt")]),
    // a schedule's copy that names Bo's message: no sender, and Bo's entry stays
    {
      ...copied(3, "See the report", [file("a.txt")]),
      source: { ...relay, schedule: { key: "k" } },
    },
    // Cy's own session names Bo's message: Cy said it, and Bo's entry stays
    { ...copied(4, "See the report", [file("a.txt")]), source: { ...relay, principal: CY } },
    // the loop's copy
    copied(5, "See the report", [file("a.txt")]),
    // a second copy
    copied(6, "See the report", [file("a.txt")]),
  ]);
  expect(items.map(saidByOfItem)).toEqual([null, null, "cy", "bo", null]);
});

test("an interrupt through a second copy of a person's message names nobody as who stopped the answer", () => {
  const { state, items } = foldState([
    {
      offset: 1,
      type: "events.iterate.com/agent/message-received",
      createdAt: AT,
      payload: { message: "go" },
      source: { principal: BO },
    },
    copied(2, "go"),
    running(3, 2),
    {
      ...copied(4, "go"),
      payload: {
        ...said(4, "go").payload,
        llmRequestPolicy: { behaviour: "interrupt-current-request" },
      },
    },
    cancelled(5, 3),
  ]);
  expect(summaryOf(state, items)).toMatch(/interrupted$/);
});

test("the newest interrupt says who stopped the answer: one that code sent names nobody, also after a person's", () => {
  const { state, items } = foldState([
    { ...said(1, "go"), source: { principal: ADA } },
    running(2, 1),
    interrupt(3, { principal: BO }),
    cancelled(4, 2),
    running(5, 3),
    interrupt(6, { origin: "/" }),
    cancelled(7, 5),
  ]);
  expect(summaryOf(state, items)).toMatch(/2 requests · interrupted$/);
});

test("with presence off a page sends nothing and shows no line: presence is the host's to turn on", async () => {
  using chat = await mount(
    [status(1, BO, "bo-page", { typing: true })],
    { me: ADA.actor },
    { pages: [page("bo-page", BO)], subscription: "ada-page" },
  );
  await chat.write("Book the table");
  // outlasts the 400 ms in which a page answers another's arrival
  await act(() => new Promise((done) => setTimeout(done, 450)));
  expect(chat.line()?.outerHTML).toBeUndefined();
  expect(chat.access()?.outerHTML).toBeUndefined();
  expect(document.querySelector("[data-typing-in-stream]")?.outerHTML).toBeUndefined();
  expect(chat.sent()).toEqual([]);
});

test("who can use the conversation is a people button beside the tabs that counts the others here or who wrote; the line has none", async () => {
  {
    using chat = await mount([{ ...said(1, "mine"), source: { principal: ADA } }], {
      me: ADA.actor,
      presence: true,
    });
    // alone: the plain icon, and a line of the empty status that typing words go into
    expect(chat.access()?.getAttribute("data-others")).toBe("0");
    expect(chat.access()?.textContent).toBe("");
    expect(chat.line()?.querySelector("button")?.outerHTML).toBeUndefined();
    expect(chat.line()?.querySelector("[role=status]")?.outerHTML).toContain('role="status"');
    expect(chat.line()?.textContent).toBe("");
  }
  using chat = await mount(
    [
      { ...said(1, "mine"), source: { principal: ADA } },
      { ...said(2, "an earlier word"), source: { principal: CY } },
    ],
    { me: ADA.actor, presence: true },
    { pages: [page("bo-page", BO)] },
  );
  // one here, one who wrote
  expect(chat.access()?.getAttribute("data-others")).toBe("2");
  expect(chat.access()?.textContent).toBe("2");
  expect(chat.line()?.querySelector("button")?.outerHTML).toBeUndefined();
  expect(document.body.textContent).not.toContain("Shared");
  await act(async () => chat.access()?.click());
  const card = document.querySelector("[data-slot=popover-content]");
  expect(card?.querySelector("[data-slot=popover-title]")?.textContent).toBe(
    "Who can use this conversation",
  );
  expect(card?.textContent).toContain(
    "Every member of this mind can open it, read all of its history (the messages, the scripts and their results) and write to it.",
  );
  expect(card?.textContent).toContain(
    "The agent acts for whoever writes here, with everything it can reach",
  );
  expect(card?.querySelector("[data-shared-here]")?.textContent).toBe("Here now: bo@example.com");
  expect(card?.querySelector("[data-shared-wrote]")?.textContent).toBe(
    "Also wrote here: cy@example.com",
  );
});

test("a page's status events are no row: the Events tab neither counts nor shows them, and the line still hears them", async () => {
  using chat = await mount(
    [{ ...said(1, "hello"), source: { principal: ADA } }, status(2, BO, "bo-page", { away: true })],
    { me: ADA.actor, presence: true },
    { pages: [page("bo-page", BO)] },
  );
  expect(chat.faces()).toEqual(["bo@example.com is here, in another tab or app"]);
  const tab = [...document.querySelectorAll("[role=tab]")].find((element) =>
    element.textContent?.startsWith("Events"),
  );
  expect(tab?.textContent).toBe("Events1");
  await chat.show("events");
  expect(document.body.textContent).toContain("context-added");
  expect(document.body.textContent).not.toContain("presence/status");
});

test("each message says its author once to a screen reader, also a later bubble of a run; the face and the name beside a bubble are for the eye, the line's face says who", async () => {
  using chat = await mount(
    [
      { ...said(1, "hello"), source: { principal: BO } },
      { ...said(2, "and again"), source: { principal: BO } },
      { ...said(3, "mine"), source: { principal: ADA } },
    ],
    { me: ADA.actor, presence: true },
    { pages: [page("bo-page", BO)] },
  );
  expect(
    [...document.querySelectorAll("[role=log] [data-kind]")].map((row) =>
      [...row.querySelectorAll(".sr-only")].map((author) => author.textContent),
    ),
  ).toEqual([["bo@example.com:"], ["bo@example.com:"], ["You:"]]);
  expect(
    [...document.querySelectorAll("[data-slot=avatar], [data-said-by]")].map((part) => [
      part.textContent,
      part.closest("[aria-hidden=true]")?.getAttribute("aria-hidden"),
      part.getAttribute("aria-label"),
    ]),
  ).toEqual([
    ["bo", "true", null],
    ["B", "true", null],
    ["B", undefined, "bo@example.com is here"],
  ]);
  expect(chat.faces()).toEqual(["bo@example.com is here"]);
});

test("each waiting message says whose it is, and anyone may interrupt an answer, whoever asked for it", async () => {
  const onAppend = vi.fn(async (_events: unknown[]) => {});
  using _chat = await mount(
    [
      { ...said(1, "go"), source: { principal: BO } },
      running(2, 1),
      { ...said(3, "and make it green"), source: { principal: BO } },
      { ...said(4, "no, blue"), source: { principal: ADA } },
    ],
    { me: ADA.actor, onAppend },
  );
  const panel = document.querySelector("[data-testid=queued-messages-panel]");
  expect(
    [...(panel?.querySelectorAll("[data-queued-by]") || [])].map((label) => [
      label.textContent,
      label.getAttribute("title"),
    ]),
  ).toEqual([
    ["bo", "bo@example.com"],
    ["You", "ada@example.com"],
  ]);
  // each beside the face the feed draws over a person's bubble, which says who
  expect(labels("[data-testid=queued-messages-panel] [data-slot=avatar]")).toEqual([
    ["B", "bo@example.com"],
    ["A", "ada@example.com"],
  ]);
  // Bo's answer is running; Ada stops it
  const interrupt = [...(panel?.querySelectorAll("button") || [])].find((button) =>
    button.textContent?.includes("Interrupt"),
  );
  await act(async () => interrupt?.click());
  expect(onAppend.mock.calls).toMatchObject([
    [
      [
        {
          type: "events.iterate.com/agent/context-added",
          payload: { llmRequestPolicy: { behaviour: "interrupt-current-request" } },
        },
      ],
    ],
  ]);
});

test("the feed says who stopped an answer: the principal whose input carried the interrupt, or you", () => {
  let state = initialAgentUiState();
  const items: AgentUiItem[] = [];
  for (const event of [
    { ...said(1, "go"), source: { principal: ADA } },
    running(2, 1),
    {
      offset: 3,
      type: "events.iterate.com/agent/context-added",
      createdAt: AT,
      payload: {
        role: "developer",
        content: "The user interrupted the in-progress response from the web chat.",
        actor: { type: "user" },
        llmRequestPolicy: { behaviour: "interrupt-current-request" },
      },
      source: { principal: BO },
    },
    {
      offset: 4,
      type: "events.iterate.com/agent/llm-request-settled",
      createdAt: AT,
      payload: {
        requestOffset: 2,
        result: { status: "cancelled", reason: "interrupted-by-user-input" },
      },
    },
  ] as StreamEvent[]) {
    const step = reduceAgentUi(state, event);
    state = step.endState;
    items.push(...step.items);
  }
  const activity = state.live || items.find((item) => item.kind === "activity");
  if (!activity || activity.kind !== "activity") throw new Error("no activity was folded");
  expect([
    formatAgentUiActivitySummary(activity, { me: ADA.actor }),
    formatAgentUiActivitySummary(activity, { me: "BO@example.com" }),
  ]).toEqual([
    expect.stringContaining("interrupted by bo"),
    expect.stringContaining("interrupted by you"),
  ]);
});

test("a guest's message shows their name and that they are a guest, over the bubble and in the queue, on a face of their name's initials", async () => {
  using _chat = await mount(
    [saidFor(1, "go", GUEST), running(2, 1), saidFor(3, "and make it green", GUEST)],
    { me: ADA.actor },
  );
  expect(labels("[data-said-by], [data-queued-by]")).toEqual([
    ["Bob Proof (guest)", "Bob Proof (guest)"],
    ["Bob Proof (guest)", "Bob Proof (guest)"],
  ]);
  expect(labels("[data-slot=avatar]").map(([initials]) => initials)).toEqual(["BP", "BP"]);
});

test("an interrupt by a guest reads as their name, marked a guest", () => {
  const { state, items } = foldState([
    { ...said(1, "go"), source: { principal: ADA } },
    running(2, 1),
    interrupt(3, { onBehalfOf: { principal: GUEST } }),
    cancelled(4, 2),
  ]);
  expect(summaryOf(state, items)).toContain("interrupted by Bob Proof (guest)");
});

test("a guest who is here is a face of their name's initials that says their name and that they are a guest", async () => {
  using chat = await mount(
    [],
    { me: ADA.actor, presence: true },
    { pages: [page("bob-page", GUEST)] },
  );
  expect(chat.faces()).toEqual(["Bob Proof (guest) is here"]);
  expect(labels("[data-slot=agent-presence] [data-slot=avatar]")).toEqual([
    ["BP", "Bob Proof (guest) is here"],
  ]);
});

test("a member with an email looks as before, also when the stamp has a name; a person with neither is their actor id", async () => {
  const BO_NAMED = { ...BO, name: "Robert" };
  const NOBODY_NAMED = { actor: "user_9001" };
  using chat = await mount(
    [saidFor(1, "hi", BO_NAMED), saidFor(2, "hello", NOBODY_NAMED)],
    { me: ADA.actor, presence: true },
    { pages: [page("bo-page", BO_NAMED), page("nobody-page", NOBODY_NAMED)] },
  );
  expect(labels("[data-said-by]")).toEqual([
    ["bo", "bo@example.com"],
    ["user_9001", "user_9001"],
  ]);
  expect(chat.faces()).toEqual(["bo@example.com is here", "user_9001 is here"]);
  expect(labels("[data-slot=avatar]").map(([initials]) => initials)).toEqual([
    "B",
    "U9",
    "B",
    "U9",
  ]);
});

test("a name with markup characters is drawn as its text", async () => {
  const MARKUP = { ...GUEST, name: "<b>Eve</b>" };
  using chat = await mount(
    [saidFor(1, "hi", MARKUP)],
    { me: ADA.actor, presence: true },
    { pages: [page("eve-page", MARKUP)] },
  );
  expect(labels("[data-said-by]")).toEqual([["<b>Eve</b> (guest)", "<b>Eve</b> (guest)"]]);
  expect(chat.faces()).toEqual(["<b>Eve</b> (guest) is here"]);
});

test("a message keeps its key while the same words are tried again, and the next message has another", async () => {
  const keys: string[] = [];
  let fail = true;
  using chat = await mount([], {
    onMessage: async ({ key }) => {
      keys.push(key);
      if (fail) throw new Error("the connection was lost");
    },
  });
  await chat.write("Book the table");
  await chat.send(() => keys.length === 1);
  // the words stay in the box after a failure: sent again, they are the same message
  fail = false;
  await chat.send(() => keys.length === 2);
  await chat.write("Book the table");
  await chat.send(() => keys.length === 3);
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).not.toBe(keys[0]);
  expect(keys.every((key) => /^[0-9a-f-]{12}:\d+$/.test(key))).toBe(true);
});

test("the key is the draft's: it outlives a visit to the Events tab, and a file replaced by another of the same name is another message", async () => {
  const keys: string[] = [];
  using chat = await mount([], {
    onMessage: async ({ key }) => {
      keys.push(key);
      throw new Error("the connection was lost");
    },
  });
  await chat.write("See the report");
  await chat.attach(note("100"));
  await chat.send(() => keys.length === 1);
  // the person looks at the events and comes back: the draft is there, and so is its key
  await chat.show("events");
  await chat.show();
  await chat.send(() => keys.length === 2);
  // the corrected report has the same name and the same length
  await chat.detach("report.txt");
  await chat.attach(note("900"));
  await chat.send(() => keys.length === 3);
  expect([keys[1] === keys[0], keys[2] === keys[0]]).toEqual([true, false]);
});

// ── which side a message stands on, and whose face is over it ──

test("a chat of one person is drawn as before: their bubble at the right with no face or name, the mind's answer full width", async () => {
  using _chat = await mount(
    [
      { ...said(1, "can you check the DNS"), source: { principal: ADA } },
      answer(2, "The MX record"),
    ],
    { me: ADA.actor },
  );
  // the classes are the point: the viewer's bubble and the answer keep every one they had
  expect(
    [...document.querySelectorAll("[role=log] [data-kind]")].map((row) => [
      row.getAttribute("class"),
      row.firstElementChild?.getAttribute("class"),
    ]),
  ).toEqual([
    [
      "group flex w-full flex-col gap-2 is-user ml-auto max-w-[95%] justify-end pb-2 pt-3.5",
      "is-user:dark flex w-fit max-w-full min-w-0 flex-col gap-2 text-sm wrap-break-word group-[.is-user]:ml-auto group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-foreground group-[.is-assistant]:text-foreground group-[.is-user]:rounded-2xl",
    ],
    [
      "group flex w-full flex-col gap-2 is-assistant py-2",
      "is-user:dark flex w-fit max-w-full min-w-0 flex-col gap-2 text-sm wrap-break-word group-[.is-user]:ml-auto group-[.is-user]:rounded-lg group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-foreground group-[.is-assistant]:text-foreground",
    ],
  ]);
  // the one change: the viewer's bubble begins with its author for a screen reader,
  // `<span class="sr-only">You:</span>`, which takes no room
  expect(feedRows()).toEqual([
    { kind: "user", from: null, author: "You:", shows: ["can you check the DNS"] },
    { kind: "assistant", from: null, author: undefined, shows: ["The MX record"] },
  ]);
  expect(labels("[role=log] [data-slot=avatar]")).toEqual([]);
});

test("another person's message stands at the left under their face and short name, and no name is under any bubble", async () => {
  using _chat = await mount(
    [
      { ...said(1, "can you check the DNS"), source: { principal: ADA } },
      { ...said(2, "also the SPF record please"), source: { principal: BO } },
    ],
    { me: ADA.actor },
  );
  // a row's parts from top to bottom: the name comes before the bubble
  expect(feedRows()).toMatchObject([
    { kind: "user", from: null, shows: ["can you check the DNS"] },
    { kind: "user", from: "other", shows: ["by bo", "also the SPF record please"] },
  ]);
  expect(labels("[role=log] [data-slot=avatar]")).toEqual([["B", null]]);
});

test("a run of one person's messages has one face and one name; the mind's answer or another person starts a new run", async () => {
  using _chat = await mount(
    [
      saidFor(1, "also the SPF record please", BO),
      saidFor(2, "and DKIM", BO),
      saidFor(3, "and DMARC", BO),
      answer(4, "On it"),
      saidFor(5, "thanks", BO),
      saidFor(6, "me too", CY),
      saidFor(7, "and the TTL", BO),
    ],
    { me: ADA.actor },
  );
  expect(feedRows()).toMatchObject([
    { kind: "user", from: "other", shows: ["by bo", "also the SPF record please"] },
    { kind: "user", from: "other", shows: ["and DKIM"] },
    { kind: "user", from: "other", shows: ["and DMARC"] },
    { kind: "assistant", from: null, shows: ["On it"] },
    { kind: "user", from: "other", shows: ["by bo", "thanks"] },
    { kind: "user", from: "other", shows: ["by cy", "me too"] },
    { kind: "user", from: "other", shows: ["by bo", "and the TTL"] },
  ]);
});

test("a guest, a person's script and another mind each stand at the left under a face, and a script starts its own run", async () => {
  using _chat = await mount(
    [
      saidFor(1, "hi", GUEST),
      { ...said(2, "from the script"), source: { onBehalfOf: { principal: BO, run: "r1" } } },
      { ...said(3, "and from me"), source: { principal: BO } },
      {
        ...said(4, "hello from a mind"),
        source: { signer: { principal: { actor: "garple.com", kind: "mind" } } },
      },
    ] as Row[],
    { me: ADA.actor },
  );
  expect(feedRows()).toEqual([
    {
      kind: "user",
      from: "other",
      author: "Bob Proof (guest):",
      shows: ["by Bob Proof (guest)", "hi"],
    },
    {
      kind: "user",
      from: "other",
      author: "bo@example.com:",
      shows: ["by bo (a script)", "from the script"],
    },
    { kind: "user", from: "other", author: "bo@example.com:", shows: ["by bo", "and from me"] },
    {
      kind: "user",
      from: "other",
      author: "garple.com:",
      shows: ["by garple.com", "hello from a mind"],
    },
  ]);
  expect(labels("[role=log] [data-slot=avatar]").map(([initials]) => initials)).toEqual([
    "BP",
    "B",
    "B",
    "GC",
  ]);
});

test.for([
  { name: "by actor id", me: ADA.actor },
  { name: "by address", me: "ADA@example.com" },
])(
  "the viewer's own message stays at the right with no face or name, known $name",
  async ({ me }) => {
    using _chat = await mount([{ ...said(1, "mine"), source: { principal: ADA } }], { me });
    expect(feedRows()).toEqual([{ kind: "user", from: null, author: "You:", shows: ["mine"] }]);
    expect(labels("[role=log] [data-slot=avatar]")).toEqual([]);
  },
);

test("a page's own row under an item is the next element after the row, which keeps its kind", async () => {
  using _chat = await mount(
    [
      { ...said(1, "mine"), source: { principal: ADA } },
      { ...said(2, "theirs"), source: { principal: BO } },
      answer(3, "On it"),
    ],
    { me: ADA.actor, itemFooter: (item) => <span data-footer={item.id} /> },
  );
  expect(
    [...document.querySelectorAll("[data-footer]")].map((footer) => [
      footer.getAttribute("data-footer"),
      footer.previousElementSibling?.getAttribute("data-kind"),
      footer.previousElementSibling?.getAttribute("data-from"),
    ]),
  ).toEqual([
    ["user-1", "user", null],
    ["user-2", "user", "other"],
    ["assistant-3", "assistant", null],
  ]);
});

// ── who is typing, at the end of the feed ──

test("a person who types is their face with dots at the end of the feed, the line's words are for a screen reader, and both go when they stop", async () => {
  using chat = await mount(
    [status(1, BO, "bo-page", { typing: true })],
    { me: ADA.actor, presence: true },
    { pages: [page("bo-page", BO)], subscription: "ada-page" },
  );
  expect(labels("[data-typing-in-stream] [data-said-by]")).toEqual([["bo", "bo@example.com"]]);
  const words = () => chat.line()?.querySelector("[role=status]");
  expect([words()?.textContent, words()?.getAttribute("class")]).toEqual([
    "bo is typing…",
    "sr-only",
  ]);
  await chat.append([status(2, BO, "bo-page")]);
  expect(document.querySelector("[data-typing-in-stream]")?.outerHTML).toBeUndefined();
  expect(words()?.textContent).toBe("");
});

test("a person's dots go when their message lands, also beside a status of the same instant, and come back with a newer status", async () => {
  const at = Date.now();
  using chat = await mount(
    [status(1, BO, "bo-page", { typing: true, at: at - 2_000 })],
    { me: ADA.actor, presence: true },
    { pages: [page("bo-page", BO)] },
  );
  // the rows of dots, the names over them, and the line's words
  const typists = () => [
    document.querySelectorAll("[data-typing-in-stream] > *").length,
    labels("[data-typing-in-stream] [data-said-by]"),
    chat.line()?.querySelector("[role=status]")?.textContent,
  ];
  const seen = [typists()];
  await chat.append([
    {
      ...said(2, "a table for four"),
      createdAt: new Date(at - 1_000).toISOString(),
      source: { principal: BO },
    },
  ]);
  seen.push(typists());
  await chat.append([status(3, BO, "bo-page", { typing: true, at: at - 1_000 })]);
  seen.push(typists());
  await chat.append([status(4, BO, "bo-page", { typing: true, at })]);
  seen.push(typists());
  expect(seen).toEqual([
    [1, [["bo", "bo@example.com"]], "bo is typing…"],
    [0, [], ""],
    [0, [], ""],
    // on Bo's run now: the dots have no name over them, as his next bubble will have none
    [1, [], "bo is typing…"],
  ]);
});

test("the dots of who types stand where their message will: on their own run with no name or face, else as a run's first bubble", async () => {
  using _chat = await mount(
    [
      saidFor(1, "the table?", BO),
      saidFor(2, "for four", CY),
      status(3, BO, "bo-page", { typing: true }),
      status(4, CY, "cy-page", { typing: true }),
    ],
    { me: ADA.actor, presence: true },
    { pages: [page("bo-page", BO), page("cy-page", CY)] },
  );
  // Cy's run ends the stream, so Cy's dots come first and go on it
  expect([
    [...document.querySelectorAll("[data-typing-in-stream] > *")].map((row) => [
      row.getAttribute("class"),
      row.querySelector("[data-said-by]")?.textContent,
      row.querySelectorAll("[data-slot=avatar]").length,
    ]),
    [...document.querySelectorAll("[role=log] [data-from=other]")].map((row) =>
      row.getAttribute("class"),
    ),
  ]).toEqual([
    [
      ["grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2 gap-y-1 pb-2", undefined, 0],
      ["grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2 gap-y-1 pb-2 pt-3.5", "bo", 1],
    ],
    [
      "grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2 gap-y-1 pb-2 pt-3.5",
      "grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2 gap-y-1 pb-2 pt-3.5",
    ],
  ]);
});

test("in a chat where nothing was said, the greeting stays while someone types, and their dots stand with it", async () => {
  using _chat = await mount(
    [status(1, BO, "bo-page", { typing: true })],
    { me: ADA.actor, presence: true, empty: <p>Ask me anything</p> },
    { pages: [page("bo-page", BO)] },
  );
  expect([
    document.querySelector("[data-slot=agent-chat-empty]")?.textContent,
    labels("[role=log] [data-typing-in-stream] [data-said-by]"),
  ]).toEqual(["Ask me anything", [["bo", "bo@example.com"]]]);
});

test("the feed draws three typists and counts the rest", async () => {
  const typists = ["bo", "cy", "di", "ed", "fy"].map((name) => ({
    actor: `/members/${name}`,
    email: `${name}@example.com`,
  }));
  using chat = await mount(
    typists.map((principal, index) =>
      status(index + 1, principal, `${principal.actor}-page`, { typing: true }),
    ),
    { me: ADA.actor, presence: true },
    { pages: typists.map((principal) => page(`${principal.actor}-page`, principal)) },
  );
  expect([
    labels("[data-typing-in-stream] [data-said-by]").map(([, title]) => title),
    labels("[data-typing-more]"),
    chat.line()?.querySelector("[role=status]")?.textContent,
  ]).toEqual([
    ["bo@example.com", "cy@example.com", "di@example.com"],
    [["+2", null]],
    "5 people are typing…",
  ]);
});

/** The source of the loop's copy of the message at offset 1, as iterate's loop appends it. */
const relay = {
  processor: {
    slug: "agent",
    version: "1",
    whileProcessing: { offset: 1, type: "events.iterate.com/agent/message-received" },
  },
};

test('the live row says "interrupted by you" to who stopped the answer, when nothing runs and when the next request does', async () => {
  const stopped = [
    { ...said(1, "go"), source: { principal: ADA } },
    running(2, 1),
    interrupt(3, { principal: BO }),
    cancelled(4, 2),
  ];
  const texts: (string | null)[] = [];
  for (const events of [stopped, [...stopped, running(5, 3)]]) {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <AgentLiveActivity
          state={foldState(events).state}
          toggledIds={new Set()}
          onToggle={() => {}}
          inspect={{ llmRequest: () => {}, scriptRun: () => {} }}
          me={BO.actor}
        />,
      ),
    );
    texts.push(container.textContent);
    await act(async () => root.unmount());
  }
  expect(texts).toEqual([
    expect.stringContaining("interrupted by you"),
    expect.stringContaining("interrupted by you"),
  ]);
});

/** Each row of the feed: its kind, its side (`other`: another participant's), who wrote it in
 *  words for a screen reader (`author`), and what the eye reads from top to bottom: "by <name>" for
 *  the line with a name, then the bubble's words. A face shows no words. */
const feedRows = () =>
  [...document.querySelectorAll("[role=log] [data-kind]")].map((row) => {
    const author = row.querySelector(".sr-only")?.textContent;
    return {
      kind: row.getAttribute("data-kind"),
      from: row.getAttribute("data-from"),
      author,
      shows: [...row.children].flatMap((part) => {
        if (part.matches("[data-said-by]")) return [`by ${part.textContent}`];
        if (part.matches("[aria-hidden=true]")) return [];
        // the author is the first words of the bubble, the row's one part left
        return [part.textContent.slice(author?.length)];
      }),
    };
  });

/** The text and the title of each element that `selector` finds in the page, in order. */
const labels = (selector: string) =>
  [...document.querySelectorAll(selector)].map((element) => [
    element.textContent,
    element.getAttribute("title"),
  ]);

/** The loop's copy of the message at offset 1, with `content` and `files`. */
function copied(offset: number, content: string, files: ReturnType<typeof file>[] = []) {
  const words = said(offset, content);
  return { ...words, payload: { ...words.payload, files }, source: relay };
}

/** A file as a message names it. */
function file(name: string) {
  return { path: `/agents/demo/files/${name}`, filename: name, contentType: "text/plain", size: 3 };
}

/** A press of Interrupt, appended under `source`. */
function interrupt(offset: number, source: Record<string, unknown>) {
  return {
    offset,
    type: "events.iterate.com/agent/context-added",
    createdAt: AT,
    payload: {
      role: "developer",
      content: "The user interrupted the in-progress response from the web chat.",
      actor: { type: "user" },
      llmRequestPolicy: { behaviour: "interrupt-current-request" },
    },
    source,
  };
}

/** The request at `requestOffset`, stopped by an interrupt. */
function cancelled(offset: number, requestOffset: number) {
  return {
    offset,
    type: "events.iterate.com/agent/llm-request-settled",
    createdAt: AT,
    payload: {
      requestOffset,
      result: { status: "cancelled", reason: "interrupted-by-user-input" },
    },
  };
}

/** `events` through the chat's reducer: the end state and every item it made. */
function foldState(events: unknown[]) {
  let state = initialAgentUiState();
  const items: AgentUiItem[] = [];
  // The cast: each row is built above in the shape of a committed event.
  for (const event of events as StreamEvent[]) {
    const step = reduceAgentUi(state, event);
    state = step.endState;
    items.push(...step.items);
  }
  return { state, items };
}

/** The person's bubbles that `events` make. */
const fold = (events: unknown[]) => foldState(events).items.filter((item) => item.kind === "user");

/** Who a bubble says sent it, or null. */
const saidByOfItem = (item: AgentUiItem) => (item.kind === "user" && item.saidBy) || null;

/** The answer's summary line, as Ada reads it. */
function summaryOf(state: ReturnType<typeof initialAgentUiState>, items: AgentUiItem[]) {
  const activity = state.live || items.find((item) => item.kind === "activity");
  if (!activity || activity.kind !== "activity") throw new Error("no activity was folded");
  return formatAgentUiActivitySummary(activity, { me: ADA.actor });
}

type Row = ComponentProps<typeof AgentChat>["context"]["events"][number];
/** A report to attach, with `content`. */
const note = (content: string) => new File([content], "report.txt", { type: "text/plain" });
const AT = "2026-11-18T12:00:00.000Z";

/** A person's words in the log. */
function said(offset: number, content: string) {
  return {
    offset,
    type: "events.iterate.com/agent/context-added",
    createdAt: AT,
    payload: { role: "user", content, actor: { type: "user" } },
  };
}

/** A person's words, appended through a call into the agent on their behalf, as the platform
 *  names a person who may be no member. The cast: the context's event type does not name
 *  `onBehalfOf`. */
function saidFor(offset: number, content: string, principal: ShownPrincipal) {
  return { ...said(offset, content), source: { onBehalfOf: { principal } } } as unknown as Row;
}

/** The agent's answer, as its loop sends it to the web chat. */
function answer(offset: number, message: string) {
  return {
    offset,
    type: "events.iterate.com/agent/web-message-sent",
    createdAt: AT,
    payload: { message },
  };
}

/** A request the agent is writing an answer to. */
function running(offset: number, triggerOffset: number) {
  return {
    offset,
    type: "events.iterate.com/agent/llm-request-requested",
    createdAt: AT,
    payload: { model: "m", expiresAt: 9e12, triggerOffset },
  };
}

/** A page's `presence/status` as the platform commits it: ephemeral, stamped with whose session
 *  appended it, at `at` on the mind's clock (default now). The cast: the context's event type does
 *  not name `ephemeral`. */
function status(
  offset: number,
  principal: ShownPrincipal,
  subscription: string,
  { at = Date.now(), ...more }: { away?: boolean; typing?: boolean; at?: number } = {},
) {
  return {
    offset,
    type: "presence/status",
    createdAt: new Date(at).toISOString(),
    ephemeral: true,
    payload: { subscription, away: false, typing: false, ...more },
    source: { origin: "/", principal },
  } as unknown as Row;
}

/** A page that `principal` holds open: its row of the subscriptions table, as the platform lists it. */
function page(name: string, principal: ShownPrincipal) {
  return {
    name,
    target: `itx.builtins.rpcStubs.get('subscription:${name}')`,
    consumes: [...AgentChat.contextOptions.consumes],
    configuredAtOffset: 1,
    heldBy: { principal, via: { appPage: "dash" } },
  };
}

/** The chat over a log of `events`, with a page that has height (jsdom has none, and the
 *  virtual log draws no row without it), the `pages` open on the context, and the name of the
 *  chat's own row (`subscription`). Disposing unmounts it and clears the page. */
async function mount(
  events: Row[],
  props: Partial<ComponentProps<typeof AgentChat>> = {},
  { pages = [], subscription }: { pages?: ReturnType<typeof page>[]; subscription?: string } = {},
) {
  const sizes = { clientHeight: 600, offsetHeight: 0 };
  const own = Object.keys(sizes).map(
    (name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)] as const,
  );
  for (const [name, value] of Object.entries(sizes))
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get: () => value });
  const appended: { type: string; ephemeral?: boolean; payload: Record<string, unknown> }[][] = [];
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  let context = {
    events,
    caughtUp: true,
    presence: { actors: [], rpcStubs: pages.map((row) => `subscription:${row.name}`) },
    processors: { rows: pages, loaded: true },
    subscription,
    liveState: {},
  };
  const show = (view?: "events") =>
    act(async () =>
      root.render(
        <AgentChat
          path="/agents/demo"
          context={context}
          error={undefined}
          state={{ view }}
          onStateChange={() => {}}
          onMessage={async () => {}}
          onAppend={async (sent) => void appended.push(sent as (typeof appended)[number])}
          signedUrl={async () => ""}
          {...props}
        />,
      ),
    );
  await show();
  const line = () => document.querySelector("[data-slot=agent-presence]");
  const textbox = () =>
    vi.waitFor(() => {
      const element = document.querySelector('[role="textbox"]');
      if (!element) throw new Error("the message editor has not loaded");
      return element;
    });
  /** A paste into the message box: jsdom has no DataTransfer, so the event carries a stand-in. */
  const paste = async (text: string, files: File[]) => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: {
        files,
        items: text ? [{ kind: "string", type: "text/plain", getAsFile: () => null }] : [],
        getData: (format: string) => (format === "text/plain" ? text : ""),
      },
    });
    const box = await textbox();
    await act(async () => box.dispatchEvent(event));
  };
  return {
    line,
    /** The button that says who can use the conversation. */
    access: () =>
      document.querySelector<HTMLButtonElement>('button[title="Who can use this conversation"]'),
    /** The Events tab, or the chat again. */
    show,
    /** `rows` come into the log, and the chat is drawn again. */
    append(rows: Row[]) {
      context = { ...context, events: [...context.events, ...rows] };
      return show();
    },
    /** Attaches a file, as a paste does. */
    attach: (file: File) => paste("", [file]),
    /** Takes the attached file of that name out of the draft. */
    async detach(name: string) {
      const button = document.querySelector<HTMLButtonElement>(`button[title="Remove ${name}"]`);
      await act(async () => button?.click());
    },
    /** What each face says in words, in the order drawn. */
    faces: () =>
      [...(line()?.querySelectorAll("[data-slot=avatar]") || [])].map((face) =>
        face.getAttribute("aria-label"),
      ),
    /** The ephemeral events the page sent. */
    sent: () => appended.flat().filter((event) => event.ephemeral),
    /** Puts `text` into the message box, as a paste does. */
    write: (text: string) => paste(text, []),
    /** Presses Send, and waits until `done`. */
    async send(done: () => boolean) {
      const button = document.querySelector<HTMLButtonElement>('button[title="Send message"]');
      await act(async () => button?.click());
      await vi.waitFor(() => expect(done()).toBe(true));
      await act(async () => {});
    },
    [Symbol.dispose]: () => {
      act(() => root.unmount());
      document.body.replaceChildren();
      for (const [name, descriptor] of own)
        if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
        else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
    },
  };
}
