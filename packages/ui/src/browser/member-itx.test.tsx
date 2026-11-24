// @vitest-environment jsdom
// The member's itx on a mind's own host, over a socket that closes: a new session is dialled and
// the page stays. Only the end of the sign-in reloads it. A Dash's agent view keeps its rows and
// subscribes again, and a Dash mounts anew a page that cannot. The sockets are fakes; behind each
// one is a capnweb session to a small mind.
import { act, Suspense, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, onTestFinished, test, vi } from "vitest";
import { newWebSocketRpcSession, RpcTarget } from "capnweb";
import { IDBFactory } from "fake-indexeddb";
import { BotIcon } from "lucide-react";
import { useContextStub, useIterateContext } from "iterate/react";
import { connectMemberItx, mayReload } from "./member-itx.ts";
import { DashAgents } from "#/agent-kind-view/dash-agents.tsx";
import { DashContexts } from "#/components/dash/dash.tsx";
import { AppShell } from "#/components/app-shell.tsx";
import { Dash, type DashPage, type DashPageProps } from "#/components/dash/dash.tsx";
import { ReconnectingMark } from "#/components/reconnecting-mark.tsx";
import { agentRowsOf } from "#/lib/agent-summary.ts";
import { itxSessionOf } from "#/lib/itx-session.ts";
import { liveState, said, type LoggedEvent } from "#/test-support/agent-log.ts";

// React's flag for a test that wraps its changes in `act`: a global that no type declares.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("a socket that closes with 1006 is dialled again: no reload, the same itx calls through the new session, and the epoch grows", async () => {
  using _clock = clock();
  const net = network();
  const { itx, session, reload } = member(net);
  expect(await itx.whoami()).toMatchObject({ principal: { actor: "/members/a" } });
  expect(session.get()).toEqual({ epoch: 1, state: "open" });
  net.drop(1006);
  // asked while the new session's socket is not open yet: the call waits for it
  expect(session.get()).toEqual({ epoch: 1, state: "opening" });
  expect(await itx.whoami()).toMatchObject({ principal: { actor: "/members/a" } });
  expect(session.get()).toEqual({ epoch: 2, state: "open" });
  expect(net.sockets).toHaveLength(2);
  expect(reload).not.toHaveBeenCalled();
});

test.for([
  { name: "is still connecting", open: false },
  { name: "has opened already", open: true },
])(
  "a socket that the page dialled before the app loaded, and that $name, is the first session's: no other is dialled, and it is replaced like any other when it closes",
  async ({ open }) => {
    using _clock = clock();
    const net = network();
    const early = new net.WebSocket("ws://dash.example.com/itx");
    // a dial opens a moment after it was made
    if (open) await vi.advanceTimersByTimeAsync(0);
    // 0 is connecting and 1 is open (a plain number: a socket in a failed `expect` is printed whole)
    const state = early.readyState;
    expect(state).toBe(open ? 1 : 0);
    const { itx, session, reload } = member(net, null, early);
    expect(await itx.whoami()).toMatchObject({ principal: { actor: "/members/a" } });
    expect(session.get()).toEqual({ epoch: 1, state: "open" });
    expect(net.sockets).toHaveLength(1);
    net.drop(1006);
    expect(await itx.whoami()).toMatchObject({ principal: { actor: "/members/a" } });
    expect(session.get()).toEqual({ epoch: 2, state: "open" });
    expect(net.sockets).toHaveLength(2);
    expect(reload).not.toHaveBeenCalled();
  },
);

test("an early socket that closed before the app loaded is not taken, and one that fails after is dialled again as any first dial", async () => {
  using _clock = clock();
  // closed already: the app dials at once
  const gone = network();
  gone.up = false;
  const closed = new gone.WebSocket("ws://dash.example.com/itx");
  await vi.advanceTimersByTimeAsync(0);
  const state = closed.readyState;
  expect(state).toBe(3);
  gone.up = true;
  const first = member(gone, null, closed);
  expect(await first.itx.whoami()).toMatchObject({ principal: { actor: "/members/a" } });
  expect(gone.sockets).toHaveLength(2);
  expect(first.session.get()).toEqual({ epoch: 1, state: "open" });
  // still connecting when the app takes it, and then refused: the next dial comes after 250 ms
  const failing = network();
  failing.up = false;
  const second = member(failing, null, new failing.WebSocket("ws://dash.example.com/itx"));
  await vi.advanceTimersByTimeAsync(0);
  failing.up = true;
  expect(failing.sockets).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(250);
  expect(await second.itx.whoami()).toMatchObject({ principal: { actor: "/members/a" } });
  expect(failing.sockets).toHaveLength(2);
  expect(second.session.get()).toEqual({ epoch: 1, state: "open" });
  expect(second.reload).not.toHaveBeenCalled();
});

