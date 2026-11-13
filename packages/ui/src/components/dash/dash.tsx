// dash.tsx — A MIND'S DASH, drawn from lists: `Dash` takes the mind's pages (each a row with its
// id, name, icon and component) and its groups of links (other apps, the stack's pages), and draws
// the shell, the sidebar, the page the URL names and, on every page, what waits for a member's yes.
// ONE list of pages drives the sidebar and the overview's cards (`DashOverview`). A page is any
// component: the kit's (`DashContexts`, `DashRepo`, … in ./dash-pages.tsx) or one of the mind's
// own, which takes the same props (`DashPageProps`).
//
// The URL is the page's (#/lib/page-url.ts): `?page=<id>` (none: the first page) and the page's
// own keys. The overview of a no-build page loads none of the kit's larger parts: each page loads
// its own when it first draws, and suspends meanwhile.
import {
  Component,
  Suspense,
  use,
  useCallback,
  useEffect,
  useSyncExternalStore,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
} from "react";
import type { AuthenticatedApp } from "iterate/app";
import type { Principal } from "iterate/principal";
import { servesOf } from "./serves.ts";
import {
  DashContexts,
  DashNote,
  DashScroll,
  type DashLinks,
  type DashPage,
  type DashPageProps,
} from "./dash-pages.tsx";
import { AppShell } from "#/components/app-shell.tsx";
import { ApprovalsAlert } from "#/components/approvals-alert.tsx";
import { useContextCatalog } from "#/components/context-catalog/context-catalog-list.tsx";
import type { ContextListing } from "#/components/context-catalog/context-catalog-rows.ts";
import { ContextPalette } from "#/components/context-catalog/context-palette.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Card, CardDescription, CardHeader, CardTitle } from "#/components/ui/card.tsx";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "#/components/ui/sidebar.tsx";
import { Toaster } from "#/components/ui/sonner.tsx";
import { go, linkTo, pageHref, usePageParam, useSearch } from "#/lib/page-url.ts";
import { titleWithCount, useWaitingApprovals } from "#/lib/waiting-approvals.ts";

export {
  DashAnalytics,
  DashContexts,
  DashIntegrations,
  DashMcp,
  DashNote,
  DashPartIsOff,
  DashRepo,
  DashScroll,
  DashSecrets,
  type DashLink,
  type DashLinks,
  type DashPage,
  type DashPageProps,
} from "./dash-pages.tsx";

type Itx = AuthenticatedApp["itx"];

export function Dash({
  app,
  itx,
  mind,
  principal,
  pages,
  links,
}: {
  /** the app's name, on top of the sidebar: "Dash" */
  app: string;
  itx: Itx;
  mind: string;
  principal: Principal | null | undefined;
  pages: DashPage[];
  links: DashLinks[];
}) {
  // WHAT WAITS FOR A MEMBER'S YES is said on every page: the alert at the top of the sidebar, the
  // number beside the link that counts it, and the count before the tab's title. An agent stands
  // still until a member answers.
  const read = useCallback<AuthenticatedApp["read"]>((ask) => Promise.resolve(ask(itx)), [itx]);
  const waiting = useWaitingApprovals(mind, read);
  useEffect(() => {
    document.title = titleWithCount(document.title, waiting);
  }, [waiting]);
  const scheme = useSyncExternalStore(
    () => () => {},
    schemeOfPage,
    (): "light" => "light",
  );
  const search = useSearch();
  const asked = usePageParam("page");
  const page = pages.find((row) => row.id === asked) || pages[0];
  if (!page) throw new Error("A Dash has at least one page");
  const Page = page.component;
  // THE CATALOG OF THE MIND'S CONTEXTS, read once for every page: ⌘K lists it, and the Contexts
  // page shows its awake dots and its Recent list. A platform without it rejects: the rows stay
  // undefined, and ⌘K says so.
  const listContexts = useCallback(() => itx.contexts.list({ limit: 500 }), [itx]);
  const catalog = useContextCatalog(listContexts, { of: mind });
  const contextsPage = pages.find((row) => row.component === DashContexts);
  return (
    <>
      <AppShell
        app={app}
        mind={mind}
        mindHref={() => "./"}
        nav={
          <DashNav
            itx={itx}
            mind={mind}
            pages={pages}
            links={links}
            page={page}
            waiting={waiting}
          />
        }
        account={principal}
        palette={
          contextsPage
            ? ({ open, onClose }) => (
                <DashPalette
                  itx={itx}
                  rows={catalog.rows}
                  error={catalog.error}
                  open={open}
                  onClose={onClose}
                  contextsPage={contextsPage}
                  shown={page === contextsPage}
                />
              )
            : undefined
        }
        locationKey={search}
      >
        <PageBoundary key={page.id}>
          <Suspense fallback={<DashNote waiting>Loading the page…</DashNote>}>
            <Page
              itx={itx}
              mind={mind}
              principal={principal}
              page={page}
              pages={pages}
              links={links}
              catalog={catalog.rows}
            />
          </Suspense>
        </PageBoundary>
      </AppShell>
      <Toaster theme={scheme} />
    </>
  );
}

