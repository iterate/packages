// @vitest-environment jsdom
// Two of the shell's options: the desktop sidebar's state for a person who has not toggled it, and
// the floating phone header, which the person's moves over the page show and put away. What the
// header looks like at each state is CSS (the pull request's screenshots); this file reads the
// state the CSS reads. And the shell's height, which follows what a phone shows: a keyboard takes
// room, a pinch takes none.
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { AppShell, AppShellPageMenu } from "./app-shell.tsx";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

test.for<{ name: string; sidebarDefaultOpen?: boolean; cookie?: string; state: string }>([
  { name: "by default, with no cookie", state: "expanded" },
  { name: "by default, toggled shut", cookie: "sidebar_state=false", state: "collapsed" },
  { name: "collapsed by default, with no cookie", sidebarDefaultOpen: false, state: "collapsed" },
  {
    name: "collapsed by default, toggled open",
    sidebarDefaultOpen: false,
    cookie: "sidebar_state=true",
    state: "expanded",
  },
  {
    name: "collapsed by default, toggled shut",
    sidebarDefaultOpen: false,
    cookie: "sidebar_state=false",
    state: "collapsed",
  },
])("the desktop sidebar $name is $state", async ({ sidebarDefaultOpen, cookie, state }) => {
  using _shell = await mount({ sidebarDefaultOpen }, { cookie });
  expect(document.querySelector("[data-slot=sidebar]")?.getAttribute("data-state")).toBe(state);
});

test.for<{ name: string; then: { height: number; scale: number }; shown: boolean; height: string }>(
  [
    // the keyboard's 300 px come back: 577.39 px of a page pinched to 1.15 are 664 of its own
    {
      name: "the keyboard goes while the page is pinched",
      then: { height: 577.39, scale: 1.15 },
      shown: false,
      height: "664px",
    },
    { name: "the keyboard goes", then: { height: 664, scale: 1 }, shown: false, height: "664px" },
    {
      name: "a pinch comes while the keyboard is in",
      then: { height: 316.52, scale: 1.15 },
      shown: false,
      height: "364px",
    },
    // no resize came (the keyboard went while the page was hidden): the height is taken again
    {
      name: "the page is shown again with the keyboard gone",
      then: { height: 664, scale: 1 },
      shown: true,
      height: "664px",
    },
  ],
)(
  "the shell is as high as what a phone shows, when $name: $height",
  async ({ then, shown, height }) => {
    const viewport = Object.assign(new EventTarget(), { height: 664, scale: 1 });
    vi.stubGlobal("visualViewport", viewport);
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    using _shell = await mount({}, {});
    const shellHeight = () => document.documentElement.style.getPropertyValue("--app-height");
    // the keyboard comes: a shorter visual viewport
    Object.assign(viewport, { height: 364 });
    viewport.dispatchEvent(new Event("resize"));
    expect(shellHeight()).toBe("364px");
    Object.assign(viewport, then);
    if (shown) document.dispatchEvent(new Event("visibilitychange"));
    else viewport.dispatchEvent(new Event("resize"));
    expect(shellHeight()).toBe(height);
    document.documentElement.style.removeProperty("--app-height");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  },
);

test("a floating header goes as a finger takes a long page down, and comes back on a pull", async () => {
  using shell = await mount({ phoneHeader: "floating" }, { feedScrolls: true });
  expect(shell.header()).toBe("shown");
  touch(shell.feed, [300, 290]);
  expect(shell.header()).toBe("shown"); // ten pixels: not yet a move
  touch(shell.feed, [300, 260]);
  expect(shell.header()).toBe("hidden");
  touch(shell.feed, [300, 340]);
  expect(shell.header()).toBe("shown");
  // sideways, as across a wide table: no move up or down
  touch(shell.feed, [300, 270], { sideways: 120 });
  expect(shell.header()).toBe("shown");
});

test("a floating header stays on a page that cannot scroll, where a finger going up moves nothing", async () => {
  using shell = await mount({ phoneHeader: "floating" }, { feedScrolls: false });
  touch(shell.feed, [300, 200]);
  expect(shell.header()).toBe("shown");
});

test("at the end of a long page, a finger going up leaves the floating header as it was", async () => {
  using shell = await mount({ phoneHeader: "floating" }, { feedScrolls: true });
  shell.feed.scrollTop = 1_400;
  touch(shell.feed, [300, 200]);
  expect(shell.header()).toBe("shown");
  shell.feed.scrollTop = 0;
  touch(shell.feed, [300, 200]);
  shell.feed.scrollTop = 1_400;
  touch(shell.feed, [300, 200]);
  expect(shell.header()).toBe("hidden");
});

test("a wheel moves a floating header as a finger does, once its deltas one way add up", async () => {
  using shell = await mount({ phoneHeader: "floating" }, { feedScrolls: true });
  wheel(shell.feed, [8, 8]);
  expect(shell.header()).toBe("hidden");
  // a trackpad's last nudge back is no turn
  wheel(shell.feed, [-4, 6, -6]);
  expect(shell.header()).toBe("hidden");
  wheel(shell.feed, [-10, -10]);
  expect(shell.header()).toBe("shown");
});

test("a floating header put away on one page shows again on the next", async () => {
  using shell = await mount({ phoneHeader: "floating" }, { feedScrolls: true });
  touch(shell.feed, [300, 200]);
  expect(shell.header()).toBe("hidden");
  await shell.render({ phoneHeader: "floating", locationKey: "/minds" });
  expect(shell.header()).toBe("shown");
});

