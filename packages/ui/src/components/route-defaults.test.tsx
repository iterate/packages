// @vitest-environment jsdom
// The default error page's "Try again": it loads the route again. The boundary's own reset would
// show the same failed load once more.
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { expect, test, vi } from "vitest";
import { createAppRouter } from "../apps/router.tsx";

test("Try again on a failed load runs the loader again and shows the page when it answers", async () => {
  let loads = 0;
  const root = createRootRoute({ component: Outlet });
  const page = createRoute({
    getParentRoute: () => root,
    path: "/",
    loader: () => {
      loads += 1;
      if (loads === 1) throw new Error("the first read failed");
      return { said: "the page, read again" };
    },
    component: () => <p>{page.useLoaderData().said}</p>,
  });
  const router = createAppRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const mount = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => {
    await router.load();
    mount.render(<RouterProvider router={router} />);
  });
  expect(document.body.textContent).toContain("Something went wrong");
  expect(document.body.textContent).toContain("the first read failed");
  const retry = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Try again",
  );
  // the click alone: nothing else here asks the router to load
  await act(async () => {
    retry!.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain("the page, read again"));
  });
  expect(loads).toBe(2);
  expect(document.body.textContent).not.toContain("Something went wrong");
  await act(() => mount.unmount());
});
