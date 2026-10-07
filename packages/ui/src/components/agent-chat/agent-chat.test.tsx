// @vitest-environment jsdom
// The chat's status strip when the agent's live state is not there to read: it says so, and the
// log alone then decides when a turn is over, instead of waiting on "Connecting…" for good.
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
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
])("the strip when $name: $status", async ({ processors, liveState, status }) => {
  using chat = await mount({ processors, liveState });
  expect(chat.status()).toBe(status);
});

type Context = ComponentProps<typeof AgentChat>["context"];

/** The chat mounted in the document over an empty log; disposing unmounts it and clears the page. */
async function mount(context: Pick<Context, "processors" | "liveState">) {
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
        onAppend={undefined}
        signedUrl={async () => ""}
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
