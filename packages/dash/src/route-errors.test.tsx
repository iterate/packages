// What the Dash shows when a load fails: the document when the root's own read fails, and the
// mind's frame when the mind's sign-in or first read fails. Each is the server's render of a
// router whose loader threw.
import { renderToString } from "react-dom/server";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  RouterProvider,
} from "@tanstack/react-router";
import { expect, test } from "vitest";
import { createAppRouter } from "@iterate-com/ui/apps/router";
import { AppRoot } from "@iterate-com/ui/apps/document";
import { MindLoadError } from "./components/mind-frame.tsx";
import { getRouter } from "./router.tsx";

test("a root loader that fails still renders a document, with the app's styles, the failure and a retry", async () => {
  // the failure: the root's loader is a server function, and a test is no Start server, so the
  // call throws before it reads the Worker's configuration
  const router = getRouter();
  router.update({
    history: createMemoryHistory({ initialEntries: ["/"] }),
    origin: "https://dash.example.com",
  });
  await router.load();
  const html = renderToString(<RouterProvider router={router} />);
  expect(html).toMatch(/^<html lang="en"/);
  // the head the root names (vitest gives the stylesheet's `?url` import no address)
  expect(html).toContain('<link rel="stylesheet"');
  expect(html).toContain("<title>Dash</title>");
  expect(html).toContain("Something went wrong");
  expect(html).toMatch(/<p data-type="error"[^>]*>No Start context found/);
  expect(html).toContain("Try again");
  expect(html).toContain("</body></html>");
});

test("a mind whose first read fails keeps the Dash's frame, and says which mind and what failed, with a retry", async () => {
  const root = createRootRoute({
    loader: () => ({ posthogProjectKey: null, apps: [] }),
    component: () => <AppRoot posthogProjectKey={null} />,
  });
  const mind = createRoute({
    getParentRoute: () => root,
    path: "minds/$mind",
    loader: () => {
      throw new Error("the mind answered 503");
    },
    errorComponent: MindLoadError,
    component: () => <p>the mind's page</p>,
  });
  const router = createAppRouter({
    routeTree: root.addChildren([mind]),
    history: createMemoryHistory({ initialEntries: ["/minds/example.com"] }),
    origin: "https://dash.example.com",
  });
  await router.load();
  const html = renderToString(<RouterProvider router={router} />);
  expect(html).not.toContain("the mind's page");
  expect(html).toContain("Dash could not load example.com");
  expect(html).toContain("the mind answered 503");
  expect(html).toContain("Try again");
  // the frame: the mind's navigation is still there to leave by
  expect(html).toContain('href="/minds/example.com/approvals"');
  expect(html).toContain("Contexts");
});
