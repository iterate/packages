// @vitest-environment jsdom
// The tools a page lends an agent (./page-tools.ts): how a call reaches them, whom the page lends
// to, what never matches and what refuses, and what is written down.
import { newMessagePortRpcSession } from "capnweb";
import { walkStepsOnRpcStub, type ItxExpression } from "iterate/expression";
import { expect, test, vi } from "vitest";
import {
  BANNERS_WAITING,
  CALLS_PER_WINDOW,
  jailOf,
  lendPageTools,
  LIMITS,
  PageToolsSession,
  personSegment,
  refusalOf,
  type LendingContext,
  type PageToolCall,
  type PageToolsHost,
  type RuleRow,
} from "./page-tools.ts";

test("a call walked over capnweb as the kernel walks a lent stub runs in the page, and its audit row holds no value", async () => {
  const typed: string[] = [];
  const { session, audit } = page(`<label for="name">Name</label><input id="name" />`, {
    tools: { evaluate: { description: "runs code", run: (code) => `ran ${String(code)}` } },
  });
  field("name").addEventListener("input", () => typed.push(field("name").value));
  const { port1, port2 } = new MessageChannel();
  newMessagePortRpcSession(port1, session.target);
  const lent = newMessagePortRpcSession(port2);
  const call = (steps: ItxExpression) => walkStepsOnRpcStub(lent, steps);

  await call([
    ["getByLabel", "Name"],
    ["fill", "Ada Lovelace"],
  ]);
  expect(typed).toEqual(["Ada Lovelace"]);
  await call([
    ["getByLabel", "Name"],
    ["highlight", { note: "Your name goes here" }],
  ]);
  // the newest mark of an element stands, and the page says whose words a note is
  expect(session.get().highlights.map((mark) => mark.note)).toEqual([
    "Helper: Your name goes here",
  ]);

  const answer = call(["banner", ["show", { title: "Ready?", body: "The secret words" }]]);
  await vi.waitFor(() => expect(session.get().banner?.title).toBe("Ready?"));
  session.answerBanner(null);
  expect(await answer).toEqual({ pressed: null, why: "dismissed" });

  expect(await call([["evaluate", "1 + 1"]])).toBe("ran 1 + 1");
  expect(audit).toEqual([
    { tool: "fill", locator: 'internal:label="Name"i', outcome: "done" },
    { tool: "highlight", locator: 'internal:label="Name"i', outcome: "done" },
    { tool: "banner.show", outcome: "done" },
    { tool: "evaluate", outcome: "done" },
  ]);
  expect(JSON.stringify(audit)).not.toMatch(/Ada|secret words|1 \+ 1|Your name/);
});

test("a page lends only where the agent's scripts run in its own context with the kernel's own run and cd", async () => {
  // the rows as iterate.afoop.com listed them at depth 0 on 20 Nov 2026
  // (lint/page-tools-jail-rows.test.ts makes the same lists with the kernel's own code)
  expect(jailOf(ORDINARY)).toBeNull();
  // `jailUndo` of a mind's jail.ts writes the kernel's run back as a row of the agent's own
  expect(jailOf([...ORDINARY, { match: "itx.run", target: "itx.builtins.run" }])).toBeNull();
  for (const [form, rows] of Object.entries({
    "an agent whose scripts run in a jail": JAILED_AGENT,
    "the jail's own context": THE_JAIL,
    "a context with run masked": ORDINARY.map((row) =>
      row.match === "itx.run" ? { ...row, target: null } : row,
    ),
    "a list that could not be read": [],
  }))
    expect(jailOf(rows), form).toMatch(/jailed.*no page lends it tools/);

  const { session, tools } = page(`<button>Save</button>`, { rules: async () => JAILED_AGENT });
  const mind = context(JAILED_AGENT);
  expect(await lendPageTools(mind, "jonas", session)).toMatch(/jailed/);
  expect([...mind.lent]).toEqual([]);
  expect(await refusal(() => tools.getByRole("button").click())).toMatch(/jailed/);
});

test("a context that became jailed after the lend refuses the next call and loses the lend", async () => {
  let rows = ORDINARY;
  const { session, tools } = page(`<button>Save</button>`, { rules: async () => rows });
  const mind = context(ORDINARY);
  expect(await lendPageTools(mind, "jonas", session)).toBeNull();
  const saves = vi.fn();
  document.querySelector("main button")!.addEventListener("click", saves);
  await tools.getByRole("button", { name: "Save" }).click();
  rows = JAILED_AGENT;
  expect(await refusal(() => tools.getByRole("button", { name: "Save" }).click())).toMatch(
    /jailed/,
  );
  expect([...mind.lent]).toEqual([]);
  rows = ORDINARY;
  expect(await refusal(() => tools.getByRole("button", { name: "Save" }).click())).toMatch(
    /jailed/,
  );
  expect(saves).toHaveBeenCalledTimes(1);
});

