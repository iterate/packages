// @vitest-environment jsdom
import { act, useState, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import {
  ContextStream,
  useWindowedEventPager,
  type ContextStreamActorRef,
  type ContextStreamItem,
  type ContextStreamOpenTarget,
  type OffsetEvent,
} from "./context-stream.ts";

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
});

const JONAS: ContextStreamActorRef = {
  kind: "person",
  id: "u_jonas",
  email: "jonas@nustom.com",
  name: "jonas",
};

const ITERATE: ContextStreamActorRef = {
  kind: "mind",
  id: "iterate.com",
  name: "iterate",
};

const JEEVES: ContextStreamActorRef = {
  kind: "mind",
  id: "jeeves.jonas.com",
  name: "jeeves",
};

test("keeps offsets off the 0-click surface, stacks same-principal messages with individual hover + faint ••• menu, and reveals provenance 1 click deep", async () => {
  const reacted: [number, string][] = [];
  const inspected: number[] = [];
  const items: ContextStreamItem[] = [
    {
      kind: "message",
      key: "m1",
      offset: 80,
      at: Date.parse("2026-11-25T14:38:00Z"),
      by: JONAS,
      text: "First message from Jonas",
    },
    {
      kind: "message",
      key: "m2",
      offset: 81,
      at: Date.parse("2026-11-25T14:38:20Z"),
      by: JONAS,
      text: "Second consecutive message from Jonas",
    },
    {
      kind: "message",
      key: "m3",
      offset: 92,
      at: Date.parse("2026-11-25T14:39:00Z"),
      by: ITERATE,
      text: "Updated both titles and preserved existing ones.",
    },
    {
      kind: "message",
      key: "m4",
      offset: 98,
      at: Date.parse("2026-11-25T14:40:00Z"),
      by: JEEVES,
      text: "Verified from jeeves",
    },
  ];

  using view = mount(
    <ContextStream
      items={items}
      onToggleReaction={(offset, emoji) => reacted.push([offset, emoji])}
      messageMenu={(item) =>
        item.offset === 92
          ? {
              provenance: <span>Events 80..92 · 2 model calls · 18s</span>,
              copyItems: [
                { label: "Copy message text", value: item.text },
                { label: "Copy offset range 80..92", value: "/agents/em#80..92", mono: true },
              ],
              actions: [
                { label: "Inspect full trace", onSelect: () => inspected.push(item.offset) },
              ],
            }
          : undefined
      }
    />,
  );

  // Zero offset numbers appear anywhere on the 0-click normie surface!
  expect(view.container.textContent).not.toContain("80..92");
  expect(view.container.textContent).not.toContain("92");

  const messageRows = [...view.container.querySelectorAll('[data-slot="context-stream-message"]')];
  expect(messageRows.length).toBe(4);
  for (const row of messageRows) {
    expect(row.className).toContain("group/msg");
    expect(row.className).toContain("hover:bg-muted/55");
    expect(row.querySelector('[data-slot="message-more-trigger"]')).toBeTruthy();
  }

  // `m1` starts Jonas's run; `m2` stacks (`data-continues-run="true"`, no avatar, reveals stacked-hover-time on hover).
  expect(messageRows[0]!.getAttribute("data-continues-run")).toBeNull();
  expect(messageRows[1]!.getAttribute("data-continues-run")).toBe("true");
  expect(messageRows[1]!.querySelector('[data-slot="avatar"]')).toBeNull();
  expect(
    messageRows[1]!.querySelector('[data-slot="stacked-hover-time"]')?.textContent,
  ).toBeTruthy();

  // Quick hover reaction on `m2` targets `m2`'s individual offset (`81`).
  act(() => {
    messageRows[1]!
      .querySelector<HTMLButtonElement>('[aria-label="React with thumbs up"]')!
      .click();
  });
  expect(reacted).toEqual([[81, "👍"]]);

  // Clicking the faint right-aligned `•••` on `iterate`'s reply (`m3`) reveals `80..92` 1 level deep!
  await act(async () => {
    messageRows[2]!.querySelector<HTMLButtonElement>('[data-slot="message-more-trigger"]')!.click();
  });
  const menu = document.body.querySelector('[data-slot="message-more-menu"]');
  expect(menu?.textContent).toContain("80..92");
  expect(menu?.textContent).toContain("Copy offset range 80..92");

  const saidByLabels = [...view.container.querySelectorAll("[data-said-by]")].map(
    (el) => el.textContent,
  );
  expect(saidByLabels).toEqual(["jonas", "iterate", "jeeves"]);

  // `jeeves` (`kind: "mind"`) gets `rounded-[22.37%]`; `jonas` (`kind: "person"`) stays circular.
  const jeevesAvatar = view.container
    .querySelector('[data-actor="jeeves.jonas.com"]')!
    .querySelector('[data-slot="avatar"]')!;
  expect(jeevesAvatar.className).toContain("rounded-[22.37%]");
  const jonasAvatar = view.container
    .querySelector('[data-actor="u_jonas"]')!
    .querySelector('[data-slot="avatar"]')!;
  expect(jonasAvatar.className).not.toContain("rounded-[22.37%]");
});

