// The traces, inspector sheets built over the chat's own event array: the LLM request (what the
// model was sent, what it answered, what the loop derived) and the script run (the code, its
// settlement, what the agent was told). One Sheet, opened by the chat's state (agent-chat-search.ts), so any
// trace is a shareable link. The Events view is the raw log: one row per event, click to inspect.
import { memo, useMemo, useState, type ReactNode } from "react";
import { CheckIcon, ChevronRightIcon, CopyIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { parseCodemodeResponse } from "iterate/agents/codemode-format";
import type { StreamEvent } from "./stream-event.ts";
import {
  formatAgentUiDuration,
  type AgentUiActivity,
  type AgentUiLlmStep,
} from "./agent-ui-reducer.ts";
import { sliceText, type StreamText } from "./chunked-text.ts";
import { formatDateTime, llmTrace, scriptTrace, type LlmTrace } from "./agent-events.ts";
import { MessageResponse } from "./message.tsx";
import { StreamingCursor, StreamingText } from "./streaming-text.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs.tsx";
import { Spinner } from "#/components/ui/spinner.tsx";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "#/components/ui/sheet.tsx";
import { CodeBlock, SerializedObjectCodeBlock } from "#/components/code-block.tsx";
import { ReadProgress } from "#/components/virtual-log/read-progress.tsx";
import { VirtualLog, type VirtualLogRowInfo } from "#/components/virtual-log/virtual-log.tsx";
import { Button } from "#/components/ui/button.tsx";

const READING_THE_LOG = "Reading the log…";

/** Which trace the sheet shows — at most one; the chat's state carries it. */
export type Inspected =
  | { kind: "llmRequest"; llmRequestOffset: number }
  | { kind: "scriptRun"; requestOffset: number }
  | null;

export function InspectorSheet({
  events,
  live,
  inspected,
  readProgress,
  onInspect,
}: {
  events: readonly StreamEvent[];
  /** The reduced live activity, so an in-flight request's trace streams its raw response. */
  live: AgentUiActivity | null;
  inspected: Inspected;
  /** How much of the log is held, from 0 to 1, while older pages are read for this trace: what it
   *  shows may yet grow. */
  readProgress: number | undefined;
  onInspect: (next: Inspected) => void;
}) {
  const reading = readProgress !== undefined;
  // The running llm step for the inspected request (if it is the one in flight): its responseText
  // and thinkingText are the chunk windows folded, i.e. the raw model output as it streams.
  const liveStep =
    inspected?.kind === "llmRequest"
      ? live?.steps.find(
          (step): step is AgentUiLlmStep =>
            step.kind === "llm" &&
            step.status === "running" &&
            step.llmRequestOffset === inspected.llmRequestOffset,
        )
      : undefined;
  return (
    <Sheet open={!!inspected} onOpenChange={(open) => !open && onInspect(null)}>
      <SheetContent
        side="right"
        className="flex flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:w-[min(92vw,64rem)] data-[side=right]:sm:max-w-[92vw]"
      >
        {readProgress === undefined ? null : (
          <div className="shrink-0 px-4 pt-4 pr-12">
            <ReadProgress label="Reading the log" value={readProgress} />
          </div>
        )}
        {inspected?.kind === "llmRequest" ? (
          <LlmTraceContent
            events={events}
            llmRequestOffset={inspected.llmRequestOffset}
            liveStep={liveStep}
            reading={reading}
            onInspect={onInspect}
          />
        ) : inspected?.kind === "scriptRun" ? (
          <ScriptTraceContent
            events={events}
            requestOffset={inspected.requestOffset}
            reading={reading}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

// ── the LLM request ──

function LlmTraceContent({
  events,
  llmRequestOffset,
  liveStep,
  reading,
  onInspect,
}: {
  events: readonly StreamEvent[];
  llmRequestOffset: number;
  liveStep: AgentUiLlmStep | undefined;
  reading: boolean;
  onInspect: (next: Inspected) => void;
}) {
  const trace = useMemo(() => llmTrace(events, llmRequestOffset), [events, llmRequestOffset]);
  const [renderMode, setRenderMode] = useState<"markdown" | "plain">("markdown");
  const [copied, setCopied] = useState(false);
  if (!trace)
    return (
      <>
        <SheetHeader>
          <SheetTitle>LLM trace #{llmRequestOffset}</SheetTitle>
          <SheetDescription>
            {reading
              ? READING_THE_LOG
              : `No LLM request at offset #${String(llmRequestOffset)} on this path.`}
          </SheetDescription>
        </SheetHeader>
      </>
    );
  const totalChars = trace.messages.reduce((sum, message) => sum + message.content.length, 0);
  return (
    <>
      <SheetHeader className="shrink-0 pr-12">
        <SheetTitle className="truncate">
          LLM trace #{llmRequestOffset} · {trace.model}
        </SheetTitle>
        <SheetDescription>
          {formatDateTime(trace.requestedAtMs)} · {trace.messages.length.toLocaleString()} messages
          · {totalChars.toLocaleString()} chars
          <Outcome outcome={trace.outcome} />
        </SheetDescription>
      </SheetHeader>
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 pb-3">
        <Button
          size="sm"
          variant="outline"
          aria-pressed={renderMode === "plain"}
          title="Toggle between rendered markdown and the verbatim wire text"
          onClick={() => setRenderMode(renderMode === "markdown" ? "plain" : "markdown")}
        >
          {renderMode === "markdown" ? "Markdown" : "Plain text"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={reading}
          title="Copy the request's messages as JSON"
          onClick={async () => {
            try {
              const messages = trace.messages.map(({ role, content }) => ({ role, content }));
              await navigator.clipboard.writeText(JSON.stringify({ messages }, null, 2));
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2_000);
            } catch {
              toast.error("Failed to copy to clipboard");
            }
          }}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          Copy JSON
        </Button>
        <span className="ml-auto text-2xs text-muted-foreground/70">
          rebuilt from the log: every context item before the request, as the agent sends them
        </span>
      </div>
      <TraceLog messages={trace.messages} renderMode={renderMode}>
        <ResponseView
          liveStep={liveStep}
          outcome={trace.outcome}
          onInspect={onInspect}
          scriptRequestOffset={trace.derived.scriptRequestOffset}
        />
        <Derived derived={trace.derived} onInspect={onInspect} />
      </TraceLog>
    </>
  );
}

const TRACE_ROWS: VirtualLogRowInfo<LlmTrace["messages"][number]> = {
  key: (row) => String(row.offset),
  // its header, and its text at about a hundred characters to a line of 24px, up to a tall row
  estimateSize: (row) => 56 + Math.min(4_000, Math.ceil(row.content.length / 100) * 24),
  offset: (row) => row.offset,
};

/** What the model was sent, as rows, and `children`, its answer, as the tail: a long agent's prompt
 *  is thousands of items. It opens on the answer, and the prompt arrives above it as older pages
 *  do. */
function TraceLog({
  messages,
  renderMode,
  children,
}: {
  messages: LlmTrace["messages"];
  renderMode: "markdown" | "plain";
  children: ReactNode;
}) {
  return (
    <VirtualLog
      rows={messages}
      rowInfo={TRACE_ROWS}
      renderRow={(row) => (
        <TraceMessage
          offset={row.offset}
          role={row.role}
          content={row.content}
          renderMode={renderMode}
        />
      )}
      tail={children}
      className="border-t"
    />
  );
}

/** Memoised by value: a trace is rebuilt as older pages arrive, and the words of a row are not. */
const TraceMessage = memo(function TraceMessage({
  offset,
  role,
  content,
  renderMode,
}: {
  offset: number;
  role: string;
  content: string;
  renderMode: "markdown" | "plain";
}) {
  return (
    <section className="border-b border-border/60 px-5 py-3">
      <div className="mb-2 flex items-baseline gap-2">
        <RoleChip name={role} />
        <span className="font-mono text-2xs text-muted-foreground/60">
          #{offset} · {content.length.toLocaleString()} chars
        </span>
      </div>
      <Body text={content} renderMode={renderMode} />
    </section>
  );
});

/** What the loop did with the answer: the prose it sent, the script it ran. */
function Derived({
  derived,
  onInspect,
}: {
  derived: LlmTrace["derived"];
  onInspect: (next: Inspected) => void;
}) {
  const { prose, scriptRequestOffset } = derived;
  if (!prose && !scriptRequestOffset) return null;
  return (
    <section className="px-5 py-3">
      <div className="mb-2 flex items-baseline gap-2">
        <RoleChip name="derived" />
        <span className="font-mono text-2xs text-muted-foreground/60">
          what the loop did with the answer
        </span>
      </div>
      <div className="flex flex-col gap-2 text-sm">
        {prose ? (
          <div>
            <span className="font-mono text-xs text-muted-foreground">sent to you:</span>
            <MessageResponse
              className="min-w-0 max-w-full overflow-hidden text-sm"
              mode="static"
              parseIncompleteMarkdown={false}
            >
              {prose}
            </MessageResponse>
          </div>
        ) : null}
        {scriptRequestOffset ? (
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => onInspect({ kind: "scriptRun", requestOffset: scriptRequestOffset })}
          >
            Ran a script — open its execution trace
            <ChevronRightIcon data-icon="inline-end" />
          </Button>
        ) : null}
      </div>
    </section>
  );
}

/** The trace's response half: the model's RAW output (streamed live from the chunk windows, or the
 *  settled text after the fact) syntax-highlighted, and the parsed script highlighted as TypeScript
 *  beside it — the two a person debugging a turn reads. Reasoning ("thinking") streams above while it
 *  is in flight; it is ephemeral, so it is gone once the turn settles. */
function ResponseView({
  liveStep,
  outcome,
  onInspect,
  scriptRequestOffset,
}: {
  liveStep: AgentUiLlmStep | undefined;
  outcome: LlmTrace["outcome"];
  onInspect: (next: Inspected) => void;
  scriptRequestOffset: number | undefined;
}) {
  const streaming = Boolean(liveStep);
  const thinking = liveStep && liveStep.thinkingText.length > 0 ? liveStep.thinkingText : null;
  const raw = rawResponseOf(liveStep, outcome);
  // The loop's own parser, so the pane shows exactly the script the loop runs; a streaming answer
  // shows none until its closing `</codemode>` line arrives.
  const parsed = raw ? parseCodemodeResponse(raw) : null;
  const script = parsed?.kind === "script" ? parsed.code : null;
  return (
    <section className="flex flex-col gap-3 border-b border-border/60 bg-muted/20 px-5 py-3">
      <div className="flex items-baseline gap-2">
        <RoleChip name="response" />
        <ResponseSize streaming={streaming} raw={raw} />
      </div>
      {thinking ? <Reasoning text={thinking} streaming={!raw} /> : null}
      {raw ? (
        <div>
          <p className="mb-1 font-mono text-2xs uppercase tracking-wider text-muted-foreground/60">
            raw response
          </p>
          <div className="max-h-96 overflow-y-auto rounded-lg">
            <CodeBlock code={raw} language="markdown" showLineNumbers={false} />
          </div>
        </div>
      ) : null}
      {script ? (
        <ParsedScript
          script={script}
          scriptRequestOffset={scriptRequestOffset}
          onInspect={onInspect}
        />
      ) : null}
      <ResponseEnd outcome={outcome} streaming={streaming} partialShown={Boolean(raw)} />
      {streaming && !raw && !thinking ? (
        <p className="font-readme flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-3" /> Waiting for the first tokens…
        </p>
      ) : null}
    </section>
  );
}

/** The model's raw output: what has streamed so far, or the settled text. */
function rawResponseOf(liveStep: AgentUiLlmStep | undefined, outcome: LlmTrace["outcome"]) {
  if (liveStep) return sliceText(liveStep.responseText);
  return outcome.status === "succeeded" ? outcome.text : null;
}

function ResponseSize({ streaming, raw }: { streaming: boolean; raw: string | null }) {
  if (streaming)
    return (
      <span className="inline-flex items-center gap-1 font-mono text-2xs text-muted-foreground/60">
        <Spinner className="size-2.5" /> streaming
      </span>
    );
  if (!raw) return null;
  return (
    <span className="font-mono text-2xs text-muted-foreground/60">
      {raw.length.toLocaleString()} chars
    </span>
  );
}

function Reasoning({ text, streaming }: { text: StreamText; streaming: boolean }) {
  return (
    <div>
      <p className="mb-1 font-mono text-2xs uppercase tracking-wider text-muted-foreground/60">
        reasoning
      </p>
      <div className="max-w-full whitespace-pre-wrap text-sm italic leading-relaxed text-muted-foreground">
        <StreamingText text={text} />
        {streaming ? <StreamingCursor /> : null}
      </div>
    </div>
  );
}

function ParsedScript({
  script,
  scriptRequestOffset,
  onInspect,
}: {
  script: string;
  scriptRequestOffset: number | undefined;
  onInspect: (next: Inspected) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <p className="font-mono text-2xs uppercase tracking-wider text-success">parsed script</p>
        {scriptRequestOffset ? (
          <Button
            variant="ghost"
            size="xs"
            className="font-normal text-muted-foreground"
            onClick={() => onInspect({ kind: "scriptRun", requestOffset: scriptRequestOffset })}
          >
            Execution trace
            <ChevronRightIcon data-icon="inline-end" className="text-muted-foreground/50" />
          </Button>
        ) : null}
      </div>
      <div className="max-h-96 overflow-y-auto rounded-lg">
        <CodeBlock code={script} language="typescript" showLineNumbers={false} />
      </div>
    </div>
  );
}

/** A request that did not succeed says so under what it wrote. */
function ResponseEnd({
  outcome,
  streaming,
  partialShown,
}: {
  outcome: LlmTrace["outcome"];
  streaming: boolean;
  partialShown: boolean;
}) {
  if (outcome.status === "failed")
    return (
      <pre
        data-type="error"
        className="overflow-x-auto rounded-xl bg-destructive/5 px-4 py-2.5 font-mono text-xs leading-relaxed text-destructive"
      >
        {outcome.errorMessage}
      </pre>
    );
  if (outcome.status !== "cancelled" || streaming) return null;
  return (
    <p className="font-readme text-sm text-muted-foreground">
      Cancelled{outcome.reason ? ` — ${outcome.reason}` : ""}
      {partialShown ? " (partial output above)" : ""}
    </p>
  );
}

function Outcome({ outcome }: { outcome: LlmTrace["outcome"] }) {
  if (outcome.status === "in flight") return <> · in flight</>;
  const duration =
    "durationMs" in outcome && outcome.durationMs != null
      ? ` in ${formatAgentUiDuration(outcome.durationMs)}`
      : "";
  return (
    <>
      {" · "}
      <span
        className={cn(
          outcome.status === "succeeded" && "text-success",
          outcome.status === "failed" && "text-destructive",
          outcome.status === "cancelled" && "text-warning",
        )}
      >
        {outcome.status}
        {duration}
      </span>
    </>
  );
}

function RoleChip({ name }: { name: string }) {
  return (
    <span
      className={cn(
        "font-mono text-2xs font-semibold uppercase tracking-wider",
        name === "system" && "text-foreground",
        name === "developer" && "text-muted-foreground",
        name === "user" && "text-info",
        name === "assistant" && "text-success",
        name === "response" && "text-warning",
        name === "derived" && "text-muted-foreground",
      )}
    >
      {name}
    </span>
  );
}

function Body({ text, renderMode }: { text: string; renderMode: "markdown" | "plain" }) {
  return renderMode === "markdown" ? (
    <MessageResponse
      className="min-w-0 max-w-full overflow-hidden text-sm"
      mode="static"
      parseIncompleteMarkdown={false}
    >
      {text}
    </MessageResponse>
  ) : (
    <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">
      {text}
    </pre>
  );
}

// ── the script run ──

function ScriptTraceContent({
  events,
  requestOffset,
  reading,
}: {
  events: readonly StreamEvent[];
  requestOffset: number;
  reading: boolean;
}) {
  const trace = scriptTrace(events, requestOffset);
  if (!trace)
    return (
      <SheetHeader>
        <SheetTitle>Script run #{requestOffset}</SheetTitle>
        <SheetDescription>
          {reading
            ? READING_THE_LOG
            : `No script run requested at offset #${String(requestOffset)} on this path.`}
        </SheetDescription>
      </SheetHeader>
    );
  const settlement = trace.settlement?.value;
  const failed = settlement?.status === "failed";
  return (
    <>
      <SheetHeader className="shrink-0 pr-12">
        <SheetTitle className="truncate">Script run #{requestOffset}</SheetTitle>
        <SheetDescription>
          {formatDateTime(trace.requestedAtMs)}
          {trace.settlement ? (
            <>
              {" · "}
              <span className={failed ? "text-destructive" : "text-success"}>
                {failed ? "failed" : "succeeded"} in{" "}
                {formatAgentUiDuration(trace.settlement.atMs - trace.requestedAtMs)}
              </span>
            </>
          ) : (
            " · running"
          )}
        </SheetDescription>
      </SheetHeader>
      <Tabs defaultValue="code" className="min-h-0 flex-1 gap-0">
        <TabsList variant="line" className="mx-4 h-8 shrink-0">
          <TabsTrigger value="code">Code</TabsTrigger>
          <TabsTrigger value="result">Result</TabsTrigger>
          <TabsTrigger value="agent">What the agent saw</TabsTrigger>
        </TabsList>
        <TabsContent value="code" className="min-h-0 flex-1 overflow-y-auto border-t p-4">
          <CodeBlock code={trace.code} language="typescript" />
        </TabsContent>
        <TabsContent value="result" className="min-h-0 flex-1 overflow-y-auto border-t p-4">
          {settlement ? (
            <SerializedObjectCodeBlock data={settlement} />
          ) : (
            <p className="font-readme text-sm text-muted-foreground">Not settled yet.</p>
          )}
        </TabsContent>
        <TabsContent value="agent" className="min-h-0 flex-1 overflow-y-auto border-t p-4">
          {trace.rendered ? (
            <MessageResponse
              className="min-w-0 max-w-full overflow-hidden text-sm"
              mode="static"
              parseIncompleteMarkdown={false}
            >
              {trace.rendered}
            </MessageResponse>
          ) : (
            <p className="font-readme text-sm text-muted-foreground">
              Nothing was appended to the agent's context for this run — a script that returns
              nothing ends the turn.
            </p>
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}
