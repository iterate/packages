// @vitest-environment jsdom
// Two of the shell's options: the desktop sidebar's state for a person who has not toggled it, and
// the floating phone header, which the person's moves over the page show and put away. What the
// header looks like at each state is CSS (the pull request's screenshots); this file reads the
// state the CSS reads.
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { AppShell } from "./app-shell.tsx";

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

test("the header row, the default, has no state to show or hide", async () => {
  using shell = await mount({}, { feedScrolls: true });
  touch(shell.feed, [300, 200]);
  expect(shell.header()).toBeUndefined();
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
  const render = (drawn: Partial<ComponentProps<typeof AppShell>>) =>
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
