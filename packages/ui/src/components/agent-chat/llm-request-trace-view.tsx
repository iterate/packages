// THE TRACE SHEET'S BODY for a request of the agent (llm-request-trace.ts), for every LLM: what it
// asked (the instructions, then the conversation, a virtual list: a long agent's is thousands of
// items), each attempt's exact body as JSON in the provider's own form, and what came back (the
// thinking, the text, a failure's reason, the usage and the cost). The API shape is a name the
// attempt gives: the sheet knows no provider.
import { memo, useMemo, useState, type ReactNode } from "react";
import { ChevronRightIcon, PaperclipIcon } from "lucide-react";
import { cn } from "cn";
import { formatAgentUiDuration, type AgentUiLlmStep } from "./agent-ui-reducer.ts";
import { sliceText } from "./chunked-text.ts";
import { formatDateTime, formatFileSize } from "./agent-events.ts";
import type {
  LlmRequestAttempt,
  LlmRequestOutcome,
  LlmRequestTrace,
  LlmRequestTraceItem,
  LlmRequestUsage,
} from "./llm-request-trace.ts";
import { MessageResponse } from "./message.tsx";
import { StreamingCursor, StreamingText } from "./streaming-text.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs.tsx";
import { SheetDescription, SheetHeader, SheetTitle } from "#/components/ui/sheet.tsx";
import { Spinner } from "#/components/ui/spinner.tsx";
import { Button } from "#/components/ui/button.tsx";
import { SerializedObjectCodeBlock } from "#/components/code-block.tsx";
import { VirtualLog, type VirtualLogRowInfo } from "#/components/virtual-log/virtual-log.tsx";

/** A row of the conversation tab: the instructions, or an item. */
type Row = LlmRequestTraceItem & { key: string };

const ROWS: VirtualLogRowInfo<Row> = {
  key: (row) => row.key,
  // its header, and its text at about a hundred characters to a line of 24px, up to a tall row
  estimateSize: (row) => 56 + Math.min(4_000, Math.ceil(row.text.length / 100) * 24),
  offset: (row) => row.atOffset,
};

export function LlmRequestTraceContent({
  trace,
  step,
  onScript,
}: {
  trace: LlmRequestTrace;
  /** The request's step in the feed: its streamed thinking and words. */
  step: AgentUiLlmStep | undefined;
  onScript: (requestOffset: number) => void;
}) {
  const [renderMode, setRenderMode] = useState<"markdown" | "plain">("markdown");
  const rows = useMemo<Row[]>(
    () => [
      ...(trace.instructions
        ? [{ key: "instructions", role: "instructions", text: trace.instructions, files: [] }]
        : []),
      ...trace.conversation.map((item, index) => ({ ...item, key: String(index) })),
    ],
    [trace.instructions, trace.conversation],
  );
  const apis = [...new Set(trace.attempts.flatMap((attempt) => attempt.api || []))];
  return (
    <>
      <SheetHeader className="shrink-0 pr-12">
        <SheetTitle className="truncate">
          LLM trace #{trace.llmRequestOffset} · {trace.model}
        </SheetTitle>
        <SheetDescription>
          {formatDateTime(trace.requestedAtMs)}
          {apis.length > 0 ? ` · ${apis.join(", ")}` : ""}
          {trace.purpose === "answer" ? "" : ` · ${trace.purpose} request`}
          {` · ${trace.conversation.length.toLocaleString()} items`}
          <OutcomeText outcome={trace.outcome} />
          {trace.usage ? ` · ${usageLine(trace.usage)}` : ""}
        </SheetDescription>
      </SheetHeader>
      <Tabs defaultValue="conversation" className="min-h-0 flex-1 gap-0">
        <div className="flex shrink-0 items-center gap-2 px-4">
          <TabsList variant="line" className="h-8">
            <TabsTrigger value="conversation">Conversation</TabsTrigger>
            <TabsTrigger value="body">Request body</TabsTrigger>
            <TabsTrigger value="response">Response</TabsTrigger>
          </TabsList>
          <Button
            size="xs"
            variant="ghost"
            className="ml-auto font-normal text-muted-foreground"
            aria-pressed={renderMode === "plain"}
            title="Toggle between rendered markdown and the verbatim text"
            onClick={() => setRenderMode(renderMode === "markdown" ? "plain" : "markdown")}
          >
            {renderMode === "markdown" ? "Markdown" : "Plain text"}
          </Button>
        </div>
        <TabsContent value="conversation" className="flex min-h-0 flex-1 flex-col border-t">
          {trace.conversationWhole ? null : (
            <p className="font-readme shrink-0 px-5 py-2 text-xs text-muted-foreground">
              A base of this request is not in the log held: its items are missing here. The request
              body has them as they were sent.
            </p>
          )}
          <VirtualLog
            rows={rows}
            rowInfo={ROWS}
            renderRow={(row) => <ItemRow item={row} renderMode={renderMode} />}
            className="min-h-0 flex-1"
          />
        </TabsContent>
        <TabsContent value="body" className="min-h-0 flex-1 overflow-y-auto border-t">
          {trace.attempts.length === 0 ? (
            <p className="font-readme px-5 py-3 text-sm text-muted-foreground">
              No attempt has started yet.
            </p>
          ) : (
            trace.attempts.map((attempt) => <AttemptBody key={attempt.attempt} attempt={attempt} />)
          )}
        </TabsContent>
        <TabsContent value="response" className="min-h-0 flex-1 overflow-y-auto border-t">
          <ResponsePane trace={trace} step={step} renderMode={renderMode} onScript={onScript} />
        </TabsContent>
      </Tabs>
    </>
  );
}

