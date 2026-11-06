// @vitest-environment jsdom
// The live row between a model's answer that holds a script and the script's run: the agent is
// still working, so the row keeps its spinner.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { AgentLiveActivity } from "./agent-feed.tsx";
import { initialAgentUiState, reduceAgentUi } from "./agent-ui-reducer.ts";
import type { StreamEvent } from "./stream-event.ts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

test("a finished answer whose script has not started yet still shows the agent working", async () => {
  const script = '<codemode status="Multiplying">\nreturn 6 * 7;\n</codemode>';
  const events = [
    { type: "events.iterate.com/agent/llm-request-requested", payload: { model: "gpt-test" } },
    {
      type: "events.iterate.com/agent/llm-response-frame",
      payload: { llmRequestOffset: 1, sequence: 0, responseDelta: script, thinkingDelta: "" },
    },
    {
      type: "events.iterate.com/agent/llm-request-settled",
      payload: { requestOffset: 1, result: { status: "succeeded", text: script } },
    },
  ].map(
    (event, index) =>
      ({
        ...event,
        offset: index + 1,
        createdAt: `2026-11-06T00:00:0${String(index)}.000Z`,
      }) as unknown as StreamEvent,
  );
  let state = initialAgentUiState();
  for (const event of events) state = reduceAgentUi(state, event).endState;

  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <AgentLiveActivity
        state={state}
        toggledIds={new Set()}
        onToggle={() => {}}
        inspect={{ llmRequest: () => {}, scriptRun: () => {} }}
      />,
    ),
  );
  expect(container.querySelector('[aria-label="Loading"]')).not.toBeNull();
  expect(container.textContent).toContain("Working…");
  await act(async () => root.unmount());
});
