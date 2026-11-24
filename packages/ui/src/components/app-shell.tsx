// The one shell for the client apps (dash, docs, tasks, voice, admin): the sidebar (the brand or
// app switcher in its header, the app's own navigation in its body, the collapse button and the
// account menu in its footer, the rail) and the page beside it under a header row (on a phone, over
// it: `phoneHeader`) that carries the phone's sidebar trigger, a page's own row
// (`AppShellPageHeader`) and its menu (`AppShellPageMenu`) — and ⌘K, a palette over the sidebar's
// pages (app-shell-palette.tsx), or the app's own (`palette`). Router-agnostic on purpose: the app
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
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  type TouchEvent,
  type WheelEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  CheckIcon,
  ChevronsLeftIcon,
  ChevronsUpDownIcon,
  EllipsisIcon,
  LogOutIcon,
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
import { plainLeftClick } from "#/lib/plain-left-click.ts";
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
import { wipeSavedLogTails } from "#/lib/saved-log-tail.ts";

/** Nothing to subscribe to: the cookie has no change event, and `SidebarProvider` reads
 *  `defaultOpen` once, when it mounts. */
const subscribeToNothing = () => () => {};

/** The sidebar as the person left it, from the cookie shadcn's provider writes: undefined until
 *  they have toggled it. */
function sidebarCookie() {
  const cookies = document.cookie.split("; ");
  if (cookies.includes("sidebar_state=false")) return false;
  if (cookies.includes("sidebar_state=true")) return true;
  return undefined;
}

/** How far a finger or a wheel goes one way before the floating phone header follows it. */
const HEADER_MOVE_PX = 16;

/** Frames a signed-in page. It reads the `sidebar_state` cookie shadcn's provider writes, so the
 *  sidebar reopens the way it was left — through `useSyncExternalStore`, which keeps the read out
 *  of render: a server render (the dash's frame before sign-in, routes/_auth.tsx) gets the default
 *  (`sidebarDefaultOpen`) until the page hydrates. */
