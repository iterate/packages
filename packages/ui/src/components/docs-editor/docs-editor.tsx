// Carried over from iterate/docs@fba5c21 (packages/docs-app/src/components/doc-editor.tsx).
// THE DOCS EDITOR: one doc of a mind's repo, co-edited live. A page holds the mind's root `itx`,
// makes a `DocSession` for the doc it shows and draws `DocEditor` with it: the text in CodeMirror
// bound to the doc's shared Y.Text, the comments beside it, and where saving stands. `DocList` is a
// repo's files, live; `DocListPanel` lists them with a box to start a doc, and `DocTree` shows them
// as a tree. None of it imports a router: a link is an href from the page, and a plain left click
// on one is the page's `onNavigate` or `onOpen`. The page links dist/docs-editor.css in place of
// styles.css (AGENTS.md beside this file says how the parts fit).
import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import type { EditorView } from "@codemirror/view";
import {
  Bold,
  CodeXml,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  MessageSquarePlus,
  SeparatorHorizontal,
  Pilcrow,
  Redo,
  Strikethrough,
  Table,
  TextQuote,
  Undo,
} from "lucide-react";
import { insertBlock, promptLink, setLinePrefix, TABLE_TEMPLATE, toggleWrap } from "./commands.ts";
import { CommentsPanel } from "./comments-panel.tsx";
import type { DocMode, DocSession, DocStatus } from "./doc-session.ts";
import { docContextPath } from "./frames.ts";
import { StreamLink, type StreamTarget } from "#/components/stream-link.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select.tsx";
import { Separator } from "#/components/ui/separator.tsx";
import { plainLeftClick } from "#/lib/plain-left-click.ts";

// A no-build page imports one module per registry item (browser-entries.ts): this one, so it also
// exports what a page needs from the item's other files.
export { CommentsPanel } from "./comments-panel.tsx";
export { commitAuthorOf, createDoc, newDocPath, type DocsMind } from "./create-doc.ts";
export { DocList, type DocListState } from "./doc-list.ts";
export { DocListPanel } from "./doc-list-panel.tsx";
export { DocTree } from "./doc-tree-nav.tsx";
export { cursorColor, DocSession, type DocSessionOptions } from "./doc-session.ts";
export { fileKind, type FileKind } from "./file-kind.ts";

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

/** The doc's editor, filling its parent's width: a bar (a link back to the doc list and the doc's
 *  path, markdown's formatting bar, who else is here, Comment, the view switch, Stream ↗), the text
 *  (or an html file's preview) with its comments beside it, and where saving stands. Below `md` the
 *  formatting bar folds into a menu of the same commands. A doc opened to comment on (`commentOnly`) has no formatting, and a
 *  bar of its own under the first that says how to comment and links to the doc opened to edit. */
