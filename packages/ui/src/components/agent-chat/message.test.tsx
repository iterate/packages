// @vitest-environment jsdom
// MessageResponse's links: no question before a link opens, and a link to this page opens in place.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { MessageResponse } from "./message.tsx";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

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
  await vi.waitFor(() => expect(host.querySelectorAll("a")).toHaveLength(2));

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
  await vi.waitFor(() => expect(host.querySelector("a")).not.toBeNull());
  expect(host.querySelector("a")?.hasAttribute("target")).toBe(false);
  await act(async () => root.unmount());
  host.remove();
});
