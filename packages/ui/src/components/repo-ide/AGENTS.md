# The repo IDE

`RepoIde` is a small IDE over one of a mind's repos: a file tree, an editable CodeMirror buffer with
a diff against the last commit, staging, commit and history. Dash's
`routes/minds/$mind/repos.$.tsx` is the host to copy.

- The host owns the mind stub, the route and the shell. The IDE imports no SDK at runtime, no router
  and nothing from an app. Its view state is the `search` prop (`RepoIdeSearch`), so a host without
  a router keeps it in React state.
- Parts that stand alone: `repo-file-tree`, `repo-code-editor`, `markdown-preview`, `html-preview`
  and `repo-client` (`useRepoFiles`, `readRepoFile`). Import one by its path. The rest of the folder
  belongs to the IDE.
- Client only: the IDE reads the working tree from `localStorage` while it renders. Mount it where
  the page is not server-rendered (under an `ssr: false` route, or in `ClientOnly`).
- Every `@codemirror/*` import in the folder is a dynamic `import()` in `codemirror.ts`, so a page
  that never shows a file never downloads CodeMirror. Keep it so. In a TanStack Start file route,
  import `RepoIde` statically: the route is already its own chunk.
- The markdown preview renders through streamdown. The app's stylesheet must scan it, as Dash's
  does.
- Text only: images and archives show a notice.

React Doctor scores 100 here. Keep it there (run from `packages/ui`):

```sh
npx react-doctor@latest --yes src/components/repo-ide/*.tsx src/components/repo-ide/*.ts
```
