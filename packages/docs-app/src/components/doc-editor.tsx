import { useCallback, useSyncExternalStore } from "react";
import type { EditorView } from "@codemirror/view";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  MessageSquarePlus,
  Minus,
  Pilcrow,
  Redo2,
  Strikethrough,
  Table,
  TextQuote,
  Undo2,
} from "lucide-react";
import { AppShellPageHeader, AppShellPageMenu } from "@iterate-com/ui/components/app-shell";
import { StreamLink, streamHref, type StreamTarget } from "@iterate-com/ui/components/stream-link";
import { Button } from "@iterate-com/ui/components/ui/button";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "@iterate-com/ui/components/ui/dropdown-menu";
import { NativeSelect, NativeSelectOption } from "@iterate-com/ui/components/ui/native-select";
import { Separator } from "@iterate-com/ui/components/ui/separator";
import {
  insertBlock,
  promptLink,
  setLinePrefix,
  TABLE_TEMPLATE,
  toggleWrap,
} from "../editor/commands.ts";
import type { DocMode, DocSession, DocStatus } from "../editor/doc-session.ts";
import { CommentsPanel } from "./comments-panel.tsx";

/** The views each kind of file switches between, by label; a code file has one. */
const modes: Record<"markdown" | "html" | "code", [DocMode, string][]> = {
  markdown: [
    ["rich", "Rich"],
    ["markdown", "Markdown"],
  ],
  html: [
    ["preview", "Preview"],
    ["source", "Source"],
  ],
  code: [],
};

/** The doc page's editor: one row in the shell's header (the doc's path, markdown's formatting bar,
 *  who else is here, the view switch, Stream ↗), the text (or an html file's preview) with its
 *  comments beside it, and where saving stands. On a phone the row's controls are in the header's ⋯
 *  menu instead. */