test("renders Slack-style thread bars (`5 replies • Unread`, capped at 2 + overflow) and plugs in 2-layer slots without border-t", () => {
  const opened: ContextStreamOpenTarget[] = [];
  const items: ContextStreamItem[] = [
    {
      kind: "message",
      key: "m100",
      offset: 100,
      at: Date.parse("2026-11-25T12:05:00Z"),
      by: ITERATE,
      text: "Shipped the rollout plan.",
      subcontexts: [
        {
          path: "/agents/rollout/t/100",
          anchor: 100,
          replies: 5,
          unread: true,
          participants: [ITERATE, JONAS],
        },
        {
          path: "/agents/rollout/security-audit",
          anchor: 100,
          title: "security-audit",
          replies: 3,
          participants: [ITERATE],
          last: { offset: 12, at: "2026-11-25T12:05:30Z", by: ITERATE, text: "All checks green" },
        },
        {
          path: "/agents/rollout/perf-bench",
          anchor: 100,
          title: "perf-bench",
          replies: 2,
          participants: [JEEVES],
        },
      ],
    },
    {
      kind: "mcp/widget",
      key: "w120",
      offset: 120,
      at: Date.parse("2026-11-25T12:07:00Z"),
      by: ITERATE,
      span: [105, 120],
      data: { title: "Rollout Plan Widget" },
    },
  ];

  using view = mount(
    <ContextStream
      items={items}
      onOpen={(target) => opened.push(target)}
      rows={{
        "mcp/widget": (item) => (
          <div data-testid="mcp-widget">{(item.data as { title: string }).title}</div>
        ),
      }}
      live={[
        {
          key: "live-iterate",
          by: ITERATE,
          kind: "agent/working",
          data: { stackCount: 3 },
        },
      ]}
      liveRows={{
        "agent/working": () => <div data-testid="grokbot-stack">Checking CI & reviewing…</div>,
      }}
      composer={<div data-testid="stream-composer">Composer box</div>}
      belowComposer={<div data-testid="below-bar">Standard mode · Ready</div>}
    />,
  );

  const bars = view.container.querySelectorAll('[data-slot="subcontext-bar"]');
  expect(bars.length).toBe(2);
  expect(bars[0]!.textContent).toContain("5 replies");
  expect(bars[0]!.textContent).toContain("Unread");
  expect(view.container.textContent).toContain("+1 more threads");
  expect(view.container.querySelector('[data-testid="mcp-widget"]')?.textContent).toBe(
    "Rollout Plan Widget",
  );
  expect(view.container.querySelector('[data-testid="grokbot-stack"]')?.textContent).toBe(
    "Checking CI & reviewing…",
  );

  const footerEl = view.container.querySelector('[data-slot="context-stream-footer"]')!;
  expect(footerEl.className).not.toContain("border-t");

  act(() => {
    (bars[0] as HTMLButtonElement).click();
  });
  expect(opened).toEqual([{ subcontext: "/agents/rollout/t/100", anchor: 100 }]);
});

