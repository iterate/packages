// @vitest-environment jsdom
// The composer's paste: image files in a paste are staged as attachments, as from the `+`, and a
// submit sends them as data URLs; the paste's text still goes into the message editor (CodeMirror,
// loaded for real). Out of scope: drop and the file picker.
import { act } from "react";
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

type Paste = { files?: File[]; items?: File[]; text?: string };

async function renderComposer() {
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
