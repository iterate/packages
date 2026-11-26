// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { BotIcon } from "lucide-react";
import { agentFeedOf, foldAgentLog } from "../agent-chat/agent-events.ts";
import { AGENT_FACT } from "../agent-chat/agent-facts.ts";
import { kindIcon } from "../agent-look.ts";
import {
  activityFaviconHref,
  CONTEXT_ACTIVITY_POPPED_TYPE,
  CONTEXT_ACTIVITY_PUSHED_TYPE,
  contextActivitiesFromLiveState,
  foldContextActivities,
  foldContextActivityLog,
  groupContextActivitiesByTag,
} from "./context-activity-stack.ts";
import { ContextActivityStack } from "./context-activity-stack-view.tsx";
import {
  contextActivitiesOf,
  contextIcon,
  describedPayload,
  filterContextListings,
  isAgentContext,
  type ContextListing,
} from "./context-catalog-rows.ts";
import { ContextIcon, ContextIconTooltipContent } from "./context-icon.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("foldContextActivities pushes one or multiple items, updates matching keys to top, pops by key/keys/tag, and drops expired items", () => {
  const events = [
    {
      type: CONTEXT_ACTIVITY_PUSHED_TYPE,
      createdAt: "2026-11-21T22:00:00.000Z",
      payload: {
        items: [
          {
            key: "cf-docs",
            text: "Reading Workers KV limits",
            url: "https://developers.cloudflare.com/kv/",
            tags: ["web", "cloudflare"],
          },
          {
            key: "mcp-posthog",
            text: "Querying PostHog funnel",
            icon: "mcp",
            tags: ["mcp", "analytics"],
            ttlMs: 10_000,
          },
          {
            key: "msg-chief",
            text: "Messaging Coding chief of staff",
            url: "/agents/coding-chief-of-staff",
            tags: ["agent"],
          },
        ],
      },
    },
    {
      type: CONTEXT_ACTIVITY_PUSHED_TYPE,
      createdAt: "2026-11-21T22:00:03.000Z",
      payload: {
        key: "cf-docs",
        text: "Checking Durable Object hibernation pricing",
        url: "https://developers.cloudflare.com/durable-objects/",
        tags: ["web", "cloudflare"],
      },
    },
  ];

  const beforeExpiry = Date.parse("2026-11-21T22:00:05.000Z");
  const active = foldContextActivities(events, { nowMs: beforeExpiry });
  expect(active.map((item) => [item.key, item.text])).toEqual([
    ["cf-docs", "Checking Durable Object hibernation pricing"],
    ["msg-chief", "Messaging Coding chief of staff"],
    ["mcp-posthog", "Querying PostHog funnel"],
  ]);

  const afterExpiry = Date.parse("2026-11-21T22:00:12.000Z");
  expect(foldContextActivities(events, { nowMs: afterExpiry }).map((item) => item.key)).toEqual([
    "cf-docs",
    "msg-chief",
  ]);

  const afterPop = foldContextActivities(
    [...events, { type: CONTEXT_ACTIVITY_POPPED_TYPE, payload: { key: "cf-docs" } }],
    { nowMs: afterExpiry },
  );
  expect(afterPop.map((item) => item.key)).toEqual(["msg-chief"]);

  // Incremental fold preserves exact stack reference when appended events are unrelated
  const firstFold = foldContextActivityLog(undefined, events);
  const appendedUnrelated = [...events, { type: "demo/ping", payload: {} }];
  const secondFold = foldContextActivityLog(firstFold, appendedUnrelated);
  expect(Object.is(secondFold.stack, firstFold.stack)).toBe(true);
});

test("activityFaviconHref resolves website domains and keeps symbolic/emoji icons separate", () => {
  expect(
    activityFaviconHref(
      { url: "https://developers.cloudflare.com/workers/" },
      (host) => `https://favicons.example/${host}`,
    ),
  ).toBe("https://favicons.example/developers.cloudflare.com");
  expect(
    activityFaviconHref({ icon: "github.com" }, (host) => `https://favicons.example/${host}`),
  ).toBe("https://favicons.example/github.com");
  expect(activityFaviconHref({ icon: "mcp" })).toBeUndefined();
  expect(activityFaviconHref({ icon: "🔍" })).toBeUndefined();
  expect(activityFaviconHref({ url: "/agents/coding-chief-of-staff" })).toBeUndefined();
});

test("groupContextActivitiesByTag and filterContextListings index active stack items", () => {
  const activities = [
    { key: "w1", text: "Visiting cloudflare.com", url: "https://cloudflare.com", tags: ["web"] },
    { key: "w2", text: "Reading iterate/core#239", url: "https://github.com", tags: ["web"] },
    { key: "m1", text: "Calling Linear MCP", icon: "mcp", tags: ["mcp"] },
  ];
  expect(groupContextActivitiesByTag(activities).map((g) => [g.tag, g.items.length])).toEqual([
    ["web", 2],
    ["mcp", 1],
  ]);

  const listing: ContextListing = {
    path: "/agents/engineering-manager",
    eventCount: 12,
    eventTypes: { "events.iterate.com/agent/created": 1 },
    recentTypes: [],
    processors: ["agent"],
    activities,
  };
  expect(contextActivitiesOf(listing)).toHaveLength(3);
  expect(filterContextListings([listing], "linear mcp")).toHaveLength(1);
});