test("each lend has a long name of its own; a lend that ended runs nothing, and a session that stopped before its lend landed ends it at once", async () => {
  const mind = context(ORDINARY);
  const { session, tools } = page(`<input aria-label="Name" id="name" />`);
  await lendPageTools(mind, "jonas", session);
  await lendPageTools(mind, "jonas", page("").session);
  expect(mind.lent.every((name) => /^itx\.page\.jonas\.[a-z2-7]{12}$/.test(name))).toBe(true);
  expect([...new Set(mind.lent)]).toHaveLength(2);

  // the page left the agent: the kernel is told, and a call that still arrives does nothing
  const [first] = mind.lent;
  session.stop("this tab's lend ended");
  expect(mind.lent.includes(first!)).toBe(false);
  document.body.innerHTML = `<main data-page-tools="scope"><input aria-label="Name" id="name" /></main>`;
  expect(await refusal(() => tools.getByLabel("Name").fill("late"))).toBe("this tab's lend ended");
  expect([field("name").value]).toEqual([""]);

  const early = page("").session;
  early.stop("gone before the lend");
  const before = mind.lent.length;
  await lendPageTools(mind, "jonas", early);
  expect(mind.lent.length).toBe(before);
});

test("Stop pressed while a call is being admitted stops that call", async () => {
  let answerRules = (_rows: RuleRow[]) => {};
  const { session, tools } = page(`<button>Save</button>`, {
    rules: () => new Promise<RuleRow[]>((resolve) => (answerRules = resolve)),
  });
  const saves = vi.fn();
  document.querySelector("main button")!.addEventListener("click", saves);
  const call = refusal(() => tools.getByRole("button").click());
  await vi.waitFor(() => expect(answerRules.length).toBe(1));
  session.stop("the person pressed Stop");
  answerRules(ORDINARY);
  expect(await call).toBe("the person pressed Stop");
  expect(saves).not.toHaveBeenCalled();
});

test("fields for a password, a code or a card, hidden and file inputs, the parts a host keeps back and what is outside the scope never match: to count as to every act", async () => {
  const { tools, audit } = page(`
    <input id="a" type="password" value="s3cret" />
    <input id="b" autocomplete="one-time-code" />
    <input id="c" autocomplete="section-pay cc-number" />
    <input id="d" type="file" />
    <input id="e" type="hidden" value="s3cret" />
    <div data-page-tools="off"><input id="g" /><button id="h">Sign out</button></div>
    <p id="words">Shown <span data-page-tools="off">kept back</span> also shown</p>
  `);
  const absent = /no match \(a part the page keeps back.*never match\)$/;
  for (const id of ["a", "b", "c", "d", "e", "g", "h", "outside", "nothing-has-this-id"]) {
    expect(await tools.locator(`#${id}`).count(), id).toBe(0);
    expect(await refusal(() => tools.locator(`#${id}`).click({ timeout: 20 })), id).toMatch(absent);
  }
  expect(await refusal(() => tools.locator("#a").fill("x", { timeout: 20 }))).toMatch(absent);
  expect(await refusal(() => tools.locator("#h").textContent({ timeout: 20 }))).toMatch(absent);
  // a selector on a kept value answers as one that matches nothing
  expect(await tools.locator('input[value^="s3"]').count()).toBe(0);
  expect(await tools.locator('input[value^="zz"]').count()).toBe(0);
  expect(["a", "b", "c", "g"].map((id) => field(id).value)).toEqual(["s3cret", "", "", ""]);
  expect(await tools.locator("#words").textContent()).toBe("Shown  also shown");
  // the scope's own element is no match either way, and a selector of another engine is none
  expect(await tools.locator("button").count()).toBe(0);
  expect(await refusal(() => tools.locator("xpath=..").count())).not.toBe("no refusal");
  expect(await refusal(() => tools.locator("main >> xpath=..").count())).toMatch(
    /one CSS selector/,
  );
  expect(await refusal(() => tools.getByRole("button] >> xpath=..").count())).toMatch(
    /one lowercase word/,
  );
  expect(audit.filter((call) => call.outcome === "refused")).toEqual([]);
});

