// The one shell for the client apps (dash, agents, notes, docs, voice, admin): the sidebar (the
// mind switcher in its header, the app's own navigation in its body, the collapse button and the
// account menu in its footer, the rail) and the page
// beside it under a header row that carries the phone's sidebar trigger, a page's own row
// (`AppShellPageHeader`) and its menu (`AppShellPageMenu`) — and ⌘K, a palette over the minds
// and the sidebar's pages (app-shell-palette.tsx). Router-agnostic on purpose: the app
// hands over hrefs and its current location, nothing from TanStack comes in here.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  CheckIcon,
  ChevronsLeftIcon,
  ChevronsUpDownIcon,
  EllipsisIcon,
  LogOutIcon,
  PlusIcon,
  SearchIcon,
} from "lucide-react";
import { cn } from "cn";
import type { Principal } from "iterate/principal";
import {
  AppShellPalette,
  PaletteHeaderButton,
  PaletteSidebarButton,
  usePaletteShortcut,
} from "./app-shell-palette.tsx";
import {
  readSidebarNav,
  type AppPaletteEntry,
  type SidebarNavItem,
} from "./app-shell-palette-entries.ts";
import { useConnectedMinds } from "./connected-minds.ts";
import { plainLeftClick } from "#/lib/plain-left-click.ts";
import { ThemeMenuItems, ThemeProvider } from "#/components/mode-toggle.tsx";
import { Avatar, AvatarFallback } from "#/components/ui/avatar.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import { IterateLogo } from "#/components/iterate-logo.tsx";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "#/components/ui/sidebar.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { resetPosthog } from "#/components/posthog.tsx";

/** Where the switcher's "Connect another mind" goes: every app's connect page
 *  (iterate/app-server `CONNECT_PAGE_PATH`). */
const CONNECT_PAGE = "/connect";

/** Nothing to subscribe to: the cookie has no change event, and `SidebarProvider` reads
 *  `defaultOpen` once, when it mounts. */
const subscribeToNothing = () => () => {};

/** Frames a signed-in page. It reads the `sidebar_state` cookie shadcn's provider writes, so the
 *  sidebar reopens the way it was left — through `useSyncExternalStore`, which keeps the read out
 *  of render: a server render (the dash's frame before sign-in, routes/_auth.tsx) gets shadcn's
 *  default, open, until the page hydrates. */
