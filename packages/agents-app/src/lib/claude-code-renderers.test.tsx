// Each hook a Claude Code session POSTs, as its row in the Events tab reads. The payloads are cut
// down from real ones a session sent on a preview.
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { claudeCodeInspectors, claudeCodeRenderers } from "./claude-code-renderers.tsx";

const cwd = "/work/demo";

test.for<{ hook: Record<string, unknown>; row: string }>([
  {
    hook: { hook_event_name: "UserPromptSubmit", prompt: "Read b.txt\nand say what it says" },
    row: "prompt Read b.txt",
  },
  {
    hook: {
      hook_event_name: "UserPromptSubmit",
      prompt: "<task-notification>\n<task-id>bm04q2s10</task-id>",
    },
    row: "Claude Code notified it: <task-notification>",
  },
  {
    hook: {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "ls -la\necho done", description: "List files" },
    },
    row: "Bash ls -la",
  },
  {
    hook: {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "cat a.txt" },
      tool_response: { stdout: "hello\n", stderr: "", interrupted: false },
      duration_ms: 19,
    },
    row: "Bash ✓ cat a.txt → hello · 19 ms",
  },
  {
    hook: {
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: `${cwd}/b.txt` },
    },
    row: "Read b.txt",
  },
  {
    hook: {
      hook_event_name: "PostToolUse",
      tool_name: "Read",
      tool_input: { file_path: `${cwd}/b.txt` },
      tool_response: { type: "text", file: { content: "world\n", numLines: 2 } },
      duration_ms: 5,
    },
    row: "Read ✓ b.txt → 2 lines · 5 ms",
  },
  {
    hook: {
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_input: { description: "List the folder", prompt: "…", subagent_type: "Explore" },
    },
    row: "Agent List the folder (Explore)",
  },
  {
    hook: {
      hook_event_name: "Stop",
      stop_hook_active: false,
      last_assistant_message: '`b.txt` says "world".',
    },
    row: 'said `b.txt` says "world".',
  },
  {
    hook: { hook_event_name: "SubagentStart", agent_type: "Explore" },
    row: "Subagent started: Explore",
  },
  {
    hook: {
      hook_event_name: "Notification",
      message: "Claude needs your permission to use Bash",
      notification_type: "permission_prompt",
    },
    row: "notice Claude needs your permission to use Bash",
  },
  {
    hook: { hook_event_name: "SessionEnd", reason: "prompt_input_exit" },
    row: "The session ended (prompt_input_exit)",
  },
])("$hook.hook_event_name $hook.tool_name reads: $row", ({ hook, row }) => {
  expect(textOf(claudeCodeRenderers, { cwd, ...hook })).toBe(row);
});

test("a prompt the bridge moved to a file reads as its preview", () => {
  const prompt = { file: "hooks/r1/prompt", size: 301_000, preview: "a very long prompt" };
  expect(textOf(claudeCodeRenderers, { hook_event_name: "UserPromptSubmit", prompt })).toBe(
    "prompt a very long prompt",
  );
});

test("the inspector shows a Bash call's command and its output whole", () => {
  expect(
    textOf(claudeCodeInspectors, {
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "ls" },
      tool_response: { stdout: "a.txt\nb.txt", stderr: "" },
    }),
  ).toBe("$ lsa.txt\nb.txt");
});

/** The text a registry's entry for `claude-code/hook-received` draws for `payload`. */
function textOf(registry: typeof claudeCodeRenderers, payload: Record<string, unknown>) {
  const node = registry["events.iterate.com/claude-code/hook-received"]({
    offset: 1,
    type: "events.iterate.com/claude-code/hook-received",
    createdAt: "2026-11-10T00:00:00.000Z",
    payload,
  });
  return renderToStaticMarkup(<>{node}</>)
    .replaceAll(/<[^>]+>/g, "")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}
