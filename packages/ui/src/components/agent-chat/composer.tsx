// The pill composer: a `+` menu (Message / Raw event, and Attach files), the CodeMirror message
// editor that grows with the draft, a raw-event editor that appends YAML or JSON to the agent's
// log, attachment chips with drag-and-drop, and one round button that sends — or, while a turn
// runs, STOPS it (an interruption is a property of the person's next input). A composer for an
// agent that does not exist yet has no log to append to, so it has no raw mode. On a narrow screen
// (below `sm`) it is compact: the buttons and padding shrink, so the words get the width and the
// chat keeps the height (a phone's keyboard takes half the screen).
import { useState, type DragEvent, type ReactNode } from "react";
import { parse as parseYaml } from "yaml";
import {
  ArrowUpIcon,
  FileCode2Icon,
  MessageSquareIcon,
  PaperclipIcon,
  PlusIcon,
  SquareIcon,
} from "lucide-react";
import { cn } from "cn";
import { AttachmentChips, AttachmentFileInput } from "./composer-attachments.tsx";
import { ComposerTextarea } from "./composer-textarea.tsx";
import { type ComposerDraft } from "./use-composer-attachments.ts";
import { Button } from "#/components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import { Spinner } from "#/components/ui/spinner.tsx";
import { CodeEditor } from "#/components/code-editor.tsx";

type AgentComposerMode = "message" | "raw";

type AgentComposerMessageConfig = {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => Promise<void> | void;
  attachments?: ReactNode;
  canSubmit: boolean;
  /** Open the file picker (the hidden input lives in the parent). */
  onAttach: () => void;
  /** Accept dropped or picked files (the same path as the picker). */
  onAddFiles: (files: FileList | null) => void;
  placeholder: string;
};

type AgentComposerRawConfig = {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => Promise<void> | void;
};

/** The pill itself. */
function AgentPillComposer({
  mode,
  onModeChange,
  message,
  raw,
  isSubmitting = false,
  error,
  autoFocusMessage = false,
  isInterrupting = false,
  onInterrupt,
}: {
  mode: AgentComposerMode;
  onModeChange: (mode: AgentComposerMode) => void;
  message: AgentComposerMessageConfig;
  /** Absent: no raw mode, and the `+` only attaches files. */
  raw: AgentComposerRawConfig | undefined;
  isSubmitting?: boolean;
  error?: string;
  autoFocusMessage?: boolean;
  isInterrupting?: boolean;
  onInterrupt?: () => Promise<void> | void;
}) {
  // the raw editor while it is the open mode; otherwise the message editor is
  const openRaw = mode === "raw" ? raw : undefined;
  const canSubmit = !isSubmitting && (openRaw ? openRaw.value.trim() !== "" : message.canSubmit);
  const showInterrupt = mode === "message" && !!onInterrupt;
  const { isDragging, dropHandlers } = useFileDrop({
    accepts: !isSubmitting,
    onFiles: (files) => {
      if (mode !== "message") onModeChange("message");
      message.onAddFiles(files);
    },
  });

  function submit() {
    if (!canSubmit) return;
    void (openRaw || message).onSubmit();
  }

  function interrupt() {
    if (isSubmitting || isInterrupting || !onInterrupt) return;
    void onInterrupt();
  }

  return (
    <div className="w-full">
      <ComposerError error={error} />
      <div
        {...dropHandlers}
        data-drop-active={isDragging ? "true" : undefined}
        className={cn(
          "flex items-end gap-1 rounded-3xl border bg-background p-1 shadow-sm transition-shadow sm:gap-2 sm:py-2 sm:pr-2 sm:pl-1.5",
          isDragging && "ring-2 ring-primary/40 border-primary/40",
        )}
      >
        <ComposerModeMenu
          mode={mode}
          onModeChange={onModeChange}
          hasRaw={Boolean(raw)}
          isSubmitting={isSubmitting}
          onAttach={message.onAttach}
        />
        {openRaw ? (
          <CodeEditor
            value={openRaw.value}
            onValueChange={openRaw.onValueChange}
            onSubmit={submit}
            focusOnMount
            placeholder={"type: events.iterate.com/note/added\npayload:\n  text: hello"}
            className="min-w-0 flex-1 px-2 py-1.5"
          />
        ) : (
          <div className="flex min-w-0 flex-1 flex-col">
            {message.attachments ? <div className="px-1 pb-1">{message.attachments}</div> : null}
            <ComposerTextarea
              value={message.value}
              onValueChange={message.onValueChange}
              onSubmit={submit}
              focusOnMount={autoFocusMessage}
              placeholder={message.placeholder}
            />
          </div>
        )}
        {showInterrupt ? (
          <ComposerStopButton
            onClick={interrupt}
            disabled={isSubmitting || isInterrupting}
            isInterrupting={isInterrupting}
          />
        ) : (
          <Button
            size="icon-lg"
            title={mode === "raw" ? "Append events (⌘↵)" : "Send message"}
            onClick={submit}
            disabled={!canSubmit}
            className="relative overflow-hidden rounded-full sm:pointer-coarse:size-11"
          >
            {isSubmitting ? <Spinner className="size-4" /> : <ArrowUpIcon className="size-4" />}
          </Button>
        )}
      </div>
    </div>
  );
}

