// @vitest-environment jsdom
// The Dash's canonical path addresses: round-trips for every route, encoding and trailing
// punctuation, reserved page ids, and root-path normalisation with hashes.
import { expect, test } from "vitest";
import { agentViewHref, dashPaths, rawViewHref } from "./dash-href.ts";
import { go, hrefOf, keysOfLink, linkTo, pageHref } from "#/lib/page-url.ts";

test.for<{
  name: string;
  href: string;
  keys: Record<string, string>;
  view?: Record<string, unknown>;
}>([
  { name: "root", href: "/", keys: {} },
  { name: "simple page", href: "/secrets", keys: { page: "secrets" } },
  { name: "integrations page", href: "/integrations", keys: { page: "integrations" } },
  { name: "agents overview", href: "/agents", keys: { page: "agents" } },
  {
    name: "agents path remainder (free for the Agents page)",
    href: "/agents/drafts/1",
    keys: { page: "agents", rest: "drafts/1" },
  },
  {
    name: "agent under /agents/",
    href: "/agents?contextPath=/agents/onboarding",
    keys: { agent: "/agents/onboarding" },
  },
  {
    name: "agent outside /agents/",
    href: "/agents?contextPath=/people/ada",
    keys: { agent: "/people/ada" },
  },
  { name: "agent at root", href: "/agents?contextPath=/", keys: { agent: "/" } },
  {
    name: "agent with kind (iterate.com Herdr link)",
    href: "/agents?contextPath=/agents/claude/s1&kind=claude",
    keys: { agent: "/agents/claude/s1", kind: "claude" },
  },
  {
    name: "agent with view (contextPath ordered before view)",
    href: "/agents?contextPath=/agents/onboarding&view=%7B%22view%22:%22events%22%7D",
    keys: { agent: "/agents/onboarding" },
    view: { view: "events" },
  },
  { name: "contexts overview", href: "/contexts", keys: { page: "contexts" } },
  {
    name: "context path",
    href: "/contexts/repos/config",
    keys: { page: "contexts", context: "/repos/config" },
  },
  {
    name: "context with page's name",
    href: "/contexts/secrets",
    keys: { page: "contexts", context: "/secrets" },
  },
  {
    name: "root context",
    href: "/contexts?contextPath=/",
    keys: { page: "contexts", context: "/" },
  },
  { name: "default repo", href: "/repo", keys: { page: "repo" } },
  { name: "explicit config repo", href: "/repo/config", keys: { page: "repo", repo: "config" } },
  { name: "other repo", href: "/repo/docs", keys: { page: "repo", repo: "docs" } },
  {
    name: "repo file with dot",
    href: "/repo/config/worker.ts",
    keys: { page: "repo", repo: "config" },
    view: { file: "worker.ts" },
  },
  {
    name: "nested repo file named like a static asset",
    href: "/repo/config/apps/dash/app.js",
    keys: { page: "repo", repo: "config" },
    view: { file: "apps/dash/app.js" },
  },
  {
    name: "repo file with extra view state",
    href: "/repo/docs/guide.md?view=%7B%22diff%22:true%7D",
    keys: { page: "repo", repo: "docs" },
    view: { file: "guide.md", diff: true },
  },
  {
    name: "custom page with remainder",
    href: "/notes/2026/standup",
    keys: { page: "notes", rest: "2026/standup" },
  },
])("canonical round-trip: $name ($href)", ({ href, keys, view }) => {
  const read = keysAt(href);
  const { view: readView, ...readKeys } = read;
  expect(readKeys).toEqual(keys);
  if (view) expect(JSON.parse(readView!)).toEqual(view);
  else expect(readView).toBeUndefined();
  const written = dashPaths.hrefOf(new URLSearchParams(read));
  expect(written).toBe(href);
  const parsed = new URL(written, "https://dash.example.com");
  expect(parsed.pathname + parsed.search).toBe(written);
});

