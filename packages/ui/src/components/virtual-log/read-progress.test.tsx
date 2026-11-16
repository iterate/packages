// @vitest-environment jsdom
// The loading line's wait on a page whose HTML drew a loading frame before the app loaded: the
// person has been waiting since that frame, so the line does not start its 200 unseen
// milliseconds when the app at last draws it.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { LoadingWait, LogReading } from "./read-progress.tsx";

// React's flag for a test that wraps its changes in `act`: a global that no type declares.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("on a page that says `data-frame`, the first wait began with the page: the line fades in at once; a later wait begins when its line goes up", async () => {
  document.documentElement.setAttribute("data-frame", "");
  const clock = vi.spyOn(performance, "now");
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  const delay = () =>
    document.querySelector<HTMLElement>("[data-slot=log-reading]")?.style.animationDelay;
  // the app draws its first loading line 1.5 s after the page began
  clock.mockReturnValue(1_500);
  await act(async () => root.render(<LogReading key="first" label="Reading the log" />));
  expect(delay()).toBe("-1300ms");
  // the rows come; a minute later another view reads its log
  clock.mockReturnValue(2_000);
  await act(async () => root.render(null));
  clock.mockReturnValue(62_000);
  await act(async () => root.render(<LogReading key="later" label="Reading the log" />));
  expect(delay()).toBe("200ms");
  await act(async () => root.unmount());
  document.documentElement.removeAttribute("data-frame");
});

test("a page that loaded with no line: its placeholder took the page's first wait, so a view opened later starts its own 200 ms", async () => {
  document.documentElement.setAttribute("data-frame", "");
  const clock = vi.spyOn(performance, "now");
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  // Home's part loads under the placeholder shapes, which are the page's first wait
  clock.mockReturnValue(1_500);
  await act(async () => root.render(<LoadingWait key="shapes" />));
  clock.mockReturnValue(1_800);
  await act(async () => root.render(null));
  // half a minute later the person opens an agent: a new wait, with its unseen 200 ms
  clock.mockReturnValue(30_000);
  await act(async () => root.render(<LogReading key="agent" label="Reading the log" />));
  expect(document.querySelector<HTMLElement>("[data-slot=log-reading]")?.style.animationDelay).toBe(
    "200ms",
  );
  await act(async () => root.unmount());
  document.documentElement.removeAttribute("data-frame");
});