export function AppShell({
  app,
  mind,
  switcher,
  nav,
  paletteEntries,
  palette: appPalette,
  commandPalette = true,
  searchRow = true,
  header,
  sidebarDefaultOpen = true,
  phoneHeader = "row",
  account,
  accountActions,
  sidebarAlert = false,
  locationKey,
  children,
}: {
  /** the app's name, shown in the default sidebar header: "Dash", "Docs", "Tasks" */
  app: string;
  /** the mind the page serves, by its address (used for Sign out and as the default header's
   *  subtitle) */
  mind: string | null;
  /** what heads the sidebar instead of the default plain brand (`AppShellBrand` or
   *  `AppShellSwitcher`) */
  switcher?: ReactNode;
  /** the app's own navigation, its `SidebarGroup`s */
  nav?: ReactNode;
  /** rows for ⌘K beside what it reads off `nav`: what the sidebar shows in a way it can't read
   *  (a file tree in its own shadow DOM) */
  paletteEntries?: AppPaletteEntry[];
  /** the app's own palette in place of the shell's (the Dash's: its contexts). The shell keeps
   *  ⌘K, the "Search" row and the phone's Search button, and says whether the palette is open */
  palette?: (state: { open: boolean; onClose: () => void }) => ReactNode;
  /** ⌘K, the sidebar's "Search" row and the phone's Search button; false for an app with nothing
   *  to search (the Cloud's installer: one page, no navigation) */
  commandPalette?: boolean;
  /** the sidebar's "Search" row above `nav`; without it, ⌘K and the phone's header button still
   *  open the palette */
  searchRow?: boolean;
  /** what sits beside the phone's sidebar trigger in the header row; without it, a desktop shows
   *  the row only while a page puts its own in it (`AppShellPageHeader`) */
  header?: ReactNode;
  /** the desktop sidebar for a person who has not toggled it yet (no `sidebar_state` cookie):
   *  open, shadcn's default, or false to start collapsed to its rail. Their toggle wins after. */
  sidebarDefaultOpen?: boolean;
  /** the header row on a phone. "row": a row above the page. "floating": its controls alone (the
   *  sidebar trigger, a page's ⋯) on the page's background, with no rule, over the page, so that
   *  nothing under it moves when it comes or goes. It goes as the person scrolls down a page that
   *  scrolls, and comes back as they scroll up or pull down; on a page that cannot scroll it stays.
   *  A desktop's header is the same either way. */
  phoneHeader?: "row" | "floating";
  /** who the app is signed in as, when it knows; null when the app is signed in to `mind` but
   *  does not know as whom (the menu then names the mind). "Sign out" posts to the gate's
   *  `/.auth/logout?mind=<address>`, which ends that mind's sign-in alone. Undefined while the
   *  app is still signing in: a placeholder of the menu's height holds its place. False when nobody
   *  is signed in and the page shows all the same: no menu. */
  account?: Principal | null | false;
  /** the app's own items in the account menu, before Sign out — `DropdownMenuItem`s; an app with
   *  no mind brings its own Sign out here */
  accountActions?: ReactNode;
  /** shows a warning dot on the phone's sidebar button when something inside the closed sheet
   *  needs the member's attention (waiting approvals) */
  sidebarAlert?: boolean;
  /** the router's current href — a change closes the phone's sidebar sheet */
  locationKey: string;
  children: ReactNode;
}) {
  const defaultOpen = useSyncExternalStore(
    subscribeToNothing,
    () => sidebarCookie() ?? sidebarDefaultOpen,
    () => sidebarDefaultOpen,
  );
  const floating = phoneHeader === "floating";
  // the palette: the sidebar's navigation as it read when ⌘K opened it, null while closed
  const navRef = useRef<HTMLDivElement>(null);
  const [palette, setPalette] = useState<SidebarNavItem[] | null>(null);
  const openPalette = useCallback(() => setPalette(readSidebarNav(navRef.current)), []);
  const closePalette = useCallback(() => setPalette(null), []);
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
    () => ({
      header: pageHeaderSlot,
      menu: pageMenuSlot,
      openPalette: commandPalette ? openPalette : undefined,
      appHeader: header,
    }),
    [pageHeaderSlot, pageMenuSlot, commandPalette, openPalette, header],
  );
  return (
    <SidebarProvider defaultOpen={defaultOpen} className="h-(--app-height,100svh) min-h-0">
      {/* outside <Sidebar>: on a phone its children live in a Sheet that remounts when opened */}
      <CloseMobileSidebarOnNavigate locationKey={locationKey} />
      <Sidebar collapsible="icon">
        <SidebarHeader>
          {switcher ?? <AppShellBrand app={app} line={mind} />}
          {commandPalette && searchRow ? <PaletteSidebarButton onOpen={openPalette} /> : null}
        </SidebarHeader>
        {/* ⌘K lists what the sidebar shows here — on a desktop */}
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
                {/* the account's own height (one line; its avatar alone in the rail), so nothing
                    in the footer moves when the account arrives */}
                <SidebarRowSkeleton className="h-12 group-data-[collapsible=icon]:h-8" />
              </SidebarMenuItem>
            </SidebarMenu>
          )}
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <ShellInset floatingHeader={floating} locationKey={locationKey}>
        <ShellHeader
          header={header}
          floating={floating}
          sidebarAlert={sidebarAlert}
          onOpenPalette={commandPalette ? openPalette : undefined}
          pageHeaderRef={setPageHeaderSlot}
          pageMenuRef={setPageMenuSlot}
        />
        <PageSlotsContext value={pageSlots}>
          <div className="flex min-h-0 flex-1 flex-col overflow-auto">{children}</div>
        </PageSlotsContext>
      </ShellInset>
      {commandPalette ? (
        <ShellPalette
          appPalette={appPalette}
          nav={palette}
          entries={paletteEntries || []}
          onClose={closePalette}
        />
      ) : null}
    </SidebarProvider>
  );
}

/** The row over the page: the phone's sidebar trigger, Search and the app's `header`, and the slots
 *  a page's own row (`AppShellPageHeader`) and its ⋯ (`AppShellPageMenu`) are drawn into. */
