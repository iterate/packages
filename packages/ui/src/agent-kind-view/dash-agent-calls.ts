// The Dash's calls that open a handle on the mind: a message to an agent, and the events a view
// appends. Each lets go of the handle it opens on every path, a refusal included:
// in capnweb the caller disposes every stub it gets, and a stub it never disposes stays held on
// the other side until the socket closes.
import { z } from "zod";
import type { AuthenticatedApp } from "iterate/app";
import type { OutgoingFile, StoredFile } from "#/components/agent-chat/agent-facts.ts";
import {
  widgetMcpHost,
  type WidgetMcpCalls,
  type WidgetMcpConnection,
} from "#/components/widget/widget-mcp.ts";

type Itx = AuthenticatedApp["itx"];

/** The member's itx with `itx.agents`, which the mind's agents app adds by a rewrite rule: the
 *  two calls these pages make (iterate/agents api.ts has the whole root). `get` answers a handle,
 *  a stub of its own. */
type AgentsRoot = {
  agents: {
    create(path: string): Promise<unknown>;
    get(path: string): {
      message(
        input: { message: string; files?: unknown },
        options?: { key: string },
      ): Promise<unknown>;
      [Symbol.dispose](): void;
    };
  };
};

/** `itx` with the `agents` root. The cast is safe to make and cannot be a check: `Itx` names only
 *  the platform's own roots, and `agents` is a root a rewrite rule adds at run time, which no type
 *  can see. On a mind without it, the call is refused over RPC and the refusal reaches the caller. */
export const withAgents = (itx: Itx) => itx as Itx & AgentsRoot;

/** The events a view asks to append, as far as this page checks them: each has a type,
 *  and a payload that is an object. Every other key goes on as it is: the platform parses each
 *  event as it commits. */
const AppendedEvents = z.array(
  z.looseObject({
    type: z.string(),
    payload: z.record(z.string(), z.unknown()).optional(),
  }),
);

/** Appends events that came from outside this page's code (a kind's frame, the chat's raw
 *  composer) to `context`, after the check above: a malformed one is refused here, with nothing
 *  appended. */
export async function appendEvents(
  context: Awaited<ReturnType<Itx["cd"]>>,
  events: unknown[],
): Promise<void> {
  await context.append(...AppendedEvents.parse(events));
}

/** Appends `events` to the context at `path` (after the check above), then lets go of its handle,
 *  whatever the answer. */
export async function appendTo(itx: Itx, path: string, events: unknown[]): Promise<void> {
  const context = await itx.cd(path);
  try {
    await appendEvents(context, events);
  } finally {
    context[Symbol.dispose]();
  }
}

/** Says `input` to the agent at `path` (`itx.agents.get(path).message`), then lets go of the
 *  agent's handle, whatever the answer. With `key`, the message's own key from the chat, the
 *  same message sent again lands once (a mind whose platform does not know keys yet ignores it). */
export async function messageAgent(
  itx: Itx,
  path: string,
  input: { message: string; files?: unknown },
  key?: string,
): Promise<void> {
  const agent = withAgents(itx).agents.get(path);
  try {
    await (key ? agent.message(input, { key }) : agent.message(input));
  } finally {
    agent[Symbol.dispose]();
  }
}

/** A SIGNED DOWNLOAD URL FOR A FILE, ASKED OF THE MIND (`itx.files.get(path).url()`), never of an
 *  agent's context. Only an agent of the mind's own kind links its context to the root, where
 *  `files` is. The context of a Claude Code, Codex, ACP or Herdr agent has its own names alone, so
 *  `itx.cd(path).files` matches no rule there, and no attachment of its chat would show. Lets go
 *  of the file's handle, whatever the answer. */
export async function fileUrl(itx: Itx, filePath: string): Promise<string> {
  const file = itx.files.get(filePath);
  try {
    return (await file.url()).url;
  } finally {
    file[Symbol.dispose]();
  }
}

/** STORES A MESSAGE'S FILES under the agent's path, as the platform's `message()` stores them
 *  (core/lib agents/message.ts `appendMessage`): `<path>/<stem>-<name>`, where the stem, for a
 *  message with a key, is made from the key, the file's place, its type and the SHA-256 of its
 *  content, so the same file sent again goes to the same path; with no key, 8 characters of a
 *  random id. Answers each file as the store holds it. Lets go of each file's handle. */
export async function storeAgentFiles(
  itx: Itx,
  path: string,
  files: readonly OutgoingFile[],
  key?: string,
): Promise<StoredFile[]> {
  const stored: StoredFile[] = [];
  for (const [index, file] of files.entries()) {
    const filename = file.filename.replace(/[^A-Za-z0-9._-]+/g, "-");
    const stem = key
      ? (
          await sha256Hex(
            `${key}\n${String(index)}\n${file.contentType}\n${await sha256Hex(file.data)}`,
          )
        ).slice(0, 16)
      : crypto.randomUUID().slice(0, 8);
    const handle = itx.files.get(`${path}/${stem}-${filename}`);
    try {
      const record = await handle.put({ contentType: file.contentType, data: file.data });
      stored.push({
        contentType: record.contentType,
        filename: file.filename,
        path: record.path,
        size: record.size,
      });
    } finally {
      handle[Symbol.dispose]();
    }
  }
  return stored;
}

/** The SHA-256 of a text, in hex. */
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** One host of MCP App calls for each agent the page has shown, kept while the page lives: its
 *  connections stay open for the next call (widget-mcp.ts). */
const widgetHosts = new WeakMap<Itx, Map<string, WidgetMcpCalls>>();

/** THE CALLS OF THE MCP APPS IN AN AGENT'S FEED, made as that agent: `itx.cd(path)` holds the
 *  connection, so a widget reaches what the agent at `path` reaches. Its context and its
 *  connections are held from an app's first call while the page lives, one connection for each
 *  server and headers. */
export function widgetCallsOf(itx: Itx, path: string): WidgetMcpCalls {
  let byPath = widgetHosts.get(itx);
  if (!byPath) widgetHosts.set(itx, (byPath = new Map()));
  let host = byPath.get(path);
  if (!host) {
    // opened at an app's first call, not when the chat draws: most feeds have no app
    let opened: Promise<Awaited<ReturnType<Itx["cd"]>>> | undefined;
    const context = () => {
      opened ||= Promise.resolve(itx.cd(path));
      // a context that did not open is opened again by the next call
      opened.catch(() => (opened = undefined));
      return opened;
    };
    host = widgetMcpHost({
      path,
      // The connection's type is the platform's `McpConnectionApi`; a mind whose platform predates
      // `callToolResult` and `readResource` refuses those calls over RPC, and the refusal reaches
      // the widget as its call's error. So the structural type is safe to assume and cannot be
      // checked here.
      open: async (server, headers) =>
        (await (
          await context()
        ).connectToMcp(server, { headers })) as unknown as WidgetMcpConnection,
      append: async (events) => await appendEvents(await context(), events),
      // the agent's own rules, read at each of a widget's reads of a context (widget-mcp.ts)
      rules: async () =>
        (await (await context()).rewriteRules.list(0)).map(({ match, target }) => ({
          match,
          target,
        })),
      // THROUGH THE AGENT'S OWN CONTEXT, never from the page's root: the kernel resolves this `cd`
      // by the agent's rules, so the widget reads a context only when the agent's own scripts
      // could open it (and the person who looks holds the session that asks)
      readEvents: async (target, after, limit) => {
        const read = await (await context()).cd(target);
        try {
          return await read.readEvents(after, limit);
        } finally {
          read[Symbol.dispose]();
        }
      },
    });
    byPath.set(path, host);
  }
  return host;
}