test("kind=agent and kind=iterate contexts get BotIcon, match isAgentContext, and fold AGENT_FACT events", () => {
  expect(kindIcon("agent")).toBe(BotIcon);
  expect(kindIcon("iterate")).toBe(BotIcon);
  expect(
    isAgentContext({
      path: "/agents/people/jonas/agent/2026-11-23t17-00-00-000z",
      eventCount: 2,
      eventTypes: { [AGENT_FACT.uiAgentRequested]: 1, [AGENT_FACT.uiMessageReceived]: 1 },
      recentTypes: [],
      processors: ["agent"],
    }),
  ).toBe(true);

  const events = [
    {
      offset: 1,
      type: AGENT_FACT.uiMessageReceived,
      createdAt: "2026-11-23T17:00:00.000Z",
      payload: { message: "Hello agent", client: "web" },
      source: { principal: { actor: "usr_jonas", email: "jonas@iterate.com" } },
    },
    {
      offset: 2,
      type: "events.iterate.com/agent/context-added",
      createdAt: "2026-11-23T17:00:00.050Z",
      payload: {
        role: "user",
        content: "Hello agent\n\n— Web UI",
        source: { path: "/agents/people/jonas/agent/1", offset: 1 },
      },
    },
    {
      offset: 3,
      type: AGENT_FACT.llmRequested,
      createdAt: "2026-11-23T17:00:00.100Z",
      payload: {
        model: "anthropic/claude-fable-5-2",
        purpose: "answer",
        extends: null,
        itemsAdded: [],
      },
    },
    {
      offset: 4,
      type: AGENT_FACT.llmSettled,
      createdAt: "2026-11-23T17:00:01.000Z",
      payload: {
        llmRequestOffset: 3,
        attempt: 0,
        durationMs: 900,
        result: { status: "succeeded", text: "<codemode>...</codemode>" },
      },
    },
    {
      offset: 5,
      type: AGENT_FACT.uiMessageSent,
      createdAt: "2026-11-23T17:00:01.050Z",
      payload: { message: "Hello from the agent!" },
    },
  ];
  const feed = agentFeedOf(foldAgentLog(undefined, events), true, false);
  expect(feed.items.map((item) => item.kind)).toEqual(["user", "activity", "assistant"]);
});

test("ContextActivityStack renders pill without noisy tag badges and opens active work popover", () => {
  const openedPaths: string[] = [];
  using view = renderIntoDom(
    <ContextActivityStack
      nowMs={Date.parse("2026-11-21T22:00:05.000Z")}
      faviconForHost={(host) =>
        `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><text>${host}</text></svg>`
      }
      onOpenPath={(path) => openedPaths.push(path)}
      activities={[
        {
          key: "cf",
          text: "Reading Cloudflare Workers docs",
          url: "https://developers.cloudflare.com/workers/",
          tags: ["web"],
          expiresAt: "2026-11-21T22:00:20.000Z",
        },
        {
          key: "chief",
          text: "Syncing with Coding chief of staff",
          url: "/agents/coding-chief-of-staff",
          tags: ["agent"],
        },
        {
          key: "mcp",
          text: "Querying PostHog events",
          icon: "mcp",
          tags: ["mcp"],
        },
      ]}
    />,
  );

  const pill = view.container.querySelector<HTMLElement>("[data-slot=context-activity-pill]");
  expect(pill?.textContent).toContain("Reading Cloudflare Workers docs");
  expect(pill?.textContent).toContain("1/3");
  expect(pill?.textContent).not.toContain("1 web");
  expect(pill?.textContent).not.toContain("1 mcp");

  act(() => pill?.click());
  const list = document.body.querySelector("[data-slot=activity-stack-list]");
  expect(list?.textContent).toContain("Syncing with Coding chief of staff");
  expect(list?.textContent).toContain("developers.cloudflare.com");
  expect(list?.textContent).toContain("15s");

  const agentButton = [...(list?.querySelectorAll("button") || [])].find((btn) =>
    btn.textContent?.includes("Syncing with Coding chief of staff"),
  );
  act(() => agentButton?.click());
  expect(openedPaths).toEqual(["/agents/coding-chief-of-staff"]);
});