test("encoding rules: raw / @ : , ; %20 for space; encoded & # % + ? = ; '; trailing . , : encoded", () => {
  const special = "/agents/ada+notes@example.com/a:b,c;d=e&f#g?h%20i'j k";
  const href = agentViewHref(special);
  expect(href).toBe(
    "/agents?contextPath=/agents/ada%2Bnotes@example.com/a:b,c%3Bd%3De%26f%23g%3Fh%2520i%27j%20k",
  );
  expect(keysAt(href)).toEqual({ agent: special });
  const parsed = new URL(href, "https://dash.example.com");
  expect(parsed.pathname + parsed.search).toBe(href);

  // trailing . , : are encoded at the end of the URL (both query and path) so linkifiers keep them
  for (const [path, suffix] of [
    ["/agents/a.", "%2E"],
    ["/agents/a,", "%2C"],
    ["/agents/a:", "%3A"],
  ] as const) {
    const agent = agentViewHref(path);
    expect(agent.endsWith(suffix)).toBe(true);
    expect(keysAt(agent)).toEqual({ agent: path });
    const parsedAgent = new URL(agent, "https://dash.example.com");
    expect(parsedAgent.pathname + parsedAgent.search).toBe(agent);

    const raw = rawViewHref("contexts", path);
    expect(raw.endsWith(suffix)).toBe(true);
    expect(keysAt(raw)).toEqual({ page: "contexts", context: path });
    const parsedRaw = new URL(raw, "https://dash.example.com");
    expect(parsedRaw.pathname + parsedRaw.search).toBe(raw);
  }

  for (const path of [
    "/agents/canvas2/ada@example.com/notes.md",
    "/agents/a b/100%/#1/what?",
    "/agents/%2F/a+b/ä",
    "/agents/ada+notes@example.com/a:b,c;d=e&f$g",
    "/agents/app.js",
  ]) {
    const agent = agentViewHref(path);
    expect(keysAt(agent)).toEqual({ agent: path });
    const parsedAgent = new URL(agent, "https://dash.example.com");
    expect(parsedAgent.pathname + parsedAgent.search).toBe(agent);

    const raw = rawViewHref("contexts", path);
    expect(keysAt(raw)).toEqual({ page: "contexts", context: path });
    const parsedRaw = new URL(raw, "https://dash.example.com");
    expect(parsedRaw.pathname + parsedRaw.search).toBe(raw);
  }
});

test("what the path cannot say stays a query, and reserved page ids stay in ?page=", () => {
  expect(rawViewHref("contexts", "/")).toBe("/contexts?contextPath=/");
  expect(keysAt("/contexts?contextPath=/")).toEqual({ page: "contexts", context: "/" });
  expect(rawViewHref("contexts", "repos/config/")).toBe("/contexts?contextPath=repos/config/");
  expect(rawViewHref("contexts", "/a/../b")).toBe("/contexts?contextPath=/a/../b");

  const badRepo = pageHref("repo", { repo: "a/b", view: JSON.stringify({ file: "worker.ts" }) });
  expect(badRepo).toBe("/repo?repo=a/b&view=%7B%22file%22:%22worker.ts%22%7D");
  expect(keysAt(badRepo)).toEqual({
    page: "repo",
    repo: "a/b",
    view: '{"file":"worker.ts"}',
  });
  const badFile = pageHref("repo", { repo: "docs", view: JSON.stringify({ file: "a/../b" }) });
  expect(badFile).toBe("/repo/docs?view=%7B%22file%22:%22a/../b%22%7D");
  expect(keysAt(badFile)).toEqual({ page: "repo", repo: "docs", view: '{"file":"a/../b"}' });

  // reserved first segments and dotted/slashed page ids stay in ?page=
  for (const id of ["itx", "connect", "api", "keys", "brands", "app.js", ".auth", "a/b"]) {
    const href = pageHref(id);
    expect(href.startsWith("/?page=")).toBe(true);
    expect(keysAt(href)).toEqual({ page: id });
  }
});

test("legacy query keys are ignored: unmatched addresses read no page or agent", () => {
  expect(keysAt("/?page=integrations")).toEqual({});
  expect(keysAt("/?agent=/agents/onboarding")).toEqual({});
  expect(keysAt("/contexts?context=/agents/a")).toEqual({ page: "contexts" });
  expect(keysAt("/repo?repo=docs")).toEqual({ page: "repo" });
});

test("written() normalises root paths and ./, keeping any hash", () => {
  history.replaceState(null, "", "/agents?contextPath=/agents/a");
  expect(linkTo("./")).toMatchObject({ href: "/" });
  expect(linkTo("./#top")).toMatchObject({ href: "/#top" });
  expect(linkTo("/agents/")).toMatchObject({ href: "/agents" });
  expect(linkTo("/agents?contextPath=/agents/x#last")).toMatchObject({
    href: "/agents?contextPath=/agents/x#last",
  });
  expect(linkTo("https://docs.example.com/")).toMatchObject({ href: "https://docs.example.com/" });
  go("/agents?contextPath=/agents/b#msg");
  expect(location).toMatchObject({
    pathname: "/agents",
    search: "?contextPath=/agents/b",
    hash: "#msg",
  });
  expect(hrefOf({ view: undefined })).toBe("/agents?contextPath=/agents/b");
  expect(Object.fromEntries(keysOfLink("/agents?contextPath=/agents/b#msg") || [])).toEqual({
    agent: "/agents/b",
  });
  expect(keysOfLink("?agent=/agents/b")).toBeNull();
  expect(keysOfLink("https://docs.example.com/")).toBeNull();
  expect(keysOfLink("//docs.example.com/")).toBeNull();
  history.replaceState(null, "", "/");
});

/** The keys that the Dash reads at `address`. */
function keysAt(address: string) {
  const url = new URL(address, "https://dash.example.com");
  return Object.fromEntries(dashPaths.keysOf(url.pathname, url.search));
}
