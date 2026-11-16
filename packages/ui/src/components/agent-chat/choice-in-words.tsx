// A CHOICE IN AN AGENT'S WORDS: `[[kind:value|label]]` in the text of an agent's message is a button
// in the sentence, and a press acts at once (no select-then-submit). The page that hosts the chat
// passes what a press does (`AgentChat`'s `onChoice`); with no handler, a choice is its plain words.
// The Markdown draws it. Before the Markdown is parsed, each choice becomes an opaque token (a URL in
// it is no autolink, a `*` no emphasis); a rehype step after streamdown's sanitizing step makes each
// token in prose an element and gives a token in code its words back, so no message text ever
// becomes HTML.
"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { ExtraProps } from "streamdown";
import { cn } from "cn";

const choiceKinds = ["domain", "account", "name", "say", "link"] as const;

export type AgentChoiceKind = (typeof choiceKinds)[number];

/** A choice as the agent wrote it. `label` is the words it shows: its own label, or the value. */
export type AgentChoice = { kind: AgentChoiceKind; value: string; label: string };

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
  return (
    <AgentChoiceContext.Provider value={{ onChoice, choiceState }}>
      {children}
    </AgentChoiceContext.Provider>
  );
}

/** The element the rehype step makes of a choice; `MessageResponse` maps it to `AgentChoiceButton`. */
export const choiceTagName = "agent-choice";

const choicePattern =
  /\[\[(domain|account|name|say|link):([^\]|\n]{1,200})(?:\|([^\]\n]{1,120}))?\]\]/g;

/** A draft's text without a choice that has not ended yet: `[[…` with no `]]` at the end, no line
 *  break and no more than a choice's length (a longer one is no choice, and stays shown). */
export function withoutUnfinishedChoice(text: string): string {
  return text.replace(/\[\[[^\]\n]{0,330}\]?$/, "");
}

/** Text with each choice as its plain words: what a message shows before its Markdown loads. */
export function choicesInPlainWords(text: string): string {
  return text.replace(choicePattern, (_whole, _kind, value: string, label?: string) =>
    (label || value).trim(),
  );
}

/** A choice as a token the Markdown parser passes through: its whole text in hex, between two
 *  private-use characters. */
const tokenPattern = /\uE000([0-9a-f]+)\uE001/g;

/** The text for the Markdown parser: each choice is a token. */
export function choicesAsTokens(text: string): string {
  return text.replace(
    choicePattern,
    (whole) =>
      `\uE000${Array.from(new TextEncoder().encode(whole), (byte) => byte.toString(16).padStart(2, "0")).join("")}\uE001`,
  );
}

function tokenText(hex: string): string {
  return new TextDecoder().decode(
    Uint8Array.from(hex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16)),
  );
}

type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

/** The rehype step: each token in prose becomes an `agent-choice` element; in `code` or `pre` it is
 *  its text again. */
export function rehypeAgentChoices() {
  return (tree: HastNode) => splitChoices(tree, false);
}

function splitChoices(parent: HastNode, inCode: boolean) {
  const code =
    inCode ||
    (parent.type === "element" && (parent.tagName === "code" || parent.tagName === "pre"));
  if (!parent.children) return;
  parent.children = parent.children.flatMap((child) => {
    if (child.type !== "text" || !child.value) {
      splitChoices(child, code);
      return [child];
    }
    if (code)
      return [
        {
          ...child,
          value: child.value.replace(tokenPattern, (_token, hex: string) => tokenText(hex)),
        },
      ];
    return choiceNodes(child.value);
  });
}

function choiceNodes(text: string): HastNode[] {
  const nodes: HastNode[] = [];
  let from = 0;
  for (const token of text.matchAll(tokenPattern)) {
    if (token.index > from) nodes.push({ type: "text", value: text.slice(from, token.index) });
    const [, kind = "", value = "", label] =
      new RegExp(choicePattern.source).exec(tokenText(token[1])) ?? [];
    const words = (label || value).trim();
    nodes.push({
      type: "element",
      tagName: choiceTagName,
      properties: { dataKind: kind, dataValue: value.trim(), dataLabel: words },
      children: [{ type: "text", value: words }],
    });
    from = token.index + token[0].length;
  }
  if (from === 0) return [{ type: "text", value: text }];
  if (from < text.length) nodes.push({ type: "text", value: text.slice(from) });
  return nodes;
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
