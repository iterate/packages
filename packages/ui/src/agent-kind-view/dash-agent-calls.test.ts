// The Dash's calls let go of every handle they open, a refusal included, and check the events
// that come from outside the page's code before they are appended.
import { expect, test } from "vitest";
import {
  appendEvents,
  appendTo,
  fileUrl,
  messageAgent,
  storeAgentFiles,
} from "./dash-agent-calls.ts";

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

test("a file's URL is asked of the mind, which has `files`, and its handle is let go, a refusal included", async () => {
  // the agent's own context has no `files`, as a Claude Code agent's has none
  const signing = mind();
  expect(await fileUrl(signing.itx, "/agents/claude/c/photo.png")).toBe(
    "https://files.example.com/agents/claude/c/photo.png",
  );
  expect(signing).toMatchObject({ handles: { opened: 1, disposed: 1 } });

  const refusing = mind({ refuseFile: true });
  await expect(fileUrl(refusing.itx, "/agents/claude/c/photo.png")).rejects.toThrow("NOT_FOUND");
  expect(refusing).toMatchObject({ handles: { opened: 1, disposed: 1 } });
});

test("a message's files are stored under the agent's path as message() stores them: a key gives the same path again", async () => {
  const { itx, handles, puts } = mind();
  const file = { contentType: "image/png", filename: "my photo.png", data: "AAAA" };
  const keyed = await storeAgentFiles(itx, "/agents/a", [file], "page:1");
  const again = await storeAgentFiles(itx, "/agents/a", [file], "page:1");
  await storeAgentFiles(itx, "/agents/a", [file]);
  expect(again).toEqual(keyed);
  expect(keyed).toMatchObject([{ contentType: "image/png", filename: "my photo.png", size: 4 }]);
  // a stem of 16 hex characters from the key, the place, the type and the content; else 8 random
  expect(puts.map((put) => put.path)).toMatchObject([
    expect.stringMatching(/^\/agents\/a\/[0-9a-f]{16}-my-photo\.png$/),
    keyed[0]!.path,
    expect.stringMatching(/^\/agents\/a\/[0-9a-f-]{8}-my-photo\.png$/),
  ]);
  expect(handles).toEqual({ opened: 3, disposed: 3 });
});

test("an append to a path lets go of the context's handle", async () => {
  const { itx, handles, appended } = mind();
  await appendTo(itx, "/agents/a", [{ type: "events.example.com/x", payload: {} }]);
  expect({ handles, appended }).toEqual({
    handles: { opened: 1, disposed: 1 },
    appended: [{ type: "events.example.com/x", payload: {} }],
  });
});

/** A mind that counts the handles it gives out and the ones let go, and keeps what is appended.
 *  Its root has `files`; a context that `cd` answers has none. */
function mind({ refuseMessage = false, refuseFile = false } = {}) {
  const handles = { opened: 0, disposed: 0 };
  const appended: unknown[] = [];
  const puts: { path: string; contentType?: string }[] = [];
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
    files: {
      get: (path: string) =>
        handle({
          url: async () => {
            if (refuseFile) throw new Error("NOT_FOUND");
            return { url: `https://files.example.com${path}` };
          },
          put: async ({ contentType, data }: { contentType?: string; data: string }) => {
            puts.push({ path, contentType });
            return { path, contentType, size: data.length };
          },
        }),
    },
  } as unknown as Parameters<typeof messageAgent>[0];
  return { itx, handles, appended, puts };
}
