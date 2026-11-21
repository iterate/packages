// dash-share.tsx — SHARE ON AN AGENT IN THE DASH: the kit's Share (components/call/call-share.tsx)
// in the agent page's header, beside the call's controls, with the Dash's `DashShare` bound to this
// agent. The Agents page loads this module with the call's part, only where its row turns both on
// (`DashPage["share"]` beside `DashPage["call"]`).
import { useMemo } from "react";
import { createPortal } from "react-dom";
import { CallShare, type ShareContext } from "#/components/call/call-share.tsx";
import type { DashShare } from "#/components/dash/dash.tsx";

/** SHARE, drawn into the header's place `shareIn`. `pageUrl` is the agent's page in this Dash,
 *  which the members' link and an invite for members hold. */
export function AgentShare({
  share,
  itx,
  path,
  title,
  pageUrl,
  context,
  enable,
  shareIn,
}: {
  share: DashShare;
  itx: Parameters<DashShare["make"]>[0];
  path: string;
  /** The agent's title, or the last part of its path: the invite's title. */
  title: string;
  pageUrl: string;
  context: ShareContext;
  /** Turns the call on for this agent. */
  enable: () => Promise<unknown>;
  shareIn: HTMLElement | null;
}) {
  const links = useMemo(
    () => ({
      make: (lifetimeMs: number) => share.make(itx, path, lifetimeMs),
      end: (link: string) => share.end(itx, path, link),
    }),
    [share, itx, path],
  );
  if (!shareIn) return null;
  return createPortal(
    <CallShare share={links} title={title} pageUrl={pageUrl} context={context} enable={enable} />,
    shareIn,
  );
}