test("suppresses live tail when detached in history (!newer.exhausted) and supports span-based reveal", () => {
  const items: ContextStreamItem[] = [
    {
      kind: "agent/receipt",
      key: "r120",
      offset: 120,
      at: Date.parse("2026-11-25T12:07:00Z"),
      by: ITERATE,
      span: [105, 120],
      data: { summary: "Folded span" },
    },
  ];

  using view = mount(
    <ContextStream
      items={items}
      newer={{ exhausted: false, loading: false, failed: false, loadNewer: () => {} }}
      reveal={112}
      rows={{
        "agent/receipt": (item) => (
          <div data-testid="span-row">{(item.data as { summary: string }).summary}</div>
        ),
      }}
      live={[
        {
          key: "live-iterate",
          by: ITERATE,
          kind: "agent/working",
          data: {},
        },
      ]}
      liveRows={{
        "agent/working": () => <div data-testid="live-tail-should-hide">Live tail</div>,
      }}
    />,
  );

  expect(view.container.querySelector('[data-testid="span-row"]')?.textContent).toBe("Folded span");
  expect(view.container.querySelector('[data-testid="live-tail-should-hide"]')).toBeNull();
});

test("useWindowedEventPager jumps across sparse offsets via openAt, pages older/newer, trims past maxHeldEvents, and merges back into live tail", async () => {
  type Ev = OffsetEvent & { label: string };
  const allEvents: Ev[] = [
    { offset: 10, label: "genesis" },
    { offset: 500, label: "mid-a" },
    { offset: 505, label: "mid-b" },
    { offset: 510, label: "mid-c" },
    { offset: 990, label: "tail-a" },
    { offset: 1000, label: "tail-b" },
  ];
  const tailEvents = allEvents.slice(4);
  const readEvents = vi.fn(async (afterOffset: number, limit: number) =>
    allEvents.filter((e) => e.offset > afterOffset).slice(0, limit),
  );

  let api!: ReturnType<typeof useWindowedEventPager<Ev>>;
  function Harness() {
    api = useWindowedEventPager({
      tailEvents,
      readEvents,
      pageSize: 2,
      maxHeldEvents: 4,
    });
    return (
      <div>
        <span data-testid="attached">{String(api.attachedToHead)}</span>
        <span data-testid="offsets">{api.events.map((e) => e.offset).join(",")}</span>
        <span data-testid="reveal">{String(api.reveal ?? "")}</span>
      </div>
    );
  }

  using view = mount(<Harness />);
  expect(view.container.querySelector('[data-testid="attached"]')?.textContent).toBe("true");
  expect(view.container.querySelector('[data-testid="offsets"]')?.textContent).toBe("990,1000");

  await act(async () => {
    await api.openAt(420);
  });
  expect(api).toMatchObject({ attachedToHead: false, reveal: 500 });
  expect(api.events.map((e) => e.offset)).toContain(500);

  await act(async () => {
    api.newer.loadNewer();
  });
  expect(api).toMatchObject({ attachedToHead: true });
  expect(api.events.map((e) => e.offset)).toEqual([500, 505, 510, 990, 1000]);

  act(() => {
    api.jumpToLatest();
  });
  expect(api.events.map((e) => e.offset)).toEqual([990, 1000]);
});

