// @vitest-environment jsdom
// The URL of a page with no router: the links a page makes, and how its view changes the URL.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { hrefOf, linkTo, pageHref, useView } from "./page-url.ts";

test("a link to a page starts from none of the last page's keys; the first page is the root", () => {
  history.replaceState(null, "", "/?page=repo&repo=docs&view=%7B%7D");
  expect(pageHref("contexts", { context: "/agents" })).toBe("?page=contexts&context=%2Fagents");
  expect(pageHref(undefined)).toBe("./");
  // a change keeps the other keys, and a key set to undefined goes
  expect(hrefOf({ view: undefined })).toBe("?page=repo&repo=docs");
});

test("a plain left click changes the URL in place; a click that opens a new tab is the browser's", () => {
  history.replaceState(null, "", "/");
  const link = linkTo("?page=secrets");
  const click = (init: MouseEventInit = {}) => {
    const event = new MouseEvent("click", { button: 0, cancelable: true, ...init });
    link.onClick(event);
    return event.defaultPrevented;
  };
  expect(click({ metaKey: true })).toBe(false);
  expect(location).toMatchObject({ search: "" });
  expect(click()).toBe(true);
  expect(location).toMatchObject({ search: "?page=secrets" });
});

test("a view's patch replaces the history's entry, and a whole view set is a new entry", async () => {
  history.replaceState(null, "", "/?page=repo&view=not-json");
  let view: ReturnType<typeof useView> | undefined;
  function Probe() {
    view = useView();
    return null;
  }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(() => root.render(createElement(Probe)));
  // a hand-edited value is no view state
  expect(view?.view).toEqual({});
  const entries = history.length;
  await act(() => view?.patchView({ file: "a.ts", diff: undefined }));
  expect(new URLSearchParams(location.search).get("view")).toBe('{"file":"a.ts"}');
  expect(history.length).toBe(entries);
  expect(view?.view).toEqual({ file: "a.ts" });
  await act(() => view?.setView({ new: 1 }));
  expect(history.length).toBe(entries + 1);
  expect(view?.view).toEqual({ new: 1 });
  // an empty view is no key at all
  await act(() => view?.setView({}, true));
  expect(location).toMatchObject({ search: "?page=repo" });
  await act(() => root.unmount());
});