test("a click or a key that leads to another origin, or to sign-in or sign-out, is stopped before the page hears it: by a link, a form, or a handler that submits a form later", async () => {
  const { session, tools, audit } = page(`
    <a id="approvals" href="https://iterate.example.com/secrets/approvals"><span>Approvals</span></a>
    <a id="login" href="/.auth/login?scope=openid">Sign in</a>
    <a id="script" href="javascript:alert(1)">Run</a>
    <a id="here" href="/secrets">Secrets</a>
    <form action="https://other.example.com/post"><button id="send">Send</button></form>
    <form id="elsewhere" action="https://other.example.com/post"></form>
    <button id="by-attribute" form="elsewhere">Post</button>
    <form action="/notes"><button id="by-formaction" formaction="/.auth/logout">Out</button><button id="plain">Save</button></form>
    <form id="hidden-logout" method="post" action="/.auth/logout?mind=example.com" hidden></form>
    <button id="menu-item" type="button">Sign out</button>
    <button id="late-item" type="button">Sign out later</button>
  `);
  // every submit and every click on a link that reaches the page's own handlers
  const heard: string[] = [];
  document.querySelector("main")!.addEventListener("submit", (event) => {
    event.preventDefault();
    heard.push(`submit ${(event.target as HTMLFormElement).getAttribute("action")}`);
  });
  for (const link of document.querySelectorAll("main a"))
    link.addEventListener("click", (event) => {
      event.preventDefault();
      heard.push(`click ${link.id}`);
    });
  // the shell's Sign out: a menu item whose handler submits a hidden form, at once or after a wait
  const logout = document.querySelector<HTMLFormElement>("#hidden-logout")!;
  document.getElementById("menu-item")!.addEventListener("click", () => logout.requestSubmit());
  document
    .getElementById("late-item")!
    .addEventListener("click", () => void setTimeout(() => logout.requestSubmit(), 30));

  const away = /another site/;
  const platform = /platform's own page/;
  const click = (id: string) => refusal(() => tools.locator(`#${id}`).click());
  expect(await refusal(() => tools.getByText("Approvals").click())).toMatch(away);
  expect(await click("login")).toMatch(platform);
  expect(await click("script")).toMatch(away);
  expect(await click("send")).toMatch(away);
  expect(await click("by-attribute")).toMatch(away);
  expect(await click("by-formaction")).toMatch(platform);
  expect(await click("menu-item")).toMatch(platform);
  expect(heard).toEqual([]);
  // a handler that submits after the click returned: stopped too, and written down as a refusal
  expect(await click("late-item")).toBe("no refusal");
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(heard).toEqual([]);
  expect(audit.slice(-2)).toEqual([
    { tool: "click", locator: "css=#late-item", outcome: "done" },
    { tool: "click", locator: "css=#late-item", outcome: "refused" },
  ]);
  // a link and a form of the app itself are the page's to handle
  expect([await click("here"), await click("plain")]).toEqual(["no refusal", "no refusal"]);
  expect(heard).toEqual(["click here", "submit /notes"]);

  expect(refusalOf("/secrets")).toBeNull();
  expect(refusalOf("/.iterate/sign-out")).toMatch(platform);
  expect(await refusal(() => tools.open("/.auth/login"))).toMatch(platform);
  await tools.locator("#approvals").highlight();
  expect(session.get().highlights.map((mark) => mark.note)).toEqual(["Helper points here"]);
});

test("a click's watch outlives the lend: a Sign out that submits 300 ms later, as the shell's does, is stopped though the lend ended meanwhile", async () => {
  const { session, tools, audit } = page(`
    <form id="logout" method="post" action="/.auth/logout?mind=example.com" hidden></form>
    <button id="item" type="button">Sign out</button>
  `);
  const heard: string[] = [];
  const logout = document.querySelector<HTMLFormElement>("#logout")!;
  logout.addEventListener("submit", (event) => {
    event.preventDefault();
    heard.push("submit");
  });
  // the shell waits for its saved rows' wipe, at most 300 ms, and then submits
  document
    .getElementById("item")!
    .addEventListener("click", () => void setTimeout(() => logout.requestSubmit(), 300));
  await tools.locator("#item").click();
  // the caller's next call takes the page to another agent, which ends this lend
  session.stop("this tab's lend ended");
  await session.settled();
  expect(heard).toEqual([]);
  expect(audit).toEqual([
    { tool: "click", locator: "css=#item", outcome: "done" },
    { tool: "click", locator: "css=#item", outcome: "refused" },
  ]);
  // once the window has ended, the person's own Sign out goes through
  await new Promise((resolve) => setTimeout(resolve, 30));
  logout.requestSubmit();
  expect(heard).toEqual(["submit"]);
});

