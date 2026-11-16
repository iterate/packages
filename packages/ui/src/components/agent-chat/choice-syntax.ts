// THE SYNTAX OF A CHOICE IN AN AGENT'S WORDS (choice-in-words.tsx draws one): `[[kind:value|label]]`
// in a message's text. Text in, text or tree nodes out, with no React: a choice as its plain words,
// a choice as the opaque token the Markdown parser passes through, and the rehype step that makes
// each token in prose an `agent-choice` element and gives a token in code its words back.
export const choiceKinds = ["domain", "account", "name", "say", "link"] as const;

export type AgentChoiceKind = (typeof choiceKinds)[number];

/** A choice as the agent wrote it. `label` is the words it shows: its own label, or the value. */
export type AgentChoice = { kind: AgentChoiceKind; value: string; label: string };

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