export function AppShell({
  app,
  mind,
  mindHref,
  onNavigate,
  switcher,
  nav,
  paletteEntries,
  commandPalette = true,
  searchRow = true,
  header,
  account,
  accountActions,
  locationKey,
  children,
}: {
  /** the app's name, on top of the switcher: "Agents", "Notes", "Voice" */
  app: string;
  /** the mind the page shows, by its address; the switcher lists the others this browser is
   *  connected to (`useConnectedMinds`) */
  mind: string | null;
  /** where the app shows a mind (`/minds/<address>` by convention) — a same-origin href;
   *  switching is a full navigation unless
   *  `onNavigate` takes it (an app with a client router prevents the default and navigates itself).
   *  Only a plain left click is handed over: a modified or middle click keeps the anchor's own
   *  behaviour (a new tab). */
  mindHref: (address: string) => string;
  onNavigate?: (href: string, event: MouseEvent<HTMLAnchorElement>) => void;
  /** what heads the sidebar instead of the mind switcher, for an app that is not about one
   *  mind (the Cloud: a person and their deployments) — `AppShellBrand` is the plain one */
  switcher?: ReactNode;
  /** the app's own navigation, its `SidebarGroup`s */
  nav?: ReactNode;
  /** rows for ⌘K beside what it reads off `nav`: what the sidebar shows in a way it can't read
   *  (a file tree in its own shadow DOM) */
  paletteEntries?: AppPaletteEntry[];
  /** ⌘K, the sidebar's "Search" row and the phone's Search button; false for an app with nothing
   *  to search (the Cloud's installer: one page, no navigation) */
  commandPalette?: boolean;
  /** the sidebar's "Search" row above `nav`; without it, ⌘K and the phone's header button still
   *  open the palette */
  searchRow?: boolean;
  /** what sits beside the phone's sidebar trigger in the header row; without it, a desktop shows
   *  the row only while a page puts its own in it (`AppShellPageHeader`) */
  header?: ReactNode;
  /** who the app is signed in as, when it knows; null when the app is signed in to `mind` but
   *  does not know as whom (the menu then names the mind). "Sign out" posts to the gate's
   *  `/.auth/logout?mind=<address>`, which ends that mind's sign-in alone. Undefined while the
   *  app is still signing in: a placeholder of the menu's height holds its place. False when nobody
   *  is signed in and the page shows all the same: no menu. */
  account?: Principal | null | false;
  /** the app's own items in the account menu, before Sign out — `DropdownMenuItem`s; an app with
   *  no mind brings its own Sign out here */
  accountActions?: ReactNode;
  /** the router's current href — a change closes the phone's sidebar sheet */
  locationKey: string;
  children: ReactNode;
}) {
  const connected = useConnectedMinds();
  // the switcher's and the palette's list: every connected mind, the shown one too while the
  // gate has not answered, by address
  const minds = useMemo(
    () =>
      [
        ...new Set([
          ...(mind ? [mind] : []),
          ...(connected?.minds.map((item) => item.address) || []),
        ]),
      ].sort(),
    [connected, mind],
  );
  const defaultOpen = useSyncExternalStore(
    subscribeToNothing,
    () => !document.cookie.split("; ").includes("sidebar_state=false"),
    () => true,
  );
  // the palette: the sidebar's navigation as it read when ⌘K opened it, null while closed
  const navRef = useRef<HTMLDivElement>(null);
  const [palette, setPalette] = useState<SidebarNavItem[] | null>(null);
  const openPalette = useCallback(() => setPalette(readSidebarNav(navRef.current)), []);
  // the header row's middle and end, where a page's own row (`AppShellPageHeader`) and its menu
  // (`AppShellPageMenu`) go
  const [pageHeaderSlot, setPageHeaderSlot] = useState<HTMLElement | null>(null);
  const [pageMenuSlot, setPageMenuSlot] = useState<HTMLElement | null>(null);
  const togglePalette = useCallback(
    () => setPalette((open) => (open ? null : readSidebarNav(navRef.current))),
    [],
  );
  usePaletteShortcut(commandPalette ? togglePalette : null);
  useHeightOfWhatIsVisible();
  const pageSlots = useMemo(
    () => ({ header: pageHeaderSlot, menu: pageMenuSlot, openPalette, appHeader: header }),
    [pageHeaderSlot, pageMenuSlot, openPalette, header],
  );
  return (
    // the app's theme, unless the app has its own provider above this one
    <ThemeProvider>
      <SidebarProvider defaultOpen={defaultOpen} className="h-(--app-height,100svh) min-h-0">
        {/* outside <Sidebar>: on a phone its children live in a Sheet that remounts when opened */}
        <CloseMobileSidebarOnNavigate locationKey={locationKey} />
        <Sidebar collapsible="icon">
          <SidebarHeader>
            {switcher ?? (
              <MindSwitcher
                app={app}
                minds={minds}
                mind={mind}
                mindHref={mindHref}
                onNavigate={onNavigate}
              />
            )}
            {commandPalette && searchRow ? <PaletteSidebarButton onOpen={openPalette} /> : null}
          </SidebarHeader>
          {/* ⌘K lists what the sidebar shows here — on a desktop; a phone's lists the minds alone */}
          <SidebarNav navRef={navRef}>{nav}</SidebarNav>
          <SidebarFooter>
            <CollapseButton />
            {/* oxlint-disable-next-line iterate/simple-truthiness-check -- `account` has three states: undefined is still signing in, null is signed in as someone the app cannot name */}
            {account === false ? null : account !== undefined ? (
              <AccountMenu
                name={account?.email || account?.actor || mind || app}
                mind={mind}
                actions={accountActions}
              />
            ) : (
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarRowSkeleton className="h-12" />
                </SidebarMenuItem>
              </SidebarMenu>
            )}
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>
        <SidebarInset className="min-w-0 overflow-hidden">
          <header
            className={cn(
              "group/header flex shrink-0 items-center gap-3 px-4 pt-2.5 pb-1",
              // a page's own row is a toolbar: even padding, a rule under it
              "has-[[data-page-header]]:border-b has-[[data-page-header]]:py-1.5",
              // the trigger, Search and the ⋯ are a phone's: on a desktop the row would be empty
              !header && "md:hidden md:has-[[data-page-header]]:flex",
            )}
          >
            <SidebarTrigger className="-ml-1 md:hidden" title="Toggle sidebar" />
            {/* in a page's menu instead on a phone, while it has one */}
            <div
              className={cn(
                "flex min-w-0 items-center gap-3 max-md:group-has-[[data-page-menu]]/header:hidden",
                !header && "md:hidden",
              )}
            >
              {commandPalette ? <PaletteHeaderButton onOpen={openPalette} /> : null}
              {header}
            </div>
            <div
              ref={setPageHeaderSlot}
              className="flex min-w-0 flex-1 items-center empty:hidden"
            />
            <div ref={setPageMenuSlot} className="ml-auto flex items-center md:hidden" />
          </header>
          <PageSlotsContext value={pageSlots}>
            <div className="flex min-h-0 flex-1 flex-col overflow-auto">{children}</div>
          </PageSlotsContext>
        </SidebarInset>
        {commandPalette ? (
          <AppShellPalette
            nav={palette}
            entries={paletteEntries || []}
            onClose={() => setPalette(null)}
            minds={minds}
            mind={mind}
            mindHref={mindHref}
            onNavigate={onNavigate}
          />
        ) : null}
      </SidebarProvider>
    </ThemeProvider>
  );
}

