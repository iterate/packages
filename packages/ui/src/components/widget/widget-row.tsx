// A WIDGET'S ROW IN THE AGENT CHAT'S FEED. The chat folds the newest widget for each key over the
// facts it holds (widget.ts `widgetFold`) and gives it here with a React context, beside what a
// widget may do: send the person's words, give the agent words for its next turn, and, for another
// server's MCP App, call that server (widget-mcp.ts). The row of a key's first fact draws the
// newest widget; a later fact with the same key replaced it, so its own row draws nothing.
"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { WIDGET_FACT, widgetFold, type Widget, type WidgetFold } from "./widget.ts";
import { WidgetFrame, type WidgetServerCalls } from "./widget-frame.tsx";
import type { WidgetMcpCalls } from "./widget-mcp.ts";

/** Words from a press in a widget, and the widget they came from. */
export type WidgetSend = (text: string, widget: { key: string; offset: number }) => void;

type WidgetHost = {
  fold: WidgetFold;
  onSend?: WidgetSend;
  onDraft?: (text: string) => void;
} & WidgetServerCalls;
const WidgetHostContext = createContext<WidgetHost>({ fold: new Map() });

/** Gives each widget row under it the newest widget for its key, from `events`. `path` is the
 *  agent's; `calls` makes an app's tool calls and reads through it; `onAppend` writes a view's
 *  words for the agent's next turn on its log. */
export function WidgetHostProvider({
  events,
  onSend,
  onDraft,
  path,
  calls,
  onAppend,
  children,
}: {
  events: readonly unknown[];
  onSend?: WidgetSend;
  /** Puts another server's words into the chat's composer. None: an app's words are refused. */
  onDraft?: (text: string) => void;
  path?: string;
  calls?: WidgetMcpCalls;
  onAppend?: (events: unknown[]) => Promise<unknown>;
  children: ReactNode;
}) {
  // with the path: a widget's `contexts` count only from a fact that this agent's context wrote
  const fold = useMemo(() => widgetFold(events, undefined, path), [events, path]);
  const server = useMemo(() => serverCallsOf(path, calls, onAppend), [path, calls, onAppend]);
  const host = useMemo(
    () => ({ fold, onSend, onDraft, ...server }),
    [fold, onSend, onDraft, server],
  );
  return <WidgetHostContext.Provider value={host}>{children}</WidgetHostContext.Provider>;
}

export function WidgetRow({ widgetKey, offset }: { widgetKey: string; offset: number }) {
  const { fold, onSend, onDraft, onCallTool, onReadResource, onReadContext, onModelContext } =
    useContext(WidgetHostContext);
  const held = fold.get(widgetKey);
  if (!held || held.first !== offset) return null;
  return (
    <WidgetFrame
      widget={held.widget}
      onSend={onSend}
      onDraft={onDraft}
      onCallTool={onCallTool}
      onReadResource={onReadResource}
      onReadContext={onReadContext}
      onModelContext={onModelContext}
    />
  );
}

/** The frame's server calls for the agent at `path`: an app's go to the server its fact names,
 *  with that fact's headers; a view's context is one fact on the agent's log. */
function serverCallsOf(
  path: string | undefined,
  calls: WidgetMcpCalls | undefined,
  onAppend: ((events: unknown[]) => Promise<unknown>) | undefined,
): WidgetServerCalls {
  const appOf = (widget: Widget) => {
    if (!widget.app) throw new Error("This widget has no server.");
    return widget.app;
  };
  return {
    ...(path &&
      calls && {
        onCallTool: ({ widget, name, arguments: args }) => {
          const { server, headers } = appOf(widget);
          return calls.callTool({ path, key: widget.key, server, headers, name, args });
        },
        onReadResource: ({ widget, uri }) => {
          const { server, headers } = appOf(widget);
          return calls.readResource({ path, server, headers, uri });
        },
      }),
    // a host older than this verb has none: the widget's read is then refused in words
    ...(path &&
      calls?.readContext && {
        onReadContext: ({ widget, context, after, limit }) =>
          calls.readContext!({ path, key: widget.key, context, after, limit }),
      }),
    ...(onAppend && {
      onModelContext: ({ widget, content }) => {
        void onAppend([
          {
            type: WIDGET_FACT.context,
            payload: { key: widget.key, server: widget.app?.server, content },
          },
        ]).catch(() => undefined);
      },
    }),
  };
}
