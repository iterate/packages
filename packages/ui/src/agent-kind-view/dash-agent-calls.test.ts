// The Dash's calls let go of every handle they open, a refusal included, and check the events
// that come from outside the page's code before they are appended.
import { expect, test } from "vitest";
import { appendEvents, messageAgent } from "./dash-agent-calls.ts";

test("a malformed event from outside the page is refused before anything is appended", async () => {
  const { itx, appended } = mind();
  const context = await itx.cd("/agents/claude/c");
  await expect(
    appendEvents(context, [
      { type: "events.example.com/kind/started", payload: {} },
      { payload: {} },
    ]),
  ).rejects.toThrow();
  await expect(appendEvents(context, [{ type: "x", payload: "words" }])).rejects.toThrow();
  expect(appended).toEqual([]);
});

test("a message lets go of the agent's handle, whether the agent takes it or refuses it", async () => {
  const taking = mind();
  await messageAgent(taking.itx, "/agents/a", { message: "Hello" });
  expect(taking).toMatchObject({ handles: { opened: 1, disposed: 1 } });

  const refusing = mind({ refuseMessage: true });
  await expect(messageAgent(refusing.itx, "/agents/a", { message: "Hello" })).rejects.toThrow(
    "NOT_CREATED",
  );
  expect(refusing).toMatchObject({ handles: { opened: 1, disposed: 1 } });
});

/** A mind that counts the handles it gives out and the ones let go, and keeps what is appended. */
function mind({ refuseMessage = false } = {}) {
  const handles = { opened: 0, disposed: 0 };
  const appended: unknown[] = [];
  const handle = <T extends object>(stub: T) => {
    handles.opened++;
    return { ...stub, [Symbol.dispose]: () => void handles.disposed++ };
  };
  const itx = {
    cd: async () =>
      handle({ append: async (...events: unknown[]) => void appended.push(...events) }),
    agents: {
      get: () =>
        handle({
          message: async () => {
            if (refuseMessage) throw new Error("NOT_CREATED");
          },
        }),
    },
  } as unknown as Parameters<typeof messageAgent>[0];
  return { itx, handles, appended };
}
