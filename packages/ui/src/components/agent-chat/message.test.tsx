// @vitest-environment jsdom
// MessageResponse's links: no question before a link opens, and a link to this page opens in place.
// A choice in an agent's words (`[[kind:value|label]]`) is a button that calls the page's handler,
// or its plain words when the page has none.
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { AgentChoiceProvider, type AgentChoice } from "./choice-in-words.tsx";
import { MessageResponse } from "./message.tsx";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
// the Markdown renderer loads after the first render: on a loaded machine that takes seconds
vi.setConfig({ testTimeout: 30_000 });

test("a link to another page that names its way back here opens in this tab; one that returns elsewhere opens a new tab", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const back = encodeURIComponent(`${window.location.origin}/?agent=/agents/onboarding`);
  await act(async () => {
    root.render(
      <MessageResponse>
        {`[Sign](https://iterate.example.com/keys/enrol?actor=iterate-com&next=${back}) or [elsewhere](https://iterate.example.com/keys?next=https%3A%2F%2Fother.example%2F).`}
      </MessageResponse>,
    );
  });
  await drawn(() => expect(host.querySelectorAll("a")).toHaveLength(2));
  const [sign, elsewhere] = [...host.querySelectorAll("a")];
  expect(sign?.hasAttribute("target")).toBe(false);
  expect(elsewhere?.getAttribute("target")).toBe("_blank");
  await act(async () => root.unmount());
  host.remove();
});

test("a link in an agent's words is an <a> with its href, and no dialog opens on a click", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <MessageResponse>
        {"See [the docs](https://example.com/docs) and [this shape](#canvas-shape-1)."}
      </MessageResponse>,
    );
  });
  await drawn(() => expect(host.querySelectorAll("a")).toHaveLength(2));

  const [docs, shape] = [...host.querySelectorAll("a")];
  expect(docs?.getAttribute("href")).toBe("https://example.com/docs");
  expect(docs?.getAttribute("target")).toBe("_blank");
  expect(shape?.getAttribute("href")).toBe("#canvas-shape-1");
  // a link to this page opens in place, not in a new tab
  expect(shape?.hasAttribute("target")).toBe(false);
  expect(host.querySelector("button")).toBeNull();

  await act(async () => {
    shape?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.body.textContent).not.toMatch(/open external link/i);

  await act(async () => root.unmount());
  host.remove();
});

test("a link to this page's own origin opens in place", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <MessageResponse>{`Open [the session](${window.location.origin}/moose-iris-gull).`}</MessageResponse>,
    );
  });
  await drawn(() => expect(host.querySelector("a")).not.toBeNull());
  expect(host.querySelector("a")?.hasAttribute("target")).toBe(false);
  await act(async () => root.unmount());
  host.remove();
});

test.for<{ text: string; title: string; choice: AgentChoice }>([
  {
    text: "Pick [[domain:afoop.com]] for it.",
    title: "Use afoop.com for your mind",
    choice: { kind: "domain", value: "afoop.com", label: "afoop.com" },
  },
  {
    text: "Pick [[account:abc123|Garple Ltd]] for it.",
    title: "Use the account Garple Ltd",
    choice: { kind: "account", value: "abc123", label: "Garple Ltd" },
  },
  {
    text: "Call it [[name:moose|Moose]] maybe.",
    title: "Name your mind Moose",
    choice: { kind: "name", value: "moose", label: "Moose" },
  },
  {
    text: "Or [[say:Tell me more]].",
    title: "Send “Tell me more”",
    choice: { kind: "say", value: "Tell me more", label: "Tell me more" },
  },
  {
    text: "Then [[link:https://dash.example.com|Open your Dash]].",
    title: "Open your Dash",
    choice: { kind: "link", value: "https://dash.example.com", label: "Open your Dash" },
  },
])(
  "a $choice.kind choice is a button with its title, and a press sends it",
  async ({ text, title, choice }) => {
    const onChoice = vi.fn();
    using page = await render(
      <AgentChoiceProvider onChoice={onChoice}>
        <MessageResponse mode="static">{text}</MessageResponse>
      </AgentChoiceProvider>,
    );
    const button = await drawn(() => {
      const found = page.host.querySelector<HTMLElement>('[role="button"], button');
      if (!found) throw new Error("no choice drawn yet");
      return found;
    });
    // a text kind wraps with its sentence, so only the link pill is a <button>
    expect(button).toMatchObject({
      tagName: choice.kind === "link" ? "BUTTON" : "SPAN",
      title,
      textContent: choice.label,
    });
    expect(page.host.textContent).not.toContain("[[");

    await act(async () => button.click());
    expect(onChoice.mock).toMatchObject({ calls: [[choice]] });
    if (choice.kind === "link") return;
    // a span with the button role takes Enter and Space as a <button> does
    for (const key of ["Enter", " "])
      await act(async () =>
        button.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })),
      );
    expect(onChoice.mock).toMatchObject({ calls: [[choice], [choice], [choice]] });
  },
);

test("with no handler a choice is its plain words: no button and no brackets", async () => {
  using page = await render(
    <MessageResponse mode="static">{"Pick [[domain:afoop.com|afoop]] now."}</MessageResponse>,
  );
  await drawn(() => expect(page.host.querySelector("p")).not.toBeNull());
  expect(page.host.querySelector('[role="button"], button')).toBeNull();
  expect(page.host).toMatchObject({ textContent: "Pick afoop now." });
});

test("a draft hides a choice that has not ended yet", async () => {
  using page = await render(
    <AgentChoiceProvider onChoice={() => {}}>
      <MessageResponse>{"Pick one: [[domain:afoo"}</MessageResponse>
    </AgentChoiceProvider>,
  );
  await drawn(() => expect(page.host.querySelector("p")).not.toBeNull());
  expect(page.host.textContent?.trim()).toBe("Pick one:");
  expect(page.host.querySelector('[role="button"], button')).toBeNull();
});

test("a choice in a code span or block stays as written", async () => {
  using page = await render(
    <AgentChoiceProvider onChoice={() => {}}>
      <MessageResponse mode="static">
        {"Write `[[say:hi]]` like this:\n\n```\n[[name:moose]]\n```"}
      </MessageResponse>
    </AgentChoiceProvider>,
  );
  await drawn(() => expect(page.host.querySelectorAll("code")).toHaveLength(2));
  expect(page.host.querySelector('[role="button"], button')).toBeNull();
  expect([...page.host.querySelectorAll("code")].map((code) => code.textContent)).toEqual([
    "[[say:hi]]",
    "[[name:moose]]\n",
  ]);
});

/** `node` mounted in the document; disposing unmounts it. */
async function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return {
    host,
    [Symbol.dispose]: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

/** Waits until `check` holds. The Markdown renderer is a part that loads after the
 *  first render, and on a loaded machine that takes seconds: this waits for what is drawn, for up
 *  to 20 s, and not for a time. */
function drawn<Found>(check: () => Found): Promise<Found> {
  return vi.waitFor(check, { timeout: 20_000, interval: 20 });
}