function ShellHeader({
  header,
  floating,
  sidebarAlert,
  onOpenPalette,
  pageHeaderRef,
  pageMenuRef,
}: {
  header: ReactNode;
  /** the phone's floating header (`phoneHeader`) */
  floating: boolean;
  /** warning dot on the phone's sidebar button when something waits inside the sheet */
  sidebarAlert: boolean;
  /** opens ⌘K's palette; the row has no Search button without it */
  onOpenPalette: (() => void) | undefined;
  pageHeaderRef: (element: HTMLElement | null) => void;
  pageMenuRef: (element: HTMLElement | null) => void;
}) {
  return (
    <header
      className={cn(
        "group/header flex shrink-0 items-center gap-3 px-4 pt-2.5 pb-1",
        // a page's own row is a toolbar: even padding, a rule under it
        "has-[[data-page-header]]:border-b has-[[data-page-header]]:py-1.5",
        // the trigger, Search and the ⋯ are a phone's: on a desktop the row would be empty
        !header && "md:hidden md:has-[[data-page-header]]:flex",
        // over the page, which shows through it; only its controls take a touch. Out of sight,
        // it is above the inset, which clips it, unless a key has brought focus into it
        floating &&
          "max-md:pointer-events-none max-md:absolute max-md:inset-x-0 max-md:top-0 max-md:z-20 max-md:bg-linear-to-b max-md:from-background max-md:from-40% max-md:to-transparent max-md:*:pointer-events-auto max-md:motion-safe:transition-transform max-md:motion-safe:duration-200 max-md:group-data-[phone-header=hidden]/inset:not-focus-within:-translate-y-full",
      )}
    >
      <span className="relative -ml-1 inline-flex md:hidden">
        <SidebarTrigger
          title={sidebarAlert ? "Toggle sidebar (requests wait for approval)" : "Toggle sidebar"}
          aria-label={
            sidebarAlert ? "Toggle sidebar (requests wait for approval)" : "Toggle sidebar"
          }
        />
        {sidebarAlert ? (
          <span
            aria-hidden="true"
            data-sidebar-alert
            className="pointer-events-none absolute top-0.5 right-0.5 size-2 rounded-full bg-warning ring-2 ring-background"
          />
        ) : null}
      </span>
      {/* in a page's menu instead on a phone, while it has one */}
      <div
        className={cn(
          "flex min-w-0 items-center gap-3 max-md:group-has-[[data-page-menu]]/header:hidden",
          !header && "md:hidden",
        )}
      >
        {onOpenPalette ? <PaletteHeaderButton onOpen={onOpenPalette} /> : null}
        {header}
      </div>
      <div ref={pageHeaderRef} className="flex min-w-0 flex-1 items-center empty:hidden" />
      <div ref={pageMenuRef} className="ml-auto flex items-center empty:hidden md:hidden" />
    </header>
  );
}

/** The page beside the sidebar. With a floating phone header, the person's own moves over the page
 *  say whether it shows: a finger or a wheel toward the end of a page that can scroll on puts it
 *  away, one back toward the top brings it back. Their moves and not scroll events, because the
 *  page also scrolls by itself: a feed follows its end as rows land, and holds a reader's row
 *  still as older pages land above it. Nothing here moves the page. Put away, it is put away on
 *  one page: a new location shows it again. */
function ShellInset({
  floatingHeader,
  locationKey,
  children,
}: {
  floatingHeader: boolean;
  locationKey: string;
  children: ReactNode;
}) {
  // the location where the person put the header away, while it is away
  const [hiddenAt, setHiddenAt] = useState<string | null>(null);
  const shown = hiddenAt !== locationKey;
  const touchRef = useRef<{ x: number; y: number } | null>(null);
  // one way's wheel deltas so far: a trackpad's last nudge the other way is no turn
  const wheelRef = useRef(0);
  // toward the end of what cannot scroll on (a short page, the end of a long one): it stays as it is
  const moved = (towardEnd: boolean, target: EventTarget, inset: Element) => {
    if (!towardEnd) setHiddenAt(null);
    else if (scrollsOn(target, inset)) setHiddenAt(locationKey);
  };
  return (
    <SidebarInset
      className="group/inset min-w-0 overflow-hidden"
      data-phone-header={floatingHeader ? (shown ? "shown" : "hidden") : undefined}
      {...(floatingHeader && {
        onTouchStartCapture: (event: TouchEvent<HTMLElement>) => {
          const touch = event.touches[0];
          touchRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
        },
        onTouchMoveCapture: (event: TouchEvent<HTMLElement>) => {
          const touch = event.touches[0];
          const from = touchRef.current;
          if (!touch || !from) return;
          const down = touch.clientY - from.y;
          // a sideways swipe (a wide table) says nothing
          if (Math.abs(down) < HEADER_MOVE_PX || Math.abs(down) < Math.abs(touch.clientX - from.x))
            return;
          touchRef.current = { x: touch.clientX, y: touch.clientY };
          // a finger going up takes the page toward its end
          moved(down < 0, event.target, event.currentTarget);
        },
        onWheelCapture: (event: WheelEvent<HTMLElement>) => {
          const sum =
            Math.sign(event.deltaY) === Math.sign(wheelRef.current)
              ? wheelRef.current + event.deltaY
              : event.deltaY;
          wheelRef.current = Math.abs(sum) < HEADER_MOVE_PX ? sum : 0;
          if (Math.abs(sum) >= HEADER_MOVE_PX) moved(sum > 0, event.target, event.currentTarget);
        },
      })}
    >
      {children}
    </SidebarInset>
  );
}

