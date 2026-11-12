// What `/minds/<address>` shows when it has no mind to show yet: the shell drawn from the URL
// alone, around a spinner while the browser signs in and reads, or around what failed.
import type { ReactNode } from "react";
import { useParams, useRouterState, type ErrorComponentProps } from "@tanstack/react-router";
import { AppShell } from "@iterate-com/ui/components/app-shell";
import {
  DefaultErrorComponent,
  DefaultPendingComponent,
} from "@iterate-com/ui/components/route-defaults";
import { usePageLabel } from "../lib/page-label.ts";
import { DashBreadcrumbs } from "./dash-breadcrumbs.tsx";
import { MindNav } from "./dash-nav.tsx";

/** The shell before sign-in, from what the URL says: the navigation and the mind. The account is
 *  a placeholder, and the page a spinner, until the route's own shell replaces it in place. */
export function MindFrame({ children }: { children?: ReactNode }) {
  const href = useRouterState({ select: (state) => state.location.href });
  const { mind } = useParams({ strict: false });
  const page = usePageLabel();
  const body = children || <DefaultPendingComponent />;
  if (!mind) return body;
  return (
    <AppShell
      app="Dash"
      mind={mind}
      mindHref={(address) => `/minds/${address}`}
      nav={<MindNav mind={mind} />}
      searchRow={false}
      header={<DashBreadcrumbs mind={mind} page={page} />}
      locationKey={href}
    >
      {body}
    </AppShell>
  );
}

/** The mind's sign-in or its first read failed: the frame stays, so the person can still go to
 *  another mind or another page, and the page says what failed, with a retry. */
export function MindLoadError({ error }: ErrorComponentProps) {
  const { mind } = useParams({ strict: false });
  return (
    <MindFrame>
      <DefaultErrorComponent error={error} title={`Dash could not load ${mind || "this mind"}`} />
    </MindFrame>
  );
}