test("useWindowedEventPager keeps pre-tail rows when openAt bridges into live tail, reopens newer if rolling tail advances past history, trims around anchor, and leaves zero gap in dense logs", async () => {
  type Ev = OffsetEvent & { label: string };
  const denseEvents: Ev[] = Array.from({ length: 1_090 }, (_, idx) => ({
    offset: idx + 1,
    label: `ev-${String(idx + 1)}`,
  }));
  const readEvents = vi.fn(async (afterOffset: number, limit: number) =>
    denseEvents.filter((e) => e.offset > afterOffset).slice(0, limit),
  );

  let api!: ReturnType<typeof useWindowedEventPager<Ev>>;
  let setTailSlice!: (next: readonly Ev[]) => void;
  let setMaxHeld!: (next: number) => void;
  function Harness() {
    const [tail, setTail] = useState<readonly Ev[]>(() => denseEvents.slice(999, 1_050));
    const [maxHeld, updateMaxHeld] = useState(3_000);
    setTailSlice = setTail;
    setMaxHeld = updateMaxHeld;
    api = useWindowedEventPager({ tailEvents: tail, readEvents, maxHeldEvents: maxHeld });
    return null;
  }

  using _view = mount(<Harness />);

  // 1. Opening offset 950 when live tail is 1000..1050 bridges into tail WITHOUT discarding 871..999:
  await act(async () => {
    await api.openAt(950);
  });
  expect(api).toMatchObject({ attachedToHead: true, reveal: 950 });
  expect(api.newer).toMatchObject({ exhausted: true });
  expect(api.events.map((e) => e.offset)).toEqual(
    Array.from({ length: 180 }, (_, idx) => 871 + idx),
  );

  // 2. If the rolling live tail later advances to 1040..1090 (past history's 1029), `attachedToHead`
  //    flips back to `false` and `newer` reopens instead of silently skipping 1030..1039:
  act(() => {
    setTailSlice(denseEvents.slice(1_039, 1_090));
  });
  expect(api).toMatchObject({ attachedToHead: false });
  expect(api.newer).toMatchObject({ exhausted: false });
  expect(api.events.map((e) => e.offset)).toEqual(
    Array.from({ length: 159 }, (_, idx) => 871 + idx),
  );
  await act(async () => {
    api.newer.loadNewer();
  });
  expect(api).toMatchObject({ attachedToHead: true });
  expect(api.newer).toMatchObject({ exhausted: true });
  expect(api.events.map((e) => e.offset)).toEqual(
    Array.from({ length: 220 }, (_, idx) => 871 + idx),
  );

  // 3. Opening offset 500 in a dense log with defaults (pageSize = 80) yields contiguous 421..579 with zero gap:
  await act(async () => {
    await api.openAt(500);
  });
  expect(api).toMatchObject({ attachedToHead: false, reveal: 500 });
  expect(api.events.map((e) => e.offset)).toEqual(
    Array.from({ length: 159 }, (_, idx) => 421 + idx),
  );

  // 4. Paging older from 421 loads 341..420 with zero gap:
  await act(async () => {
    api.older.loadOlder();
  });
  expect(api.events.map((e) => e.offset)).toEqual(
    Array.from({ length: 239 }, (_, idx) => 341 + idx),
  );

  // 5. With `maxHeldEvents < pageSize` (40 < 80), opening offset 500 trims around 500 (481..520) so 500 stays loaded:
  act(() => {
    setMaxHeld(40);
  });
  await act(async () => {
    await api.openAt(500);
  });
  expect(api).toMatchObject({ attachedToHead: false, reveal: 500 });
  expect(api.events.map((e) => e.offset)).toEqual(
    Array.from({ length: 40 }, (_, idx) => 481 + idx),
  );

  // 6. Concurrent `loadOlder` + `loadNewer` calls at capacity serialize instead of creating an internal hole:
  await act(async () => {
    api.older.loadOlder();
    api.newer.loadNewer();
  });
  expect(api.events.map((e) => e.offset)).toEqual(
    Array.from({ length: 40 }, (_, idx) => 401 + idx),
  );
});

