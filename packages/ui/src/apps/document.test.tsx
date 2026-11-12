// What an app shows when a load fails, from the two pieces every app's routes name: the document
// as the root's `shellComponent`, and a mind's frame as its route's `errorComponent`. Each is the
// server's render of a router whose loader threw.
import { renderToString } from "react-dom/server";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  RouterProvider,
} from "@tanstack/react-router";
import { expect, test } from "vitest";
import { MindAppLoadError } from "../components/mind-app-shell.tsx";
import { AppDocumentShell, AppRoot } from "./document.tsx";
import { appHead } from "./head.ts";
import { createAppRouter } from "./router.tsx";

test("a root loader that fails still renders the document: the head the root names, the failure and a retry", async () => {
  const root = createRootRoute({
    loader: (): { posthogProjectKey: string | null } => {
      throw new Error("the deployment's configuration could not be read");
    },
    head: () => appHead({ title: "Agents", stylesheet: "/assets/styles.css" }),
    shellComponent: ({ children }) => (
      <AppDocumentShell icon="/client-logo.svg">{children}</AppDocumentShell>
    ),
    component: () => <AppRoot posthogProjectKey={root.useLoaderData().posthogProjectKey} />,
  });
  const router = createAppRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ["/"] }),
    origin: "https://agents.example.com",
  });
  await router.load();
  const html = renderToString(<RouterProvider router={router} />);
  expect(html).toMatch(/^<html lang="en"/);
  expect(html).toContain('<link rel="stylesheet" href="/assets/styles.css"');
  expect(html).toContain("<title>Agents</title>");
  expect(html).toContain("Something went wrong");
  expect(html).toContain("the deployment&#x27;s configuration could not be read");
  expect(html).toContain("Try again");
  expect(html).toContain("</body></html>");
});

test("a mind whose first read fails keeps the app's frame, and says which mind and what failed, with a retry", async () => {
  const root = createRootRoute({ component: () => <AppRoot posthogProjectKey={null} /> });
  const mind = createRoute({
    getParentRoute: () => root,
    path: "minds/$mind",
    loader: () => {
      throw new Error("example.com is unavailable (503). Please retry.");
    },
    errorComponent: ({ error }) => <MindAppLoadError app="Agents" error={error} />,
    component: () => <p>the mind's page</p>,
  });
  const router = createAppRouter({
    routeTree: root.addChildren([mind]),
    history: createMemoryHistory({ initialEntries: ["/minds/example.com"] }),
    origin: "https://agents.example.com",
  });
  await router.load();
  const html = renderToString(<RouterProvider router={router} />);
  expect(html).not.toContain("the mind&#x27;s page");
  expect(html).toContain("Agents could not load example.com");
  expect(html).toContain("example.com is unavailable (503). Please retry.");
  expect(html).toContain("Try again");
  // the frame: the switcher still names the app and the mind
  expect(html).toContain('data-slot="sidebar"');
});