const PageSlotsContext = createContext<{
  header: HTMLElement | null;
  menu: HTMLElement | null;
  openPalette: () => void;
  /** the app's `header`, which a phone shows in the page's menu */
  appHeader: ReactNode;
} | null>(null);

/** A page's own row of the header: what it shows above itself (a doc's path and its controls), in
 *  the row the shell has anyway, between the phone's sidebar trigger and the page's ⋯. The row gets
 *  a rule under it while a page has one, and a desktop shows it then even when the app gave the
 *  shell no `header`. */
/** The sidebar's head for an app with no mind switcher: the logo, the app's name, and a line
 *  under it (whom the app serves, or what it is about). */
export function AppShellBrand({ app, line }: { app: string; line?: string | null }) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" className="pointer-events-none">
          <span className="flex aspect-square size-8 items-center justify-center rounded-md bg-black">
            <IterateLogo alt="" className="size-6" />
          </span>
          <span className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium">{app}</span>
            {line ? <span className="truncate text-xs text-muted-foreground">{line}</span> : null}
          </span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function AppShellPageHeader({ children }: { children: ReactNode }) {
  const shell = useContext(PageSlotsContext);
  if (!shell) throw new Error("AppShellPageHeader is drawn inside an AppShell");
  if (!shell.header) return null;
  return createPortal(
    // one line on a phone, where the page's controls are in its ⋯: what's too long truncates
    <div data-page-header className="flex min-w-0 flex-1 items-center gap-x-4 gap-y-1 md:flex-wrap">
      {children}
    </div>,
    shell.header,
  );
}

/** A page's own controls on a phone, behind a ⋯ at the end of the header row: the row's `header`
 *  and Search move in above them, so the row is the sidebar trigger and the ⋯ alone. `children`
 *  are `DropdownMenuItem`s (in `DropdownMenuGroup`s). Hidden from `md` up, where the page shows
 *  its controls itself: the page hides them below `md`, so one breakpoint decides both, in CSS. */