export function DocEditor({
  session,
  listHref,
  listLabel,
  editHref,
  onNavigate,
  stream,
  unavailable,
}: {
  session: DocSession;
  /** the doc list, which the bar links back to under `listLabel` (the repo's name, say) */
  listHref: string;
  listLabel: string;
  /** this doc opened to edit, which a doc opened to comment on links to */
  editHref: string;
  /** a plain left click on one of the editor's links, for a page that changes its URL itself; with
   *  none, the browser follows the link */
  onNavigate?: (href: string) => void;
  /** the dash's "Stream ↗" to the doc's context; none shows no link */
  stream?: Omit<StreamTarget, "path">;
  /** the page's own words beside "Couldn't open this doc", when the doc's processors can't be
   *  enabled: what the mind's config needs */
  unavailable?: ReactNode;
}) {
  const state = useSyncExternalStore(session.subscribe, session.state, session.state);
  const { kind, commentOnly, path, repo } = session.options;
  const comment = (
    <CommentButton
      session={session}
      selecting={state.selecting}
      opening={state.status.kind === "opening"}
    />
  );
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="sticky top-0 z-10 bg-background">
        <div className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-1.5">
          <p className="flex min-w-0 gap-2 font-mono text-xs text-muted-foreground">
            <DocLink href={listHref} onNavigate={onNavigate} className="hover:text-foreground">
              {listLabel}
            </DocLink>
            <span aria-hidden>/</span>
            <span className="truncate">{path}</span>
          </p>
          {kind === "markdown" && !commentOnly ? (
            <>
              <FormattingBar session={session} />
              <FormattingMenu session={session} />
            </>
          ) : null}
          <div className="ml-auto flex shrink-0 items-center gap-3">
            {state.others.length > 0 && (
              <p aria-label="Also here" className="text-xs text-muted-foreground">
                Also here: {state.others.join(", ")}
              </p>
            )}
            {commentOnly ? null : comment}
            <ModeSwitch session={session} mode={state.mode} />
            {stream ? <StreamLink {...stream} path={docContextPath({ repo, path })} /> : null}
          </div>
        </div>
        {commentOnly ? (
          <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b px-4 py-1.5">
            <p className="font-readme text-xs text-muted-foreground">
              {state.selecting ? "Comment on the selected text" : "Select text to comment on it"} ·{" "}
              <DocLink
                href={editHref}
                onNavigate={onNavigate}
                className="underline hover:text-foreground"
              >
                Edit
              </DocLink>
            </p>
            {comment}
          </div>
        ) : null}
        {/* the find panel (Cmd/Ctrl-F) */}
        <div ref={session.mountPanels} />
      </div>
      <div className="flex flex-1 flex-col md:flex-row">
        <div className={textColumn(state.mode, kind)}>
          {state.status.kind === "unavailable" ? (
            <div
              role="alert"
              className="mt-4 flex flex-col gap-1.5 rounded-lg border border-destructive/40 p-3 text-sm"
            >
              <p className="font-medium">Couldn't open this doc for editing</p>
              <p className="font-mono text-xs text-destructive">{state.status.message}</p>
              {unavailable}
              <Button
                size="xs"
                variant="outline"
                className="self-start"
                onClick={() => session.reconnect()}
              >
                Try again
              </Button>
            </div>
          ) : null}
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
        className="sticky bottom-0 border-t bg-background px-4 py-1.5 font-readme text-xs text-muted-foreground"
      >
        <StatusText status={state.status} onRetry={() => session.reconnect()} />
      </p>
    </div>
  );
}

/** The text's column: an html file's Preview fills it, markdown reads at a page's width, code takes
 *  the whole width. */
function textColumn(mode: DocMode, kind: DocSession["options"]["kind"]) {
  if (mode === "preview") return "flex min-w-0 flex-1 flex-col";
  return kind === "markdown"
    ? "mx-auto w-full max-w-3xl min-w-0 flex-1 px-4 md:px-8"
    : "flex w-full min-w-0 flex-1 flex-col px-4";
}

/** A link of the editor's: a plain left click is the page's `onNavigate` when it has one. */
function DocLink({
  href,
  onNavigate,
  className,
  children,
}: {
  href: string;
  onNavigate: ((href: string) => void) | undefined;
  className: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className={className}
      onClick={(event) => {
        if (!onNavigate || !plainLeftClick(event)) return;
        event.preventDefault();
        onNavigate(href);
      }}
    >
      {children}
    </a>
  );
}

/** Comment on the selection, or on the whole doc when nothing is selected. */
function CommentButton({
  session,
  selecting,
  opening,
}: {
  session: DocSession;
  selecting: boolean;
  opening: boolean;
}) {
  const { commentOnly } = session.options;
  return (
    <Button
      size="xs"
      // what a doc opened to comment on is for, once there's something to comment on
      variant={commentOnly && selecting ? "default" : "ghost"}
      // a doc opened to comment on takes no focus, so no keys
      title={commentOnly ? "Comment on the selection" : "Comment on the selection (⌘⌥M)"}
      disabled={opening}
      // keeps the editor's selection, which is what the comment is on
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => session.startComment()}
    >
      <MessageSquarePlus />
      Comment
    </Button>
  );
}

