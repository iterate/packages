// A CHOICE IN AN AGENT'S WORDS: `[[kind:value|label]]` in the text of an agent's message is a button
// in the sentence, and a press acts at once (no select-then-submit). The page that hosts the chat
// passes what a press does (`AgentChat`'s `onChoice`); with no handler, a choice is its plain words.
// The Markdown draws it. Before the Markdown is parsed, each choice becomes an opaque token (a URL in
// it is no autolink, a `*` no emphasis); a rehype step after streamdown's sanitizing step makes each
// token in prose an element and gives a token in code its words back, so no message text ever
// becomes HTML. The syntax itself, with no React, is choice-syntax.ts.
"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { ExtraProps } from "streamdown";
import { cn } from "cn";
import { choiceKinds, type AgentChoice, type AgentChoiceKind } from "./choice-syntax.ts";

export type { AgentChoice };

export type AgentChoiceHandlers = {
  /** What a press does. Absent: a choice is its plain words, not a button. */
  onChoice?: (choice: AgentChoice) => void | Promise<void>;
  /** "chosen": the choice the person took; "busy": its press is being sent. */
  choiceState?: (choice: AgentChoice) => "chosen" | "busy" | undefined;
};

const AgentChoiceContext = createContext<AgentChoiceHandlers>({});

/** Gives every agent message under it the page's choice handlers. */
export function AgentChoiceProvider({
  onChoice,
  choiceState,
  children,
}: AgentChoiceHandlers & { children: ReactNode }) {
  // one value while the page's handlers stay the same: a message under it draws again only for
  // a handler that changed
  const handlers = useMemo(() => ({ onChoice, choiceState }), [onChoice, choiceState]);
  return <AgentChoiceContext.Provider value={handlers}>{children}</AgentChoiceContext.Provider>;
}

const choiceTitle: Record<AgentChoiceKind, (words: string) => string> = {
  domain: (words) => `Use ${words} for your mind`,
  account: (words) => `Use the account ${words}`,
  name: (words) => `Name your mind ${words}`,
  say: (words) => `Send “${words}”`,
  link: (words) => words,
};

/** One choice: a button when the page handles a press, else its plain words. A text kind is a
 *  `span` with the button role, since a `<button>` is laid out as an inline block and its words
 *  would not wrap with the sentence; the `link` pill is a `<button>`. */
export function AgentChoiceButton({ node }: ExtraProps) {
  const { onChoice, choiceState } = useContext(AgentChoiceContext);
  const choice = choiceOf(node?.properties);
  if (!choice) return null;
  if (!onChoice) return choice.label;
  const state = choiceState?.(choice);
  const busy = state === "busy";
  const press = () => {
    if (!busy) void onChoice(choice);
  };
  const shared = {
    title: choiceTitle[choice.kind](choice.label),
    "data-choice": choice.kind,
    "data-state": state,
    "aria-pressed": state === "chosen" ? true : undefined,
    "aria-busy": busy ? true : undefined,
    onClick: press,
  };
  if (choice.kind === "link")
    return (
      <button
        type="button"
        {...shared}
        disabled={busy}
        className="inline-block cursor-pointer rounded-full bg-primary px-2.5 py-px text-primary-foreground no-underline outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-progress disabled:opacity-60"
      >
        {choice.label}
      </button>
    );
  return (
    // react-doctor-disable-next-line react-doctor/prefer-tag-over-role -- a <button> is one unbreakable inline block in every browser, whatever its display: these words must wrap with the sentence they are in
    <span
      role="button"
      tabIndex={busy ? -1 : 0}
      aria-disabled={busy ? true : undefined}
      {...shared}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        // Space would scroll the page
        event.preventDefault();
        press();
      }}
      className={cn(
        "cursor-pointer rounded-sm font-semibold text-primary underline decoration-dotted underline-offset-3 outline-none hover:decoration-solid focus-visible:ring-2 focus-visible:ring-ring/50",
        state === "chosen" && "decoration-solid",
        busy && "cursor-progress opacity-60",
      )}
    >
      {choice.label}
    </span>
  );
}

function choiceOf(properties: Record<string, unknown> | undefined): AgentChoice | undefined {
  const kind = choiceKinds.find((known) => known === properties?.dataKind);
  const value = properties?.dataValue;
  const label = properties?.dataLabel;
  if (!kind || typeof value !== "string" || typeof label !== "string") return undefined;
  return { kind, value, label };
}
