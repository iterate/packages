// A WIDGET'S ROW IN THE AGENT CHAT'S FEED. The chat folds the newest widget for each key over the
// facts it holds (widget.ts `widgetFold`) and gives it here with a React context, beside how a
// widget sends the person's words. The row of a key's first fact draws the newest widget; a later
// fact with the same key replaced it, so its own row draws nothing.
"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { widgetFold, type WidgetFold } from "./widget.ts";
import { WidgetFrame } from "./widget-frame.tsx";

type WidgetHost = { fold: WidgetFold; onSend?: (text: string) => void };
const WidgetHostContext = createContext<WidgetHost>({ fold: new Map() });

/** Gives each widget row under it the newest widget for its key, from `events`. */
export function WidgetHostProvider({
  events,
  onSend,
  children,
}: {
  events: readonly unknown[];
  onSend?: (text: string) => void;
  children: ReactNode;
}) {
  const fold = useMemo(() => widgetFold(events), [events]);
  const host = useMemo(() => ({ fold, onSend }), [fold, onSend]);
  return <WidgetHostContext.Provider value={host}>{children}</WidgetHostContext.Provider>;
}

export function WidgetRow({ widgetKey, offset }: { widgetKey: string; offset: number }) {
  const { fold, onSend } = useContext(WidgetHostContext);
  const held = fold.get(widgetKey);
  if (!held || held.first !== offset) return null;
  return <WidgetFrame widget={held.widget} onSend={onSend} />;
}
