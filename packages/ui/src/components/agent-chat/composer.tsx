// The pill composer: a `+` menu (Message / Raw event, and Attach files), the CodeMirror message
// editor that grows with the draft, a raw-event editor that appends YAML or JSON to the agent's
// log, attachment chips with drag-and-drop and paste, and one round button of one size: Send when
// the draft can be sent, also while a turn runs (the message then waits in the queue), and STOP
// while a turn runs and the draft is empty (an interruption is a property of the person's next
// input). A composer for an agent that does not exist yet has no log to append to, so it has no raw
// mode. `attach={false}` takes words only: no `+`, no files, no raw mode. On a narrow screen (below
// `sm`) the padding shrinks, so the words get the width and the chat keeps the height (a phone's
// keyboard takes half the screen); a touch screen's buttons are a finger's size at every width.
import { useRef, useState, type DragEvent, type ReactNode } from "react";
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
  /** Accept dropped, pasted or picked files (the same path as the picker). */
  onAddFiles: (files: FileList | readonly File[] | null) => void;
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
  attach = true,
  topLip,
  below,
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
  /** `false`: words only: no `+` (no files, no raw mode), and a paste or drop adds no file. */
  attach?: boolean;
  /** Optional unified status / activity-stack lip attached directly to the top of the composer card. */
  topLip?: ReactNode;
  /** Quiet bar rendered below the composer pill (context utilization, model settings, sticky notices). */
  below?: ReactNode;
}) {
  // the raw editor while it is the open mode; otherwise the message editor is
  const openRaw = mode === "raw" ? raw : undefined;
  const canSubmit = !isSubmitting && (openRaw ? openRaw.value.trim() !== "" : message.canSubmit);
  // Stop only while there is nothing to send: words written during a turn are sent, and queue
  const stops = mode === "message" && Boolean(onInterrupt) && !message.canSubmit && !isSubmitting;
  // files come in by the `+`, a drop or a paste, and by none of them while a message is sent
  const takesFiles = attach && !isSubmitting;
  const { isDragging, dropHandlers } = useFileDrop({
    accepts: takesFiles,
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
        className={cn(
          "group/composer-card rounded-3xl transition-shadow has-[[data-composer-lip]]:border has-[[data-composer-lip]]:border-border has-[[data-composer-lip]]:bg-muted/45 has-[[data-composer-lip]]:shadow-sm",
          isDragging &&
            "has-[[data-composer-lip]]:border-primary/40 has-[[data-composer-lip]]:ring-2 has-[[data-composer-lip]]:ring-primary/40",
        )}
      >
        <ComposerSlot className="px-3.5 py-1">{topLip}</ComposerSlot>
        <div
          {...dropHandlers}
          data-drop-active={isDragging ? "true" : undefined}
          className={cn(
            "flex items-end gap-1 rounded-3xl border bg-background p-1 shadow-sm transition-shadow sm:py-2 sm:pr-2 sm:pl-1.5 group-has-[[data-composer-lip]]/composer-card:border-x-0 group-has-[[data-composer-lip]]/composer-card:border-b-0 group-has-[[data-composer-lip]]/composer-card:shadow-none",
            isDragging &&
              "border-primary/40 ring-2 ring-primary/40 group-has-[[data-composer-lip]]/composer-card:ring-0",
          )}
        >
          {attach ? (
            <ComposerModeMenu
              mode={mode}
              onModeChange={onModeChange}
              hasRaw={Boolean(raw)}
              isSubmitting={isSubmitting}
              onAttach={message.onAttach}
            />
          ) : null}
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
            <ComposerMessageEditor
              message={message}
              onSubmit={submit}
              focusOnMount={autoFocusMessage}
              takesFiles={takesFiles}
            />
          )}
          <ComposerRoundButton
            stops={stops}
            sendTitle={mode === "raw" ? "Append events (⌘↵)" : "Send message"}
            canSubmit={canSubmit}
            isSubmitting={isSubmitting}
            isInterrupting={isInterrupting}
            onSubmit={submit}
            onInterrupt={interrupt}
          />
        </div>
      </div>
      <ComposerSlot dataSlot="composer-below" className="px-2 pt-1.5">
        {below}
      </ComposerSlot>
    </div>
  );
}

function ComposerSlot({
  dataSlot,
  className,
  children,
}: {
  dataSlot?: string;
  className: string;
  children: ReactNode;
}) {
  if (!children) return null;
  return (
    <div data-slot={dataSlot} className={cn(className, "empty:hidden")}>
      {children}
    </div>
  );
}

