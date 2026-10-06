// @vitest-environment jsdom
// `useRead` as render state: what a page has to show while a read is in flight, once it lands, and
// while a newer read replaces it. The repo reads made through it are covered end to end by
// test/playwright/dash/repo-ide.spec.ts.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { useRead, type Read } from "./repo-client.ts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

test("a first read is pending until it lands", async () => {
  using reads = await mount("a");
  expect(reads.state).toMatchObject({ status: "pending" });
  await reads.answer("a", "A");
  expect(reads.state).toMatchObject({ status: "loaded", value: "A", refreshing: false });
});

test("a read made again keeps the last value, marked refreshing, until the new one lands", async () => {
  using reads = await mount("a");
  await reads.answer("a", "A");
  await reads.rerender("b");
  expect(reads.state).toMatchObject({ status: "loaded", value: "A", refreshing: true });
  await reads.answer("b", "B");
  expect(reads.state).toMatchObject({ status: "loaded", value: "B", refreshing: false });
});

test("an earlier read's answer is dropped once a newer read has begun", async () => {
  using reads = await mount("a");
  await reads.rerender("b");
  await reads.answer("a", "A");
  expect(reads.state).toMatchObject({ status: "pending" });
  await reads.answer("b", "B");
  expect(reads.state).toMatchObject({ status: "loaded", value: "B", refreshing: false });
});

test("no read reads nothing: never read stays pending, and a loaded value stays as it was", async () => {
  using reads = await mount(undefined);
  expect(reads).toMatchObject({ started: [], state: { status: "pending" } });
  await reads.rerender("a");
  await reads.answer("a", "A");
  await reads.rerender(undefined);
  expect(reads).toMatchObject({
    started: ["a"],
    state: { status: "loaded", value: "A", refreshing: false },
  });
});

/** A component reading `useRead` mounted in the document, with `key` as the read's one dep (no key:
 *  no read). Each read waits until the test answers it; disposing unmounts it. */
async function mount(key: string | undefined) {
  const answers = new Map<string, (value: string) => void>();
  const reads = { started: [] as string[], state: { status: "pending" } as Read<string> };
  function Reader({ readKey }: { readKey: string | undefined }) {
    reads.state = useRead(
      readKey
        ? () => {
            reads.started.push(readKey);
            const { promise, resolve } = Promise.withResolvers<string>();
            answers.set(readKey, resolve);
            return promise;
          }
        : undefined,
      [readKey],
    );
    return null;
  }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  const rerender = (next: string | undefined) => act(() => root.render(<Reader readKey={next} />));
  await rerender(key);
  return {
    get state() {
      return reads.state;
    },
    get started() {
      return reads.started;
    },
    rerender,
    answer: (readKey: string, value: string) => act(async () => answers.get(readKey)?.(value)),
    [Symbol.dispose]() {
      act(() => root.unmount());
      document.body.replaceChildren();
    },
  };
}
