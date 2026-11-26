// An app's calls to its own server, as the page makes them (widget-mcp.ts): one connection for each
// server and headers, a tool whose visibility leaves out "app" refused, a call as another path
// refused, and each call one `widget-tool-called` fact on the agent's log.
import { expect, test, vi } from "vitest";
import { WIDGET_FACT } from "./widget.ts";
import { WIDGET_TOOLS_KEPT_MS, widgetMcpHost, type WidgetMcpConnection } from "./widget-mcp.ts";

test("a tool call goes through one connection, and each call is one fact on the agent's log", async () => {
  const { host, open, appended, connection } = fake();
  const call = { path: "/agents/main", key: "pets", server: SERVER, headers: HEADERS, args: {} };
  expect(await host.callTool({ ...call, name: "list_pets" })).toEqual({
    content: [{ type: "text", text: "list_pets" }],
  });
  expect(await host.callTool({ ...call, name: "refuse" })).toMatchObject({ isError: true });
  expect(open).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledWith(SERVER, HEADERS);
  expect(connection.listTools).toHaveBeenCalledTimes(1);
  expect(appended.map((event) => event.type)).toEqual([
    WIDGET_FACT.toolCalled,
    WIDGET_FACT.toolCalled,
  ]);
  expect(appended[0]!.payload).toMatchObject({
    key: "pets",
    server: SERVER,
    tool: "list_pets",
    ok: true,
  });
  expect(appended[1]!.payload).toMatchObject({ tool: "refuse", ok: false });
  expect(typeof appended[0]!.payload.ms).toBe("number");
  // other headers are another connection
  await host.callTool({ ...call, headers: {}, name: "list_pets" });
  expect(open).toHaveBeenCalledTimes(2);
});

test("a tool whose visibility leaves out the app, and a call as another path, are refused", async () => {
  const { host, connection, appended } = fake();
  const call = { key: "pets", server: SERVER, args: {} };
  await expect(
    host.callTool({ ...call, path: "/agents/main", name: "secret_model_tool" }),
  ).rejects.toThrow("secret_model_tool is not a tool for the app");
  await expect(
    host.callTool({ ...call, path: "/agents/other", name: "list_pets" }),
  ).rejects.toThrow("A widget of /agents/main cannot call as /agents/other.");
  await expect(
    host.readResource({ path: "/agents/other", server: SERVER, uri: "ui://x" }),
  ).rejects.toThrow("cannot call as /agents/other");
  expect(connection.callToolResult).not.toHaveBeenCalled();
  expect(appended).toEqual([]);
  // a tool of both is the app's too, and so is one that names no visibility
  await host.callTool({ ...call, path: "/agents/main", name: "adopt_pet" });
  expect(connection.callToolResult).toHaveBeenCalledWith("adopt_pet", {});
});

test("a call that fails is a fact too, and its error reaches the view", async () => {
  const { host, connection, appended } = fake();
  connection.callToolResult.mockRejectedValueOnce(new Error("the shop is closed"));
  await expect(
    host.callTool({
      path: "/agents/main",
      key: "pets",
      server: SERVER,
      name: "list_pets",
      args: {},
    }),
  ).rejects.toThrow("the shop is closed");
  expect(appended[0]!.payload).toMatchObject({ ok: false, error: "the shop is closed" });
  expect(await host.readResource({ path: "/agents/main", server: SERVER, uri: "ui://x" })).toEqual({
    contents: [{ uri: "ui://x", text: "<p>x</p>" }],
  });
});

test("a tool that is not listed is refused after one more listing, and found when the server added it", async () => {
  const { host, connection } = fake();
  const call = { path: "/agents/main", key: "pets", server: SERVER, args: {} };
  await host.callTool({ ...call, name: "list_pets" });
  expect(connection.listTools).toHaveBeenCalledTimes(1);
  await expect(host.callTool({ ...call, name: "no_such_tool" })).rejects.toThrow(
    `no_such_tool is not a tool of ${SERVER}.`,
  );
  expect(connection.listTools).toHaveBeenCalledTimes(2);
  expect(connection.callToolResult).toHaveBeenCalledTimes(1);
  // the server adds the tool: the miss lists again, and the call goes
  connection.listTools.mockResolvedValueOnce([{ name: "walk_pet" }]);
  await host.callTool({ ...call, name: "walk_pet" });
  expect(connection.listTools).toHaveBeenCalledTimes(3);
  expect(connection.callToolResult).toHaveBeenLastCalledWith("walk_pet", {});
});

test("a listing is kept 30 s: a tool that turns model-only is refused after that", async () => {
  let clock = 1_000;
  const { host, connection } = fake(() => clock);
  const call = { path: "/agents/main", key: "pets", server: SERVER, args: {}, name: "adopt_pet" };
  await host.callTool(call);
  connection.listTools.mockResolvedValue([
    { name: "adopt_pet", _meta: { ui: { visibility: ["model"] } } },
  ]);
  // within 30 s the kept listing answers: the call goes, with no new listing
  clock += WIDGET_TOOLS_KEPT_MS - 1;
  await host.callTool(call);
  expect(connection.listTools).toHaveBeenCalledTimes(1);
  // after 30 s the next call lists again before it calls
  clock += 1;
  await expect(host.callTool(call)).rejects.toThrow("adopt_pet is not a tool for the app");
  expect(connection.listTools).toHaveBeenCalledTimes(2);
  expect(connection.callToolResult).toHaveBeenCalledTimes(2);
});

const SERVER = "https://petshop.iterate.com/mcp";
const HEADERS = { authorization: 'Bearer getSecret("/secrets/petshop")' };

function fake(now?: () => number) {
  const connection = {
    listTools: vi.fn(async () => [
      { name: "list_pets", _meta: { ui: { visibility: ["model", "app"] } } },
      { name: "secret_model_tool", _meta: { ui: { visibility: ["model"] } } },
      { name: "adopt_pet" },
      { name: "refuse" },
    ]),
    callToolResult: vi.fn(async (name: string) =>
      name === "refuse"
        ? { content: [{ type: "text", text: "no" }], isError: true }
        : { content: [{ type: "text", text: name }] },
    ),
    readResource: vi.fn(async (uri: string) => ({ contents: [{ uri, text: "<p>x</p>" }] })),
  } satisfies WidgetMcpConnection;
  const appended: { type: string; payload: Record<string, unknown> }[] = [];
  const open = vi.fn(async () => connection);
  const host = widgetMcpHost({
    path: "/agents/main",
    now,
    open,
    append: async (events) => {
      appended.push(...(events as typeof appended));
    },
  });
  return { host, open, appended, connection };
}
