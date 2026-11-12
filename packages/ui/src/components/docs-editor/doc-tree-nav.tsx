// Carried over from iterate/docs@fba5c21 (packages/docs-app/src/components/docs-nav.tsx).
// A repo's docs as a tree (doc-tree.ts), the open file selected and its folders open. It imports no
// router: the page passes the open path as a prop, and a new one (a click, Back, Forward) moves the
// selection. A file picked in the tree, and a doc made from it, are the page's `onOpen`. A doc made
// from the tree shows "Creating…" until the page has it, and why it couldn't be made below the tree.
//
// The tree's code (@pierre/trees) loads when the tree first draws, not with the editor: the repo
// IDE carries the same library in its own file, and a static import here would make the two share a
// new chunk, one more file for every page that shows the IDE.
import { Suspense, use, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createDoc } from "./create-doc.ts";
import type { DocList } from "./doc-list.ts";
import { Spinner } from "#/components/ui/spinner.tsx";

type DocTreeProps = {
  /** the page's list of the repo's files, the one its doc list reads too */
  list: DocList;
  /** the file the page shows now, if any */
  openPath: string | undefined;
  onOpen: (path: string) => void;
  /** the commit's author for a doc made from the tree (`commitAuthorOf`) */
  author: { name: string; email: string } | undefined;
};

export function DocTree(props: DocTreeProps) {
  return (
    <Suspense
      fallback={
        <p className="px-2 py-1 font-readme text-xs text-muted-foreground">Loading files…</p>
      }
    >
      <LoadedDocTree {...props} />
    </Suspense>
  );
}

/** doc-tree.ts, fetched once, the first time a tree draws. */
let docTreeModule: Promise<typeof import("./doc-tree.ts")> | undefined;

function LoadedDocTree({ list, openPath, onOpen, author }: DocTreeProps) {
  const { PierreDocTree } = use((docTreeModule ||= import("./doc-tree.ts")));
  const docs = useSyncExternalStore(list.subscribe, list.state, list.state);
  const [making, setMaking] = useState<{ path: string; error: string | null } | null>(null);
  // the tree is made once per list; it reads the page's newest props through this
  const latest = useRef({ openPath, onOpen, author });
  useEffect(() => {
    latest.current = { openPath, onOpen, author };
  });
  const tree = useMemo(
    () =>
      new PierreDocTree({
        list,
        openPath: () => latest.current.openPath,
        open: (path) => latest.current.onOpen(path),
        create: async (path) => {
          setMaking({ path, error: null });
          try {
            await createDoc({
              mind: list.mind,
              repo: list.repo,
              path,
              heading: path
                .split("/")
                .at(-1)!
                .replace(/\.[^.]+$/, ""),
              author: latest.current.author,
            });
          } catch (error) {
            setMaking({ path, error: error instanceof Error ? error.message : String(error) });
            throw error;
          }
          list.reload();
          setMaking(null);
          latest.current.onOpen(path);
        },
      }),
    [list, PierreDocTree],
  );
  // the page navigated: the tree, an outside widget, selects the file now open
  useEffect(() => tree.reveal(), [tree, openPath]);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      {docs.kind === "loaded" ? (
        <div ref={tree.mount} aria-label="Files" className="min-h-0 flex-1" />
      ) : (
        <p
          className={
            docs.kind === "failed"
              ? "px-2 py-1 text-xs text-destructive"
              : "px-2 py-1 font-readme text-xs text-muted-foreground"
          }
        >
          {docs.kind === "failed" ? `Couldn't list the files: ${docs.message}` : "Loading files…"}
        </p>
      )}
      {making && !making.error ? (
        <p className="flex items-center gap-1.5 px-2 py-1 font-readme text-xs text-muted-foreground">
          <Spinner />
          Creating {making.path}…
        </p>
      ) : null}
      {making?.error ? (
        <p role="alert" data-type="error" className="px-2 py-1 text-xs text-destructive">
          Couldn't make {making.path}: {making.error}
        </p>
      ) : null}
    </div>
  );
}