export function DocEditor({
  session,
  path,
  back,
  stream,
}: {
  session: DocSession;
  path: string;
  /** a link back to the doc list */
  back: React.ReactNode;
  /** the doc's context, which "Stream ↗" opens in the dash */
  stream: StreamTarget;
}) {
  const state = useSyncExternalStore(session.subscribe, session.state, session.state);
  const { kind } = session.options;
  const views = modes[kind];
  const streamUrl = streamHref(stream);
  return (
    <div className="flex flex-1 flex-col">
      <AppShellPageMenu>
        <DropdownMenuGroup>
          <DropdownMenuItem
            disabled={state.status.kind === "opening"}
            onClick={() => session.startComment()}
          >
            <MessageSquarePlus />
            Comment
          </DropdownMenuItem>
        </DropdownMenuGroup>
        {views.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              aria-label="Mode"
              value={state.mode}
              onValueChange={(mode: DocMode) => session.setMode(mode)}
            >
              {views.map(([mode, label]) => (
                <DropdownMenuRadioItem key={mode} value={mode} closeOnClick>
                  {label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        ) : null}
        {kind === "markdown" ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup aria-label="Formatting" className="grid grid-cols-6">
              {[...FORMATTING.flat(), ...BLOCK_TYPES].map(({ label, icon, run }) => (
                <DropdownMenuItem
                  key={label}
                  aria-label={label}
                  title={label}
                  className="justify-center p-2"
                  onClick={() => run(session)}
                >
                  {icon}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        ) : null}
        {streamUrl ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<a href={streamUrl} target="_blank" rel="noreferrer" />}>
              Stream ↗
            </DropdownMenuItem>
          </>
        ) : null}
      </AppShellPageMenu>
      <AppShellPageHeader>
        <p className="flex min-w-0 gap-2 font-mono text-xs text-muted-foreground">
          {back}
          <span aria-hidden>/</span>
          <span className="truncate">{path}</span>
        </p>
        {kind === "markdown" ? <FormattingBar session={session} /> : null}
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {state.others.length > 0 && (
            <p aria-label="Also here" className="text-xs text-muted-foreground">
              Also here: {state.others.join(", ")}
            </p>
          )}
          <div className="hidden items-center gap-2 md:flex">
            <Button
              size="xs"
              variant="ghost"
              title="Comment on the selection (⌘⌥M)"
              disabled={state.status.kind === "opening"}
              // keeps the editor's selection, which is what the comment is on
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => session.startComment()}
            >
              <MessageSquarePlus />
              Comment
            </Button>
            {views.length > 0 ? (
              <div role="group" aria-label="Mode" className="flex rounded-lg border p-0.5">
                {views.map(([mode, label]) => (
                  <Button
                    key={mode}
                    size="xs"
                    variant={state.mode === mode ? "secondary" : "ghost"}
                    aria-pressed={state.mode === mode}
                    onClick={() => session.setMode(mode)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
          <span className="hidden md:flex">
            <StreamLink {...stream} />
          </span>
        </div>
      </AppShellPageHeader>
      {/* the find panel (Cmd/Ctrl-F) */}
      <div ref={session.mountPanels} className="sticky top-0 z-10 bg-background" />
      <div className="flex flex-1 flex-col md:flex-row">
        <div
          className={
            state.mode === "preview"
              ? "flex min-w-0 flex-1 flex-col"
              : kind === "markdown"
                ? "mx-auto w-full min-w-0 max-w-3xl flex-1 px-4 md:px-8"
                : "flex w-full min-w-0 flex-1 flex-col px-4"
          }
        >
          {state.mode === "preview" ? <Preview path={path} html={state.previewText} /> : null}
          {/* mounted in Preview too: the text stays live, and the preview follows it */}
          <div
            ref={session.mount}
            className={state.mode === "preview" ? "hidden" : "docs-editor pt-4"}
          />
        </div>
        {state.threads.length > 0 || state.draft ? (
          <CommentsPanel session={session} state={state} />
        ) : null}
      </div>
      <p
        role="status"
        className="sticky bottom-0 border-t bg-background px-4 py-1.5 text-xs text-muted-foreground"
      >
        <StatusText status={state.status} onRetry={() => session.reconnect()} />
      </p>
    </div>
  );
}

/** An html file's Preview, filling the page under the header: a sandboxed frame (its own opaque
 *  origin: the page's scripts run, and reach nothing of the app's) at a blob: URL of its own. Not
 *  `srcdoc`: an about:srcdoc page resolves `#…` against the app's URL, so its
 *  `history.replaceState(null, "", "#2")` throws and a `#` link loads the app into the frame. */
function Preview({ path, html }: { path: string; html: string }) {
  const load = useCallback(
    (frame: HTMLIFrameElement | null) => {
      if (!frame) return;
      const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
      frame.src = url;
      return () => URL.revokeObjectURL(url);
    },
    [html],
  );
  return (
    <iframe
      // a new frame for each version of the text: one frame loading each in turn would add a step to
      // the tab's Back for every one
      key={html}
      ref={load}
      title={`Preview of ${path}`}
      sandbox="allow-scripts allow-popups allow-forms"
      className="w-full flex-1 bg-white"
    />
  );
}

function StatusText({ status, onRetry }: { status: DocStatus; onRetry: () => void }) {
  if (status.kind === "opening") return "Opening…";
  if (status.kind === "editing") return "Editing…";
  if (status.kind === "save-failed")
    return (
      <span className="text-destructive">
        Couldn't save: {status.message}. The text is kept, and the next edit saves again.
      </span>
    );
  if (status.kind === "disconnected")
    return (
      <span className="text-destructive">
        Lost the connection: {status.message}. Your text is still here.{" "}
        <button type="button" className="underline" onClick={onRetry}>
          Try again
        </button>
      </span>
    );
  const saved = `Saved ${status.oid.slice(0, 7)}`;
  return status.by.length > 0 ? `${saved} (${status.by.join(", ")})` : saved;
}

/** A formatting command: the bar's button, the phone menu's item. */
type Formatting = { label: string; icon: React.ReactNode; run: (session: DocSession) => void };

/** A text edit on the markdown (commands.ts), so it works in Markdown mode too. */
const edit = (command: (view: EditorView) => boolean) => (session: DocSession) =>
  session.run(command);

/** The bar's buttons, in the groups its separators part. */
const FORMATTING: Formatting[][] = [
  [
    { label: "Undo", icon: <Undo2 />, run: (session) => session.undo() },
    { label: "Redo", icon: <Redo2 />, run: (session) => session.redo() },
  ],
  [
    { label: "Bold", icon: <Bold />, run: edit((view) => toggleWrap(view, "**")) },
    { label: "Italic", icon: <Italic />, run: edit((view) => toggleWrap(view, "_")) },
    {
      label: "Strikethrough",
      icon: <Strikethrough />,
      run: edit((view) => toggleWrap(view, "~~")),
    },
    { label: "Inline code", icon: <Code />, run: edit((view) => toggleWrap(view, "`")) },
  ],
  [
    { label: "Bulleted list", icon: <List />, run: edit((view) => setLinePrefix(view, "- ")) },
    {
      label: "Numbered list",
      icon: <ListOrdered />,
      run: edit((view) => setLinePrefix(view, "1. ")),
    },
    {
      label: "Checklist",
      icon: <ListChecks />,
      run: edit((view) => setLinePrefix(view, "- [ ] ")),
    },
  ],
  [
    { label: "Link", icon: <Link />, run: edit(promptLink) },
    { label: "Table", icon: <Table />, run: edit((view) => insertBlock(view, TABLE_TEMPLATE)) },
    { label: "Divider", icon: <Minus />, run: edit((view) => insertBlock(view, "---")) },
  ],
];

/** The block types: the bar's select, the phone menu's last row. Each sets the markers its lines
 *  start with. */
const BLOCK_TYPES: Formatting[] = [
  { label: "Paragraph", icon: <Pilcrow />, run: edit((view) => setLinePrefix(view, "")) },
  { label: "Heading 1", icon: <Heading1 />, run: edit((view) => setLinePrefix(view, "# ")) },
  { label: "Heading 2", icon: <Heading2 />, run: edit((view) => setLinePrefix(view, "## ")) },
  { label: "Heading 3", icon: <Heading3 />, run: edit((view) => setLinePrefix(view, "### ")) },
  { label: "Quote", icon: <TextQuote />, run: edit((view) => setLinePrefix(view, "> ")) },
];

/** MDXEditor's bar, more or less. Buttons keep the editor's focus and selection (mousedown). */
function FormattingBar({ session }: { session: DocSession }) {
  const button = ({ label, icon, run }: Formatting) => (
    <Button
      key={label}
      size="icon-sm"
      variant="ghost"
      aria-label={label}
      title={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => run(session)}
    >
      {icon}
    </Button>
  );
  const [history, inline, lists, blocks] = FORMATTING;
  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="hidden flex-wrap items-center gap-0.5 md:flex"
    >
      {history.map(button)}
      <Separator orientation="vertical" className="mx-1 h-5" />
      {inline.map(button)}
      <Separator orientation="vertical" className="mx-1 h-5" />
      {lists.map(button)}
      <Separator orientation="vertical" className="mx-1 h-5" />
      <NativeSelect
        size="sm"
        aria-label="Block type"
        value=""
        onChange={(event) =>
          BLOCK_TYPES.find((type) => type.label === event.target.value)?.run(session)
        }
      >
        <NativeSelectOption value="" disabled>
          Block type
        </NativeSelectOption>
        {BLOCK_TYPES.map(({ label }) => (
          <NativeSelectOption key={label} value={label}>
            {label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <Separator orientation="vertical" className="mx-1 h-5" />
      {blocks.map(button)}
    </div>
  );
}