test("the sign-in ended (1008): the saved rows are wiped, then the page reloads and dials nothing; the fourth time in a minute it says so", async () => {
  using _clock = clock();
  const root = { textContent: "the app" };
  const browser = new IDBFactory();
  vi.stubGlobal("indexedDB", browser);
  const wipe = vi.spyOn(browser, "deleteDatabase");
  for (let time = 1; time <= 4; time += 1) {
    const net = network();
    const { itx, reload } = member(net, root);
    await itx.whoami();
    net.drop(1008);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(net.sockets).toHaveLength(1);
    expect(reload).toHaveBeenCalledTimes(time < 4 ? 1 : 0);
    // the next member of this browser sees none of the saved rows: the wipe came first
    expect(wipe).toHaveBeenCalledTimes(time);
    if (time < 4)
      expect(wipe.mock.invocationCallOrder.at(-1)).toBeLessThan(
        reload.mock.invocationCallOrder[0]!,
      );
  }
  expect(root).toMatchObject({ textContent: "Your sign-in ended. Reload the page to sign in." });
});

test("three closes in a row: no reload, and the page says that it reconnects only after two seconds without a session", async () => {
  using _clock = clock();
  const net = network();
  const { itx, session, reload } = member(net);
  await itx.whoami();
  // the first: the mind is away for a while
  net.up = false;
  net.drop(1006);
  await vi.advanceTimersByTimeAsync(1_999);
  expect(session.get()).toEqual({ epoch: 1, state: "opening" });
  await vi.advanceTimersByTimeAsync(1);
  expect(session.get()).toEqual({ epoch: 1, state: "reconnecting" });
  // dialled at once and after 250, 500 and 1,000 ms; the next dial, 2 s later, finds the mind
  expect(net.sockets).toHaveLength(5);
  net.up = true;
  await vi.advanceTimersByTimeAsync(1_750);
  expect(session.get()).toEqual({ epoch: 2, state: "open" });
  // the second and the third: each is over at once, and nothing is said of it
  net.drop(1006);
  await itx.whoami();
  net.drop(1006);
  await itx.whoami();
  expect(session.get()).toEqual({ epoch: 4, state: "open" });
  await vi.advanceTimersByTimeAsync(5_000);
  expect(session.get()).toEqual({ epoch: 4, state: "open" });
  expect(reload).not.toHaveBeenCalled();
});

test("a mind that cannot be reached: the calls that waited are refused after the quick dials, and a slow dial goes on until one opens", async () => {
  using _clock = clock();
  const net = network();
  const { itx, session, reload } = member(net);
  await itx.whoami();
  net.up = false;
  net.drop(1006);
  const asked = itx.whoami().then(
    () => "answered",
    () => "refused",
  );
  // seven dials: at once, then after 250, 500, 1,000, 2,000, 4,000 and 8,000 ms
  await vi.advanceTimersByTimeAsync(15_749);
  expect(session.get()).toEqual({ epoch: 1, state: "reconnecting" });
  await vi.advanceTimersByTimeAsync(1);
  expect(net.sockets).toHaveLength(8);
  expect(await asked).toBe("refused");
  expect(session.get()).toEqual({ epoch: 1, state: "unreachable" });
  // one dial every 15 s from here
  await vi.advanceTimersByTimeAsync(15_000);
  expect(net.sockets).toHaveLength(9);
  expect(session.get()).toEqual({ epoch: 1, state: "unreachable" });
  net.up = true;
  await vi.advanceTimersByTimeAsync(15_000);
  expect(session.get()).toEqual({ epoch: 2, state: "open" });
  expect(await itx.whoami()).toMatchObject({ principal: { actor: "/members/a" } });
  expect(reload).not.toHaveBeenCalled();
});

test("a network that comes back dials at once, not at the slow dial's time", async () => {
  using _clock = clock();
  const net = network();
  const { itx, session } = member(net);
  await itx.whoami();
  net.up = false;
  net.drop(1006);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(session.get()).toEqual({ epoch: 1, state: "unreachable" });
  net.up = true;
  dispatchEvent(new Event("online"));
  await itx.whoami();
  expect(session.get()).toEqual({ epoch: 2, state: "open" });
});

test("an open session that leaves a heartbeat unanswered for 15 s is replaced", async () => {
  using _clock = clock();
  const net = network();
  const { itx, session, reload } = member(net);
  await itx.whoami();
  // the network is gone with no close: nothing arrives, and the socket stays open
  net.silent = true;
  await vi.advanceTimersByTimeAsync(30_000 + 14_999);
  expect(net.sockets).toHaveLength(1);
  expect(session.get()).toEqual({ epoch: 1, state: "open" });
  net.silent = false;
  await vi.advanceTimersByTimeAsync(1);
  expect(net.sockets).toHaveLength(2);
  await itx.whoami();
  expect(session.get()).toEqual({ epoch: 2, state: "open" });
  expect(reload).not.toHaveBeenCalled();
});

