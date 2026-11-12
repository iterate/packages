// Carried over from iterate/docs@fba5c21 (packages/docs-app/src/routes/_auth/projects.$slug.$repo.index.tsx).
// Every doc in one of the mind's repos (the page's live `DocList`), and a box to start one there;
// `folder/name` makes it in a folder. A doc is a link to `docHref(path)`; a plain left click on
// one, and a doc just made, are the page's `onOpen`.
import { useActionState, useSyncExternalStore } from "react";
import { createDoc, newDocHeading, newDocPath } from "./create-doc.ts";
import type { DocList } from "./doc-list.ts";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { plainLeftClick } from "#/lib/plain-left-click.ts";

export function DocListPanel({
  list,
  author,
  docHref,
  onOpen,
}: {
  list: DocList;
  /** The commit's author for a new doc: the person signed in (`commitAuthorOf`); none leaves the
   *  repo's own default. */
  author: { name: string; email: string } | undefined;
  docHref: (path: string) => string;
  onOpen: (path: string) => void;
}) {
  const docs = useSyncExternalStore(list.subscribe, list.state, list.state);
  // the button stays "Creating…" until the page has opened the new doc
  const [created, create, creating] = useActionState(
    async (_previous: { error: string } | null, form: FormData) => {
      const title = String(form.get("title"));
      const path = newDocPath(title);
      if (!path) return { error: "A title needs a letter or a digit in it." };
      try {
        await createDoc({
          mind: list.mind,
          repo: list.repo,
          path,
          heading: newDocHeading(title),
          author,
        });
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
      list.reload();
      onOpen(path);
      return null;
    },
    null,
  );
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 md:p-8">
      <form action={create} className="flex gap-2">
        <Input
          name="title"
          aria-label="New doc title"
          placeholder="New doc title, or folder/title"
          // a page's "New doc" lands here to type a title
          autoFocus
          required
        />
        <Button type="submit" disabled={creating}>
          {creating ? "Creating…" : "New doc"}
        </Button>
      </form>
      {created?.error ? (
        <p role="alert" className="text-sm text-destructive">
          {created.error}
        </p>
      ) : null}
      {docs.kind === "loading" ? (
        <p className="font-readme text-sm text-muted-foreground">Loading docs…</p>
      ) : docs.kind === "failed" ? (
        <p role="alert" className="text-sm text-destructive">
          Couldn't list the docs: {docs.message}
        </p>
      ) : docs.paths.length > 0 ? (
        <ul aria-label="Docs" className="flex flex-col divide-y rounded-lg border">
          {docs.paths.map((path) => (
            <li key={path}>
              <a
                href={docHref(path)}
                onClick={(event) => {
                  if (!plainLeftClick(event)) return;
                  event.preventDefault();
                  onOpen(path);
                }}
                className="block px-4 py-2.5 font-mono text-sm hover:bg-muted"
              >
                {path}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="font-readme text-sm text-muted-foreground">No docs yet.</p>
      )}
    </main>
  );
}