test("Sign out wipes the saved rows, then posts the form that ends the sign-in", async () => {
  const browser = new IDBFactory();
  vi.stubGlobal("indexedDB", browser);
  const wipe = vi.spyOn(browser, "deleteDatabase");
  const submit = vi.spyOn(HTMLFormElement.prototype, "requestSubmit").mockImplementation(() => {});
  using _shell = await mount(
    { mind: "example.com", account: { actor: "/members/a", email: "jo@example.com" } },
    {},
  );
  const account = document.querySelector<HTMLElement>('[aria-label="Account"]')!;
  await act(async () => {
    account.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    account.click();
  });
  const signOut = [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find((item) =>
    item.textContent?.includes("Sign out of example.com"),
  )!;
  await act(async () => signOut.click());
  await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  expect(wipe).toHaveBeenCalledTimes(1);
  expect(wipe.mock.invocationCallOrder[0]).toBeLessThan(submit.mock.invocationCallOrder[0]!);
});

test("the header row, the default, has no state to show or hide", async () => {
  using shell = await mount({}, { feedScrolls: true });
  touch(shell.feed, [300, 200]);
  expect(shell.header()).toBeUndefined();
});

test("AccountMenu shows the email once on the trigger and not again in the expanded menu; in the icon rail the menu labels it once", async () => {
  const openAccountMenu = async () => {
    const account = document.querySelector<HTMLElement>('[aria-label="Account"]')!;
    await act(async () => {
      account.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
      account.click();
    });
    return account;
  };
  {
    using _shell = await mount(
      { mind: "iterate.example.com", account: { actor: "/members/a", email: "jo@example.com" } },
      {},
    );
    const account = await openAccountMenu();
    expect(account).toMatchObject({ textContent: "JOjo@example.com" });
    expect(account.textContent).not.toContain("iterate.example.com");
    const menu = document.querySelector('[role="menu"]');
    expect(menu?.textContent).not.toContain("jo@example.com");
    expect(menu?.textContent).toContain("Sign out of iterate.example.com");
  }
  {
    using _shell = await mount(
      { mind: "iterate.example.com", account: { actor: "/members/a", email: "jo@example.com" } },
      { cookie: "sidebar_state=false" },
    );
    await openAccountMenu();
    const menu = document.querySelector('[role="menu"]');
    expect(menu?.textContent).toContain("jo@example.com");
    expect(menu?.textContent).toContain("Sign out of iterate.example.com");
  }
});

test("AppShellPageMenu omits Search when commandPalette is false", async () => {
  using _shell = await mount(
    {
      commandPalette: false,
      children: (
        <AppShellPageMenu>
          <div role="menuitem">Inspect</div>
        </AppShellPageMenu>
      ),
    },
    {},
  );
  const trigger = document.querySelector<HTMLElement>('[aria-label="More"]')!;
  await act(async () => {
    trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    trigger.click();
  });
  const menu = document.querySelector('[role="menu"]');
  expect(menu?.textContent).toContain("Inspect");
  expect(menu?.textContent).not.toContain("Search");
});

/** The shell over one feed, on a desktop-wide jsdom window: the sidebar asks the viewport's width,
 *  and the switcher this host's minds. `feedScrolls` gives the feed 2,000 pixels in a view of 600
 *  (jsdom lays nothing out). `cookie` is the sidebar's, cleared again on disposal. `render` draws
 *  the shell again with other props, as a navigation does. */
async function mount(
  props: Partial<ComponentProps<typeof AppShell>>,
  { cookie, feedScrolls = false }: { cookie?: string; feedScrolls?: boolean },
) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal("fetch", async () => Response.json({ minds: [], lastUsed: null }));
  if (cookie) document.cookie = `${cookie}; path=/`;
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const render = ({ children, ...drawn }: Partial<ComponentProps<typeof AppShell>>) =>
    act(async () =>
      root.render(
        <AppShell
          app="Cloud"
          mind={null}
          mindHref={() => "/"}
          account={false}
          locationKey="/"
          {...drawn}
        >
          {children}
          <div data-testid="feed" style={{ overflowY: "auto" }}>
            <p>a row</p>
          </div>
        </AppShell>,
      ),
    );
  await render(props);
  const feed = host.querySelector<HTMLElement>("[data-testid=feed]")!;
  Object.defineProperty(feed, "clientHeight", { value: 600 });
  Object.defineProperty(feed, "scrollHeight", { value: feedScrolls ? 2_000 : 600 });
  return {
    feed,
    render,
    header: () => host.querySelector<HTMLElement>("[data-slot=sidebar-inset]")?.dataset.phoneHeader,
    [Symbol.dispose]: () => {
      act(() => root.unmount());
      host.remove();
      document.cookie = "sidebar_state=; path=/; max-age=0";
    },
  };
}

/** A finger on `target` from the first height to the last, through each between; `sideways` moves
 *  it that far across as well. */
function touch(target: Element, ys: number[], { sideways = 0 } = {}) {
  ys.forEach((y, at) => {
    const event = new Event(at === 0 ? "touchstart" : "touchmove", { bubbles: true });
    const x = 100 + (at === 0 ? 0 : sideways);
    Object.defineProperty(event, "touches", { value: [{ clientX: x, clientY: y }] });
    act(() => target.dispatchEvent(event));
  });
}

/** Wheel events on `target`, each with its delta. */
function wheel(target: Element, deltas: number[]) {
  for (const deltaY of deltas)
    act(() => target.dispatchEvent(new WheelEvent("wheel", { deltaY, bubbles: true })));
}