test("a page that does not read its session says that the mind cannot be reached, and is reloaded when the next session opens", async () => {
  using _clock = clock();
  const net = network();
  net.up = false;
  const root = { textContent: "Connecting…" };
  const reload = vi.fn();
  const itx = connectMemberItx({ root, url: new URL("ws://dash.example.com/itx"), reload, ...net });
  // the app waits for its first answer before it draws
  const asked = itx.whoami().then(
    () => "answered",
    () => "refused",
  );
  await vi.advanceTimersByTimeAsync(15_750);
  expect(await asked).toBe("refused");
  expect(root).toMatchObject({ textContent: "Cannot reach the mind. Trying again…" });
  expect(reload).not.toHaveBeenCalled();
  net.up = true;
  await vi.advanceTimersByTimeAsync(15_000);
  expect(reload).toHaveBeenCalledTimes(1);
});

test("a page that only draws the mark holds its stubs for one session: it is reloaded when the next one opens", async () => {
  using _clock = clock();
  const net = network();
  const reload = vi.fn();
  const itx = connectMemberItx({
    root: null,
    url: new URL("ws://dash.example.com/itx"),
    reload,
    ...net,
  });
  itxSessionOf(itx).watch(() => {});
  await itx.whoami();
  net.drop(1006);
  await itx.whoami();
  expect(reload).toHaveBeenCalledTimes(1);
});

test("a sign-in that ended while no session was open: an outage alone reloads nothing, and when the host answers 401 over HTTP the page reloads and dials no more", async () => {
  using _clock = clock();
  const net = network();
  const { itx, reload } = member(net);
  await itx.whoami();
  // an outage: no dial opens, and nothing answers over HTTP
  net.up = false;
  net.drop(1006);
  await vi.advanceTimersByTimeAsync(15_750 + 15_000);
  expect(net.asked()).toBe(2);
  expect(reload).not.toHaveBeenCalled();
  // the network is back, and the sign-in ended meanwhile: the upgrade is refused, which the
  // socket shows as one more close with 1006
  net.up = true;
  net.signedOut = true;
  await vi.advanceTimersByTimeAsync(15_000);
  expect(reload).toHaveBeenCalledTimes(1);
  const dialled = net.sockets.length;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(net.sockets).toHaveLength(dialled);
});

test("a host that accepts each socket and closes it 50 ms later: the dials keep to the quick waits and then one every 15 s, the epoch grows no faster, the mark does not flicker, and the probe runs", async () => {
  using _clock = clock();
  const net = network();
  const { itx, session, reload } = member(net);
  await itx.whoami();
  const states: string[] = [];
  session.watch(() => {
    const { state } = session.get();
    if (states.at(-1) !== state) states.push(state);
  });
  const dialledAt: number[] = [];
  net.dialled = () => dialledAt.push(Date.now());
  net.acceptThenCloseMs = 50;
  const from = Date.now();
  net.drop(1006);
  await vi.advanceTimersByTimeAsync(60_000);
  // at once, then after 250, 500, 1,000, 2,000, 4,000 and 8,000 ms, then one every 15 s
  expect(dialledAt.map((at) => at - from)).toEqual([
    0, 300, 850, 1_900, 3_950, 8_000, 16_050, 31_100, 46_150,
  ]);
  expect(dialledAt.slice(1).every((at, index) => at - dialledAt[index]! >= 200)).toBe(true);
  // a hook opens again once for each epoch: one for each dial, and no more
  expect(session.get()).toMatchObject({ epoch: 1 + dialledAt.length });
  expect(states).toEqual(["opening", "reconnecting", "unreachable"]);
  // the probe ran when the quick dials were over, and after each slow one
  expect(net.asked()).toBe(3);
  expect(reload).not.toHaveBeenCalled();
});

test("a host that accepts and closes because the sign-in ended: the probe after the quick dials answers 401, and the page reloads and dials no more", async () => {
  using _clock = clock();
  const net = network();
  const { itx, reload } = member(net);
  await itx.whoami();
  net.acceptThenCloseMs = 50;
  net.answers401 = true;
  net.drop(1006);
  await vi.advanceTimersByTimeAsync(16_100);
  expect(net.sockets).toHaveLength(8);
  expect(reload).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(net.sockets).toHaveLength(8);
});

