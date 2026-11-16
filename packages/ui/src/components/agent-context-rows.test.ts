// agent-context-rows.test.ts — the feed's rows as data: the merge by time, the rollup of spoken
// lines and its keys, and when the agent's log must read an older page to keep up with the host's.
import { expect, test } from "vitest";
import type { StreamEvent } from "./agent-chat/stream-event.ts";
import type { AgentUiActivity } from "./agent-chat/agent-ui-reducer.ts";
import { OLDER_EXHAUSTED } from "./virtual-log/older-pages.ts";
import { agentLogTrailsHost, placeRows, rolledUp, type RowSources } from "./agent-context-rows.ts";

test("an activity sits by its start time between the host's rows, its key its id", () => {
  expect(shape(sources([event(1, "typed"), event(9, "typed")], [activity(4)]))).toEqual([
    "event:1",
    "activity:activity-4",
    "event:9",
  ]);
});

test("a typed row and an activity row each end a run of spoken lines", () => {
  expect(
    shape(
      sources(
        [event(1, "said"), event(2, "said"), event(3, "typed"), event(4, "said"), event(8, "said")],
        [activity(5)],
      ),
    ),
  ).toEqual([
    "said:head(2)",
    "event:3",
    "said:after:event:3(1)",
    "activity:activity-5",
    "said:after:activity:activity-5(1)",
  ]);
});

test("the host's events of one instant keep the order of its log, typed and spoken alike", () => {
  // one batch: a line said, a line typed, a line said, all with the same time
  const at = new Date(T).toISOString();
  const batch = [event(5, "said"), event(6, "typed"), event(7, "said")].map((e) => ({
    ...e,
    createdAt: at,
  }));
  expect(shape(sources(batch))).toEqual(["said:head(1)", "event:6", "said:after:event:6(1)"]);
  // and the agent's work of that instant comes after them
  expect(shape(sources(batch, [activity(0)])).at(-1)).toBe("activity:activity-0");
});

test("a rollup keeps its key as lines are said at its end and as older lines load in front", () => {
  const key = (events: StreamEvent[]) => shape(sources(events)).at(-1);
  const now = [event(5, "typed"), event(6, "said"), event(7, "said")];
  expect(key(now)).toBe("said:after:event:5(2)");
  expect(key([...now, event(8, "said"), event(9, "said")])).toBe("said:after:event:5(4)");
  expect(key([event(2, "said"), event(3, "said"), ...now])).toBe("said:after:event:5(2)");
});

test("the agent's log reads older only while the host holds a row older than the agent's oldest event", () => {
  const older = { exhausted: false, loading: false, loadOlder: () => {} };
  const rows = placeRows(sources([event(10, "typed")]));
  const agent = (seconds: number) => [{ ...event(seconds, "typed"), offset: 100 }];
  expect(agentLogTrailsHost(rows, agent(20), older)).toBe(true);
  expect(agentLogTrailsHost(rows, agent(5), older)).toBe(false);
  expect(agentLogTrailsHost(rows, agent(20), OLDER_EXHAUSTED)).toBe(false);
  expect(agentLogTrailsHost([], agent(20), older)).toBe(false);
  expect(agentLogTrailsHost(rows, [], older)).toBe(false);
});

const T = Date.parse("2026-11-16T12:00:00Z");

/** A host event at `offset`, `offset` seconds after T. Type "said" is a spoken line. */
const event = (offset: number, type: "typed" | "said"): StreamEvent => ({
  offset,
  type,
  // a host's time without milliseconds: the merge reads it as the same instant as an activity's
  createdAt: new Date(T + offset * 1000).toISOString().replace(".000", ""),
  payload: { text: `${type} ${String(offset)}` },
});

const activity = (seconds: number): AgentUiActivity => ({
  kind: "activity",
  id: `activity-${String(seconds)}`,
  status: "done",
  steps: [],
  startedAtMs: T + seconds * 1000,
  endedAtMs: T + seconds * 1000 + 500,
});

const sources = (events: StreamEvent[], activities: AgentUiActivity[] = []): RowSources => ({
  events,
  renderers: { typed: true },
  spokenLine: (e) =>
    e.type === "said"
      ? { key: `line-${String(e.offset)}`, who: "a@x.com", at: Date.parse(e.createdAt), text: "hi" }
      : null,
  messages: [],
  activities,
});

const shape = (s: RowSources) =>
  rolledUp(placeRows(s)).map((row) =>
    row.kind === "rollup" ? `${row.key}(${String(row.lines.length)})` : row.key,
  );
