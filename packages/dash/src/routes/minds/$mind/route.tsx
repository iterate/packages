// /minds/<address> — the frame of every page about one mind. The URL names the mind by
// its address (iterate/mind-api); the page's `itx` is that mind's root context, through the
// app's gate (`createIterateClient({ mind })`). A browser with no session there leaves to sign
// in, or to the connect page. Every page below reads `itx`, `read` and `mind` from this route's
// context. Until the browser has signed in, and in the server's HTML, the route shows `Frame`: the
// same shell, drawn from the URL alone.
import { useEffect } from "react";
import {
  createFileRoute,
  Outlet,
  useMatches,
  useParams,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { createIterateClient, type IterateClient } from "iterate/app";
import { AppShell } from "@iterate-com/ui/components/app-shell";
import { DefaultPendingComponent } from "@iterate-com/ui/components/route-defaults";
import { DropdownMenuGroup, DropdownMenuLabel } from "@iterate-com/ui/components/ui/dropdown-menu";
import { titleWithCount, useWaitingApprovals } from "@iterate-com/ui/lib/waiting-approvals";
import { Identifier } from "@iterate-com/ui/components/identifier";
import { DashBreadcrumbs } from "../../../components/dash-breadcrumbs.tsx";
import { MindNav } from "../../../components/dash-nav.tsx";

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
  // who the mind's API says is signed in, for the account menu
  loader: async ({ context }) => ({
    principal: (await context.read((itx) => itx.whoami())).principal || null,
  }),
  head: ({ params }) => ({ meta: [{ title: `${params.mind} · Dash` }] }),
  pendingComponent: Frame,
  component: Shell,
});

/** The label the deepest page that names itself gives (`staticData: { page }`), for the header. */
function usePageLabel() {
  return useMatches()
    .map((match) => match.staticData.page)
    .filter((label): label is string => Boolean(label))
    .at(-1);
}

/** The shell before sign-in, from what the URL says: the navigation and the mind. The account is
 *  a placeholder, and the page a spinner, until `Shell` replaces it in place. */
function Frame() {
  const href = useRouterState({ select: (state) => state.location.href });
  const { mind } = useParams({ strict: false });
  const page = usePageLabel();
  if (!mind) return <DefaultPendingComponent />;
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
      <DefaultPendingComponent />
    </AppShell>
  );
}

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
  const { principal } = Route.useLoaderData();
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
      nav={<MindNav mind={mind} waiting={waiting} />}
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