test.each(["refuses", "aborts"] as const)(
  "a host that accepts each socket, %s the first call as an overloaded mind does and closes 50 ms later: the dials keep to the quick waits and then one every 15 s, the session is never open, a call fails to its caller, and the probe runs",
  async (overloaded) => {
    using _clock = clock();
    const net = network();
    const { itx, session, reload } = member(net);
    await itx.whoami();
    const states: string[] = [];
    session.watch(() => {
      const { state } = session.get();
      if (states.at(-1) !== state) states.push(state);
    });
    const dialledAt: number[] = [];
    net.dialled = () => dialledAt.push(Date.now());
    net.acceptThenCloseMs = 50;
    net.overloaded = overloaded;
    const from = Date.now();
    net.drop(1006);
    const asked = itx.whoami().then(
      () => "answered",
      (error: Error) => error.message,
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await asked).toContain("Durable Object is overloaded");
    // an abort ends the session at once, and the page closes the socket; a refusal leaves it to
    // the host's close 50 ms later
    expect(dialledAt.map((at) => at - from)).toEqual(
      overloaded === "aborts"
        ? [0, 250, 750, 1_750, 3_750, 7_750, 15_750, 30_750, 45_750]
        : [0, 300, 850, 1_900, 3_950, 8_000, 16_050, 31_100, 46_150],
    );
    expect(states).toEqual(["opening", "reconnecting", "unreachable"]);
    expect(net.asked()).toBe(3);
    expect(reload).not.toHaveBeenCalled();
  },
);

test("a session that stayed open for 5 s is good, though the host said nothing: when it closes, the next dial is at once", async () => {
  using _clock = clock();
  const net = network();
  const { itx, session } = member(net);
  await itx.whoami();
  net.acceptThenCloseMs = 6_000;
  net.drop(1006);
  await vi.advanceTimersByTimeAsync(4_999);
  expect(session.get()).toEqual({ epoch: 2, state: "reconnecting" });
  await vi.advanceTimersByTimeAsync(1);
  expect(session.get()).toEqual({ epoch: 2, state: "open" });
  // the host answers again from its next socket on
  net.acceptThenCloseMs = undefined;
  await vi.advanceTimersByTimeAsync(1_000);
  // closed at 6 s, and dialled again at once
  expect(net.sockets).toHaveLength(3);
  expect(session.get()).toEqual({ epoch: 3, state: "open" });
});

test("a first socket that opened and is not good yet keeps its epoch when the page says it is reconnecting", async () => {
  using _clock = clock();
  const net = network();
  // the host accepts the first socket and says nothing
  net.acceptThenCloseMs = 6_000;
  const { session } = member(net);
  await vi.advanceTimersByTimeAsync(2_500);
  // the epoch the open gave, never back to zero: what a page holds is not opened a second time
  expect(session.get()).toEqual({ epoch: 1, state: "reconnecting" });
});

test(
  "a Dash page on the SDK's hooks alone is mounted anew at a new session and reads through it; no page is reloaded",
  { timeout: 30_000 },
  async () => {
    const net = network({ "/notes": [said(1, "first note")] });
    const reload = vi.fn();
    const itx = connectMemberItx({
      root: null,
      url: new URL("ws://dash.example.com/itx"),
      reload,
      ...net,
    });
    history.replaceState(null, "", "/notes");
    // as a page's script does before it draws: the first session is open
    await itx.whoami();
    let mounts = 0;
    /** A mind's own page: it holds a context as the SDK's hooks do, for one session. */
    function Notes({ itx: mind }: DashPageProps) {
      const [mount] = useState(() => (mounts += 1));
      const held = useContextStub(() => mind.cd("/notes"), [mind]);
      const log = useIterateContext(held.stub);
      return (
        <p>
          mount {mount}: {log.events.map((event) => JSON.stringify(event.payload)).join(" ")}
        </p>
      );
    }
    const pages: DashPage[] = [{ id: "notes", name: "Notes", icon: BotIcon, component: Notes }];
    stubBrowser();
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    await act(() =>
      root.render(
        <Dash
          app="Dash"
          itx={itx}
          mind="notes.example.com"
          principal={{ actor: "/members/a", email: "jo@example.com" }}
          pages={pages}
          links={[]}
        />,
      ),
    );
    await shows(host, "first note");
    const { opened } = net;
    expect(opened).toEqual(["/notes"]);

    await act(async () => net.drop(1006));
    await until(() => opened.length === 2);
    await act(async () => net.append("/notes", said(2, "second note")));
    await shows(host, "second note");
    expect(host.textContent).toContain("mount 2:");
    expect(opened).toEqual(["/notes", "/notes"]);
    expect(reload).not.toHaveBeenCalled();
    await act(() => root.unmount());
    host.remove();
  },
);

