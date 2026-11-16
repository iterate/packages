// The Dash's calls that open a handle on the mind: a message to an agent, and the events a view
// appends. Each lets go of the handle it opens on every path, a refusal included:
// in capnweb the caller disposes every stub it gets, and a stub it never disposes stays held on
// the other side until the socket closes.
import { z } from "zod";
import type { AuthenticatedApp } from "iterate/app";

type Itx = AuthenticatedApp["itx"];

/** The member's itx with `itx.agents`, which the mind's agents app adds by a rewrite rule: the
 *  two calls these pages make (iterate/agents api.ts has the whole root). `get` answers a handle,
 *  a stub of its own. */
type AgentsRoot = {
  agents: {
    create(path: string): Promise<unknown>;
    get(path: string): {
      message(input: { message: string; files?: unknown }): Promise<unknown>;
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

/** Says `input` to the agent at `path` (`itx.agents.get(path).message`), then lets go of the
 *  agent's handle, whatever the answer. */
export async function messageAgent(
  itx: Itx,
  path: string,
  input: { message: string; files?: unknown },
): Promise<void> {
  const agent = withAgents(itx).agents.get(path);
  try {
    await agent.message(input);
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
