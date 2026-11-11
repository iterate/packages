# The virtual log

`VirtualLog` is the root that every view of a log stands on: `ContextView`'s feed, the agent chat,
an LLM trace, and any new view of a log. The header of `virtual-log.tsx` explains the scheme and
shows a whole view in a dozen lines. A view gives three slots:

| Slot     | For                                        | Scrolls                          |
| -------- | ------------------------------------------ | -------------------------------- |
| `rows`   | What is in the log, as many as there are   | Yes                              |
| `tail`   | What is not in the log yet: work in flight | Out, with the rows               |
| `footer` | What is always there: a composer           | Never: the rows scroll behind it |

Rules that the code cannot show you:

- Put a new view of a long log on `VirtualLog`, never `.map`. A list that is not a log (the
  context tree) uses TanStack Virtual directly.
- `rowInfo` must be stable (a constant or `useMemo`). When it changes, the virtualizer lays out
  every row again.
- A row renders its real height at once, with padding for spacing, not margin. The anchor trusts
  the first measurement. Streamdown's streaming mode paints empty first, so settled text uses
  `mode="static"`.
- A settled row keeps its identity and is memoised, so what streams re-renders only the live row.
  A pass over a growing log continues from what it made last (`remembered`).
- `older` stops on an error: a view passes `OLDER_EXHAUSTED` once its context has one. If not, the
  list asks for the failed page again each time the read ends.
- Only the reader, or a jump, leaves the end. Position alone cannot tell: while the virtualizer
  catches up, a following view reads as behind, and the browser animates a key's scroll. Test code
  that scrolls dispatches a `wheel` event first.
- One scrollbar. A row never scrolls on its own: code wraps, an opened row shows all of itself, and
  only a table too wide for the view scrolls sideways. A box with a capped height inside a row traps
  a finger on a phone.
- What a person touches stays theirs (`use-reader.ts`). A finger on the glass holds the view until
  it lifts. A row that a press opens past the height of the view shows from its top.
- The footer brings its own background.
- The browser's find sees only the rows in the DOM.

The load test that proved this (painted frames, screencast pixel counts, 100,000 rows) left the
repo with `core/os`: `git show cbf560aa7:test/playwright/ui/virtual-log.spec.ts`.

React Doctor scores 100 here. Keep it there (run from `packages/ui`):

```sh
npx react-doctor@latest --yes src/components/virtual-log/*.tsx src/components/virtual-log/*.ts src/components/context-view/*.tsx src/components/context-view/*.ts src/components/agent-chat/*.tsx src/components/agent-chat/*.ts
```