test(
  "the Dash's list of agents over a new session whose catalog does not open: the agents it had read stay",
  { timeout: 30_000 },
  async () => {
    const catalog = {
      agents: {
        "/agents/a": { createdAt: "2026-11-16T12:00:00.000Z", kind: "iterate", title: "Alpha" },
      },
    };
    const net = network({}, { "/agents": catalog });
    const itx = connectMemberItx({ root: null, url: new URL("ws://dash.example.com/itx"), ...net });
    history.replaceState(null, "", "/agents");
    await itx.whoami();
    await using page = await drawDash(itx, "agents.example.com", [
      { id: "agents", name: "Agents", icon: BotIcon, component: Blank },
    ]);
    await shows(page.host, "Alpha");
    const { opened } = net;
    // the next session refuses the catalog, with its socket open
    net.refused.add("/agents");
    await act(async () => net.drop(1006));
    await until(() => opened.length === 2);
    for (let round = 0; round < 10; round += 1)
      await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(opened).toEqual(["/agents", "/agents"]);
    expect(page.host.textContent).toContain("Alpha");
  },
);

test(
  "the Dash's raw view of a context over a cut socket: its rows stay, no alert, and the context is opened once more, from the new session's root",
  { timeout: 30_000 },
  async () => {
    using _layout = laidOut();
    const net = network(
      { "/notes": [said(1, "first words")] },
      { "/": { contexts: { "/notes": {} } } },
    );
    const itx = connectMemberItx({ root: null, url: new URL("ws://dash.example.com/itx"), ...net });
    history.replaceState(null, "", "/contexts/notes");
    await itx.whoami();
    await using page = await drawDash(itx, "contexts.example.com", [
      { id: "contexts", name: "Contexts", icon: BotIcon, component: DashContexts },
    ]);
    // the raw view draws an event as its type, and events of one type in a row as one row
    await shows(page.host, "agent/context-added");
    const { opened } = net;
    expect(opened).toEqual(["/", "/notes"]);
    using seen = watch(page.host, "agent/context-added");

    await act(async () => net.drop(1006));
    await until(() => opened.length === 4);
    // the view subscribed again: what the mind appends now arrives
    await act(async () => net.append("/notes", said(2, "second words")));
    await shows(page.host, "2 events");
    // one root and one shown context for each session: nothing was opened from the root that ended
    expect(opened).toEqual(["/", "/notes", "/", "/notes"]);
    expect(seen.alerts()).toBe(0);
    expect(seen.withoutRows()).toBe(0);
  },
);

test(
  "a Dash's agent view over a cut socket: its rows and its composer stay, no loading words come back, the mark shows after two seconds, and the new session's log is live",
  {
    timeout: 30_000,
  },
  async () => {
    using _layout = laidOut();
    const net = network({ "/agents/a": [said(1, "first words")] });
    const { itx, reload } = member(net);
    history.replaceState(null, "", "/agents/agents/a");
    await using page = await draw(itx);
    await shows(page.host, "first words");
    await shows(page.host, "Idle");
    const composer = page.host.querySelector("form");
    expect(Boolean(composer)).toBe(true);
    // each context the page opened, in order
    const { opened } = net;
    expect(opened).toEqual(["/agents/a"]);
    using seen = watch(page.host);
    const row = wordsOf(page.host, "first words");
    expect(Boolean(row)).toBe(true);

    // a deploy cuts the socket, and the mind is away for longer than the quiet time
    net.up = false;
    await act(async () => net.drop(1006));
    await act(() => new Promise((resolve) => setTimeout(resolve, 1_500)));
    expect(markOf(page.host)).toBe(undefined);
    await shows(page.host, "Reconnecting…");
    expect(markOf(page.host)).toBe("Reconnecting…");
    net.up = true;
    await act(async () => void dispatchEvent(new Event("online")));
    await until(() => opened.length === 2 && !markOf(page.host));
    expect(opened).toEqual(["/agents/a", "/agents/a"]);
    expect(markOf(page.host)).toBe(undefined);

    // the view subscribed again: what the mind appends now arrives
    await act(async () => net.append("/agents/a", said(2, "second words")));
    await shows(page.host, "second words");
    expect(page.host.textContent).toContain("first words");
    expect(seen.withoutRows()).toBe(0);
    expect(seen.words()).toEqual([]);
    // nothing that was drawn is drawn again: the first row is the same element, untouched
    expect(wordsOf(page.host, "first words") === row).toBe(true);
    expect(seen.redrawn()).toBe(0);
    // the same element, so what was typed in it is still there (compared here: a failed `toBe` of
    // two elements prints both, with all that React hangs on them)
    expect(page.host.querySelector("form") === composer).toBe(true);
    expect(reload).not.toHaveBeenCalled();
  },
);

