// THE DEFAULT KIND OF A MIND: the kind whose file says `newAgent: { default: true, … }`. The Dash's
// New agent then starts that kind's agent, and no iterate agent: it appends the kind's
// `start(…)` events to the new path, then the first message as `agent-ui/message-received`. It
// calls neither `itx.agents.create` nor `message()`.
//
// A kind file is a config repo's code, which any member or any member's agent can change: it never
// runs in the page. A hidden frame loads it (host.ts `AgentKindStarterFrame`), reports its
// `newAgent` as data, and runs its `start` there. Only a file whose text says `default: true` gets
// a frame: what the frame reports decides.
import type { AgentKindNewAgentSummary, AgentKindViewLoaded } from "./bridge.ts";
import {
  agentUiMessage,
  type OutgoingFile,
  type StoredFile,
} from "#/components/agent-chat/agent-facts.ts";
import { newAgentPath } from "#/lib/agent-summary.ts";

/** A kind of agent with a file of its own, as the Dash reads the kinds: the file's path in the
 *  config repo, and its source (null when it cannot be read: its view then shows the agent's
 *  events). */
export type KindFile = { kind: string; name: string; source: string | null };

/** What the page holds of one kind's starter frame. */
export type KindStarter = {
  file: KindFile;
  /** What the frame reported, once it has. */
  loaded(): AgentKindViewLoaded | undefined;
  /** Calls `listener` at each change of `loaded()`; answers the way to stop. */
  subscribe(listener: () => void): () => void;
  /** The kind's `newAgent.start`, in the frame. */
  start(input: {
    choice: string;
    fields: Record<string, string>;
    path: string;
  }): Promise<unknown[]>;
};

/** The default kind, as the page starts its agents. */
export type DefaultKind = { starter: KindStarter; newAgent: AgentKindNewAgentSummary };

/** The text a kind file that may be the default has. */
const SAYS_DEFAULT = /\bdefault\s*:\s*true\b/;

/** The kind files that may be the default, by kind name: the first that is wins. */
export function defaultKindCandidates(kinds: readonly KindFile[]): KindFile[] {
  return kinds
    .filter((file) => file.source && SAYS_DEFAULT.test(file.source))
    .toSorted((a, b) => a.kind.localeCompare(b.kind));
}

/** How long the page waits for a starter frame to report before New agent does what it does
 *  without a default kind. */
const STARTER_WAIT_MS = 15_000;

/** The default kind among `starters`, in their order: the first whose frame reports a `newAgent`
 *  with `default: true` and a choice. Null for none, or when no frame reported in `waitMs`. */
export async function defaultKindOf(
  starters: readonly KindStarter[],
  waitMs = STARTER_WAIT_MS,
): Promise<DefaultKind | null> {
  for (const starter of starters) {
    const loaded = await loadedOf(starter, waitMs);
    const newAgent = loaded && "ephemeralEvents" in loaded ? loaded.newAgent : undefined;
    if (newAgent?.default && newAgent.choices.length > 0) return { starter, newAgent };
  }
  return null;
}

/** What the frame reported, or undefined after `waitMs`. */
function loadedOf(starter: KindStarter, waitMs: number) {
  const now = starter.loaded();
  if (now) return Promise.resolve(now);
  return new Promise<AgentKindViewLoaded | undefined>((resolve) => {
    const timer = setTimeout(() => {
      stop();
      resolve(undefined);
    }, waitMs);
    const stop = starter.subscribe(() => {
      const loaded = starter.loaded();
      if (!loaded) return;
      clearTimeout(timer);
      stop();
      resolve(loaded);
    });
  });
}

/** THE START OF A NEW AGENT OF THE KIND: its path (`/agents/people/<person>/<kind>/<moment>` for
 *  a choice that says `byPerson`, else `/agents/<kind>/<moment>`) and what its `start` is given:
 *  the first choice, each of its fields at its `defaultValue` (a list's first option when that is
 *  none of them). */
export function newAgentStartOf(
  found: DefaultKind,
  person: string | undefined,
  date: Date,
): { choice: string; fields: Record<string, string>; path: string } {
  const [choice] = found.newAgent.choices;
  const path = newAgentPath(found.starter.file.kind, date, choice.byPerson ? person : undefined);
  const fields = Object.fromEntries(
    (found.newAgent.fields || [])
      .filter((field) => !field.choices || field.choices.includes(choice.id))
      .map((field) => [
        field.name,
        field.type === "select" && field.options && !field.options.includes(field.defaultValue)
          ? (field.options[0] ?? "")
          : field.defaultValue,
      ]),
  );
  return { choice: choice.id, fields, path };
}

/** The first message to a new agent of the kind: its files stored under the agent's path, then
 *  ONE `agent-ui/message-received` appended there. */
export async function sendFirstMessage(
  path: string,
  input: { message: string; files: OutgoingFile[] },
  host: {
    storeFiles(path: string, files: OutgoingFile[]): Promise<StoredFile[]>;
    append(path: string, events: unknown[]): Promise<void>;
  },
): Promise<void> {
  const files = input.files.length > 0 ? await host.storeFiles(path, input.files) : [];
  await host.append(path, [agentUiMessage({ message: input.message, files })]);
}