test("useWindowedEventPager does not skip offsets if rolling tail advances while a short read is in flight", async () => {
  type Ev = OffsetEvent & { label: string };
  let serverEvents: Ev[] = Array.from({ length: 1_029 }, (_, idx) => ({
    offset: idx + 1,
    label: `ev-${String(idx + 1)}`,
  }));
  let releaseShortRead!: () => void;
  const readEvents = vi.fn(async (afterOffset: number, limit: number) => {
    const snapshot = serverEvents.filter((e) => e.offset > afterOffset).slice(0, limit);
    if (afterOffset === 949 && limit === 80) {
      await new Promise<void>((resolve) => {
        releaseShortRead = resolve;
      });
    }
    return snapshot;
  });

  let api!: ReturnType<typeof useWindowedEventPager<Ev>>;
  let setTailSlice!: (next: readonly Ev[]) => void;
  function Harness() {
    const [tail, setTail] = useState<readonly Ev[]>(() => serverEvents.slice(999, 1_029));
    setTailSlice = setTail;
    api = useWindowedEventPager({ tailEvents: tail, readEvents });
    return null;
  }

  using _view = mount(<Harness />);

  const openPromise = api.openAt(950);
  await act(async () => {
    await Promise.resolve();
  });

  // While the short read (seeing EOF at 1029) is still in flight, new events 1030..1080 land and
  // the rolling tail advances to 1040..1080:
  serverEvents = Array.from({ length: 1_080 }, (_, idx) => ({
    offset: idx + 1,
    label: `ev-${String(idx + 1)}`,
  }));
  act(() => {
    setTailSlice(serverEvents.slice(1_039, 1_080));
  });

  await act(async () => {
    releaseShortRead();
    await openPromise;
  });

  // `provenUpTo` stays at 1029 (not raised to 1039), so `newer` remains open to fetch 1030..1039!
  expect(api).toMatchObject({ attachedToHead: false, reveal: 950 });
  expect(api.newer).toMatchObject({ exhausted: false });
  expect(api.events.map((e) => e.offset)).toEqual(
    Array.from({ length: 159 }, (_, idx) => 871 + idx),
  );
});

test("useWindowedEventPager clears loading flags when a concurrent openAt fails so paging never gets stuck", async () => {
  type Ev = OffsetEvent & { label: string };
  const denseEvents: Ev[] = Array.from({ length: 600 }, (_, idx) => ({
    offset: idx + 1,
    label: `ev-${String(idx + 1)}`,
  }));
  let releaseOlderRead!: () => void;
  let failNextProbe = false;
  const readEvents = vi.fn(async (afterOffset: number, limit: number) => {
    if (failNextProbe && limit === 1) {
      failNextProbe = false;
      throw new Error("transient read failure");
    }
    if (afterOffset === 140 && limit === 80) {
      await new Promise<void>((resolve) => {
        releaseOlderRead = resolve;
      });
    }
    return denseEvents.filter((e) => e.offset > afterOffset).slice(0, limit);
  });

  let api!: ReturnType<typeof useWindowedEventPager<Ev>>;
  function Harness() {
    api = useWindowedEventPager({ tailEvents: denseEvents.slice(550), readEvents });
    return null;
  }

  using _view = mount(<Harness />);

  await act(async () => {
    await api.openAt(300);
  });
  expect(api.events[0]).toMatchObject({ offset: 221 });

  // Start an older page read (scans 140..220) and keep it pending:
  act(() => {
    api.older.loadOlder();
  });
  expect(api.older).toMatchObject({ loading: true });

  // Jump to another historical offset whose anchor probe rejects:
  failNextProbe = true;
  await act(async () => {
    await expect(api.openAt(100)).rejects.toThrow("transient read failure");
    releaseOlderRead();
  });

  // Loading flags are cleared, and subsequent `loadNewer` pages cleanly instead of being stuck!
  expect(api.older).toMatchObject({ loading: false });
  expect(api.newer).toMatchObject({ loading: false, exhausted: false });
  await act(async () => {
    api.newer.loadNewer();
  });
  expect(api.events.at(-1)).toMatchObject({ offset: 459 });
});

