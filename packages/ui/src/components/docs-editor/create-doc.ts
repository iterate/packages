// Carried over from iterate/docs@fba5c21 (packages/docs-app/src/lib/create-doc.ts, with
// lib/docs-repo.ts's newDocPath and newDocHeading, and lib/author.ts).
// Making a file in a repo: one commit on the repo's tip as it is now (someone may have made the
// same file since the page last looked, and then it's left as it is). A markdown file starts with
// its name as a heading; anything else starts empty. The doc list's New doc box comes here, and so
// can a page's tree.
import type { AuthenticatedApp } from "iterate/app";
import type { Principal } from "iterate/principal";
import { fileKind } from "./file-kind.ts";

/** The mind's root context, as the page holds it (`itx`). */
export type DocsMind = AuthenticatedApp["itx"];

export async function createDoc(input: {
  mind: DocsMind;
  /** `/repos/<name>` */
  repo: string;
  path: string;
  /** the first heading of a markdown file */
  heading: string;
  author: { name: string; email: string } | undefined;
}) {
  using repo = input.mind.repos.get(input.repo);
  const { commitOid, paths } = await repo.listFiles();
  if (paths.includes(input.path)) return;
  await repo.commitFiles({
    message: `docs: new ${input.path}`,
    changes: [
      {
        path: input.path,
        content: fileKind(input.path) === "markdown" ? `# ${input.heading}\n` : "",
      },
    ],
    parent: commitOid,
    author: input.author,
  });
}

/** A commit's author for the person signed in: their email as both name and address. Without an
 *  email, none: the repo writes its own default. */
export function commitAuthorOf(principal: Principal) {
  return principal.email ? { name: principal.email, email: principal.email } : undefined;
}

/** The path a new doc called `title` gets: its words, lowercased and dashed, `.md` on (once: a
 *  title "plan.md" is plan.md), each `/` a folder ("Offsites/Lisbon" is offsites/lisbon.md). ""
 *  when the title has no letters or digits. */
export function newDocPath(title: string) {
  const segments = title
    .replace(/\.md$/i, "")
    .split("/")
    .map((segment) =>
      segment
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, ""),
    )
    .filter(Boolean);
  return segments.length > 0 ? `${segments.join("/")}.md` : "";
}

/** The first heading a new doc called `title` gets: its last part ("Offsites/Lisbon" → "Lisbon"). */
export function newDocHeading(title: string) {
  return title.split("/").at(-1)!.trim();
}
