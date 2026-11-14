// @vitest-environment jsdom
// The step row in each state: the mark the eye reads, the word a screen reader reads, and the page's
// buttons under the text. How it looks is the screenshots' (the pull request), not this file's.
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { StepRow, type StepRowState } from "./step-row.tsx";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

test.for<{ name: string; state: StepRowState; mark: string; spoken: string }>([
  { name: "done", state: "done", mark: "lucide-circle-check", spoken: "Done: " },
  { name: "running", state: "running", mark: "animate-spin", spoken: "In progress: " },
  { name: "waiting", state: "waiting", mark: "lucide-circle-alert", spoken: "Waiting for you: " },
  { name: "failed", state: "failed", mark: "lucide-circle-x", spoken: "Failed: " },
])(
  "a $name step shows its own mark and says its state in words",
  async ({ state, mark, spoken }) => {
    using row = await mount(<StepRow state={state} title="Deploy the mind" detail="iterate.com" />);
    expect(row.element).toMatchObject({
      dataset: { slot: "step-row", state },
      textContent: `${spoken}Deploy the minditerate.com`,
    });
    expect(row.element.querySelector("[aria-hidden] svg")?.getAttribute("class")).toContain(mark);
  },
);

test("a step's buttons sit under its text, and a step without any has no row for them", async () => {
  using waiting = await mount(
    <StepRow state="waiting" title="Connect Cloudflare">
      <button type="button">Connect</button>
      <button type="button">Skip</button>
    </StepRow>,
  );
  const buttons = [...waiting.element.querySelectorAll("button")].map((button) => ({
    text: button.textContent,
    under: button.parentElement?.previousElementSibling?.textContent,
  }));
  expect(buttons).toMatchObject([
    { text: "Connect", under: "Waiting for you: Connect Cloudflare" },
    { text: "Skip", under: "Waiting for you: Connect Cloudflare" },
  ]);
  using done = await mount(<StepRow state="done" title="Connected" />);
  expect(done.element.lastElementChild?.childElementCount).toBe(1);
});

/** The row mounted in the document; disposing unmounts it. */
async function mount(node: ReactNode) {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(node));
  return {
    element: host.firstElementChild as HTMLElement, // StepRow renders one div
    [Symbol.dispose]: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}
