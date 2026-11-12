// /minds/<address> — the frame of every page about one mind. The URL names the mind by
// its address (iterate/mind-api); the page's `itx` is that mind's root context, through the
// app's gate (`createIterateClient({ mind })`). A browser with no session there leaves to sign
// in, or to the connect page. Every page below reads `itx`, `read` and `mind` from this route's
// context. Until the browser has signed in, and in the server's HTML, the route shows `MindFrame`
// (components/mind-frame.tsx): the same shell, drawn from the URL alone.
import { useEffect } from "react";
import { createFileRoute, Outlet, useRouter, useRouterState } from "@tanstack/react-router";
import { createIterateClient, type IterateClient } from "iterate/app";
import { AppShell } from "@iterate-com/ui/components/app-shell";
import { DropdownMenuGroup, DropdownMenuLabel } from "@iterate-com/ui/components/ui/dropdown-menu";
import { titleWithCount, useWaitingApprovals } from "@iterate-com/ui/lib/waiting-approvals";
import { Identifier } from "@iterate-com/ui/components/identifier";
import { DashBreadcrumbs } from "../../../components/dash-breadcrumbs.tsx";
import { MindNav } from "../../../components/dash-nav.tsx";
import { MindFrame, MindLoadError } from "../../../components/mind-frame.tsx";
import { usePageLabel } from "../../../lib/page-label.ts";
import { servesRoot } from "../../../lib/served.ts";

/** One client per mind this page has shown, so switching back keeps its connection. */
const clients = new Map<string, IterateClient>();
function clientFor(mind: string) {
  let client = clients.get(mind);
  if (!client) {
    client = createIterateClient({ mind });
    clients.set(mind, client);
  }
  return client;
}

export const Route = createFileRoute("/minds/$mind")({
  // signing in is the browser's: the server's HTML is the frame from the URL
  ssr: false,
  beforeLoad: async ({ params, location }) => ({
    ...(await clientFor(params.mind).authenticate(location.href)),
    mind: params.mind,
  }),
  // Who the mind's API says is signed in, for the account menu, and whether the mind has
  // telemetry, for the sidebar's "Off" beside Analytics. Both once for a mind. A failed second
  // read marks nothing.
  loader: async ({ context }) => {
    const [who, telemetry] = await Promise.all([
      context.read((itx) => itx.whoami()),
      servesRoot(context.read, "telemetry").catch(() => true),
    ]);
    return { principal: who.principal || null, telemetry };
  },
  head: ({ params }) => ({ meta: [{ title: `${params.mind} · Dash` }] }),
  pendingComponent: MindFrame,
  // a sign-in or a first read that failed: the same frame, with what failed and a retry
  errorComponent: MindLoadError,
  component: Shell,
});

/** The count of what waits, before the tab's title. The router writes the title on each
 *  navigation, after which the count is put back: a watch on the head, for as long as the mind is
 *  shown. */
function useCountInTitle(count: number) {
  useEffect(() => {
    const write = () => {
      const wanted = titleWithCount(document.title, count);
      if (document.title !== wanted) document.title = wanted;
    };
    write();
    const watch = new MutationObserver(write);
    watch.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      watch.disconnect();
      document.title = titleWithCount(document.title, 0);
    };
  }, [count]);
}

function Shell() {
  const { mind, read } = Route.useRouteContext();
  const { principal, telemetry } = Route.useLoaderData();
  const router = useRouter();
  const href = useRouterState({ select: (state) => state.location.href });
  const page = usePageLabel();
  const waiting = useWaitingApprovals(mind, read);
  useCountInTitle(waiting);
  return (
    <AppShell
      app="Dash"
      mind={mind}
      mindHref={(address) => `/minds/${address}`}
      // the dash has a client router: a plain click on a switcher item is a route change, not a
      // page load (the shell leaves modified and middle clicks to the anchor)
      onNavigate={(to, event) => {
        event.preventDefault();
        void router.navigate({ href: to });
      }}
      nav={<MindNav mind={mind} waiting={waiting} telemetryOff={!telemetry} />}
      searchRow={false}
      header={<DashBreadcrumbs mind={mind} page={page} />}
      // the menu names the mind when its API says nobody
      account={principal}
      accountActions={
        principal ? (
          // the person's id, copyable (Base UI: a menu label lives inside a group)
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              <Identifier value={principal.actor} textClassName="text-xs" />
            </DropdownMenuLabel>
          </DropdownMenuGroup>
        ) : undefined
      }
      locationKey={href}
    >
      <Outlet />
    </AppShell>
  );
}