/** The message mode's editor: the attachments over the words. */
function ComposerMessageEditor({
  message,
  onSubmit,
  focusOnMount,
  takesFiles,
}: {
  message: AgentComposerMessageConfig;
  onSubmit: () => void;
  focusOnMount: boolean;
  /** A pasted file becomes an attachment. */
  takesFiles: boolean;
}) {
  return (
    <div
      className="flex min-w-0 flex-1 flex-col"
      onPaste={(event) => {
        // A pasted screenshot is an attachment, as from the `+`. Text in the same paste still
        // pastes: the editor takes it, so this handler never calls preventDefault.
        const files = clipboardFiles(event.clipboardData);
        if (takesFiles && files.length > 0) message.onAddFiles(files);
      }}
    >
      {message.attachments ? <div className="px-1 pb-1">{message.attachments}</div> : null}
      <ComposerTextarea
        value={message.value}
        onValueChange={message.onValueChange}
        onSubmit={onSubmit}
        focusOnMount={focusOnMount}
        placeholder={message.placeholder}
      />
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

/** The files a paste holds. A browser fills `files`, or only the items of kind "file". */
function clipboardFiles(data: Pick<DataTransfer, "files" | "items">): File[] {
  if (data.files.length > 0) return Array.from(data.files);
  return Array.from(data.items).flatMap((item) => {
    const file = item.kind === "file" ? item.getAsFile() : null;
    return file ? [file] : [];
  });
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
            className="rounded-full pointer-coarse:size-11"
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

/** The round button: it sends, or (`stops`) it stops the running turn, a square in a turning ring.
 *  One button, so Send and Stop stand at the same place at the same size. */
function ComposerRoundButton({
  stops,
  sendTitle,
  canSubmit,
  isSubmitting,
  isInterrupting,
  onSubmit,
  onInterrupt,
}: {
  stops: boolean;
  sendTitle: string;
  canSubmit: boolean;
  isSubmitting: boolean;
  isInterrupting: boolean;
  onSubmit: () => void;
  onInterrupt: () => void;
}) {
  return (
    <Button
      size="icon-lg"
      title={stops ? "Stop generation" : sendTitle}
      data-spinner={stops ? "true" : undefined}
      onClick={stops ? onInterrupt : onSubmit}
      disabled={stops ? isInterrupting : !canSubmit}
      className="relative overflow-hidden rounded-full pointer-coarse:size-11"
    >
      {stops ? (
        <span
          aria-hidden
          className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary border-r-primary/40 animate-spin"
        />
      ) : null}
      {/* what it does is under way */}
      {(stops ? isInterrupting : isSubmitting) ? (
        <Spinner className="size-4" />
      ) : stops ? (
        <SquareIcon className="size-3.5 fill-current" />
      ) : (
        <ArrowUpIcon className="size-4" />
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
  attach = true,
  onTyping,
  topLip,
  below,
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
  /** `false`: the composer takes words only: no `+`, so no files and no raw mode (`onAppendRaw` is
   *  not offered), and a paste or drop of files adds none. */
  attach?: boolean;
  /** The person writes (`true`, on each change that leaves words in the box), or has stopped:
   *  the box is empty, or the words were sent. For a page that shows the others who is typing. */
  onTyping?: (isTyping: boolean) => void;
  /** Optional unified status / activity-stack lip attached directly to the top of the composer card. */
  topLip?: ReactNode;
  /** Optional slot rendered directly below the composer pill (context management, sticky notices). */
  below?: ReactNode;
}) {
  const { message, setMessage, attachments } = draft;
  const [mode, setMode] = useState<AgentComposerMode>("message");
  const [rawText, setRawText] = useState(
    "type: events.iterate.com/note/added\npayload:\n  text: Hello from the agents page\n",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string>();
  /** Synchronous lock: blocks a second Return or click before React commits `isSubmitting`. */
  const submitting = useRef(false);
  /** Each change of the words counts one: a send restores or ends what it sent, never a newer draft. */
  const revision = useRef(0);

  async function runSubmit(action: () => Promise<void>): Promise<boolean> {
    if (submitting.current) return false;
    submitting.current = true;
    setIsSubmitting(true);
    setSubmitError(undefined);
    try {
      await action();
      return true;
    } catch (failure) {
      setSubmitError(failure instanceof Error ? failure.message : String(failure));
      return false;
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  }

  async function submitMessage() {
    if (submitting.current) return;
    const draftMessage = message;
    const text = draftMessage.trim();
    if (text === "" && attachments.files.length === 0) return;
    const sent = revision.current;
    // Clear the sent text at once so typing while the send is in flight starts a fresh draft.
    if (draftMessage)
      setMessage((current) => {
        if (!current.startsWith(draftMessage)) return current;
        return current.slice(draftMessage.length);
      });
    const didSubmit = await runSubmit(async () =>
      onSubmit({
        message: text || "(see attached)",
        files: await filesToPayload(attachments.files),
      }),
    );
    if (!didSubmit) {
      if (draftMessage && revision.current === sent) setMessage(draftMessage);
      return;
    }
    attachments.clearFiles();
    // what was written while it was sending is the next message, and its person still types
    if (revision.current !== sent) return;
    onTyping?.(false);
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
      {attach ? <AttachmentFileInput attachments={attachments} /> : null}
      <AgentPillComposer
        mode={mode}
        onModeChange={setMode}
        attach={attach}
        autoFocusMessage={autoFocusMessage}
        message={{
          value: message,
          onValueChange: (value) => {
            revision.current += 1;
            setMessage(value);
            onTyping?.(value.trim() !== "");
          },
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
          attach && onAppendRaw
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
        topLip={topLip}
        below={below}
      />
    </>
  );
}
