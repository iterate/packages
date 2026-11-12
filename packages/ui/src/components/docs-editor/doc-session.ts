// Carried over from iterate/docs@fba5c21 (packages/docs-app/src/editor/doc-session.ts).
// One open doc: its editor, co-edited through the doc's processor (frames.ts). The page reads
// `state()` through useSyncExternalStore; everything that changes it happens here. A session takes
// what a page on a mind has: the mind's root `itx`, the doc's repo and path, the text the page read
// for the first paint, and who is typing.
//
// A markdown file gets the live-preview editor (Rich / Markdown); any other text file a code editor
// in its language, and an html file a Preview beside it, the live text in a sandboxed frame.
//
// The editor opens read-only on the text the page loaded, and goes live once the tab has synced
// with the doc's processor (collab.ts): from then on the editor is bound to the shared Y.Text
// (y-codemirror.next), and the processor saves. Its live state (`commitOid`, `dirty`, `savedBy`,
// `saveError`) is what the status line says. A doc opened to comment on (`commentOnly`) stays
// read-only once live: everyone else's edits still arrive, and a tap on a phone selects text instead
// of raising the keyboard.
//
// COMMENTS are events this tab appends to the doc's context (comments.ts); the
// threads come back in the processor's live state, and the editor highlights each one's text
// (comment-marks.ts). A comment being written is a draft here until its thread comes back. An open
// thread routed to an agent (`routedTo`) follows that agent's own live state, so the thread says when
// the agent is thinking about it, the scripts it runs included.
import { closeSearchPanel, openSearchPanel } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, panels } from "@codemirror/view";
import * as Y from "yjs";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import { z } from "zod";
import type { IterateContextApi } from "iterate/api";
import { connectLiveState } from "iterate/client";
// through iterate/react, the module the kit's `live` entry already loads: the page shares its chunk
import { facetSnapshotOf } from "iterate/react";
import { quoteAt, type Quote } from "./anchor.ts";
import {
  COMMENT_ADDED,
  COMMENT_DELETED,
  COMMENT_EDITED,
  COMMENT_REOPENED,
  COMMENT_REPLIED,
  COMMENT_RESOLVED,
  type CommentThread,
} from "./comments.ts";
import type { DocsMind } from "./create-doc.ts";
import type { FileKind } from "./file-kind.ts";
import { DocLiveState } from "./frames.ts";
import { ensureDoc, type DocFacetSpec } from "./install.ts";
import { DocCollab, type CollabStatus } from "./collab.ts";
import { commentMarks, commentTheme, setMarked } from "./comment-marks.ts";
import {
  codeEditorExtensions,
  codeLanguage,
  docEditorExtensions,
  previewExtensions,
  type EditorMode,
} from "./extensions.ts";

/** What the page shows of the file: a markdown file's Rich or Markdown, an html file's Preview or
 *  Source, and the code editor for anything else. */
export type DocMode = EditorMode | "preview" | "source" | "code";

export type DocStatus =
  | { kind: "opening" }
  | { kind: "editing" }
  | { kind: "saved"; oid: string; by: string[] }
  | { kind: "save-failed"; message: string }
  | { kind: "disconnected"; message: string }
  /** the doc could not be opened (its processors not enabled, or the first sync refused): the
   *  editor shows the page's text, read-only, and `reconnect` tries again */
  | { kind: "unavailable"; message: string };

/** A thread as the panel lists it: `attached` false when its quote is found nowhere in the text. */
export type ThreadView = CommentThread & { attached: boolean };

/** A comment being written: the thread it'll start (its id made here), and its quote, or none for a
 *  comment on the whole doc. */
export type Draft = { thread: string; quote: Quote | null };

export type DocSessionState = {
  mode: DocMode;
  status: DocStatus;
  /** Everyone else with the doc open, by name. */
  others: string[];
  /** An html file's text for its Preview, at most twice a second behind the editor's. */
  previewText: string;
  /** The doc's comment threads: those on the whole doc, then the rest in the order their text
   *  comes, then those found nowhere, in the order they were started. */
  threads: ThreadView[];
  /** The selected thread: clicked in the panel, or the one the cursor is in. */
  active: string | null;
  /** The contexts open threads are routed to whose agent is thinking now. */
  thinking: string[];
  /** Text is selected: a comment started now is on it, not on the whole doc. */
  selecting: boolean;
  draft: Draft | null;
  /** The comment of this person's being edited. */
  editing: { thread: string; comment: string } | null;
};