/** The failures above the pill, if any. */
function ComposerError({ error }: { error: string | undefined }) {
  if (!error) return null;
  return (
    <p
      className="mb-2 ml-4 truncate font-mono text-xs text-destructive"
      role="alert"
      data-type="error"
    >
      {error}
    </p>
  );
}

/** Dropped files, claimed from the browser. Always claim file drags, even while `accepts` is off:
 *  letting the browser take the drop would navigate the tab to the dropped file. */
function useFileDrop({
  accepts,
  onFiles,
}: {
  accepts: boolean;
  onFiles: (files: FileList) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const dropHandlers = {
    onDragEnter(event: DragEvent<HTMLDivElement>) {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      if (accepts) setIsDragging(true);
    },
    onDragOver(event: DragEvent<HTMLDivElement>) {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = accepts ? "copy" : "none";
    },
    onDragLeave(event: DragEvent<HTMLDivElement>) {
      // `relatedTarget` is the element the pointer moved on to, or null once it left the window; the
      // DOM types it as a bare EventTarget, while for drags it is always a node — what `contains` reads.
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      setIsDragging(false);
    },
    onDrop(event: DragEvent<HTMLDivElement>) {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      setIsDragging(false);
      if (accepts) onFiles(event.dataTransfer.files);
    },
  };
  return { isDragging, dropHandlers };
}

/** The `+`: Message or Raw event when there is a raw mode, and Attach files. */
function ComposerModeMenu({
  mode,
  onModeChange,
  hasRaw,
  isSubmitting,
  onAttach,
}: {
  mode: AgentComposerMode;
  onModeChange: (mode: AgentComposerMode) => void;
  hasRaw: boolean;
  isSubmitting: boolean;
  onAttach: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-lg"
            title="Composer mode"
            className="rounded-full sm:pointer-coarse:size-11"
          />
        }
      >
        <PlusIcon className="size-4.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-60">
        {hasRaw ? (
          <>
            <DropdownMenuRadioGroup
              value={mode}
              onValueChange={(value) => onModeChange(value === "raw" ? "raw" : "message")}
            >
              <DropdownMenuRadioItem value="message" closeOnClick>
                <MessageSquareIcon className="text-muted-foreground" />
                <span className="flex min-w-0 flex-1 flex-col py-0.5">
                  <span className="font-medium">Message</span>
                  <span className="text-xs text-muted-foreground">Chat with this agent</span>
                </span>
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="raw" closeOnClick>
                <FileCode2Icon className="text-muted-foreground" />
                <span className="flex min-w-0 flex-1 flex-col py-0.5">
                  <span className="font-medium">Raw event</span>
                  <span className="text-xs text-muted-foreground">Append YAML or JSON</span>
                </span>
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem
          disabled={isSubmitting}
          onClick={() => {
            // Attachments belong to the message draft; leaving raw mode here keeps the picked
            // files visible.
            if (mode !== "message") onModeChange("message");
            onAttach();
          }}
        >
          <PaperclipIcon className="text-muted-foreground" />
          <span className="flex min-w-0 flex-1 flex-col py-0.5">
            <span className="font-medium">Attach files</span>
            <span className="text-xs text-muted-foreground">Send along with a message</span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The round button while a turn runs: it stops it. */
function ComposerStopButton({
  onClick,
  disabled,
  isInterrupting,
}: {
  onClick: () => void;
  disabled: boolean;
  isInterrupting: boolean;
}) {
  return (
    <Button
      size="icon-lg"
      data-spinner="true"
      title="Stop generation"
      onClick={onClick}
      disabled={disabled}
      className="relative overflow-hidden rounded-full sm:pointer-coarse:size-11"
    >
      <span
        aria-hidden
        className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary border-r-primary/40 animate-spin"
      />
      {isInterrupting ? (
        <Spinner className="size-4" />
      ) : (
        <SquareIcon className="size-3.5 fill-current" />
      )}
    </Button>
  );
}

/** An in-flight turn's interrupt affordance, owned by the chat (the queued-messages panel shows
 *  the same one). `error` surfaces in the composer's error line beside submit failures. */
export type StreamInterrupt = {
  run: () => Promise<void>;
  isInterrupting: boolean;
  error?: string;
};

/** A file as the agent's `message()` takes it: a data URL for `data`. */
type OutgoingFile = { contentType: string; filename: string; data: string };

/** Browser files as the agent's `message()` takes them. */
function filesToPayload(files: readonly File[]): Promise<OutgoingFile[]> {
  return Promise.all(
    files.map(
      (file) =>
        new Promise<OutgoingFile>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () =>
            resolve({
              contentType: file.type || "application/octet-stream",
              filename: file.name,
              data: String(reader.result),
            });
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        }),
    ),
  );
}

/** The composer's state — mode, the raw text, the submit error — around the pill; the page supplies
 *  the draft, what a submit does and the running turn's interrupt. */
export function AgentComposer({
  draft,
  placeholder,
  onSubmit,
  onAppendRaw,
  interrupt,
  autoFocusMessage = false,
}: {
  draft: ComposerDraft;
  /** The empty editor's text, which also names its textbox. */
  placeholder: string;
  onSubmit: (input: { message: string; files: OutgoingFile[] }) => Promise<void>;
  /** Absent: no raw mode. */
  onAppendRaw: ((events: unknown[]) => Promise<void>) | undefined;
  /** Null while no turn is running. */
  interrupt: StreamInterrupt | null;
  autoFocusMessage?: boolean;
}) {
  const { message, setMessage, attachments } = draft;
  const [mode, setMode] = useState<AgentComposerMode>("message");
  const [rawText, setRawText] = useState(
    "type: events.iterate.com/note/added\npayload:\n  text: Hello from the agents page\n",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string>();

  async function runSubmit(action: () => Promise<void>): Promise<boolean> {
    setIsSubmitting(true);
    setSubmitError(undefined);
    try {
      await action();
      return true;
    } catch (failure) {
      setSubmitError(failure instanceof Error ? failure.message : String(failure));
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitMessage() {
    const text = message.trim();
    if (text === "" && attachments.files.length === 0) return;
    const didSubmit = await runSubmit(async () =>
      onSubmit({
        message: text || "(see attached)",
        files: await filesToPayload(attachments.files),
      }),
    );
    if (didSubmit) {
      // what was written while it was sending is the next message
      setMessage((current) => (current === message ? "" : current));
      attachments.clearFiles();
    }
  }

  async function submitRawEvents(append: (events: unknown[]) => Promise<void>) {
    const trimmed = rawText.trim();
    if (!trimmed) return;
    await runSubmit(async () => {
      const parsed: unknown = parseYaml(trimmed);
      await append(Array.isArray(parsed) ? parsed : [parsed]);
    });
  }

  // File validation, submit, and interrupt failures have independent lifecycles, so none may
  // mask the others — show all active messages.
  const error =
    [attachments.fileError, submitError, interrupt?.error].filter(Boolean).join(" · ") || undefined;

  return (
    <>
      <AttachmentFileInput attachments={attachments} />
      <AgentPillComposer
        mode={mode}
        onModeChange={setMode}
        autoFocusMessage={autoFocusMessage}
        message={{
          value: message,
          onValueChange: setMessage,
          onSubmit: submitMessage,
          canSubmit: message.trim() !== "" || attachments.files.length > 0,
          attachments:
            attachments.entries.length === 0 ? undefined : (
              <AttachmentChips entries={attachments.entries} onRemove={attachments.removeFile} />
            ),
          onAttach: attachments.openFilePicker,
          onAddFiles: attachments.addFiles,
          placeholder,
        }}
        raw={
          onAppendRaw
            ? {
                value: rawText,
                onValueChange: setRawText,
                onSubmit: () => submitRawEvents(onAppendRaw),
              }
            : undefined
        }
        isSubmitting={isSubmitting}
        error={error}
        isInterrupting={interrupt?.isInterrupting}
        onInterrupt={interrupt?.run}
      />
    </>
  );
}
