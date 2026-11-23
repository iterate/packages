// The mind's default kind (default-kind.ts): which kind file may be it, which one is by what its
// frame reports, where its new agent is born and what `start` is given, and the first message as
// one fact. The frame itself is host.ts's; the Dash's composer is dash-agents.test.tsx's.
import { expect, test, vi } from "vitest";
import {
  defaultKindCandidates,
  defaultKindOf,
  newAgentStartOf,
  sendFirstMessage,
  type KindStarter,
} from "./default-kind.ts";
import type { AgentKindViewLoaded } from "./bridge.ts";

test("only a kind file whose text says `default: true` may be the default, by kind name", () => {
  expect(
    defaultKindCandidates([
      { kind: "zeta", name: "agent-kinds/zeta.ts", source: "newAgent: { default: true }" },
      { kind: "claude", name: "agent-kinds/claude.ts", source: "export default {};" },
      { kind: "unread", name: "agent-kinds/unread.ts", source: null },
      { kind: "agent", name: "agent-kinds/agent.ts", source: "{ default:true, choices }" },
    ]).map((file) => file.kind),
  ).toEqual(["agent", "zeta"]);
});

test("the default is the first kind whose frame reports `default: true`; with none, there is none", async () => {
  const plain = starter("claude", { ephemeralEvents: [], newAgent: { choices: [CHOICE] } });
  const failed = starter("broken", { error: "agent-kinds/broken.ts does not parse" });
  const agent = starter("agent", { ephemeralEvents: [], newAgent: NEW_AGENT });
  expect(await defaultKindOf([plain, failed, agent])).toMatchObject({
    starter: { file: { kind: "agent" } },
    newAgent: { default: true },
  });
  expect(await defaultKindOf([plain, failed])).toBe(null);
  expect(await defaultKindOf([])).toBe(null);
});

test("a frame that reports later is waited for; one that never reports leaves New agent as it was", async () => {
  vi.useFakeTimers();
  const late = starter("agent", undefined);
  const found = defaultKindOf([late], 15_000);
  late.report({ ephemeralEvents: [], newAgent: NEW_AGENT });
  expect(await found).toMatchObject({ starter: { file: { kind: "agent" } } });

  const silent = defaultKindOf([starter("agent", undefined)], 15_000);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(await silent).toBe(null);
  vi.useRealTimers();
});

test("a new agent of the kind is born in the person's folder of the kind, on its first choice, with each field's default", () => {
  const found = { starter: starter("agent", undefined), newAgent: NEW_AGENT };
  const at = new Date(Date.UTC(2026, 10, 23, 12, 0, 0));
  expect(newAgentStartOf(found, "ada", at)).toEqual({
    choice: "agent",
    // a list whose default is none of its options starts on its first
    fields: { model: "openai/gpt-6.2-sol", effort: "high" },
    path: "/agents/people/ada/agent/2026-11-23t12-00-00-000z",
  });
  const nobodys = {
    ...found,
    newAgent: { ...NEW_AGENT, choices: [{ ...CHOICE, byPerson: false }] },
  };
  expect(newAgentStartOf(nobodys, "ada", at)).toMatchObject({
    path: "/agents/agent/2026-11-23t12-00-00-000z",
  });
});

test("the first message is its files stored under the new path, then ONE `agent-ui/message-received` there", async () => {
  const steps: unknown[] = [];
  await sendFirstMessage(
    "/agents/people/ada/agent/x",
    { message: "look", files: [{ contentType: "image/png", filename: "a.png", data: "AAAA" }] },
    {
      storeFiles: async (path, files) => {
        steps.push({ stored: path, count: files.length });
        return [{ contentType: "image/png", filename: "a.png", path: `${path}/s-a.png`, size: 3 }];
      },
      append: async (path, events) => void steps.push({ appended: path, events }),
    },
  );
  expect(steps).toMatchObject([
    { stored: "/agents/people/ada/agent/x", count: 1 },
    {
      appended: "/agents/people/ada/agent/x",
      events: [
        {
          type: "events.iterate.com/agent-ui/message-received",
          payload: {
            message: "look",
            files: [{ path: "/agents/people/ada/agent/x/s-a.png", size: 3 }],
          },
        },
      ],
    },
  ]);
});

// ── the kinds ──

const CHOICE = { id: "agent", label: "Agent", byPerson: true };
const NEW_AGENT = {
  default: true as const,
  choices: [CHOICE],
  fields: [
    {
      name: "model",
      label: "Model",
      type: "select" as const,
      defaultValue: "openai/gpt-6.2-sol",
      options: ["openai/gpt-6.2-sol", "xai/grok-4.3"],
    },
    {
      name: "effort",
      label: "Effort",
      type: "select" as const,
      defaultValue: "max",
      options: ["high"],
    },
    { name: "other", label: "Other", defaultValue: "x", choices: ["another-choice"] },
  ],
};

/** A starter frame that reported `loaded`, or reports later by `report`. */
function starter(kind: string, loaded: AgentKindViewLoaded | undefined) {
  let held = loaded;
  const listeners = new Set<() => void>();
  const fake: KindStarter & { report(next: AgentKindViewLoaded): void } = {
    file: { kind, name: `agent-kinds/${kind}.ts`, source: "default: true" },
    loaded: () => held,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    start: async () => [],
    report: (next) => {
      held = next;
      for (const listener of listeners) listener();
    },
  };
  return fake;
}