test("an act that waited for its element reads the tab again right before it acts", async () => {
  const { tools } = page(`<p>Not there yet</p>`);
  const saves = vi.fn();
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const call = refusal(() => tools.getByRole("button", { name: "Save" }).click({ timeout: 2_000 }));
  await new Promise((resolve) => setTimeout(resolve, 120));
  // the person looks away, and then the button comes
  visibility.mockReturnValue("hidden");
  const button = document.querySelector("main")!.appendChild(document.createElement("button"));
  button.textContent = "Save";
  button.addEventListener("click", saves);
  expect(await call).toMatch(/in the background, so they would not see this/);
  expect(saves).not.toHaveBeenCalled();
});

test("a locator's options are of their own keys and types: none starts a part of another engine", async () => {
  const { tools } = page(`<h1>Title</h1>`);
  expect(await tools.getByRole("heading", { level: 1 }).count()).toBe(1);
  // the engine writes `level` into its selector as it is: this one would close the role's part
  // and start an xpath part that walks out of the scope
  for (const options of [
    { level: "1] >> xpath=..//*[1" },
    { checked: "true] >> xpath=..//*[1" },
    { includeHidden: "true] >> xpath=..//*[1" },
    { bogus: true },
  ])
    expect(
      // what an agent's script sends is not held by a type
      await refusal(() => tools.getByRole("heading", options as never).count()),
      JSON.stringify(options),
    ).toMatch(/^getByRole's options: /);
  expect(await refusal(() => tools.getByText("Title", { exact: "yes" } as never).count())).toMatch(
    /^getByText's options: /,
  );
  // a name is text, which the engine quotes
  expect(await tools.getByRole("heading", { name: 'x"] >> xpath=..' }).count()).toBe(0);
});

test("no act runs while the person's tab is in the background", async () => {
  const { tools, audit } = page(`<button>Save</button>`);
  const saves = vi.fn();
  document.querySelector("main button")!.addEventListener("click", saves);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  const background = /in the background, so they would not see this/;
  expect(await refusal(() => tools.getByRole("button").click())).toMatch(background);
  expect(await refusal(() => tools.banner.show({ title: "Look" }))).toMatch(background);
  expect(await refusal(() => tools.open("/agents"))).toMatch(background);
  expect(saves).not.toHaveBeenCalled();
  expect(audit.map((call) => call.outcome)).toEqual(["refused", "refused", "refused"]);
});

test("a page that marked no part of itself gives the banner and open alone", async () => {
  const { tools, opened } = page("", { scope: () => null });
  expect(await refusal(() => tools.locator("button").count())).toMatch(/marked no part/);
  await tools.open("/secrets?view=1");
  expect(opened).toEqual(["/secrets?view=1"]);
});

test("one lend takes a bounded number of calls, banners, characters and rows, and says so in words", async () => {
  const { session, tools, opened, audit } = page(`<input id="name" />`);
  expect(await refusal(() => tools.locator("#name").fill("x".repeat(LIMITS.fill + 1)))).toMatch(
    /at most 10000 characters/,
  );
  expect(await refusal(() => tools.banner.show({ title: "x".repeat(LIMITS.title + 1) }))).toMatch(
    /at most 120 characters/,
  );
  expect(await refusal(() => tools.locator("x".repeat(LIMITS.part + 1)).count())).toMatch(
    /at most 200 characters/,
  );
  expect(
    await refusal(() => {
      let locator = tools.locator("div");
      for (let part = 0; part < LIMITS.parts; part++) locator = locator.locator("div");
      return locator.count();
    }),
  ).toMatch(/at most 8 parts/);
  expect(await refusal(() => tools.open("https://iterate.example.com/keys"))).toMatch(
    /a path of this app/,
  );
  expect(await refusal(() => tools.open("//iterate.example.com/keys"))).toMatch(
    /a path of this app/,
  );
  // a long locator is cut in its row
  let long = tools.locator(`div.${"y".repeat(150)}`);
  for (let part = 1; part < 4; part++) long = long.locator(`div.${"y".repeat(150)}`);
  expect(await long.count()).toBe(0);
  expect(audit.at(-1)?.locator).toHaveLength(LIMITS.written);
  expect(audit.every((call) => (call.locator || "").length <= LIMITS.written)).toBe(true);
  expect(audit.every((call) => call.outcome === "refused" || call.tool === "count")).toBe(true);

  // one banner shows and three wait; the next is refused
  const answers = Array.from({ length: 1 + BANNERS_WAITING }, (_, at) =>
    tools.banner.show({ title: `Banner ${at}`, buttons: [{ label: "Go", open: "/agents" }] }),
  );
  await vi.waitFor(() => expect(session.get().banner?.title).toBe("Banner 0"));
  expect(await refusal(() => tools.banner.show({ title: "One more" }))).toMatch(
    /3 banners already wait/,
  );
  session.answerBanner("Go");
  expect(await answers[0]).toEqual({ pressed: "Go" });
  expect(opened).toEqual(["/agents"]);
  expect(session.get().banner?.title).toBe("Banner 1");
  session.stop("stopped");
  expect(await Promise.all(answers.slice(1))).toEqual(
    Array.from({ length: BANNERS_WAITING }, () => ({ pressed: null, why: "off" })),
  );

  // a call over the rate is refused and writes no row
  const many = page(`<p>Words</p>`);
  for (let call = 0; call < CALLS_PER_WINDOW; call++) await many.tools.locator("p").count();
  for (let call = 0; call < 5; call++)
    expect(await refusal(() => many.tools.locator("p").count())).toBe(
      "this tab takes at most 30 calls in 10 seconds: wait, then call again",
    );
  expect(many.audit).toHaveLength(CALLS_PER_WINDOW);
});

test("the lent name's description is one line that the kernel takes, and help() says the rest", async () => {
  const { session, tools, audit } = page("", {
    person: `${"a".repeat(200)}@example.com`,
    tools: { evaluate: { description: "evaluate(code) runs code in the page.", run: () => 1 } },
  });
  // core's rule for a rewrite rule's description: one line of at most 500 characters
  expect(session.description.length).toBeLessThanOrEqual(500);
  expect(session.description).not.toContain("\n");
  expect(session.description).toContain("And 1 of the page's own. help() says");
  expect(tools.help()).toContain("evaluate: evaluate(code) runs code in the page.");
  expect(audit).toEqual([]);
});

test("a person's part of the lent name is letters and digits", () => {
  expect(personSegment({ actor: "usr_1", email: "Jonas.T+x@example.com" })).toBe("jonastx");
  expect(personSegment({ actor: "usr_1" })).toBe("usr1");
});

/** The kernel's implicit rows of a context nobody restricted, at depth 0. */
const ORDINARY: RuleRow[] = [
  "whoami",
  "append",
  "appendOffsets",
  "abort",
  "newVersion",
  "readEvents",
  "waitForEvent",
  "cd",
  "facets",
  "subscriptions",
  "processors",
  "schedules",
  "rewriteRules",
  "rpcStubs",
  "workers",
  "run",
  "url",
].map((name) => ({ match: `itx.${name}`, target: `itx.builtins.${name}` }));
/** An agent that a mind's config jailed (`jailAgent` of its jail.ts): one row of its own. */
const JAILED_AGENT: RuleRow[] = [
  { match: "itx", target: "itx.builtins.cd('/')" },
  { match: "itx.run", target: "itx.builtins.cd('/jails/outside-callers/aaaa/bbbb').run" },
  ...ORDINARY.filter((row) => row.match !== "itx.run"),
];
/** The jail that its scripts run in (`jailRowsOf`): the bare null, then what it gets back. */
const THE_JAIL: RuleRow[] = [
  { match: "itx", target: null },
  { match: "itx.run", target: "itx.builtins.run" },
  { match: "itx.cd('/agents/a').readEvents", target: "itx.builtins.cd('/agents/a').readEvents" },
];

/** An agent's context that keeps the names lent to it. */
function context(rows: RuleRow[]) {
  const lent: string[] = [];
  return {
    lent,
    rewriteRules: { list: async () => rows },
    provide: async (match: string) => {
      lent.push(match);
      return { [Symbol.dispose]: () => void lent.splice(lent.indexOf(match), 1) };
    },
    append: async () => {},
  } satisfies LendingContext & { lent: string[] };
}

/** A page with `html` in its scope, and one lend's tools for it. */
function page(html: string, host: Partial<PageToolsHost> = {}) {
  // jsdom lays nothing out: every element has a box here, so it counts as visible
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 20));
  Element.prototype.scrollIntoView = () => {};
  document.body.innerHTML = `<main data-page-tools="scope">${html}</main><button id="outside">Outside</button>`;
  const audit: PageToolCall[] = [];
  const opened: string[] = [];
  const session = new PageToolsSession({
    agent: () => "Helper",
    person: "jonas@example.com",
    scope: () => document.querySelector('[data-page-tools="scope"]'),
    open: (path) => void opened.push(path),
    audit: (call) => void audit.push(call),
    rules: async () => ORDINARY,
    ...host,
  });
  return { session, tools: session.target, audit, opened };
}

const field = (id: string) => document.getElementById(id) as HTMLInputElement;
const refusal = (call: () => unknown) =>
  Promise.resolve()
    .then(call)
    .then(
      () => "no refusal",
      (error: Error) => error.message,
    );
