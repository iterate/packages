// @vitest-environment jsdom
// The Dash's addresses as paths: what each address reads as, what each link is written as, and
// that a page which did not ask for paths keeps every address as a query.
import { expect, test } from "vitest";
import { agentViewHref, dashPaths, rawViewHref } from "./dash-href.ts";
import { go, hrefOf, keysOfLink, linkTo, pageHref, pathAddresses } from "#/lib/page-url.ts";

test("a page is the first segment, an agent's path is the URL's path, and a context's path follows the Contexts page", () => {
  using _page = pageWithPaths();
  expect(pageHref(undefined)).toBe("/");
  expect(pageHref("secrets")).toBe("/secrets");
  expect(pageHref("agents")).toBe("/agents");
  expect(agentViewHref("/agents/onboarding")).toBe("/agents/onboarding");
  expect(rawViewHref("contexts", "/repos/config")).toBe("/contexts/repos/config");
  // the same context in its two views, and a page that has a context's name
  expect(rawViewHref("contexts", "/agents/onboarding")).toBe("/contexts/agents/onboarding");
  expect(keysAt("/secrets")).toEqual({ page: "secrets" });
  expect(keysAt("/contexts/secrets")).toEqual({ page: "contexts", context: "/secrets" });
  expect(keysAt("/agents")).toEqual({ page: "agents" });
  expect(keysAt("/agents/")).toEqual({ page: "agents" });
  expect(keysAt("/agents/onboarding")).toEqual({ agent: "/agents/onboarding" });
  expect(keysAt("/")).toEqual({});
  // a key that is no place stays a query
  expect(pageHref("repo", { repo: "docs", view: '{"file":"a.ts"}' })).toBe(
    "/repo?repo=docs&view=%7B%22file%22%3A%22a.ts%22%7D",
  );
  expect(keysAt("/repo?repo=docs")).toEqual({ page: "repo", repo: "docs" });
});

