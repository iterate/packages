// AN APP'S CALLS TO ITS OWN SERVER, made by the page that holds the member's itx. A view's
// `tools/call` and `resources/read` (widget-frame.tsx) come here with the server and headers of the
// fact that showed it, never with the widget's own choice of either. The page connects through the
// context of the agent that showed the widget (`itx.cd(path).connectToMcp(server, { headers })`),
// so a widget reaches what that agent reaches, and no more. Each tool call is one fact on that
// path (`widget-tool-called`).
import { z } from "zod";
import { WIDGET_FACT } from "./widget.ts";

/** The connection that `itx.connectToMcp` answers, as far as an app's view uses it. */
export type WidgetMcpConnection = {
  listTools(): Promise<unknown[]>;
  callToolResult(name: string, args?: Record<string, unknown>): Promise<unknown>;
  readResource(uri: string): Promise<unknown>;
};

/** One call of a view: the widget's key, its fact's server and headers, the tool and arguments. */
export type WidgetToolCall = {
  path: string;
  key: string;
  server: string;
  headers?: Record<string, string>;
  name: string;
  args: Record<string, unknown>;
};
/** One read of a view. */
export type WidgetResourceRead = {
  path: string;
  server: string;
  headers?: Record<string, string>;
  uri: string;
};

/** What a chat's host does for the apps in its feed. */
export type WidgetMcpCalls = {
  callTool(call: WidgetToolCall): Promise<unknown>;
  readResource(read: WidgetResourceRead): Promise<unknown>;
};

/** A tool as the server lists it: its name, and the spec's `_meta.ui.visibility`. */
const ListedTool = z.looseObject({
  name: z.string(),
  _meta: z
    .looseObject({
      ui: z.looseObject({ visibility: z.array(z.string()).optional() }).optional(),
    })
    .optional(),
});
/** The part of a result that says it failed. */
const ToolOutcome = z.looseObject({ isError: z.boolean().optional() });

/** A tool listing is kept this long. The page hears no `notifications/tools/list_changed` through
 *  the connection, so a tool that turns model-only is refused at most this late; a listing before
 *  every call would add a round trip to every press. */
export const WIDGET_TOOLS_KEPT_MS = 30_000;

/** THE PAGE'S HOST FOR APP CALLS of the agent at `path`. `open` connects as that agent; one
 *  connection for each server and headers, kept while the host lives. `append` writes a fact on
 *  the agent's log. A call for another path is refused: the frame names the path, and the page
 *  shows one agent. */
export function widgetMcpHost({
  path,
  open,
  append,
  now = Date.now,
}: {
  path: string;
  /** The clock a listing's age is read by. */
  now?: () => number;
  open: (
    server: string,
    headers: Record<string, string> | undefined,
  ) => Promise<WidgetMcpConnection>;
  append: (events: unknown[]) => Promise<unknown>;
}): WidgetMcpCalls {
  const connections = new Map<
    string,
    {
      connection: Promise<WidgetMcpConnection>;
      tools?: { listed: Promise<z.infer<typeof ListedTool>[]>; at: number };
    }
  >();
  const held = (server: string, headers: Record<string, string> | undefined) => {
    const name = JSON.stringify([server, headers || {}]);
    let entry = connections.get(name);
    if (!entry) {
      entry = { connection: open(server, headers) };
      connections.set(name, entry);
      // a connection that failed is opened again by the next call
      entry.connection.catch(() => connections.delete(name));
    }
    return entry;
  };
  const own = (asked: string) => {
    if (asked !== path) throw new Error(`A widget of ${path} cannot call as ${asked}.`);
  };
  return {
    async callTool({ path: asked, key, server, headers, name, args }) {
      own(asked);
      const entry = held(server, headers);
      const connection = await entry.connection;
      // THE SPEC: a host refuses a view's call of a tool whose visibility leaves out "app". A
      // tool that is not listed is refused too, after one more listing (the server may have added
      // it since). No listing, no call: a listing that failed is asked again by the next call.
      const list = () => {
        const listed = connection
          .listTools()
          .then((tools) => tools.flatMap((tool) => ListedTool.safeParse(tool).data ?? []));
        const tools = { listed, at: now() };
        entry.tools = tools;
        listed.catch(() => {
          if (entry.tools === tools) entry.tools = undefined;
        });
        return listed;
      };
      const kept = entry.tools && now() - entry.tools.at < WIDGET_TOOLS_KEPT_MS;
      const find = async (tools: Promise<z.infer<typeof ListedTool>[]>) =>
        (await tools).find((tool) => tool.name === name);
      const listed =
        (await find(kept && entry.tools ? entry.tools.listed : list())) ??
        (kept ? await find(list()) : undefined);
      if (!listed) throw new Error(`${name} is not a tool of ${server}.`);
      const visibility = listed._meta?.ui?.visibility;
      if (visibility && !visibility.includes("app"))
        throw new Error(
          `${name} is not a tool for the app: its visibility is ${visibility.join(", ")}.`,
        );
      const started = performance.now();
      const told = (ok: boolean, error?: string) =>
        append([
          {
            type: WIDGET_FACT.toolCalled,
            payload: {
              key,
              server,
              tool: name,
              ok,
              ms: Math.round(performance.now() - started),
              error,
            },
          },
        ]).catch(() => undefined);
      try {
        const result = await connection.callToolResult(name, args);
        void told(ToolOutcome.safeParse(result).data?.isError !== true);
        return result;
      } catch (error) {
        void told(false, (error instanceof Error ? error.message : String(error)).slice(0, 500));
        throw error;
      }
    },
    async readResource({ path: asked, server, headers, uri }) {
      own(asked);
      return await (await held(server, headers).connection).readResource(uri);
    },
  };
}