test("renders the three-dots corner menu on an in-progress live row and opens its provenance", async () => {
  const inspected: string[] = [];
  using view = mount(
    <ContextStream
      items={[]}
      older={{ exhausted: true, loading: false, failed: false, loadOlder: () => {} }}
      agentName="iterate"
      live={[
        {
          key: "live:iterate",
          by: { id: "/agents/em", name: "iterate", kind: "mind" },
          kind: "agent/working",
          text: "Verifying preview Workers…",
          menu: {
            copyItems: [
              { label: "Copy event range (#18..#21)", value: "/agents/em#18..#21", mono: true },
            ],
            provenance: "Streaming claude-fable-5-2 (#18..#21)",
            actions: [{ label: "Inspect live trace", onSelect: () => inspected.push("live:18") }],
          },
        },
      ]}
    />,
  );

  expect(view.container.textContent).not.toContain("#18..#21");
  const moreBtn = view.container.querySelector<HTMLButtonElement>(
    '[data-slot="context-stream-tail"] [data-slot="message-more-trigger"]',
  );
  expect(moreBtn).not.toBeNull();

  await act(async () => {
    moreBtn!.click();
  });

  const menu = document.body.querySelector('[data-slot="message-more-menu"]');
  expect(menu?.textContent).toContain("Streaming claude-fable-5-2 (#18..#21)");
  const actionBtn = Array.from(menu?.querySelectorAll("button") || []).find((b) =>
    b.textContent?.includes("Inspect live trace"),
  );
  expect(actionBtn).toBeDefined();
  await act(async () => {
    actionBtn!.click();
  });
  expect(inspected).toEqual(["live:18"]);
});

test("does not snap scrollTop back to bottom when the reader scrolls up (mobile touch & wheel)", async () => {
  const manyItems: ContextStreamItem[] = Array.from({ length: 30 }, (_, idx) => ({
    kind: "message",
    key: `m-${String(idx + 1)}`,
    offset: idx + 1,
    at: 1_700_000_000_000 + idx * 60_000,
    by: { id: "/members/jonas", name: "jonas", kind: "person" },
    text: `Message line #${String(idx + 1)}`,
  }));

  using view = mount(
    <ContextStream
      items={manyItems}
      older={{ exhausted: true, loading: false, failed: false, loadOlder: () => {} }}
      agentName="iterate"
    />,
  );

  const scroller = view.container.querySelector<HTMLDivElement>('[data-slot="virtual-log"]')!;
  expect(scroller).not.toBeNull();
  Object.defineProperty(scroller, "scrollHeight", { configurable: true, get: () => 2_400 });
  scroller.scrollTop = 1_800;

  // Simulate mobile touch scroll upward (`y` moving from 200 -> 420 while scrollTop moves 1800 -> 900)
  await act(async () => {
    scroller.dispatchEvent(
      new TouchEvent("touchstart", { bubbles: true, touches: [{ clientY: 200 } as Touch] }),
    );
    scroller.dispatchEvent(
      new TouchEvent("touchmove", { bubbles: true, touches: [{ clientY: 420 } as Touch] }),
    );
    scroller.scrollTop = 900;
    scroller.dispatchEvent(new Event("scroll"));
    scroller.dispatchEvent(new TouchEvent("touchend", { bubbles: true, touches: [] }));
  });

  // `scrollTop` MUST stay at 900 (not get reset to 1800 by `setAtEnd(false)` re-rendering VirtualLog!)
  expect(scroller).toMatchObject({ scrollTop: 900 });
  expect(view.container.querySelector('[aria-label^="Scroll to bottom"]')).not.toBeNull();
});

function mount(element: ReactElement) {
  const sizes = { clientHeight: 600, offsetHeight: 0 };
  const own = Object.keys(sizes).map(
    (name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)] as const,
  );
  for (const [name, value] of Object.entries(sizes))
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get: () => value });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return {
    container,
    root,
    [Symbol.dispose]() {
      act(() => root.unmount());
      container.remove();
      document.body.replaceChildren();
      for (const [name, descriptor] of own)
        if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
        else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
    },
  };
}
