// How the Events tab reads a Claude Code session's log: each `claude-code/hook-received` (one hook
// Claude Code POSTed, its body as the payload) as the one thing it says. A prompt, a tool call and
// what it gave back, the answer a turn ended on. The inspector shows the same thing whole.
import { mono, record, str } from "@iterate-com/ui/components/context-view/renderer-helpers";
import type {
  EventInspectors,
  EventRenderers,
} from "@iterate-com/ui/components/context-view/types";
import type { ReactNode } from "react";

const HOOK_RECEIVED = "events.iterate.com/claude-code/hook-received";

/** A field's text. The bridge moves a field over 256 KB to a file and leaves
 *  `{ file, size, preview }` in its place, so the preview stands in for the text. */
function text(value: unknown): string {
  if (typeof value === "string") return value;
  return str(record(value).preview);
}

/** The first line of a text, cut for a row. */
function firstLine(value: unknown, max = 160) {
  const line = text(value).trim().split("\n")[0] || "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** A path under the session's working directory, relative to it. */
function relative(path: string, cwd: string) {
  return cwd && path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path;
}

const tag = (name: string) => (
  <>
    <span className="rounded bg-muted px-1 font-mono text-2xs uppercase text-muted-foreground">
      {name}
    </span>{" "}
  </>
);

/** What a tool call is about, in a few words: the command, the file, the pattern. */
function toolSubject(tool: string, input: Record<string, unknown>, cwd: string): string {
  switch (tool) {
    case "Bash":
      return firstLine(input.command);
    case "Read":
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return relative(str(input.file_path || input.notebook_path), cwd);
    case "Grep":
      return `${str(input.pattern)}${input.path ? ` in ${relative(str(input.path), cwd)}` : ""}`;
    case "Glob":
      return str(input.pattern);
    case "Agent":
    case "Task":
      return `${str(input.description)}${input.subagent_type ? ` (${str(input.subagent_type)})` : ""}`;
    case "WebFetch":
      return str(input.url);
    case "WebSearch":
      return str(input.query);
    default: {
      const first = Object.values(input).find((value) => typeof value === "string");
      return firstLine(first);
    }
  }
}

/** What a finished tool call gave back, in a line, where there is a short way to say it. */
function toolOutcome(tool: string, response: unknown): string {
  const r = record(response);
  if (tool === "Bash") {
    if (r.backgroundTaskId) return "running in the background";
    return firstLine(r.stderr) || firstLine(r.stdout) || "no output";
  }
  if (tool === "Read") {
    const file = record(r.file);
    return typeof file.numLines === "number" ? `${file.numLines} lines` : "";
  }
  if (tool === "Agent" || tool === "Task") {
    if (r.status === "async_launched") return "launched in the background";
    const content = Array.isArray(r.content)
      ? r.content.map((part) => text(record(part).text))
      : [];
    return firstLine(content.join("\n"));
  }
  return typeof response === "string" ? firstLine(response) : "";
}

const muted = (children: ReactNode) => <span className="text-muted-foreground">{children}</span>;

export const claudeCodeRenderers: EventRenderers = {
  [HOOK_RECEIVED]: (e) => {
    const p = record(e.payload);
    const cwd = str(p.cwd);
    const tool = str(p.tool_name);
    const input = record(p.tool_input);
    switch (p.hook_event_name) {
      case "SessionStart":
        return <>The session started{p.source ? ` (${str(p.source)})` : ""}</>;
      case "SessionEnd":
        return <>The session ended{p.reason ? ` (${str(p.reason)})` : ""}</>;
      case "UserPromptSubmit": {
        // Claude Code's own notices (a background task's `<task-notification>`) start with a tag
        const notice = text(p.prompt).trim().startsWith("<");
        return notice ? (
          muted(<>Claude Code notified it: {firstLine(p.prompt)}</>)
        ) : (
          <>
            {tag("prompt")}
            {firstLine(p.prompt)}
          </>
        );
      }
      case "PreToolUse":
        return (
          <>
            {tag(tool)}
            {mono(toolSubject(tool, input, cwd))}
          </>
        );
      case "PostToolUse": {
        const outcome = toolOutcome(tool, p.tool_response);
        const took = typeof p.duration_ms === "number" ? ` · ${p.duration_ms} ms` : "";
        return muted(
          <>
            {tag(`${tool} ✓`)}
            {mono(toolSubject(tool, input, cwd))}
            {outcome ? ` → ${outcome}` : ""}
            {took}
          </>,
        );
      }
      case "PostToolUseFailure":
        return (
          <>
            {tag(`${tool} ✗`)}
            {mono(toolSubject(tool, input, cwd))} → {firstLine(p.error)}
          </>
        );
      case "Stop":
        return p.last_assistant_message ? (
          <>
            {tag("said")}
            {firstLine(p.last_assistant_message)}
          </>
        ) : (
          <>The turn ended</>
        );
      case "SubagentStart":
        return <>Subagent started: {str(p.agent_type, "general-purpose")}</>;
      case "SubagentStop":
        return (
          <>
            The subagent finished
            {p.last_assistant_message ? <>: {firstLine(p.last_assistant_message)}</> : null}
          </>
        );
      case "Notification":
        return (
          <>
            {tag("notice")}
            {str(p.message)}
          </>
        );
      default:
        return null;
    }
  },
};

const prose = (value: unknown) => (
  <p className="text-sm whitespace-pre-wrap break-words">{text(value)}</p>
);
const code = (value: string) => (
  <pre className="max-h-96 overflow-auto rounded bg-muted p-2 font-mono text-xs whitespace-pre-wrap break-words">
    {value}
  </pre>
);
const json = (value: unknown) => code(JSON.stringify(value, null, 2));

export const claudeCodeInspectors: EventInspectors = {
  [HOOK_RECEIVED]: (e) => {
    const p = record(e.payload);
    const tool = str(p.tool_name);
    const input = record(p.tool_input);
    const response = record(p.tool_response);
    switch (p.hook_event_name) {
      case "UserPromptSubmit":
        return prose(p.prompt);
      case "Stop":
      case "SubagentStop":
        return p.last_assistant_message ? prose(p.last_assistant_message) : null;
      case "PreToolUse":
        return tool === "Bash" ? code(text(input.command)) : json(input);
      case "PostToolUse":
        if (tool === "Bash")
          return (
            <div className="flex flex-col gap-2">
              {code(`$ ${text(input.command)}`)}
              {text(response.stdout) ? code(text(response.stdout)) : null}
              {text(response.stderr) ? code(text(response.stderr)) : null}
            </div>
          );
        if (tool === "Read") return code(text(record(response.file).content));
        return (
          <div className="flex flex-col gap-2">
            {json(input)}
            {json(p.tool_response)}
          </div>
        );
      default:
        return null;
    }
  },
};
