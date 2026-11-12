// AN AGENT KIND's view (iterate/agents/kinds `AgentKind` says what a kind is). A kind file's default
// export `satisfies AgentKind` from here, which is that one with `view` typed: the mind worker
// imports the file (`makeAgentKind`) and runs `processEvent`; the Agents app's sandboxed frame loads
// the same source for `view` (frame.ts), its server-only imports stubbed (load.ts).
//
//   import type { AgentKind } from "@iterate-com/ui/agent-kind-view";
//
//   export default {
//     kind: "echo",
//     view: ({ html, useMemo, ui }) => (props) => html`<${ui.AgentShell} ...${props} />`,
//   } satisfies AgentKind;
//
// Types only: nothing here runs.
// Self-contained (React, react-query and iterate's types only), so a mind's config repo, a test
// program or a package without JSX can name them.
import type { ComponentType } from "react";
import type { useMutation, useQuery } from "@tanstack/react-query";
import type { AgentKind as SdkAgentKind } from "iterate/agents/kinds";

/** One event of the agent's log, as the view reads it. */
export type AgentKindViewEvent = {
  type: string;
  offset: number;
  createdAt: string;
  payload?: any;
  path?: string;
  ephemeral?: boolean;
  source?: Record<string, unknown>;
};

/** The chat's state (agent-chat-search.ts `AgentChatState`): the page's URL search. `view:
 *  "events"` is the Events tab, and `event` the offset its inspector shows. */
export type AgentKindViewState = {
  view?: "chat" | "events";
  event?: number;
  [key: string]: unknown;
};

/** What a view is handed: AgentChat's props. Authority over the agent reaches it only through
 *  these, scoped to this one agent. */
export type AgentKindViewProps = {
  /** The agent's path. */
  path: string;
  /** The agent's log, live: every durable event, and the kind's `ephemeralEvents`. */
  context: {
    events: readonly AgentKindViewEvent[];
    caughtUp: boolean;
    error?: string;
    older?: { loadOlder(): void; loading: boolean; exhausted: boolean };
    head?: number;
    processors: { rows: readonly any[]; loaded: boolean; error?: string };
    presence: { actors: readonly any[]; rpcStubs: readonly string[] };
    liveState: Record<string, any>;
  };
  /** The host's own failure (opening the agent's context). */
  error: string | undefined;
  /** The chat's state, which is the page's URL: the tab, the Events tab's choices. */
  state: AgentKindViewState;
  onStateChange: (patch: Partial<AgentKindViewState>) => void;
  /** Say something to the agent: `itx.agents.get(path).message(…)`. */
  onMessage: (input: {
    message: string;
    files: { contentType: string; filename: string; data: string }[];
  }) => Promise<void>;
  /** Append events to the agent's context, as a person wrote them. */
  onAppend: ((events: unknown[]) => Promise<unknown>) | undefined;
  /** A signed download URL for a file under the agent's path. */
  signedUrl: (path: string) => Promise<string>;
};

/** iterate's components a view builds with (agent-chat/chat-parts.tsx and agent-shell.tsx say
 *  what each takes; `AgentChat` takes a view's own props). */
export type AgentKindViewUi = Record<
  | "AgentShell"
  | "AgentChat"
  | "Feed"
  | "MessageBubble"
  | "Composer"
  | "Markdown"
  | "Badge"
  | "Button"
  | "Spinner",
  ComponentType<any>
>;

/** What `view` builds with. `html` is htm over React's createElement: the worker strips a kind
 *  file's types and nothing else, so there is no JSX. No `useState`, no `useEffect`: what a view
 *  holds is derived (`useMemo`) or is the server's (`useQuery`, `useMutation`). */
export type AgentKindViewKit = {
  html: (strings: TemplateStringsArray, ...values: unknown[]) => any;
  useMemo: <T>(factory: () => T, deps: readonly unknown[]) => T;
  useQuery: typeof useQuery;
  useMutation: typeof useMutation;
  ui: AgentKindViewUi;
};

/** How the Agents app's New agent starts one of a kind's agents: its `choices` in the kind picker
 *  (each listed as "<label> (<kind>)", or as its label alone when that is the kind's own name),
 *  the `fields` shown beside the picker when one is chosen, and `start`, the events appended to
 *  the new agent's path before its first message. Runs in the frame, like `view`. */
export type AgentKindNewAgent = {
  /** `byPerson: true`: this choice's new agents may be born in the folder of the person who
   *  starts them, `/agents/people/<person>/<kind>/<moment>` (lib/agent-summary.ts
   *  `newAgentPath`). A kind says it when its own file takes that path. Without it they are born at
   *  `/agents/<kind>/<moment>`. */
  choices: { id: string; label: string; byPerson?: boolean }[];
  fields?: AgentKindNewAgentField[];
  /** `path` is the new agent's; `fields` are the picked choice's alone, each by its name. */
  start(input: { choice: string; fields: Record<string, string>; path: string }): unknown[];
  /** A line under the picker about what the choice and its fields' values as typed will do (a
   *  runner that has to be started first, say), or null for none. `mind` is the mind's address.
   *  Text, where `backticks` mark code a person may copy. */
  describe?(input: { choice: string; fields: Record<string, string>; mind: string }): string | null;
};
/** A field beside the picker: a line of text, or with `type: "checkbox"` a tick box, whose value
 *  is "on" when ticked and "" when not (`defaultValue: "on"` starts it ticked). `choices`: the ids
 *  of the choices that show the field; none: every choice of the kind.
 *
 *  `type: "select"` with `options`: a list to pick one of (the models a choice can run, say). Its
 *  value is always one of the options: `defaultValue` at first, or the first option when that is
 *  not among them. Two fields of one name, each for other `choices`, give each choice its own
 *  list. A page older than this type draws a line of text with `defaultValue` in it, where a
 *  person can type anything: `start` must refuse a value that is not an option.
 *
 *  `viewerDefault`: a first value made for the person who looks, where `{name}` is their first
 *  name, from the address they sign in with (`"{name}.laptop"` opens as `misha.laptop`); for
 *  someone with no such name the field opens with `defaultValue`.
 *
 *  `offWhen`: a tick box that another field turns off. While the field named `field` has the
 *  value `is`, the box's value is "" and it is drawn unticked and disabled. A page older than
 *  this key still draws the box as it was, so `start` decides by the other field's value too. */
export type AgentKindNewAgentField = {
  name: string;
  label: string;
  defaultValue: string;
  type?: "text" | "checkbox" | "select";
  options?: string[];
  choices?: string[];
  viewerDefault?: string;
  offWhen?: { field: string; is: string };
};

/** A kind of agent whose view is a React component: iterate/agents/kinds' `AgentKind` (`kind`,
 *  `processEvent`, `ephemeralEvents`), with the chat filled in, and how New agent starts one. */
export type AgentKind = SdkAgentKind<
  (kit: AgentKindViewKit) => ComponentType<AgentKindViewProps>
> & {
  newAgent?: AgentKindNewAgent;
};
