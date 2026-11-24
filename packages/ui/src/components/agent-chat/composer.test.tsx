// @vitest-environment jsdom
// The composer's paste: image files in a paste are staged as attachments, as from the `+`, and a
// submit sends them as data URLs; the paste's text still goes into the message editor (CodeMirror,
// loaded for real). Its round button while a turn runs, and its send lifecycle: clearing the sent
// text immediately, keeping typing written while a send is in flight, restoring on failure, and
// ignoring a second submit while one is already in flight. Out of scope: drop and the file picker.
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { AgentComposer } from "./composer.tsx";
import { useComposerDraft, type ComposerDraft } from "./use-composer-attachments.ts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
// jsdom lays nothing out; CodeMirror measures text ranges after each change
Object.assign(Range.prototype, {
  getClientRects: () => [],
  getBoundingClientRect: () => new DOMRect(),
});

test("a paste of two image files stages both, and a submit sends them as data URLs", async () => {
  const composer = await renderComposer();

  await composer.paste({
    files: [
      new File(["first"], "screenshot-1.png", { type: "image/png" }),
      new File(["second"], "photo.jpeg", { type: "image/jpeg" }),
    ],
  });

  expect(composer.draft().attachments.entries.map((entry) => entry.file)).toMatchObject([
    { name: "screenshot-1.png", type: "image/png" },
    { name: "photo.jpeg", type: "image/jpeg" },
  ]);
  // a paste never sends by itself
  expect(composer.onSubmit).not.toHaveBeenCalled();

  await composer.send();

  expect(composer.onSubmit.mock).toMatchObject({
    calls: [
      [
        {
          message: "(see attached)",
          files: [
            {
              contentType: "image/png",
              filename: "screenshot-1.png",
              data: `data:image/png;base64,${btoa("first")}`,
            },
            {
              contentType: "image/jpeg",
              filename: "photo.jpeg",
              data: `data:image/jpeg;base64,${btoa("second")}`,
            },
          ],
        },
      ],
    ],
  });
  expect(composer.draft().attachments).toMatchObject({ entries: [] });
});

test("a paste with files only in its items stages them, and its text goes into the message", async () => {
  const composer = await renderComposer();

  await composer.paste({
    items: [new File(["shot"], "image.png", { type: "image/png" })],
    text: "also some words",
  });

  expect(composer.draft().attachments.entries.map((entry) => entry.file)).toMatchObject([
    { name: "image.png", type: "image/png" },
  ]);
  expect(composer.draft()).toMatchObject({ message: "also some words" });
});

test("a paste of plain text stages nothing and pastes the text into the message", async () => {
  const composer = await renderComposer();

  await composer.paste({ text: "hello" });

  expect(composer.draft()).toMatchObject({ message: "hello", attachments: { entries: [] } });
});

test("a composer for words only has no `+`, no file input, and a pasted file stages nothing", async () => {
  const composer = await renderComposer({ attach: false, onAppendRaw: async () => {} });

  expect(composer.container.querySelector('button[title="Composer mode"]')).toBeNull();
  expect(composer.container.querySelector('input[type="file"]')).toBeNull();

  await composer.paste({ files: [new File(["first"], "screenshot-1.png", { type: "image/png" })] });

  expect(composer.draft()).toMatchObject({ attachments: { entries: [] } });
});

test("while a turn runs the round button sends a draft, which waits in the queue, and stops the turn when the draft is empty, at one size", async () => {
  const run = vi.fn(async () => {});
  const composer = await renderComposer({ interrupt: { run, isInterrupting: false } });
  const round = () =>
    composer.container.querySelector(
      "button[title='Stop generation'], button[title='Send message']",
    );
  const looks = () => [round()?.getAttribute("title"), round()?.getAttribute("class")];
  const seen = [looks()];
  await composer.paste({ text: "and make it green" });
  seen.push(looks());
  await composer.send();
  seen.push(looks());
  const [, size] = seen[0]!;
  expect(seen).toEqual([
    ["Stop generation", size],
    ["Send message", size],
    ["Stop generation", size],
  ]);
  expect(composer.onSubmit.mock.calls).toMatchObject([[{ message: "and make it green" }]]);
  expect(run).not.toHaveBeenCalled();
  // a finger's size on a touch screen of any width, as is the `+`
  expect([
    size?.split(" "),
    composer.container.querySelector("button[title='Composer mode']")?.className.split(" "),
  ]).toEqual([
    expect.arrayContaining(["pointer-coarse:size-11"]),
    expect.arrayContaining(["pointer-coarse:size-11"]),
  ]);
});

