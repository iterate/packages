# The docs editor

`DocEditor` is one doc of a mind's repo, co-edited live: CodeMirror with Atomic's live preview
(`@atomic-editor/editor`), bound to the doc's shared Y.Text, its comments, and where saving stands.
`DocListPanel` is a repo's docs with a New doc box; `DocTree` shows them as a tree.
The page that carries them is the default config's Docs app (`core/configs/default/apps/docs/`),
whose config files hold the processors the editor talks to.

- A no-build page imports one module, `docs-editor.tsx`, so it exports what a page needs from the
  other files too. Nothing in the folder imports a router: links are hrefs from the page, and a
  plain left click is the page's `onNavigate` or `onOpen`.
- `frames.ts`, `comments.ts` and `anchor.ts` are the wire. The mind's config holds its own copy of
  each, and the two copies must say the same: change both, or neither.
- A page makes one `DocSession` per doc and person (`useMemo` on its values) and one `DocList` per
  repo. The session opens the doc's context with `ensureDoc` when the editor mounts, and lets it go
  when it unmounts. The page keeps `itx`.
- The page gives the processors' facet spec (`facetSpec`): the module of the config repo that
  exports `DocDurableObject` and `DocsDurableObject`, and a `cacheKey` from its source's hash,
  which only the page's server knows. Nothing here guesses one.
- A doc that does not open (its processors cannot be enabled, or the first sync fails) is status
  `unavailable`: `DocEditor` says why in the error's words, with the page's own (`unavailable`), and
  "Try again" (`reconnect`) opens it again.
- CodeMirror, Atomic and Yjs are static imports. The build keeps each in one vendor chunk
  (`browser-entries.ts` `vendorChunks`): two copies of any break their `instanceof` checks.
- A no-build page that shows the editor links the published `docs-editor.css` IN PLACE OF
  `styles.css`, never both: it is the whole kit's stylesheet with the editor's classes and Atomic's
  live preview added (`src/browser/docs-editor.css`). Two sheets would share one
  `@layer utilities`, and the second sheet's plain utilities (`.hidden`) would beat the first's
  variants (`md:block`). The build fails unless `docs-editor.css` holds every rule of `styles.css`
  in its order (`scripts/check-docs-editor-css.ts`). `theme.css` and `iterate.css` go after it,
  as after `styles.css`. `iterate.css` is cut from `styles.css`, so the build fails when a class
  that only the docs editor uses has a value that the look changes
  (`scripts/build-iterate-css.ts`): use a class that another component uses too. An app that installs the item from the registry imports
  `@atomic-editor/editor/styles.css` in its own stylesheet.
- `DocTree` draws @pierre/trees through its vanilla model (`doc-tree.ts`). The page passes the open
  path; a new one moves the selection. `doc-tree.ts` is its own build
  (`scripts/build-docs-tree.ts`), loaded when the tree first draws. The tree needs no CSS of the
  page: its element is as tall as its rows (in a flex column it takes the room it is given), and it
  follows the page's colour scheme.
- Other pages must load the same files and bytes with this item as without it. So: the item's
  Tailwind classes go to `docs-editor.css` only, never `styles.css`; its icons are ones no other entry
  imports (a shared icon becomes a new chunk); its live state comes through `iterate/react`, whose
  chunk the `live` entry already loads; its own libraries are in its own vendor chunks.
- Undo is Yjs's (`Y.UndoManager`): no extension here may add CodeMirror's `history()`.
- Tests: the anchor, the comments reducer, `ensureDoc`'s rows, and the session against a fake mind
  (`doc-session.test.ts`).

React Doctor (run from `packages/ui`):

```sh
npx react-doctor@latest --yes --verbose . | grep docs-editor
```
