// @vitest-environment jsdom
// The composer's paste: image files in a paste are staged as attachments, as from the `+`, and a
// submit sends them as data URLs; the paste's text still goes into the message editor (CodeMirror,
// loaded for real). And its round button while a turn runs. Out of scope: drop and the file picker.
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
    onSubmit,
    draft: () => current!,
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
