// @vitest-environment jsdom
// The chat's status strip when the agent's live state is not there to read: it says what the
// catalog heard from the agent, or else that it cannot tell, and the log alone then decides when a
// turn is over, instead of waiting on "Connecting…" for good. And the chat with no strip, where the
// status is the feed's last row.
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { AgentChat } from "./agent-chat.tsx";

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  // jsdom lays nothing out, so it has no ResizeObserver; the scroll container asks for one
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
});

test.for<Pick<Context, "processors" | "liveState"> & { name: string; status: string }>([
  {
    name: "the processors table has not loaded yet",
    processors: { rows: [], loaded: false },
    liveState: {},
    status: "Connecting…",
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

type Context = ComponentProps<typeof AgentChat>["context"];

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
    Partial<Pick<Context, "events" | "head" | "older">>,
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