/** Whether something under `target`, up to `inset`, can scroll further toward its end. */
function scrollsOn(target: EventTarget, inset: Element) {
  for (
    let element = target instanceof Element ? target : null;
    element && element !== inset;
    element = element.parentElement
  ) {
    const { overflowY } = getComputedStyle(element);
    if (overflowY !== "auto" && overflowY !== "scroll") continue;
    if (element.scrollHeight - element.clientHeight - element.scrollTop > 1) return true;
  }
  return false;
}

/** ⌘K's dialog: the app's own palette when it brings one, else the shell's. */
function ShellPalette({
  appPalette,
  ...shells
}: ComponentProps<typeof AppShellPalette> & {
  appPalette: ((state: { open: boolean; onClose: () => void }) => ReactNode) | undefined;
}) {
  if (appPalette) return appPalette({ open: Boolean(shells.nav), onClose: shells.onClose });
  return <AppShellPalette {...shells} />;
}

const PageSlotsContext = createContext<{
  header: HTMLElement | null;
  menu: HTMLElement | null;
  openPalette: (() => void) | undefined;
  /** the app's `header`, which a phone shows in the page's menu */
  appHeader: ReactNode;
} | null>(null);

/** Whether the page is drawn inside an `AppShell`, whose header row `AppShellPageHeader` fills. A
 *  part that pages with no shell draw too draws a row of its own where this says no. */
export function useInAppShell(): boolean {
  return Boolean(useContext(PageSlotsContext));
}

/** A page's own row of the header: what it shows above itself (a doc's path and its controls), in
 *  the row the shell has anyway, between the phone's sidebar trigger and the page's ⋯. The row gets
 *  a rule under it while a page has one, and a desktop shows it then even when the app gave the
 *  shell no `header`. */
/** The sidebar's head for an app with no mind switcher: the logo, the app's or mind's name, and a
 *  line under it (the hostname, or whom the app serves). With `href`, the whole block is a link
 *  (closing the phone sidebar sheet on a plain left click). */