test("three reloads in a minute stop the reloads; a minute later the page may reload again", () => {
  const tab = storage();
  expect([0, 1_000, 2_000, 3_000].map((at) => mayReload(tab, at))).toEqual([
    true,
    true,
    true,
    false,
  ]);
  expect(mayReload(tab, 70_000)).toBe(true);
});

test("storage that cannot be read or holds something else is no reload yet", () => {
  const broken = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {},
  };
  expect(mayReload(broken, 0)).toBe(true);
  const odd = storage();
  odd.setItem("itx-reloads", '{"not":"a list"}');
  expect(mayReload(odd, 0)).toBe(true);
});

/** The test's own clock, and a tab with no reloads behind it; disposing gives the real clock
 *  back. */
function clock() {
  sessionStorage.clear();
  vi.useFakeTimers();
  return { [Symbol.dispose]: () => void vi.useRealTimers() };
}

/** A tab's session storage. */
function storage() {
  const kept = new Map<string, string>();
  return {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
  };
}

/** THE NETWORK AND THE MIND BEHIND IT. `WebSocket` is the constructor a page dials with: a dial
 *  opens while `up`, and else closes with 1006 before it opened. Behind an open socket is a
 *  capnweb session to a mind that holds `logs` by path. `drop` closes the open socket from the
 *  mind's side; `silent` loses what the page sends, with no close. */