export type DocSessionOptions = {
  /** The mind's root context, as the page holds it: the session opens the doc's context from it
   *  (`ensureDoc`) and lets that go when the editor unmounts. The page keeps `itx` itself. */
  itx: DocsMind;
  /** The doc's repo, `/repos/<name>`. */
  repo: string;
  /** The doc's path in the repo. */
  path: string;
  /** What it opens as (file-kind.ts); a binary file doesn't open. */
  kind: Exclude<FileKind, "binary">;
  /** The doc as the page loaded it: what the editor shows until it's live. */
  text: string;
  /** Who's typing: `name` and `color` (a CSS colour, `cursorColor`) as the others see them, and
   *  `email`, which a comment's author is when this person wrote it. */
  user: { name: string; email: string; color: string };
  /** The processors' facet spec (`ensureDoc`): where the mind's config keeps their classes. */
  facetSpec: DocFacetSpec;
  /** Opened to read and comment on, never to edit. Not a `DocMode`, which is how the text shows
   *  (Rich or Markdown); this is what the person may do to it. */
  commentOnly: boolean;
};

/** What an agent is doing: the fields of its `agent` facet's live state (iterate/agents contract.ts
 *  `stateSchema`) that say it is at work on a turn. */
const AgentLive = z.object({
  paused: z.object({ reason: z.string() }).nullable(),
  /** a model request about to start, or under way */
  pendingLlmRequestTrigger: z.object({}).nullable(),
  openRequest: z.object({ model: z.string() }).nullable(),
  /** a script its model answered with, not yet started, and the scripts running */
  awaitingRun: z.object({}).nullable(),
  pendingRuns: z.record(z.string(), z.unknown()),
});

/** Whether an agent is thinking: not paused, and asking its model or running a script it answered
 *  with. It is briefly neither when a script has ended and the agent has not yet passed its result
 *  to the model. */
function isThinking(agent: z.infer<typeof AgentLive>) {
  const working =
    agent.pendingLlmRequestTrigger ||
    agent.openRequest ||
    agent.awaitingRun ||
    Object.keys(agent.pendingRuns).length > 0;
  return !agent.paused && Boolean(working);
}

/** A tab's awareness state as collab.ts sets it: whose tab it is. */
const AwarenessUser = z.object({ user: z.object({ name: z.string().min(1) }) });

/** One mount of the editor: whether it's gone, and what to let go when it goes. */
type Attachment = { unmounted: boolean; cleanups: (() => void)[] };

/** An editor that shows the text and takes no typing: a phone shows no keyboard for it. */
const readOnly: Extension = [EditorState.readOnly.of(true), EditorView.editable.of(false)];

/** The first view of each kind of file. */
const firstMode: Record<DocSessionOptions["kind"], DocMode> = {
  markdown: "rich",
  html: "preview",
  code: "code",
};

export class DocSession {
  #state: DocSessionState;
  #listeners = new Set<() => void>();
  #preview = new Compartment();
  /** A code file's language, once its grammar has loaded. */
  #language = new Compartment();
  #languageSupport: Extension = [];
  #previewTimer: ReturnType<typeof setTimeout> | undefined;
  #view: EditorView | null = null;
  /** Where the editor's find panel goes: in the page's sticky bar (`mountPanels`). */
  #panels: HTMLDivElement | null = null;
  #collab: DocCollab | null = null;
  #undo: Y.UndoManager | null = null;
  #collabStatus: CollabStatus = { kind: "opening" };
  /** The mounted editor's attachment, for `reconnect` to open the doc again on. */
  #attachment: Attachment | null = null;
  /** An attempt to open the doc is under way. */
  #goingLive = false;
  #live: DocLiveState | undefined;
  #context: IterateContextApi | null = null;
  /** The threads as last listed, and their order and attachment: the panel changes with these. */
  #listed: CommentThread[] = [];
  #threadsKey = "";
  /** Each context an open thread is routed to, followed while one is: what letting it go takes. */
  #routes = new Map<string, () => void>();

  options: DocSessionOptions;