export function AppShellPageMenu({ children }: { children: ReactNode }) {
  const shell = useContext(PageSlotsContext);
  if (!shell) throw new Error("AppShellPageMenu is drawn inside an AppShell");
  if (!shell.menu) return null;
  return createPortal(
    <DropdownMenu>
      <DropdownMenuTrigger
        data-page-menu
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            aria-label="More"
            title="More"
          />
        }
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56 rounded-lg">
        {shell.appHeader ? <div className="px-1.5 py-1">{shell.appHeader}</div> : null}
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={shell.openPalette}>
            <SearchIcon />
            Search
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {children}
      </DropdownMenuContent>
    </DropdownMenu>,
    shell.menu,
  );
}

/** A sidebar row while what it names loads: `SidebarMenuSkeleton`'s shape at a fixed width, so a
 *  server render hydrates as it was drawn (the vendored one picks its width at random). */
export function SidebarRowSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("flex h-8 items-center gap-2 px-2", className)}>
      <Skeleton className="size-4 rounded-md" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

/** Dismiss the mobile sidebar (a Sheet) when the page navigates — shadcn's Sidebar exposes
 *  `setOpenMobile` and does not do this itself. The whole href counts, not the pathname: the apps
 *  navigate by search string (`/agents?mind=…&agent=…`). Only on an actual change, never on
 *  mount: the Sheet remounts its children when opened. */
function CloseMobileSidebarOnNavigate({ locationKey }: { locationKey: string }) {
  const { setOpenMobile } = useSidebar();
  const previousLocationKeyRef = useRef(locationKey);
  useEffect(() => {
    if (previousLocationKeyRef.current === locationKey) return;
    previousLocationKeyRef.current = locationKey;
    setOpenMobile(false);
  }, [locationKey, setOpenMobile]);
  return null;
}

/** The app's navigation. On a phone, a same-tab link click in it closes the sidebar sheet at once,
 *  as the navigation starts; shadcn leaves it open (https://github.com/shadcn-ui/ui/issues/5561),
 *  and `CloseMobileSidebarOnNavigate` only fires once the location has changed. A modified or
 *  middle click, a download, or a link to another tab leaves the sheet open, as does a button (the
 *  collapse button, a dropdown trigger). This used to live in the vendored sidebar.tsx's
 *  SidebarMenuButton (iterate/iterate#1984); a vendored file stays byte-identical to upstream
 *  (packages/ui/AGENTS.md). */
function SidebarNav({
  navRef,
  children,
}: {
  navRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <SidebarContent
      ref={navRef}
      onClick={(event) => {
        if (!isMobile) return;
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
        if (!link || !event.currentTarget.contains(link) || link.hasAttribute("download")) return;
        const target = link.getAttribute("target");
        if (target && target !== "_self") return;
        setOpenMobile(false);
      }}
    >
      {children}
    </SidebarContent>
  );
}

/** The mind the page shows, and a menu of the minds this browser is connected to, by
 *  address, ending with "Connect another mind": the app's connect page. */
