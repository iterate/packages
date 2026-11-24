// The traces, inspector sheets built over the chat's own event array: the LLM request (what the
// model was asked, each attempt's exact body, what came back: llm-request-trace.ts) and the script
// run (the code, its settlement, what the model was told of it). One Sheet, opened by the chat's
// state (agent-chat-search.ts), so any trace is a shareable link. The Events view is the raw log:
// one row per event, click to inspect.
import { useMemo } from "react";
import type { StreamEvent } from "./stream-event.ts";
import {
  formatAgentUiDuration,
  type AgentUiActivity,
  type AgentUiItem,
  type AgentUiLlmStep,
} from "./agent-ui-reducer.ts";
import { formatDateTime, scriptTrace } from "./agent-events.ts";
import { llmRequestTrace } from "./llm-request-trace.ts";
import { LlmRequestTraceContent } from "./llm-request-trace-view.tsx";
import { MessageResponse } from "./message.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs.tsx";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "#/components/ui/sheet.tsx";
import { CodeBlock, SerializedObjectCodeBlock } from "#/components/code-block.tsx";
import { ReadProgress } from "#/components/virtual-log/read-progress.tsx";

const READING_THE_LOG = "Reading the log…";

/** Which trace the sheet shows — at most one; the chat's state carries it. */
export type Inspected =
  | { kind: "llmRequest"; llmRequestOffset: number }
  | { kind: "scriptRun"; requestOffset: number }
  | null;

export function InspectorSheet({
  events,
  live,
  items,
  inspected,
  readProgress,
  onInspect,
}: {
  events: readonly StreamEvent[];
  /** The reduced live activity, so an in-flight request's trace streams its raw response. */
  live: AgentUiActivity | null;
  /** The feed's settled rows, so a settled request of the agent (agent-facts.ts) shows the
   *  thinking that streamed while the page was open. */
  items?: readonly AgentUiItem[];
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
            items={items}
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
  items,
  reading,
  onInspect,
}: {
  events: readonly StreamEvent[];
  llmRequestOffset: number;
  liveStep: AgentUiLlmStep | undefined;
  items: readonly AgentUiItem[] | undefined;
  reading: boolean;
  onInspect: (next: Inspected) => void;
}) {
  const trace = useMemo(
    () => llmRequestTrace(events, llmRequestOffset),
    [events, llmRequestOffset],
  );
  if (!trace)
    return (
      <SheetHeader>
        <SheetTitle>LLM trace #{llmRequestOffset}</SheetTitle>
        <SheetDescription>
          {reading
            ? READING_THE_LOG
            : `No LLM request at offset #${String(llmRequestOffset)} on this path.`}
        </SheetDescription>
      </SheetHeader>
    );
  return (
    <LlmRequestTraceContent
      trace={trace}
      step={liveStep || settledStepOf(items, llmRequestOffset)}
      onScript={(requestOffset) => onInspect({ kind: "scriptRun", requestOffset })}
    />
  );
}

/** The settled llm step of the request at `llmRequestOffset` in the feed's rows, newest first. */
function settledStepOf(
  items: readonly AgentUiItem[] | undefined,
  llmRequestOffset: number,
): AgentUiLlmStep | undefined {
  for (const item of items?.toReversed() ?? []) {
    if (item.kind !== "activity") continue;
    const step = item.steps.find(
      (candidate): candidate is AgentUiLlmStep =>
        candidate.kind === "llm" && candidate.llmRequestOffset === llmRequestOffset,
    );
    if (step) return step;
  }
  return undefined;
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
          {trace.seen ? (
            <MessageResponse
              className="min-w-0 max-w-full overflow-hidden text-sm"
              mode="static"
              parseIncompleteMarkdown={false}
            >
              {trace.seen}
            </MessageResponse>
          ) : (
            <p className="font-readme text-sm text-muted-foreground">
              No request of the agent has read this run's result yet. A script that returns nothing
              starts no request: the next request reads its result.
            </p>
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}