/** ⌘K: the mind's contexts (`ContextPalette`). Enter shows one on the Dash's Contexts page; the
 *  mind's own search finds a context that the page's 500 rows do not hold. */
function DashPalette({
  itx,
  rows,
  error,
  open,
  onClose,
  contextsPage,
  shown,
}: {
  itx: Itx;
  rows: readonly ContextListing[] | undefined;
  error: string | undefined;
  open: boolean;
  onClose: () => void;
  contextsPage: DashPage;
  /** whether the Contexts page is the page shown: then its context is the current row */
  shown: boolean;
}) {
  const context = usePageParam("context");
  const search = useCallback(
    (query: string) => itx.contexts.list({ search: query, limit: 200 }),
    [itx],
  );
  const openPath = useCallback(
    (path: string) => go(pageHref(contextsPage.id, { context: path === "/" ? undefined : path })),
    [contextsPage.id],
  );
  return (
    <ContextPalette
      rows={rows}
      error={error}
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      onOpenPath={openPath}
      current={shown ? context || "/" : undefined}
      search={search}
    />
  );
}

/** The page's colour scheme, as apps/theme.css set it when the page loaded: shadcn's class
 *  `dark` on `<html>`. Nothing changes it later, so the store has nothing to subscribe to. */
const schemeOfPage = (): "dark" | "light" =>
  document.documentElement.classList.contains("dark") ? "dark" : "light";

/** An `<a>` for a sidebar row's `render`: the row hands it its content and its own props. `inPage`:
 *  a plain left click changes the Dash's URL in place. */
function RowLink({
  href,
  inPage,
  onClick,
  ...props
}: ComponentProps<"a"> & { href: string; inPage?: boolean }) {
  const link = inPage ? linkTo(href) : undefined;
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        link?.onClick(event);
      }}
    />
  );
}

/** The link to a page of the list: the first one is the Dash's root, "./". */
function hrefOfPage(pages: DashPage[], page: DashPage) {
  return pageHref(page === pages[0] ? undefined : page.id);
}

/** A page that throws, or whose part did not load, says so in its own place; the sidebar stays. A
 *  browser keeps a module's failed load for the life of the page, so the way out is a reload. */
class PageBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  override state: { error: string | null } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  override render() {
    if (this.state.error === null) return this.props.children;
    return (
      <DashNote alert>
        This page did not load: {this.state.error}. <a href={location.href}>Load the page again</a>{" "}
        to try once more.
      </DashNote>
    );
  }
}

/** Whether the mind serves a page's part: false while the page asks, and for a page that every
 *  stack has. The sidebar and the cards draw at once, and mute a row when the answer is no. */
function Off({
  itx,
  serves,
  children,
}: {
  itx: Itx;
  serves: string | undefined;
  children: (off: boolean) => ReactNode;
}) {
  if (!serves) return children(false);
  return (
    <Suspense fallback={children(false)}>
      <OffAnswer itx={itx} serves={serves}>
        {children}
      </OffAnswer>
    </Suspense>
  );
}

function OffAnswer({
  itx,
  serves,
  children,
}: {
  itx: Itx;
  serves: string;
  children: (off: boolean) => ReactNode;
}) {
  return children(!use(servesOf(itx, serves)));
}