function network(logs: Record<string, LoggedEvent[]> = {}, facets: Record<string, object> = {}) {
  const subscribers = new Set<{
    path: string;
    push: (events: LoggedEvent[]) => unknown;
    socket: FakeSocket;
  }>();
  let asked = 0;
  const net = {
    up: true,
    silent: false,
    /** the sign-in ended: the host refuses each upgrade, and answers 401 over HTTP */
    signedOut: false,
    /** the host accepts each upgrade, answers nothing on it, and closes it this long after */
    acceptThenCloseMs: undefined as number | undefined,
    /** with `acceptThenCloseMs`: the host answers each call with a refusal, or its first message
     *  with an abort of the session, as an overloaded mind does */
    overloaded: undefined as "refuses" | "aborts" | undefined,
    /** the host answers 401 over HTTP, whatever it does with an upgrade */
    answers401: false,
    /** called at each dial */
    dialled: () => {},
    /** how often the page asked the host over HTTP whether it is signed in */
    asked: () => asked,
    async fetch() {
      asked += 1;
      if (!net.up) throw new TypeError("Failed to fetch");
      return new Response(null, { status: net.signedOut || net.answers401 ? 401 : 426 });
    },
    sockets: [] as FakeSocket[],
    /** each context a page opened, in order */
    opened: [] as string[],
    /** the contexts that the mind refuses to open */
    refused: new Set<string>(),
    drop(code: number) {
      net.sockets.at(-1)?.end(code);
    },
    append(path: string, event: LoggedEvent) {
      (logs[path] ||= []).push(event);
      for (const one of subscribers) if (one.path === path) void one.push([event]);
    },
    // The members that the page's dial and capnweb's transport use, and no more.
    WebSocket: undefined as unknown as typeof WebSocket,
  };

  class Listed extends RpcTarget {
    #rows: unknown[];
    constructor(rows: unknown[]) {
      super();
      this.#rows = rows;
    }
    list() {
      return this.#rows;
    }
  }
  class Handle extends RpcTarget {
    #release: () => void;
    constructor(release: () => void) {
      super();
      this.#release = release;
    }
    [Symbol.dispose]() {
      this.#release();
    }
  }
  class Context extends RpcTarget {
    #path: string;
    #socket: FakeSocket;
    constructor(path: string, socket: FakeSocket) {
      super();
      this.#path = path;
      this.#socket = socket;
    }
    readEvents(after = 0, limit = 1000) {
      const held = logs[this.#path] || [];
      return {
        events: held.filter((event) => event.offset > after).slice(0, limit),
        atHead: true,
        scannedThroughOffset: held.at(-1)?.offset || 0,
      };
    }
    subscribe(input: {
      consumes?: string[];
      target: { dup(): (events: LoggedEvent[]) => unknown };
    }) {
      const durable = input.consumes?.includes("*");
      // the page's function ends with this call unless the mind keeps a copy of its own
      const subscriber = { path: this.#path, push: input.target.dup(), socket: this.#socket };
      if (durable) subscribers.add(subscriber);
      return new Handle(() => subscribers.delete(subscriber));
    }
    get subscriptions() {
      return new Listed([{ name: "agent", hostedFacet: { name: "agent" } }]);
    }
    get rpcStubs() {
      return new Listed([]);
    }
    invoke(call: string) {
      return call.includes("liveSnapshot")
        ? { rev: 1, state: facets[this.#path] || liveState() }
        : { offset: 0, state: {} };
    }
    cd(path: string) {
      return open(path, this.#socket);
    }
  }
  /** A context, opened from the mind's root or from another context. */
  const open = (path: string, socket: FakeSocket) => {
    net.opened.push(path);
    if (net.refused.has(path)) throw new Error(`${path} is not yours to open`);
    return new Context(path, socket);
  };
  class Kv extends RpcTarget {
    get() {
      return null;
    }
  }
  class Repos extends RpcTarget {
    get() {
      return new Kv();
    }
  }
  class Overloaded extends RpcTarget {
    whoami(): never {
      throw new Error("Durable Object is overloaded");
    }
  }
  // capnweb's abort frame, as the mind's end sends it
  const overloadedAbort = JSON.stringify([
    "abort",
    ["error", "Error", "Durable Object is overloaded"],
  ]);
  class Mind extends RpcTarget {
    #socket: FakeSocket;
    constructor(socket: FakeSocket) {
      super();
      this.#socket = socket;
    }
    whoami() {
      return { principal: { actor: "/members/a", email: "jo@example.com" } };
    }
    get kv() {
      return new Kv();
    }
    get repos() {
      return new Repos();
    }
    get rewriteRules() {
      return new Kv();
    }
    get contexts() {
      return new Listed([]);
    }
    cd(path: string) {
      return open(path, this.#socket);
    }
  }

  /** The page's end of a socket, and with `mind` the mind's end of it. */
  class FakeSocket extends EventTarget {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;
    readyState = FakeSocket.CONNECTING;
    binaryType = "blob";
    mind = Object.assign(new EventTarget(), {
      readyState: FakeSocket.OPEN,
      binaryType: "blob",
      send: (data: unknown) => {
        if (this.readyState === FakeSocket.OPEN && !net.silent)
          queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data })));
      },
      close: () => this.end(1000),
    });
    constructor() {
      super();
      net.sockets.push(this);
      net.dialled();
      queueMicrotask(() => {
        if (this.readyState !== FakeSocket.CONNECTING) return;
        if (!net.up || net.signedOut) return this.end(1006);
        this.readyState = FakeSocket.OPEN;
        if (net.acceptThenCloseMs !== undefined) {
          setTimeout(() => this.end(1006), net.acceptThenCloseMs);
          if (net.overloaded === "refuses")
            newWebSocketRpcSession(this.mind as unknown as WebSocket, new Overloaded());
          if (net.overloaded === "aborts")
            this.mind.addEventListener("message", () => this.mind.send(overloadedAbort), {
              once: true,
            });
          return this.dispatchEvent(new Event("open"));
        }
        // The mind's end has the members that capnweb's transport uses, and no more.
        newWebSocketRpcSession(this.mind as unknown as WebSocket, new Mind(this));
        this.dispatchEvent(new Event("open"));
      });
    }
    send(data: unknown) {
      if (!net.silent)
        queueMicrotask(() => this.mind.dispatchEvent(new MessageEvent("message", { data })));
    }
    close() {
      this.end(1006);
    }
    end(code: number) {
      if (this.readyState === FakeSocket.CLOSED) return;
      this.readyState = FakeSocket.CLOSED;
      for (const one of subscribers) if (one.socket === this) subscribers.delete(one);
      this.mind.dispatchEvent(new CloseEvent("close", { code }));
      this.dispatchEvent(new CloseEvent("close", { code }));
    }
  }
  net.WebSocket = FakeSocket as unknown as typeof WebSocket;
  return net;
}

/** A member's itx over `net`, read by one listener as a drawn page reads it. */
function member(
  net: ReturnType<typeof network>,
  root: { textContent: string } | null = null,
  /** a socket the page dialled before the app loaded */
  early?: WebSocket,
) {
  const reload = vi.fn();
  // A page never takes its listeners off its window, and one jsdom window serves every test of
  // this file. So a member's listeners are taken off when its test ends. Else a later test's
  // "online" has the members of the tests before it dial again, on the real clock, and a socket
  // of theirs can close when the file's window is gone: an error that no test owns.
  const heard = [window, document].map(
    (target) => [target, vi.spyOn(target, "addEventListener")] as const,
  );
  const itx = connectMemberItx({
    root,
    url: new URL("ws://dash.example.com/itx"),
    WebSocket: net.WebSocket,
    early,
    fetch: net.fetch,
    reload,
  });
  for (const [target, spy] of heard) {
    const listeners = [...spy.mock.calls];
    spy.mockRestore();
    onTestFinished(() => {
      for (const [type, listener] of listeners) target.removeEventListener(type, listener);
    });
  }
  const session = itxSessionOf(itx);
  session.subscribe(() => {});
  return { itx, session, reload };
}

/** A page with height, which jsdom lacks, so the virtual log draws its rows; disposing takes it
 *  back. */
function laidOut() {
  const sizes = { clientHeight: 600, offsetHeight: 0 };
  const own = Object.keys(sizes).map(
    (name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)] as const,
  );
  for (const [name, value] of Object.entries(sizes))
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get: () => value });
  return {
    [Symbol.dispose]: () => {
      for (const [name, descriptor] of own)
        if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
    },
  };
}