test("typing while a send is in flight keeps only the new text, never the sent text", async () => {
  let resolveSend = () => {};
  const onSubmit = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        resolveSend = resolve;
      }),
  );
  const composer = await renderComposer({ onSubmit });

  await composer.paste({ text: "first message" });
  await composer.pressEnter();
  expect(onSubmit.mock).toMatchObject({ calls: [[{ message: "first message", files: [] }]] });

  await composer.paste({ text: "second message" });
  await act(async () => resolveSend());
  await act(async () => {});

  expect(composer.draft()).toMatchObject({ message: "second message" });
  expect(composer.textbox).toMatchObject({ textContent: "second message" });
});

test("pressing Return twice quickly while a send is in flight submits only once", async () => {
  let resolveSend = () => {};
  const onSubmit = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        resolveSend = resolve;
      }),
  );
  const composer = await renderComposer({ onSubmit });

  await composer.paste({ text: "send once" });
  // two Return presses before React even re-renders with isSubmitting=true
  await act(async () => {
    composer.textbox.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    composer.textbox.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  });
  // and another Return press while the first send is still in flight with new words in the box
  await composer.paste({ text: "next message" });
  await composer.pressEnter();

  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(onSubmit.mock).toMatchObject({ calls: [[{ message: "send once", files: [] }]] });

  await act(async () => resolveSend());
  await act(async () => {});

  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(composer.draft()).toMatchObject({ message: "next message" });
});

test("a failed send puts the sent text back only when the box was not changed since", async () => {
  let rejectSend: (error: Error) => void = () => {};
  const onSubmit = vi.fn(
    () =>
      new Promise<void>((_, reject) => {
        rejectSend = reject;
      }),
  );
  const composer = await renderComposer({ onSubmit });

  await composer.paste({ text: "try again" });
  await composer.pressEnter();
  expect(composer.draft()).toMatchObject({ message: "" });

  await act(async () => rejectSend(new Error("network down")));
  await act(async () => {});

  expect(composer.draft()).toMatchObject({ message: "try again" });
  expect(composer.textbox).toMatchObject({ textContent: "try again" });
  expect(composer.container.querySelector('[role="alert"]')?.textContent).toBe("network down");

  // when the person has already started a new draft, a failure leaves the new draft alone
  await composer.pressEnter();
  await composer.paste({ text: "replacement" });
  await act(async () => rejectSend(new Error("still down")));
  await act(async () => {});

  expect(composer.draft()).toMatchObject({ message: "replacement" });
  expect(composer.textbox).toMatchObject({ textContent: "replacement" });
});

type Paste = { files?: File[]; items?: File[]; text?: string };

async function renderComposer(props: Partial<ComponentProps<typeof AgentComposer>> = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const onSubmit = vi.fn<(input: unknown) => Promise<void>>(async () => {});
  let current: ComposerDraft | undefined;
  function Harness() {
    const draft = useComposerDraft();
    current = draft;
    return (
      <AgentComposer
        draft={draft}
        placeholder="Message"
        onSubmit={onSubmit}
        onAppendRaw={undefined}
        interrupt={null}
        {...props}
      />
    );
  }
  const root = createRoot(container);
  await act(async () => root.render(<Harness />));
  // the editor loads lazily
  const textbox = await vi.waitFor(() => {
    const element = container.querySelector('[role="textbox"]');
    if (!element) throw new Error("the message editor has not loaded");
    return element;
  });

  const composer = {
    container,
    textbox,
    onSubmit,
    draft: () => current!,
    async pressEnter() {
      await act(async () => {
        textbox.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
        );
      });
    },
    async paste({ files = [], items = [], text = "" }: Paste) {
      // jsdom has no DataTransfer, so the event carries a stand-in with the fields a paste reads
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: {
          files,
          items: [
            ...items.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file })),
            ...(text ? [{ kind: "string", type: "text/plain", getAsFile: () => null }] : []),
          ],
          getData: (format: string) => (format === "text/plain" ? text : ""),
        },
      });
      await act(async () => textbox.dispatchEvent(event));
    },
    async send() {
      const button = container.querySelector<HTMLButtonElement>('button[title="Send message"]');
      await act(async () => button!.click());
      await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled());
      await act(async () => {});
    },
  };
  return composer;
}