export function AppShellBrand({
  app,
  line,
  logo,
  href,
  onClick,
}: {
  app: string;
  line?: string | null;
  logo?: ReactNode;
  href?: string;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  const content = (
    <>
      <span className="flex aspect-square size-8 items-center justify-center rounded-md bg-black">
        {logo ?? <IterateLogo alt="" className="size-6" />}
      </span>
      <span className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">{app}</span>
        {line ? <span className="truncate text-xs text-muted-foreground">{line}</span> : null}
      </span>
    </>
  );
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        {href ? (
          <SidebarMenuButton
            size="lg"
            tooltip={app}
            render={
              <a
                href={href}
                onClick={(event) => {
                  // check before `onClick` calls preventDefault() for in-place SPA navigation
                  const shouldClose = isMobile && plainLeftClick(event);
                  onClick?.(event);
                  if (shouldClose) setOpenMobile(false);
                }}
              />
            }
          >
            {content}
          </SidebarMenuButton>
        ) : (
          <SidebarMenuButton size="lg" className="pointer-events-none">
            {content}
          </SidebarMenuButton>
        )}
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
        {shell.openPalette ? (
          <>
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={shell.openPalette}>
                <SearchIcon />
                Search
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        ) : null}
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
 *  collapse button, a dropdown trigger). This lives here and not in the vendored sidebar.tsx's
 *  SidebarMenuButton, because a vendored file stays byte-identical to upstream
 *  (packages/ui/src/components/ui/AGENTS.md). */
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

/** The sidebar's head for an app that switches between items (such as a mind's repos in Tasks or
 *  Docs): the logo, the app's name, and the active item under it. When there is only one item,
 *  shows the plain `AppShellBrand` with no dropdown. */
export type AppShellSwitcherItem = {
  value: string;
  label?: string;
  href?: string;
};

export function AppShellSwitcher({
  app,
  logo,
  value,
  items,
  label,
  href,
  onSelect,
}: {
  app: string;
  logo?: ReactNode;
  value: string;
  items: readonly (string | AppShellSwitcherItem)[];
  /** optional heading above the menu items (e.g. "Repos") */
  label?: string;
  /** link target for the plain brand when there is at most one item */
  href?: string;
  onSelect?: (value: string, event: MouseEvent<HTMLElement>) => void;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  const normalized = items.map((item) =>
    typeof item === "string"
      ? { value: item, label: item, href: undefined }
      : { value: item.value, label: item.label || item.value, href: item.href },
  );
  const current = normalized.find((item) => item.value === value)?.label || value;
  if (normalized.length <= 1) {
    return <AppShellBrand app={app} line={current} logo={logo} href={href} />;
  }
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground"
                aria-label={label ? `${label}: ${current}` : `Switch ${app}`}
              >
                <span className="flex aspect-square size-8 items-center justify-center rounded-md bg-black">
                  {logo ?? <IterateLogo alt="" className="size-6" />}
                </span>
                <span className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{app}</span>
                  <span className="truncate text-xs text-muted-foreground">{current}</span>
                </span>
                <ChevronsUpDownIcon className="ml-auto" />
              </SidebarMenuButton>
            }
          />
          <DropdownMenuContent
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
            className="min-w-56 rounded-lg"
          >
            <DropdownMenuGroup>
              {label ? <DropdownMenuLabel>{label}</DropdownMenuLabel> : null}
              {normalized.map((item) => {
                const active = item.value === value;
                if (item.href) {
                  return (
                    <DropdownMenuItem
                      key={item.value}
                      className="gap-2"
                      render={
                        <a
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                          onClick={(event) => {
                            if (!plainLeftClick(event)) return;
                            onSelect?.(item.value, event);
                            if (isMobile) setOpenMobile(false);
                          }}
                        />
                      }
                    >
                      <span className="truncate">{item.label}</span>
                      {active ? <CheckIcon className="ml-auto" /> : null}
                    </DropdownMenuItem>
                  );
                }
                return (
                  <DropdownMenuItem
                    key={item.value}
                    className="gap-2"
                    onClick={(event) => {
                      onSelect?.(item.value, event);
                      if (isMobile) setOpenMobile(false);
                    }}
                  >
                    <span className="truncate">{item.label}</span>
                    {active ? <CheckIcon className="ml-auto" /> : null}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/** The height the page can show. Safari shrinks only the visual viewport for a phone's keyboard, so
 *  a page sized in CSS units goes behind it. A pinch shrinks the visual viewport too, in the
 *  pinch's own px: times its scale it is the page's height again. So a pinch alone changes
 *  nothing, and a keyboard that goes while the page is pinched gives its room back. The height is
 *  taken again when the page is shown again: a keyboard that went while it was hidden said
 *  nothing. */
function useHeightOfWhatIsVisible() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const fit = () => {
      const height = Math.round(viewport.height * viewport.scale * 100) / 100;
      document.documentElement.style.setProperty("--app-height", `${String(height)}px`);
      // a pinched page stays where the person put it
      if (viewport.scale <= 1) window.scrollTo(0, 0);
    };
    viewport.addEventListener("resize", fit);
    window.addEventListener("pageshow", fit);
    document.addEventListener("visibilitychange", fit);
    return () => {
      viewport.removeEventListener("resize", fit);
      window.removeEventListener("pageshow", fit);
      document.removeEventListener("visibilitychange", fit);
    };
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
  const { isMobile, state } = useSidebar();
  const inRail = state === "collapsed" && !isMobile;
  const logout = useRef<HTMLFormElement>(null);
  const initials = name.slice(0, 2).toUpperCase();
  const hasTopGroup = inRail || Boolean(actions);
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
                <span className="min-w-0 flex-1 truncate text-left text-sm font-medium group-data-[collapsible=icon]:hidden">
                  {name}
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
            {/* Base UI: a menu label lives inside a group, never bare in the menu.
                Show the label only in the icon rail, where the trigger's text is hidden. */}
            {hasTopGroup ? (
              <DropdownMenuGroup>
                {inRail ? (
                  <DropdownMenuLabel className="truncate font-normal">{name}</DropdownMenuLabel>
                ) : null}
                {actions}
              </DropdownMenuGroup>
            ) : null}
            {mind ? (
              <>
                {hasTopGroup ? <DropdownMenuSeparator /> : null}
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    onClick={() => {
                      resetPosthog();
                      // the next member of this browser sees none of this one's saved rows
                      void wipeSavedLogTails().then(() => logout.current?.requestSubmit());
                    }}
                  >
                    <LogOutIcon />
                    <span className="truncate">Sign out</span>
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