test("a path with a space, a percent sign, a hash, a question mark, an @ and a dot reads back as it is", () => {
  using _page = pageWithPaths();
  for (const path of [
    "/agents/canvas2/ada@example.com/notes.md",
    "/agents/a b/100%/#1/what?",
    "/agents/%2F/a+b/ä",
    "/agents/ada+notes@example.com/a:b,c;d=e&f$g",
    "/agents/app.js",
  ]) {
    const agent = agentViewHref(path);
    expect(agent).not.toMatch(/[?# ]/);
    expect(keysAt(agent)).toEqual({ agent: path });
    // what the browser makes of the link is the same address
    expect(new URL(agent, "https://dash.example.com")).toMatchObject({ pathname: agent });
    const raw = rawViewHref("contexts", path);
    expect(keysAt(raw)).toEqual({ page: "contexts", context: path });
  }
  // the characters a URL's path holds as they are stay as they are
  for (const path of [
    "/agents/canvas2/ada@example.com/notes.md",
    "/agents/ada+notes@example.com/a:b,c;d=e&f$g",
  ])
    expect(agentViewHref(path)).toBe(path);
});

test("what the path cannot say stays a query, and reads back", () => {
  using _page = pageWithPaths();
  // the root context, a path that is not canonical, and the agent view of what is no agent
  expect(rawViewHref("contexts", "/")).toBe("/contexts?context=/");
  expect(keysAt("/contexts?context=/")).toEqual({ page: "contexts", context: "/" });
  expect(rawViewHref("contexts", "repos/config/")).toBe("/contexts?context=repos/config/");
  expect(rawViewHref("contexts", "/a/../b")).toBe("/contexts?context=/a/../b");
  expect(agentViewHref("/people/ada")).toBe("/?agent=/people/ada");
  expect(agentViewHref("/agents")).toBe("/?agent=/agents");
  expect(keysAt("/?agent=/people/ada")).toEqual({ agent: "/people/ada" });
  // a page whose id is a path of the Dash's own host, or no plain word, keeps its query form
  for (const id of ["itx", "connect", "app.js", ".auth", "a/b"])
    expect(pageHref(id)).toBe(
      `/?${new URLSearchParams({ page: id }).toString().replaceAll("%2F", "/")}`,
    );
  expect(keysAt("/?page=itx")).toEqual({ page: "itx" });
});

test("an old link reads as it always did from any path, and is written as its path", () => {
  using _page = pageWithPaths();
  // a query that names the page wins over the path: a relative old link on a deep page
  expect(keysAt("/agents/a?page=secrets")).toEqual({ page: "secrets" });
  expect(keysAt("/secrets?agent=/agents/b")).toEqual({ agent: "/agents/b" });
  const written = (address: string) => {
    const url = new URL(address, "https://dash.example.com");
    return dashPaths.hrefOf(dashPaths.keysOf(url.pathname, url.search));
  };
  expect(written("/?agent=/agents/onboarding")).toBe("/agents/onboarding");
  expect(written("/?page=agents")).toBe("/agents");
  expect(written("/?page=contexts&context=/agents/a")).toBe("/contexts/agents/a");
  expect(written("/?page=repo&repo=docs")).toBe("/repo?repo=docs");
  // an agent's view is the Agents page's, whatever page the link names
  expect(written("/?page=contexts&agent=/agents/a&view=%7B%7D")).toBe("/agents/a?view=%7B%7D");
  // and a link written by hand in the old form leads to the same place from a deep page
  history.replaceState(null, "", "/agents/a");
  expect(linkTo("?page=secrets")).toMatchObject({ href: "/secrets" });
  expect(linkTo("./")).toMatchObject({ href: "/" });
  expect(linkTo("https://docs.example.com/")).toMatchObject({ href: "https://docs.example.com/" });
  go("?agent=/agents/b");
  expect(location).toMatchObject({ pathname: "/agents/b", search: "" });
  expect(Object.fromEntries(keysOfLink("?agent=/agents/b") || [])).toEqual({ agent: "/agents/b" });
  expect(Object.fromEntries(keysOfLink("/agents/b") || [])).toEqual({ agent: "/agents/b" });
  expect(keysOfLink("https://docs.example.com/")).toBeNull();
  expect(keysOfLink("//docs.example.com/")).toBeNull();
});

test("the address a page was opened at is rewritten once, in place, with its other keys and its hash", () => {
  using _page = pageWithPaths();
  history.replaceState(null, "", "/?agent=/agents/a%20b&view=%7B%22view%22%3A%22events%22%7D#last");
  const entries = history.length;
  pathAddresses(dashPaths);
  expect(location).toMatchObject({
    pathname: "/agents/a%20b",
    search: "?view=%7B%22view%22%3A%22events%22%7D",
    hash: "#last",
  });
  expect(history.length).toBe(entries);
  // a change of the view keeps the path
  expect(hrefOf({ view: undefined })).toBe("/agents/a%20b");
  // an address that is its own path is left as it is
  history.replaceState({ kept: 1 }, "", "/contexts/repos/config?view=%7B%7D");
  pathAddresses(dashPaths);
  expect(location).toMatchObject({ pathname: "/contexts/repos/config", search: "?view=%7B%7D" });
  expect(history).toMatchObject({ state: { kept: 1 } });
});

test("a page that did not ask for paths keeps every address as a query", () => {
  history.replaceState(null, "", "/?agent=/agents/a");
  pathAddresses(dashPaths);
  expect(location).toMatchObject({ pathname: "/", search: "?agent=/agents/a" });
  expect(agentViewHref("/agents/onboarding")).toBe("?agent=/agents/onboarding");
  expect(rawViewHref("contexts", "/repos/config")).toBe("?page=contexts&context=/repos/config");
  expect(pageHref(undefined)).toBe("./");
  expect(linkTo("?page=secrets")).toMatchObject({ href: "?page=secrets" });
  expect(keysOfLink("/agents/b")).toBeNull();
});

/** A page that asked for paths, until the test ends. */
function pageWithPaths() {
  document.documentElement.dataset.addresses = "paths";
  return {
    [Symbol.dispose]() {
      delete document.documentElement.dataset.addresses;
      history.replaceState(null, "", "/");
    },
  };
}

/** The keys that the Dash reads at `address`. */
function keysAt(address: string) {
  const url = new URL(address, "https://dash.example.com");
  return Object.fromEntries(dashPaths.keysOf(url.pathname, url.search));
}