  constructor(options: DocSessionOptions) {
    this.options = options;
    this.#state = {
      mode: firstMode[options.kind],
      status: { kind: "opening" },
      others: [],
      previewText: options.text,
      threads: [],
      active: null,
      thinking: [],
      selecting: false,
      draft: null,
      editing: null,
    };
  }

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  state = () => this.#state;

  #set(patch: Partial<DocSessionState>) {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener();
  }

  /** The find panel's place in the page's sticky bar, as a React ref: there it stays in view as the
   *  doc scrolls, and covers nothing. Its element is made on first use, by this ref or `mount`'s,
   *  so neither need come first. */
  mountPanels = (parent: HTMLDivElement | null) => {
    parent?.appendChild(this.#panelsElement());
  };

  #panelsElement() {
    return (this.#panels ||= document.createElement("div"));
  }

  /** The editor's element, as a React ref: the view and the doc's connection live while it's
   *  mounted. Closing the tab before this tab's edits have been sent asks first; closing it tells
   *  the doc's processor this tab has left, as unmounting does. */
  mount = (parent: HTMLDivElement | null) => {
    if (!parent) return;
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: this.options.text,
        extensions: [this.#extensions(), readOnly],
      }),
    });
    this.#view = view;
    if (this.options.kind !== "markdown") void this.#loadLanguage();
    const attachment: Attachment = { unmounted: false, cleanups: [] };
    this.#attachment = attachment;
    const warnIfUnsent = (event: BeforeUnloadEvent) => {
      if (this.#collab?.unsent()) event.preventDefault();
    };
    window.addEventListener("beforeunload", warnIfUnsent);
    // a closing tab never unmounts: say goodbye now, if the socket lasts long enough to carry it
    const leave = () => void this.#collab?.close();
    window.addEventListener("pagehide", leave);
    // Cmd/Ctrl-F with the focus elsewhere on the page finds in the file too, as the editor's own
    // keymap does once it has focus. Not from another text field, nor on an html file's Preview,
    // where the editor is hidden and the browser's find is the one that sees the page.
    const find = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== "f" || event.defaultPrevented) return;
      const textField = 'input, textarea, [contenteditable]:not([contenteditable="false"])';
      if (event.target instanceof Element && event.target.closest(textField)) return;
      if (this.#state.mode === "preview") return;
      event.preventDefault();
      openSearchPanel(view);
    };
    window.addEventListener("keydown", find);
    void this.#goLive(view, attachment);
    return () => {
      attachment.unmounted = true;
      window.removeEventListener("beforeunload", warnIfUnsent);
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("keydown", find);
      for (const cleanup of attachment.cleanups.reverse()) cleanup();
      clearTimeout(this.#previewTimer);
      this.#previewTimer = undefined;
      for (const letGo of this.#routes.values()) letGo();
      this.#routes.clear();
      this.#view = null;
      this.#attachment = null;
      this.#collab = null;
      this.#context = null;
      this.#undo = null;
      view.destroy();
    };
  };

  /** Let `cleanup` go with the view: at once when the view has gone already. */
  #hold(attachment: Attachment, cleanup: () => void) {
    if (attachment.unmounted) cleanup();
    else attachment.cleanups.push(cleanup);
  }

  /** Open the doc and bind the editor to it. A failure before the editor is live lets go of what
   *  this attempt opened and leaves the status `unavailable`, for `reconnect` to try again. */
  async #goLive(view: EditorView, attachment: Attachment) {
    // this attempt's cleanups: held with the view, and run at once if the attempt fails
    const held: (() => void)[] = [];
    const hold = (cleanup: () => void) => {
      held.push(cleanup);
      this.#hold(attachment, cleanup);
    };
    this.#goingLive = true;
    this.#collabStatus = { kind: "opening" };
    this.#refresh();
    try {
      const { itx, repo, path, user, facetSpec } = this.options;
      // The SDK models the public API as promises; capnweb's stub has the same runtime methods
      const context = await ensureDoc(
        itx as unknown as IterateContextApi,
        { repo, path },
        {
          facetSpec,
        },
      );
      // the context goes once the tab has left the doc (collab.close), which sends on it; the
      // context capnweb hands back is a stub, which disposes, though the IterateContextApi type
      // `cd` returns doesn't say so
      let closing: Promise<unknown> = Promise.resolve();
      hold(() => {
        void closing.finally(() => (context as unknown as Disposable)[Symbol.dispose]());
      });
      if (attachment.unmounted) return;
      const collab = new DocCollab({
        context,
        user: { name: user.name, color: user.color },
        onStatus: (status) => {
          this.#collabStatus = status;
          this.#refresh();
        },
      });
      hold(() => {
        closing = collab.close();
      });
      collab.awareness.on("change", () => this.#refresh());
      await collab.open();
      if (attachment.unmounted) return;
      // the first sync reports its failure as a status, not a throw: the doc did not open
      const opened = this.#statusNow();
      if (opened.kind === "failed") throw new Error(opened.message);
      const live = await connectLiveState<DocLiveState>(context, {
        key: "doc",
        readSeed: async () => {
          const { rev, state } = await facetSnapshotOf(context, "doc");
          return { rev, state: DocLiveState.parse(state) };
        },
      });
      hold(() => void live.dispose());
      if (attachment.unmounted) return;
      hold(
        live.store.subscribe(() => {
          const next = live.store.get();
          // a save landed: sync again, in case a frame either way went missing before it
          if (next?.commitOid !== this.#live?.commitOid) void collab.sync();
          const threadsChanged = next?.threads !== this.#live?.threads;
          this.#live = next;
          this.#refresh();
          if (threadsChanged) this.#threadsChanged();
        }),
      );
      this.#live = live.store.get();
      this.#collab = collab;
      this.#context = context;
      this.#undo = new Y.UndoManager(collab.text);
      view.setState(
        EditorState.create({
          doc: collab.text.toString(),
          extensions: [
            this.#extensions(),
            yCollab(collab.text, collab.awareness, { undoManager: this.#undo }),
            keymap.of(yUndoManagerKeymap),
            this.options.commentOnly ? readOnly : [],
          ],
        }),
      );
      // a new state has no selection, and no update tells the listener that
      this.#set({ selecting: false });
      this.#refresh();
      this.#threadsChanged();
    } catch (error) {
      for (const cleanup of held.reverse()) {
        const at = attachment.cleanups.indexOf(cleanup);
        if (at < 0) continue;
        attachment.cleanups.splice(at, 1);
        cleanup();
      }
      this.#collabStatus = {
        kind: "failed",
        message: error instanceof Error ? error.message : String(error),
      };
      this.#refresh();
    } finally {
      this.#goingLive = false;
    }
  }

  /** The collab's status as it is now: an `await` may have changed it. */
  #statusNow(): CollabStatus {
    return this.#collabStatus;
  }

  #extensions(): Extension {
    return [
      this.options.kind === "markdown"
        ? docEditorExtensions({
            mode: this.#state.mode === "markdown" ? "markdown" : "rich",
            preview: this.#preview,
          })
        : codeEditorExtensions({ language: this.#language.of(this.#languageSupport) }),
      panels({ topContainer: this.#panelsElement() }),
      // the text box is named by the file it edits
      EditorView.contentAttributes.of({ "aria-label": this.options.path }),
      commentMarks,
      commentTheme,
      // Google Docs' shortcut for a comment on the selection
      keymap.of([{ key: "Mod-Alt-m", run: () => this.startComment(), preventDefault: true }]),
      EditorView.updateListener.of((update) => {
        if (update.startState.field(commentMarks) !== update.state.field(commentMarks))
          this.#listThreads();
        const selecting = !update.state.selection.main.empty;
        if (selecting !== this.#state.selecting) this.#set({ selecting });
      }),
      this.options.kind === "html"
        ? EditorView.updateListener.of((update) => {
            if (update.docChanged) this.#schedulePreview();
          })
        : [],
    ];
  }

  /** The file's grammar, fetched once, into whichever state the view has by then. */
  async #loadLanguage() {
    this.#languageSupport = await codeLanguage(this.options.path);
    this.#view?.dispatch({ effects: this.#language.reconfigure(this.#languageSupport) });
  }

  #schedulePreview() {
    if (this.#previewTimer) return;
    this.#previewTimer = setTimeout(() => {
      this.#previewTimer = undefined;
      if (this.#view) this.#set({ previewText: this.#view.state.doc.toString() });
    }, 500);
  }

  #refresh() {
    const live = this.#live;
    const status: DocStatus =
      this.#collabStatus.kind === "failed"
        ? // failed before the editor went live: the doc never opened
          {
            kind: this.#collab ? "disconnected" : "unavailable",
            message: this.#collabStatus.message,
          }
        : !this.#collab || !live
          ? { kind: "opening" }
          : live.saveError
            ? { kind: "save-failed", message: live.saveError }
            : live.dirty || !live.commitOid
              ? { kind: "editing" }
              : { kind: "saved", oid: live.commitOid, by: live.savedBy };
    const collab = this.#collab;
    const others = collab
      ? [...collab.awareness.getStates()]
          .filter(([client]) => client !== collab.doc.clientID)
          .flatMap(([, state]) => {
            const parsed = AwarenessUser.safeParse(state);
            return parsed.success ? [parsed.data.user.name] : [];
          })
      : [];
    this.#set({ status, others });
  }

  /** The live state's threads changed: a draft whose thread has come back is done, and the
   *  editor highlights the open threads' text. */
  #threadsChanged() {
    const threads = this.#live ? this.#live.threads : [];
    const draft = this.#state.draft;
    if (draft && threads.some((thread) => thread.id === draft.thread)) this.#set({ draft: null });
    this.#mark(this.#state.active);
    this.#listThreads();
    this.#followRoutes();
  }

  /** Follow the agent each open thread is routed to, and let go of those none is routed to now. A
   *  context with no agent, or one this person can't read, is never thinking. */
  #followRoutes() {
    const context = this.#context;
    if (!context) return;
    const threads = this.#live ? this.#live.threads : [];
    const routes = new Set(
      threads.flatMap((thread) => (!thread.resolved && thread.routedTo ? [thread.routedTo] : [])),
    );
    for (const [path, letGo] of this.#routes) {
      if (routes.has(path)) continue;
      letGo();
      this.#routes.delete(path);
      this.#setThinking(path, false);
    }
    for (const path of routes) {
      if (this.#routes.has(path)) continue;
      const agent = context.cd(path);
      const abort = new AbortController();
      const connected = connectLiveState<unknown>(agent, {
        key: "agent",
        readSeed: () => facetSnapshotOf(agent, "agent"),
        signal: abort.signal,
      }).then((live) => {
        const read = () => {
          // let go of: a last change on its way in is no one's
          if (abort.signal.aborted) return;
          const parsed = AgentLive.safeParse(live.store.get());
          this.#setThinking(path, parsed.success && isThinking(parsed.data));
        };
        read();
        return { live, unsubscribe: live.store.subscribe(read) };
      });
      connected.catch(() => undefined);
      this.#routes.set(path, () => {
        abort.abort();
        void connected
          .then(({ live, unsubscribe }) => {
            unsubscribe();
            return live.dispose();
          })
          .catch(() => undefined)
          // a context's stub, like the doc's, disposes though `cd`'s type doesn't say so
          .finally(() => (agent as unknown as Disposable)[Symbol.dispose]());
      });
    }
  }

  #setThinking(path: string, thinking: boolean) {
    if (this.#state.thinking.includes(path) === thinking) return;
    this.#set({
      thinking: thinking
        ? [...this.#state.thinking, path]
        : this.#state.thinking.filter((each) => each !== path),
    });
  }

  /** Tell the editor what to highlight, and which thread is selected. */
  #mark(active: string | null) {
    const open = (this.#live ? this.#live.threads : []).filter((thread) => !thread.resolved);
    const draft = this.#state.draft;
    const quoted = [...open, ...(draft ? [{ id: draft.thread, quote: draft.quote }] : [])].flatMap(
      (thread) => (thread.quote ? [{ id: thread.id, quote: thread.quote }] : []),
    );
    this.#view?.dispatch({ effects: setMarked.of({ threads: quoted, active }) });
  }

  /** The threads in the panel's order, when that order, what's attached or what's selected moved. */
  #listThreads() {
    const marks = this.#view?.state.field(commentMarks, false);
    const ranges = marks ? marks.ranges : new Map<string, { from: number }>();
    const active = marks ? marks.active : this.#state.active;
    const threads = this.#live ? this.#live.threads : [];
    // the whole doc's first, then by where their text is; found nowhere, last
    const at = (thread: CommentThread) => {
      const range = ranges.get(thread.id);
      return !thread.quote ? -1 : range ? range.from : Number.POSITIVE_INFINITY;
    };
    const views = [...threads]
      .sort((a, b) => at(a) - at(b))
      .map((thread) => ({ ...thread, attached: at(thread) !== Number.POSITIVE_INFINITY }));
    const key = views.map((view) => `${view.id}${view.attached ? "" : "!"}`).join(" ");
    if (key === this.#threadsKey && threads === this.#listed && active === this.#state.active)
      return;
    this.#threadsKey = key;
    this.#listed = threads;
    this.#set({ threads: views, active });
  }

  /** Start a comment on the selection, or on the whole doc when nothing is selected. */
  startComment() {
    const view = this.#view;
    if (!view || !this.#context) return false;
    const text = view.state.doc.toString();
    let { from, to } = view.state.selection.main;
    // a selection's spaces and line breaks at either end aren't what it's about
    while (from < to && /\s/.test(text[from]!)) from++;
    while (to > from && /\s/.test(text[to - 1]!)) to--;
    const thread = crypto.randomUUID();
    this.#set({
      draft: { thread, quote: to > from ? quoteAt(text, from, to) : null },
      active: thread,
    });
    this.#mark(thread);
    return true;
  }

  cancelDraft() {
    this.#set({ draft: null, active: null });
    this.#mark(null);
  }

  /** Post the draft; it stays a draft until its thread comes back in the live state. */
  async postDraft(body: string) {
    const draft = this.#state.draft;
    if (!draft) return;
    await this.#append(COMMENT_ADDED, { thread: draft.thread, quote: draft.quote, body });
  }

  reply(thread: string, body: string) {
    return this.#append(COMMENT_REPLIED, { thread, comment: crypto.randomUUID(), body });
  }

  startEditing(thread: string, comment: string) {
    this.#set({ editing: { thread, comment } });
  }

  stopEditing() {
    this.#set({ editing: null });
  }

  async editComment(thread: string, comment: string, body: string) {
    await this.#append(COMMENT_EDITED, { thread, comment, body });
    this.stopEditing();
  }

  deleteComment(thread: string, comment: string) {
    return this.#append(COMMENT_DELETED, { thread, comment });
  }

  resolve(thread: string) {
    return this.#append(COMMENT_RESOLVED, { thread });
  }

  reopen(thread: string) {
    return this.#append(COMMENT_REOPENED, { thread });
  }

  /** Select a thread from the panel: its text highlighted and scrolled to, in the editor. */
  focusThread(thread: string) {
    this.#set({ active: thread });
    this.#mark(thread);
    const range = this.#view?.state.field(commentMarks, false)?.ranges.get(thread);
    if (!range) return;
    // an html file's Preview has no text to point at
    if (this.#state.mode === "preview") this.setMode("source");
    this.#view?.dispatch({ effects: EditorView.scrollIntoView(range.from, { y: "center" }) });
  }

  async #append(type: string, payload: Record<string, unknown>) {
    if (!this.#context) throw new Error("The doc isn't open yet");
    await this.#context.append({ type, payload });
  }

  /** What "Try again" does: sync with the doc's processor again after the connection failed, or
   *  open the doc again when it never opened. */
  reconnect() {
    if (this.#collab) return void this.#collab.sync();
    if (this.#view && this.#attachment && !this.#goingLive)
      void this.#goLive(this.#view, this.#attachment);
  }

  setMode(mode: DocMode) {
    if (mode === "rich" || mode === "markdown")
      this.#view?.dispatch({ effects: this.#preview.reconfigure(previewExtensions(mode)) });
    // the find panel is in the page's bar, not the editor, so hiding the editor would leave it up
    if (mode === "preview" && this.#view) closeSearchPanel(this.#view);
    this.#set({ mode });
    if (mode !== "preview") this.#view?.focus();
  }

  /** Run a formatting command (commands.ts) on the editor. */
  run(command: (view: EditorView) => boolean) {
    if (this.#view) command(this.#view);
  }

  /** Undo this person's last edit; the others' stay. */
  undo() {
    this.#undo?.undo();
  }

  redo() {
    this.#undo?.redo();
  }
}

/** A cursor colour per person, the same in every tab: one of the page's tokens
 *  (src/styles/tokens.css), picked by a hash of `email`. */
export function cursorColor(email: string) {
  let hash = 0;
  for (const char of email) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  const colors = [
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)",
    "var(--info)",
    "var(--success)",
    "var(--warning)",
  ];
  return colors[Math.abs(hash) % colors.length]!;
}
