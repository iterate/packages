// agent-page-header.tsx — THE AGENT PAGE'S HEADER, one row: the agent's title and its path at the
// left, then, at the right and never wrapped, who is here (the mind's face first), the call's
// controls (Start call or Join call; in the call, one button group and Leave), Share, and Chat |
// Events. The Dash's agent page and Meet draw this
// one row, so the two pages cannot drift apart.
//
// Inside an `AppShell` (the Dash) the row goes into the shell's header row. A page with no shell
// (Meet) gets the same row as a header of its own, with the shell's rule under it.
//
//   html`<${AgentPageHeader} path=${path} title=${title} mind=${{ name, logo }} presence
//          aside=${setAside} call callIn=${setCallIn} share shareIn=${setShareIn}
//          tabs=${{ view, hasChat: true, held, wholeLogHeld, onStateChange }} />`
import type { ComponentProps, ReactNode } from "react";
import { AgentTabs } from "./agent-strip.tsx";
import { ConversationAccessWaiting, type MindFace } from "./presence-line.tsx";
import { CallHeaderWaiting } from "#/components/call/call-controls.tsx";
import { ShareButton } from "#/components/call/call-share.tsx";
import { AppShellPageHeader, useInAppShell } from "#/components/app-shell.tsx";
import { ContextPathText } from "#/components/context-path-text.tsx";
import { isPresenceEvent } from "#/lib/presence.ts";

export type { MindFace };

export type AgentPageHeaderProps = {
  path: string;
  /** The catalog's rows, where the agent's title is read (`title` wins over it). */
  agents?: readonly { path: string; title?: string | null }[];
  /** The agent's title. Absent: the catalog's, else the path alone. */
  title?: string;
  /** Before the title: a page's own way back, such as a link to its list. */
  before?: ReactNode;
  /** Chat | Events. Absent: the tabs are drawn as they will be and cannot be pressed: the view is
   *  not there yet. */
  tabs?: Omit<ComponentProps<typeof AgentTabs>, "className">;
  /** The page shows who else is here. */
  presence: boolean;
  /** Receives the place where the chat draws who is here (`AgentChat`'s `asideIn`). */
  aside?: (element: HTMLElement | null) => void;
  /** The mind: the first face of the stack, always there, with presence or without. */
  mind?: MindFace;
  call: boolean;
  /** Receives the call's place. */
  callIn?: (element: HTMLElement | null) => void;
  share?: boolean;
  /** Receives Share's place. */
  shareIn?: (element: HTMLElement | null) => void;
};

/** THE AGENT PAGE'S HEADER. Who is here, the call and Share each have no box of their own: before
 *  their part has drawn, the header draws them as they will be, which cannot be pressed yet (the
 *  mind's face, with a plain circle for the viewer under presence; Start call; Share).
 *  Where their part is there (`aside`, `callIn`, `shareIn`), the places are `contents`, which the
 *  part fills in the same paint. So the header never shows an empty place. Who is here grows to
 *  its left as people come, so the controls and the tabs do not move. Without presence the stack
 *  is the mind's face alone. */
export function AgentPageHeader(props: AgentPageHeaderProps) {
  const inShell = useInAppShell();
  const row = <AgentPageHeaderRow {...props} />;
  if (inShell) return <AppShellPageHeader>{row}</AppShellPageHeader>;
  return (
    <header className="flex shrink-0 items-center gap-3 border-b px-4 py-1.5">
      <div data-page-header className="flex min-w-0 flex-1 items-center gap-x-4 gap-y-1">
        {row}
      </div>
    </header>
  );
}

function AgentPageHeaderRow({
  path,
  agents,
  title: given,
  before,
  tabs,
  presence,
  aside,
  mind,
  call,
  callIn,
  share = false,
  shareIn,
}: AgentPageHeaderProps) {
  const title = given || agents?.find((agent) => agent.path === path)?.title || undefined;
  // the chat fills the place only while presence is on
  const stackIn = presence ? aside : undefined;
  return (
    <>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {before}
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          {title ? (
            <span className="hidden max-w-1/2 shrink-0 truncate text-sm font-medium md:block">
              {title}
            </span>
          ) : null}
          <ContextPathText
            path={path}
            truncate
            className={title ? "text-sm md:text-xs md:text-muted-foreground" : "text-sm"}
          />
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        <span ref={stackIn} data-slot="agent-header-aside" className="contents">
          {stackIn ? null : <ConversationAccessWaiting mind={mind} viewer={presence} />}
        </span>
        {call ? (
          <span ref={callIn} data-slot="agent-header-call" className="contents">
            {callIn ? null : <CallHeaderWaiting member />}
          </span>
        ) : null}
        {share ? (
          <span ref={shareIn} data-slot="agent-header-share" className="contents">
            {shareIn ? null : <ShareButton disabled />}
          </span>
        ) : null}
        {tabs ? (
          <AgentTabs {...tabs} />
        ) : (
          <div inert>
            <AgentTabs
              view={undefined}
              hasChat
              held={undefined}
              wholeLogHeld
              onStateChange={nothingToChange}
            />
          </div>
        )}
      </span>
    </>
  );
}

/** Tabs that cannot be pressed have no state to change. */
function nothingToChange() {}

/** How many of the held events are rows of the log, the Events tab's count: a page's presence
 *  status is no row. */
export function heldRowsOf(events: readonly { type: string }[]): number {
  return events.filter((event) => !isPresenceEvent(event)).length;
}