function MindSwitcher({
  app,
  minds,
  mind,
  mindHref,
  onNavigate,
}: {
  app: string;
  minds: string[];
  mind: string | null;
  mindHref: (address: string) => string;
  onNavigate?: (href: string, event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const { isMobile } = useSidebar();
  const navigate = (href: string) =>
    onNavigate
      ? (event: MouseEvent<HTMLAnchorElement>) => {
          if (!plainLeftClick(event)) return;
          onNavigate(href, event);
        }
      : undefined;
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground"
                aria-label="Switch mind"
              >
                <span className="flex aspect-square size-8 items-center justify-center rounded-md bg-black">
                  <IterateLogo alt="" className="size-6" />
                </span>
                <span className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{app}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {mind || "(select mind)"}
                  </span>
                </span>
                <ChevronsUpDownIcon className="ml-auto" />
              </SidebarMenuButton>
            }
          />
          <DropdownMenuContent
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
            className="min-w-60 rounded-lg"
          >
            {minds.length > 0 ? (
              <DropdownMenuGroup>
                {minds.map((address) => (
                  <DropdownMenuItem
                    key={address}
                    className="gap-2 p-2"
                    render={
                      <a
                        href={mindHref(address)}
                        aria-label={`Switch to ${address}`}
                        aria-current={address === mind ? "page" : undefined}
                        onClick={navigate(mindHref(address))}
                      />
                    }
                  >
                    <span className="flex size-6 items-center justify-center rounded-md border text-xs font-medium text-muted-foreground">
                      {address.slice(0, 1)}
                    </span>
                    <span className="truncate">{address}</span>
                    {address === mind ? <CheckIcon className="ml-auto" /> : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            ) : null}
            {minds.length > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuGroup>
              <DropdownMenuItem
                className="gap-2 p-2"
                render={
                  <a
                    href={CONNECT_PAGE}
                    aria-label="Connect another mind"
                    onClick={navigate(CONNECT_PAGE)}
                  />
                }
              >
                <span className="flex size-6 items-center justify-center rounded-md border text-muted-foreground">
                  <PlusIcon className="size-3.5" />
                </span>
                <span>Connect another mind</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/** The height the page can show. Safari shrinks only the visual viewport for a phone's keyboard, so
 *  a page sized in CSS units goes behind it. Pinch zoom shrinks it too, and is no keyboard. */
function useHeightOfWhatIsVisible() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const fit = () => {
      if (viewport.scale > 1) return;
      document.documentElement.style.setProperty("--app-height", `${String(viewport.height)}px`);
      window.scrollTo(0, 0);
    };
    viewport.addEventListener("resize", fit);
    return () => viewport.removeEventListener("resize", fit);
  }, []);
}

function CollapseButton() {
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === "collapsed";
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          type="button"
          size="sm"
          className="text-sidebar-foreground/70"
          tooltip={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={toggleSidebar}
        >
          <ChevronsLeftIcon className={collapsed ? "rotate-180" : undefined} />
          <span>Collapse sidebar</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/** Who the app is signed in as, or the mind when it does not know, and Sign out: a POST to the
 *  gate's `/.auth/logout?mind=<address>`, which ends this browser's sign-in to that mind
 *  alone. */
function AccountMenu({
  name,
  mind,
  actions,
}: {
  name: string;
  mind: string | null;
  actions?: ReactNode;
}) {
  const { isMobile } = useSidebar();
  const logout = useRef<HTMLFormElement>(null);
  const initials = name.slice(0, 2).toUpperCase();
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="h-auto min-h-12 group-data-[collapsible=icon]:min-h-0 data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground"
                aria-label="Account"
              >
                <Avatar className="size-8 rounded-lg">
                  <AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
                </Avatar>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left group-data-[collapsible=icon]:hidden">
                  <span className="truncate text-sm font-medium">{name}</span>
                  {mind && mind !== name ? (
                    <span className="truncate text-xs text-muted-foreground">{mind}</span>
                  ) : null}
                </span>
                <ChevronsUpDownIcon className="ml-auto" />
              </SidebarMenuButton>
            }
          />
          <DropdownMenuContent
            className="min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            {/* Base UI: a menu label lives inside a group, never bare in the menu */}
            <DropdownMenuGroup>
              <DropdownMenuLabel className="truncate font-normal">{name}</DropdownMenuLabel>
              {actions}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <ThemeMenuItems />
            {mind ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    onClick={() => {
                      resetPosthog();
                      logout.current?.requestSubmit();
                    }}
                  >
                    <LogOutIcon />
                    <span className="truncate">Sign out of {mind}</span>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
      {/* the POST, outside the menu items so nothing but an item's click submits it */}
      {mind ? (
        <form
          ref={logout}
          method="post"
          action={`/.auth/logout?${new URLSearchParams({ mind })}`}
          hidden
        />
      ) : null}
    </SidebarMenu>
  );
}