test("ContextActivityStack mode=lip: renders nothing when Idle with empty stack, and folds status + stack into a single lip when active", () => {
  {
    using idle = renderIntoDom(
      <ContextActivityStack mode="lip" activities={[]} status={{ text: "Idle", tone: "muted" }} />,
    );
    expect(idle.container).toMatchObject({ innerHTML: "" });
  }

  {
    using statusOnly = renderIntoDom(
      <ContextActivityStack
        mode="lip"
        activities={[]}
        status={{ text: "Thinking · gpt-5.4", tone: "live" }}
      />,
    );
    expect(statusOnly.container.querySelector("[data-composer-lip=status]")?.textContent).toBe(
      "Thinking · gpt-5.4",
    );
  }

  {
    using combined = renderIntoDom(
      <ContextActivityStack
        mode="lip"
        activities={[{ key: "mcp", text: "Querying PostHog events", icon: "mcp", tags: ["mcp"] }]}
        status={{ text: "Thinking · gpt-5.4", tone: "live" }}
      />,
    );
    const lip = combined.container.querySelector("[data-composer-lip=stack]");
    expect(lip?.textContent).toContain("Querying PostHog events");
    expect(lip?.textContent).toContain("gpt-5.4");
  }
});

test("ContextIcon & describedPayload: supports custom emoji/symbolic/URL icons, multi-size rendering (xs..xl), live activity corner badge, and rich hover tooltip", () => {
  const row: ContextListing = {
    path: "/agents/engineering-manager",
    awake: { since: Date.now() - 60_000 },
    eventCount: 42,
    eventTypes: { "events.iterate.com/agent/context-added": 42 },
    recentTypes: ["events.iterate.com/agent/context-added"],
    processors: ["agent", "call"],
    storageBytes: 32_400,
    description: "Coordinates stack verification across Workers.",
    metadata: { title: "Engineering manager", icon: "🧭", extra: 1 },
    activities: [
      {
        key: "cf",
        text: "Checking Cloudflare DO limits",
        url: "https://developers.cloudflare.com/",
        tags: ["web"],
      },
    ],
  };

  expect(contextIcon(row)).toBe("🧭");
  expect(describedPayload(row, "Updated desc", "EM", "🚀")).toEqual({
    description: "Updated desc",
    metadata: { extra: 1, title: "EM", icon: "🚀" },
  });
  // Clearing icon removes icon key while keeping title & extra metadata
  expect(describedPayload(row, "Updated desc", undefined, "")).toEqual({
    description: "Updated desc",
    metadata: { extra: 1, title: "Engineering manager" },
  });

  // Renders xs..xl sizes, showing live activity badge on md..xl and status dot on xs
  for (const size of ["xs", "sm", "md", "lg", "xl"] as const) {
    using mounted = renderIntoDom(<ContextIcon row={row} size={size} />);
    const el = mounted.container.querySelector("[data-slot=context-icon]");
    expect(el?.getAttribute("data-size")).toBe(size);
    expect(el?.textContent).toContain("🧭");
    expect(Boolean(el?.querySelector("[data-slot=context-icon-activity]"))).toBe(
      size === "md" || size === "lg" || size === "xl",
    );
  }

  // Tooltip body renders title, catalog facts, description, and live activity stack
  using tip = renderIntoDom(<ContextIconTooltipContent row={row} subagentCount={5} />);
  expect(tip.container.textContent).toContain("Engineering manager");
  expect(tip.container.textContent).toContain("and 5 subagents");
  expect(tip.container.textContent).toContain("Checking Cloudflare DO limits");
  expect(tip.container.textContent).toContain("agent · call");
  expect(tip.container.textContent).toContain("42 events");
});

test("contextActivitiesFromLiveState parses live state array and ContextActivityStack reacts to array updates and exact-expiry setTimeout", () => {
  vi.useFakeTimers();
  try {
    const baseMs = Date.parse("2026-11-24T20:00:00.000Z");
    vi.setSystemTime(baseMs);

    expect(contextActivitiesFromLiveState(undefined)).toBeUndefined();
    expect(contextActivitiesFromLiveState("invalid")).toEqual([]);

    const initialLive = contextActivitiesFromLiveState([
      {
        key: "fast",
        text: "Short 5s lookup",
        icon: "⚡",
        expiresAt: "2026-11-24T20:00:05.000Z",
      },
      {
        key: "long",
        text: "Long 30s build",
        icon: "🧪",
        expiresAt: "2026-11-24T20:00:30.000Z",
      },
    ]);
    expect(initialLive).toHaveLength(2);

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      act(() => root.render(<ContextActivityStack activities={initialLive} />));
      expect(container.textContent).toContain("Short 5s lookup");
      expect(container.textContent).toContain("1/2");

      // Advance past the 5s expiry — single scheduled setTimeout fires and drops `fast` automatically
      act(() => {
        vi.advanceTimersByTime(5_100);
      });
      expect(container.textContent).toContain("Long 30s build");
      expect(container.textContent).not.toContain("1/2");

      // When liveState array updates to empty `[]`, the component unmounts cleanly
      act(() => root.render(<ContextActivityStack activities={[]} />));
      expect(container).toMatchObject({ innerHTML: "" });
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  } finally {
    vi.useRealTimers();
  }
});

function renderIntoDom(element: ReactElement) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(element));
  return {
    container,
    [Symbol.dispose]() {
      act(() => root.unmount());
      container.remove();
    },
  };
}