/** The innermost element that shows exactly `words`. */
function wordsOf(host: HTMLElement, words: string) {
  return [...host.querySelectorAll("[role=log] *")].findLast((one) => one.textContent === words);
}

/** What the page showed at each change of it, from now: how often the first row was gone, which
 *  words of a first load came back, how often the first row's words were drawn again, and how
 *  often it showed an alert. */
function watch(host: HTMLElement, first = "first words") {
  const loading = ["Connecting…", "Reading the log", "Nothing said", "Loading the page…"];
  const found = new Set<string>();
  const row = wordsOf(host, first);
  let withoutRows = 0;
  let redrawn = 0;
  let alerts = 0;
  const observer = new MutationObserver((changes) => {
    if (host.querySelector("[role=alert]")) alerts += 1;
    for (const change of changes)
      if (
        row?.contains(change.target) ||
        [...change.removedNodes].some((gone) => row && gone.contains(row))
      )
        redrawn += 1;
    const text = host.textContent || "";
    if (!text.includes(first)) withoutRows += 1;
    for (const words of loading) if (text.includes(words)) found.add(words);
  });
  observer.observe(host, { childList: true, subtree: true, characterData: true });
  return {
    withoutRows: () => withoutRows,
    redrawn: () => redrawn,
    alerts: () => alerts,
    words: () => [...found],
    [Symbol.dispose]: () => observer.disconnect(),
  };
}

/** What the mark says, when the page shows it. */
function markOf(host: HTMLElement) {
  return host.querySelector("[data-slot=reconnecting-mark]")?.textContent || undefined;
}

/** Lets the page work, 20 ms at a time, until `done` or five seconds are over. Each wait is an
 *  `act` of its own: React draws what a wait brought when its `act` ends. */
async function until(done: () => boolean) {
  for (let round = 0; round < 250 && !done(); round += 1)
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
}

/** Waits until the page shows `words`. */
async function shows(host: HTMLElement, words: string) {
  await until(() => Boolean(host.textContent?.includes(words)));
  expect(host.textContent).toContain(words);
}

/** A page that draws nothing and holds nothing of a session. */
function Blank() {
  return null;
}
Blank.staysOverReconnect = true;

/** A Dash of `pages`, as a mind's own page draws it. */
async function drawDash(itx: DashPageProps["itx"], mind: string, pages: DashPage[]) {
  stubBrowser();
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(() =>
    root.render(
      <Dash
        app="Dash"
        itx={itx}
        mind={mind}
        principal={{ actor: "/members/a", email: "jo@example.com" }}
        pages={pages}
        links={[]}
      />,
    ),
  );
  return {
    host,
    [Symbol.asyncDispose]: async () => {
      await act(() => root.unmount());
      host.remove();
    },
  };
}

/** What the shell asks of a browser and jsdom lacks. */
function stubBrowser() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal("fetch", async () => Response.json({ minds: [], lastUsed: null }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
}

/** The Agents page in the shell, with the mark, as a Dash draws them. */
async function draw(itx: Parameters<typeof DashAgents>[0]["itx"]) {
  stubBrowser();
  const row = (id: string): DashPage => ({ id, name: id, icon: BotIcon, component: () => null });
  const pages = [row("home"), row("agents"), row("contexts")];
  const agents = agentRowsOf({
    agents: { "/agents/a": { createdAt: "2026-11-16T12:00:00.000Z", kind: "iterate", title: "A" } },
  });
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(() =>
    root.render(
      <AppShell app="Dash" mind="example.com" account={null} locationKey="/">
        <Suspense fallback="Loading the page…">
          <DashAgents
            itx={itx}
            mind="example.com"
            principal={{ actor: "/members/a", email: "jo@example.com" }}
            page={pages[1]!}
            pages={pages}
            links={[]}
            catalog={undefined}
            agents={agents}
            waiting={0}
          />
        </Suspense>
        <ReconnectingMark itx={itx} />
      </AppShell>,
    ),
  );
  return {
    host,
    [Symbol.asyncDispose]: async () => {
      await act(() => root.unmount());
      host.remove();
    },
  };
}
