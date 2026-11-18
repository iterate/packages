# The agent chat

`AgentChat` is one agent's conversation: the chat with a composer, its events (`ContextView`), and
the traces of its LLM requests and script runs. The header of `agent-chat.tsx` shows how a host
mounts it. In the Agents app it is the view of the iterate agent kind
(`core/configs/default/agent-kinds/iterate.ts`), loaded through `src/agent-kind-view/`.

- The host owns the agent's context, the hook and the route. The chat owns everything inside its
  box. It imports no router and nothing of the SDK's client. Its view state is the `state` prop
  (`AgentChatState` in `agent-chat-search.ts`).
- At runtime it imports only three pure SDK modules: `iterate/agents/contract`,
  `iterate/agents/codemode-format` and `iterate/stream/run`.
- Pass `AgentChat.contextOptions` to `useIterateContext`. It names the streamed chunk windows,
  because a wildcard never matches an ephemeral event. Without it, an answer does not stream.
- A log of any length opens as fast as a short one: the chat reads the newest page and reads older
  pages as the reader scrolls up, on [the virtual log](../virtual-log/AGENTS.md). This works because
  the reducer's memory is one turn long (`agent-ui-reducer.ts`). Keep it so. An LLM trace reads
  every older page, because its prompt is every context item before the request.
- Inputs with `llmRequestPolicy: "dont-trigger-request"` fold into one quiet row per run. They close
  no activity and join no queue. Inputs that start a turn stay bubbles.
- `strip={false}` is the chat alone, for a page whose reader is no developer (a mind's own
  sign-up page): no strip and no Events tab, and the agent's status is the feed's last row.
  `aboveComposer` takes a row of the page's own over the composer. `empty` is the page's own
  greeting, centred in the feed once the log is read and nothing has been said, and `placeholder`
  the composer's text.
  `eventsTab={false}` keeps the strip's status and drops the Events tab. `attach={false}` makes the
  composer take words only: no `+`, so no files and no raw mode.
- Several people can use one chat. Who sent a message is the platform's stamp on its event
  (`senderOf` in `stream-event.ts`, the rule of `iterate/agents`' `speakerOf`), never a name in a
  payload. Another person's bubble has their face and short name under it, each waiting message
  in the queue says whose it is, and an answer that was stopped says who stopped it. Anyone may
  interrupt any answer. How a principal is shown, in words and as a face, is decided in one place,
  [`lib/principal-label.ts`](../../lib/principal-label.ts): an email, else the name a person who
  is no member gave (a guest's is marked " (guest)"), else the actor id. A name is the person's
  claim: text only, never a key, never compared with `me`.
- `presence` shows, in a line over the composer, who else has the chat open now, who is typing,
  and a button that says who can use the conversation ("Shared" when another principal is here or
  wrote, else "Open to members"). [`lib/presence.ts`](../../lib/presence.ts) has two layers. WHO
  IS HERE is the platform's: each open chat reads the log through a row of the context's
  subscriptions table, a live callback that the context removes when the page's socket closes,
  and the platform stamps who holds it (`heldBy`). A row is a page while its stub is lent
  (`context.presence.rpcStubs`), a principal holds it through an app's page (`via`), and it
  names the status type in `consumes`. WHAT ONLY A PAGE KNOWS is its status: hidden or not,
  typing or not, and `marks`. The page says it in one ephemeral `presence/status` that names its
  own row (`context.subscription`), when it changes and when another principal's page appears.
  A status counts only when the platform's stamp on it is the principal who holds that row, and
  it goes with the row. The stamp is a member's own session (`source.principal`) or a person's
  one-context view (`source.onBehalfOf` with `via.appPage` and no `run` or `call`); code that ran
  for someone is nobody. A page with no `context.subscription` says nothing and still shows who is
  here. A context whose rows carry no `heldBy` (a platform that does not stamp them yet) shows
  nobody. Status events are no row: the Events tab and its count leave them out
  (`isPresenceEvent`). Pass `presence` only on a page of a signed-in person whose session may
  append the status to the context (a member's session, or a person's one-context view), with
  their actor id as `me`. `AgentChat.contextOptions` names the status
  type. A face is initials on the principal's own colour (`Face`); no picture is looked up.
- `onMessage` gets a `key` for each message. Hand it on as `message(input, { key })`: a send that
  is tried again after a lost answer then lands once.
- A choice in an agent's words is `[[kind:value|label]]` (kind `domain`, `account`, `name`, `say`
  or `link`; no label: the value is the words). `onChoice` gets `{ kind, value, label }` on a press,
  through a React context (`choice-in-words.tsx`); `choiceState` draws one as "chosen" or "busy".
  With no `onChoice` a choice is its plain words. A text kind is a `span` with the button role, so
  it wraps with its sentence; `link` is a pill `<button>`. A running answer shows its words and
  hides one not finished yet. In code it stays as written.
- The page's own rows go under a feed item through `itemFooter`. `inspectors` gives the Events
  tab's inspector a body for the page's own event types. The rows of the Events tab are the same
  for every type: the type as stored and a glance at the payload.
- The copy buttons call sonner's `toast`, so the page renders this package's `Toaster` once
  (`AppProviders` does this in the apps).
- Markdown renders through streamdown. An app's stylesheet must scan it
  (`@source "../node_modules/streamdown/dist/*.js";`, as the apps' `styles.css` do).
- Tests: the reducer's (`agent-ui-reducer.test.ts`) and the log's (`agent-events.test.ts`). The
  `fix-stream` skill (`.agents/skills/fix-stream` in the private repo) says which one a broken chat
  adds a row to.
- `examples/agent-chat-page.ts` is a page to copy.
- React Doctor scores 100 here. The command is in [the virtual log's notes](../virtual-log/AGENTS.md).
