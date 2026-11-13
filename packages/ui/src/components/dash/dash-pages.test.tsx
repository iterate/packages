// @vitest-environment jsdom
// The kit's pages of a Dash do their own reads: what a page says for a mind that has no vault or no
// integrations, and what the secrets page says when the vault refuses.
import { act, Suspense, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { DashIntegrations, DashSecrets, type DashPageProps } from "./dash-pages.tsx";

test("a mind with no vault: the secrets page says so and lists nothing", async () => {
  const { itx, lists } = mind([], async () => []);
  await using page = await draw(DashSecrets, itx);
  expect(page.host).toMatchObject({ textContent: "This mind has no vault for secrets yet." });
  expect(lists()).toBe(0);
});

test("a vault that refuses: the page says its words", async () => {
  const { itx } = mind(["itx.secrets"], () => Promise.reject(new Error("The vault is asleep")));
  await using page = await draw(DashSecrets, itx);
  expect(page.host.querySelector('[role="alert"]')?.textContent).toBe("The vault is asleep");
});

test("a mind with no integrations: the page says so under its title", async () => {
  const { itx } = mind([], async () => []);
  await using page = await draw(DashIntegrations, itx);
  expect(page.host.querySelector("h1")?.textContent).toBe("Integrations");
  expect(page.host.textContent).toContain("This mind has no integrations yet.");
});

/** A mind that serves the roots `serves` names, with a vault that lists by `secrets`. */
function mind(serves: string[], secrets: () => Promise<{ path: string }[]>) {
  let lists = 0;
  const itx = {
    rewriteRules: {
      get: async (root: string) => (serves.includes(root) ? { target: "x" } : null),
    },
    secrets: {
      list: () => {
        lists += 1;
        return secrets();
      },
    },
  };
  return { itx: itx as unknown as DashPageProps["itx"], lists: () => lists };
}

/** The page as the Dash's shell draws it, once its part of the kit and its reads are in. */
async function draw(Page: (props: DashPageProps) => ReactNode, itx: DashPageProps["itx"]) {
  const row = { id: "secrets", name: "Secrets", icon: () => null, component: () => null };
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(() =>
    root.render(
      <Suspense fallback="Loading the page…">
        <Page
          itx={itx}
          mind="example.com"
          principal={null}
          page={row}
          pages={[row]}
          links={[]}
          catalog={undefined}
        />
      </Suspense>,
    ),
  );
  // up to four seconds, inside the test's five: under a full test run a page's part takes two to load
  for (let tick = 0; tick < 80 && host.textContent?.match(/Loading|Reading/); tick += 1)
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
  return {
    host,
    [Symbol.asyncDispose]: async () => {
      await act(() => root.unmount());
      host.remove();
    },
  };
}