/** The views of the file to switch between: none for a code file. */
function ModeSwitch({ session, mode }: { session: DocSession; mode: DocMode }) {
  const views = modes[session.options.kind];
  if (views.length === 0) return null;
  return (
    <div role="group" aria-label="Mode" className="flex rounded-lg border p-0.5">
      {views.map(([view, label]) => (
        <Button
          key={view}
          size="xs"
          variant={mode === view ? "secondary" : "ghost"}
          aria-pressed={mode === view}
          onClick={() => session.setMode(view)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}

/** An html file's Preview, filling the page under the bar: a sandboxed frame (its own opaque
 *  origin: the page's scripts run, and reach nothing of the page's) at a blob: URL of its own. Not
 *  `srcdoc`: an about:srcdoc page resolves `#…` against the page's URL, so its
 *  `history.replaceState(null, "", "#2")` throws and a `#` link loads the page into the frame. */
function Preview({ path, html }: { path: string; html: string }) {
  // one ref per version of the text: an inline ref would load the frame again at every render
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
  if (status.kind === "unavailable") return "Not open: the text is the file as it was read.";
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

/** A formatting command: a button of the bar. */
type Formatting = { label: string; icon: ReactNode; run: (session: DocSession) => void };

/** A text edit on the markdown (commands.ts), so it works in Markdown mode too. */
const edit = (command: (view: EditorView) => boolean) => (session: DocSession) =>
  session.run(command);

/** The bar's buttons, in the groups its separators part. */
const FORMATTING: Formatting[][] = [
  [
    { label: "Undo", icon: <Undo />, run: (session) => session.undo() },
    { label: "Redo", icon: <Redo />, run: (session) => session.redo() },
  ],
  [
    { label: "Bold", icon: <Bold />, run: edit((view) => toggleWrap(view, "**")) },
    { label: "Italic", icon: <Italic />, run: edit((view) => toggleWrap(view, "_")) },
    {
      label: "Strikethrough",
      icon: <Strikethrough />,
      run: edit((view) => toggleWrap(view, "~~")),
    },
    { label: "Inline code", icon: <CodeXml />, run: edit((view) => toggleWrap(view, "`")) },
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
    {
      label: "Divider",
      icon: <SeparatorHorizontal />,
      run: edit((view) => insertBlock(view, "---")),
    },
  ],
];

/** The block types: the bar's select. Each sets the markers its lines start with. */
const BLOCK_TYPES: Formatting[] = [
  { label: "Paragraph", icon: <Pilcrow />, run: edit((view) => setLinePrefix(view, "")) },
  { label: "Heading 1", icon: <Heading1 />, run: edit((view) => setLinePrefix(view, "# ")) },
  { label: "Heading 2", icon: <Heading2 />, run: edit((view) => setLinePrefix(view, "## ")) },
  { label: "Heading 3", icon: <Heading3 />, run: edit((view) => setLinePrefix(view, "### ")) },
  { label: "Quote", icon: <TextQuote />, run: edit((view) => setLinePrefix(view, "> ")) },
];

/** The bar's commands on a phone, where the bar has no room: one menu, as a grid of icons. */
function FormattingMenu({ session }: { session: DocSession }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size="icon-sm"
            variant="ghost"
            className="md:hidden"
            aria-label="Formatting"
            title="Formatting"
          />
        }
      >
        <Bold />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56 rounded-lg">
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
      {history!.map(button)}
      <Separator orientation="vertical" className="mx-1 h-5" />
      {inline!.map(button)}
      <Separator orientation="vertical" className="mx-1 h-5" />
      {lists!.map(button)}
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
      {blocks!.map(button)}
    </div>
  );
}
