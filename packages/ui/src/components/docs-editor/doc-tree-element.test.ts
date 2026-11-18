// @vitest-environment jsdom
// The tree's element, as a page with no CSS for it gets it: tall enough for its rows, and of the
// page's colour scheme.
import { expect, test } from "vitest";
import type { DocList } from "./doc-list.ts";
import { PierreDocTree } from "./doc-tree.ts";

test("the tree's element is as tall as its rows with one row of room below them, follows them as folders open, and takes the page's colour scheme", async () => {
  const parent = document.body.appendChild(document.createElement("div"));
  const tree = new PierreDocTree({
    list: listOf(["AGENTS.md", "notes/plan.md", "notes/review.md", "worker.ts"]),
    openPath: () => undefined,
    open: () => {},
    create: async () => {},
  });
  const unmount = tree.mount(parent as HTMLDivElement)!;
  const host = parent.querySelector("file-tree-container") as HTMLElement;
  // Pierre's own element says "light dark", which follows the visitor's system
  expect(host.style.getPropertyValue("color-scheme")).toBe("inherit");
  const height = () => Number.parseFloat(parent.style.height);
  const closed = height();
  // the folder is opened: the element grows by its two rows
  host.shadowRoot!.querySelector<HTMLElement>('[role="treeitem"][aria-expanded="false"]')!.click();
  const row = (height() - closed) / 2;
  expect(row).toBeGreaterThan(0);
  // closed, it was three rows and one row of room for "New doc" at the root
  expect(closed).toBe(4 * row);
  unmount();
  await afterPreactsFrame();
});

/** The tree's element is Pierre's, which renders with Preact. Preact runs a render's effects after
 *  the next frame: it asks for a frame, and sets a timer of 35 ms that cancels that frame with
 *  `cancelAnimationFrame`. Unmounting the tree does not clear that timer, and it must not fire
 *  after the test's document is gone, where `cancelAnimationFrame` is not defined. So a test that
 *  made the tree render waits here until that frame has run: a frame callback asked for now runs
 *  after Preact's, and a timer set in it after Preact's own. Twice, since a frame's work can ask
 *  for another. */
async function afterPreactsFrame() {
  for (let frame = 0; frame < 2; frame++)
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));
}

/** A list that holds `paths` and never changes. */
function listOf(paths: string[]) {
  return {
    state: () => ({ kind: "loaded", paths }),
    subscribe: () => () => {},
  } as unknown as DocList;
}
