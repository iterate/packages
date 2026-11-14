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
  `aboveComposer` takes a row of the page's own over the composer.
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