/** The sidebar: the pages, then each group of links. A page whose part the mind does not have
 *  stays in its place, muted, with "Off" beside it. */
function DashNav({
  itx,
  mind,
  pages,
  links,
  page,
  waiting,
}: {
  itx: Itx;
  mind: string;
  pages: DashPage[];
  links: DashLinks[];
  page: DashPage;
  waiting: number;
}) {
  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <ApprovalsAlert
            waiting={waiting}
            render={<RowLink href={`https://iterate.${mind}/secrets/approvals`} />}
          />
          <SidebarMenu>
            {pages.map((row) => (
              <Off key={row.id} itx={itx} serves={row.serves}>
                {(off) => (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={row === page}
                      tooltip={row.name}
                      className={off ? "text-muted-foreground" : undefined}
                      render={<RowLink href={hrefOfPage(pages, row)} inPage />}
                    >
                      <row.icon />
                      <span>{row.name}</span>
                    </SidebarMenuButton>
                    {off ? (
                      <SidebarMenuBadge className="text-muted-foreground">Off</SidebarMenuBadge>
                    ) : null}
                  </SidebarMenuItem>
                )}
              </Off>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      {links.map((group) => (
        <SidebarGroup key={group.title}>
          <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {group.rows.map((row) => (
                <SidebarMenuItem key={row.name}>
                  <SidebarMenuButton tooltip={row.name} render={<RowLink href={row.href} />}>
                    <row.icon />
                    <span>{row.name}</span>
                  </SidebarMenuButton>
                  {row.count === "approvals" && waiting ? (
                    <SidebarMenuBadge>{waiting}</SidebarMenuBadge>
                  ) : null}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  );
}

/** THE OVERVIEW: the mind's address, the page's own words (`children`), and a card for each page
 *  with an `about` (under `pagesTitle`) and for each link of each group. */
export function DashOverview({
  itx,
  mind,
  pages,
  links,
  pagesTitle,
  children,
}: DashPageProps & {
  pagesTitle: string;
  children?: ReactNode;
}) {
  return (
    <DashScroll>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-8">
        <header>
          <h1 className="mb-1.5 text-2xl font-semibold tracking-tight">{mind}</h1>
          <p className="text-sm text-muted-foreground">{children}</p>
        </header>
        <DashCards title={pagesTitle}>
          {pages
            .filter((row) => row.about)
            .map((row) => (
              <Off key={row.id} itx={itx} serves={row.serves}>
                {(off) => (
                  <DashCard
                    name={row.name}
                    icon={row.icon}
                    about={(off && row.offAbout) || row.about}
                    off={off}
                    link={linkTo(hrefOfPage(pages, row))}
                  />
                )}
              </Off>
            ))}
        </DashCards>
        {links.map((group) => (
          <DashCards key={group.title} title={group.title}>
            {group.rows.map((row) => (
              <DashCard
                key={row.name}
                name={row.name}
                icon={row.icon}
                about={row.about}
                link={{ href: row.href }}
              />
            ))}
          </DashCards>
        ))}
      </div>
    </DashScroll>
  );
}

/** One group of cards: as many in a row as fit. */
export function DashCards({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-medium text-muted-foreground">{title}</h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">{children}</div>
    </section>
  );
}

/** A card that is a link, whole. `off`: "Off" beside the name, for a part the mind does not
 *  have. */
export function DashCard({
  name,
  icon: Icon,
  about,
  off,
  link,
}: {
  name: string;
  icon: DashPage["icon"];
  about: string | undefined;
  off?: boolean;
  link: { href: string; onClick?: (event: MouseEvent<HTMLAnchorElement>) => void };
}) {
  return (
    <a
      {...link}
      className="block rounded-xl text-inherit no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&>*]:h-full [&>*]:transition-shadow hover:[&>*]:ring-ring"
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            {name}
            {off ? (
              <Badge variant="outline" className="ml-auto text-muted-foreground">
                Off
              </Badge>
            ) : null}
          </CardTitle>
          <CardDescription>{about}</CardDescription>
        </CardHeader>
      </Card>
    </a>
  );
}