/** Memoised by value: a trace is rebuilt as older pages arrive, and the words of a row are not. */
const ItemRow = memo(function ItemRow({
  item,
  renderMode,
}: {
  item: Row;
  renderMode: "markdown" | "plain";
}) {
  return (
    <section className="border-b border-border/60 px-5 py-3">
      <div className="mb-2 flex items-baseline gap-2">
        <Role name={item.role} />
        <span className="font-mono text-2xs text-muted-foreground/60">
          {item.atOffset === undefined ? "" : `#${String(item.atOffset)} · `}
          {item.tag ? `${item.tag} · ` : ""}
          {item.text.length.toLocaleString()} chars
        </span>
      </div>
      {item.files.length > 0 ? (
        <ul className="mb-2 flex flex-col gap-0.5">
          {item.files.map((file) => (
            <li
              key={file.path}
              className="flex items-center gap-1.5 font-mono text-2xs text-muted-foreground"
              title={file.path}
            >
              <PaperclipIcon className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate">
                {file.filename} · {file.contentType} · {formatFileSize(file.size)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <Text text={item.text} renderMode={renderMode} />
    </section>
  );
});

/** One attempt's exact body, as JSON, and what the attempt says of itself. */
function AttemptBody({ attempt }: { attempt: LlmRequestAttempt }) {
  const facts = [
    attempt.api || "no API shape",
    attempt.transport,
    attempt.model,
    attempt.inputFileBytes ? `${formatFileSize(attempt.inputFileBytes)} of files` : undefined,
  ].filter(Boolean);
  return (
    <section className="flex flex-col gap-2 border-b border-border/60 px-5 py-3">
      <div className="flex items-baseline gap-2">
        <Role name={`attempt ${String(attempt.attempt + 1)}`} />
        <span className="min-w-0 truncate font-mono text-2xs text-muted-foreground/60">
          {facts.join(" · ")} · {formatDateTime(attempt.startedAtMs)}
        </span>
      </div>
      {attempt.body ? (
        <>
          <div className="max-h-[70vh] overflow-y-auto rounded-lg">
            <SerializedObjectCodeBlock data={attempt.body} initialFormat="json" />
          </div>
          <p className="font-readme text-2xs text-muted-foreground/70">
            The body as it went to the provider. A file's bytes are a <code>$file</code> reference
            here.
            {attempt.bodySha256 ? ` The real body's SHA-256: ${attempt.bodySha256}.` : ""}
          </p>
        </>
      ) : (
        <p className="font-readme text-sm text-muted-foreground">{attempt.bodyMissing}</p>
      )}
    </section>
  );
}

/** What came back: the thinking and the words while they stream, then the settled text, a
 *  failure's reason, or the cancellation, and what it cost. */
function ResponsePane({
  trace,
  step,
  renderMode,
  onScript,
}: {
  trace: LlmRequestTrace;
  step: AgentUiLlmStep | undefined;
  renderMode: "markdown" | "plain";
  onScript: (requestOffset: number) => void;
}) {
  const { outcome } = trace;
  const streaming = step?.status === "running";
  const thinking = step && step.thinkingText.length > 0 ? step.thinkingText : null;
  const text =
    outcome.status === "succeeded"
      ? outcome.text
      : streaming && step
        ? sliceText(step.responseText)
        : outcome.status === "in flight"
          ? ""
          : outcome.partialText || "";
  return (
    <div className="flex flex-col gap-3 px-5 py-3">
      {thinking ? (
        <div>
          <Caption>thinking</Caption>
          <div className="whitespace-pre-wrap text-sm italic leading-relaxed text-muted-foreground">
            <StreamingText text={thinking} />
            {streaming && text === "" ? <StreamingCursor /> : null}
          </div>
        </div>
      ) : streaming && step?.thinking ? (
        <p className="font-readme flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-3" /> Thinking, with no words for it…
        </p>
      ) : null}
      {text ? (
        <div>
          <Caption>{outcome.status === "succeeded" ? "response" : "what had streamed"}</Caption>
          <Text text={text} renderMode={renderMode} />
        </div>
      ) : streaming && !thinking && !step?.thinking ? (
        <p className="font-readme flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-3" /> Waiting for the first tokens…
        </p>
      ) : null}
      {outcome.status === "failed" ? (
        <pre
          data-type="error"
          className="overflow-x-auto whitespace-pre-wrap rounded-xl bg-destructive/5 px-4 py-2.5 font-mono text-xs leading-relaxed text-destructive"
        >
          {outcome.failureKind ? `${outcome.failureKind}: ` : ""}
          {outcome.errorMessage}
        </pre>
      ) : null}
      {outcome.status === "cancelled" ? (
        <p className="font-readme text-sm text-muted-foreground">
          Cancelled{outcome.reason ? `: ${outcome.reason}` : ""}
        </p>
      ) : null}
      {trace.usage ? <UsageList usage={trace.usage} /> : null}
      {trace.scriptRequestOffsets.map((offset) => (
        <Button
          key={offset}
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => onScript(offset)}
        >
          Ran a script: open its execution trace
          <ChevronRightIcon data-icon="inline-end" />
        </Button>
      ))}
    </div>
  );
}

function UsageList({ usage }: { usage: LlmRequestUsage }) {
  const rows: [string, string][] = [];
  if (usage.inputTokens !== undefined)
    rows.push(["input tokens", usage.inputTokens.toLocaleString()]);
  if (usage.cachedInputTokens !== undefined)
    rows.push(["cached input", usage.cachedInputTokens.toLocaleString()]);
  if (usage.cacheWriteInputTokens !== undefined)
    rows.push(["cache written", usage.cacheWriteInputTokens.toLocaleString()]);
  if (usage.outputTokens !== undefined)
    rows.push(["output tokens", usage.outputTokens.toLocaleString()]);
  if (usage.reasoningOutputTokens !== undefined)
    rows.push(["reasoning", usage.reasoningOutputTokens.toLocaleString()]);
  if (usage.costUsd !== undefined) rows.push(["cost", dollars(usage.costUsd)]);
  return (
    <div>
      <Caption>usage{usage.estimated ? " (estimated: the provider gave no count)" : ""}</Caption>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-xs">
        {rows.map(([name, value]) => (
          <div key={name} className="contents">
            <dt className="text-muted-foreground">{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The usage in one line: tokens in and out, and the cost. */
export function usageLine(usage: LlmRequestUsage): string {
  const parts: string[] = [];
  if (usage.inputTokens !== undefined)
    parts.push(
      `${usage.inputTokens.toLocaleString()} in${usage.cachedInputTokens ? ` (${usage.cachedInputTokens.toLocaleString()} cached)` : ""}`,
    );
  if (usage.outputTokens !== undefined) parts.push(`${usage.outputTokens.toLocaleString()} out`);
  if (usage.costUsd !== undefined) parts.push(dollars(usage.costUsd));
  return parts.join(" · ");
}

const dollars = (usd: number) => `$${usd < 0.01 ? usd.toPrecision(3) : usd.toFixed(2)}`;

function OutcomeText({ outcome }: { outcome: LlmRequestOutcome }) {
  if (outcome.status === "in flight") return <> · in flight</>;
  const duration =
    outcome.durationMs === undefined ? "" : ` in ${formatAgentUiDuration(outcome.durationMs)}`;
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

function Caption({ children }: { children: ReactNode }) {
  return (
    <p className="mb-1 font-mono text-2xs uppercase tracking-wider text-muted-foreground/60">
      {children}
    </p>
  );
}

function Role({ name }: { name: string }) {
  return (
    <span
      className={cn(
        "font-mono text-2xs font-semibold uppercase tracking-wider text-muted-foreground",
        name === "instructions" && "text-foreground",
        name === "user" && "text-info",
        name === "assistant" && "text-success",
      )}
    >
      {name}
    </span>
  );
}

function Text({ text, renderMode }: { text: string; renderMode: "markdown" | "plain" }) {
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
