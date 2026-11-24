// ⌘K in the AppShell: one dialog to jump to any page the sidebar offers, by typing. The rows and
// the filter are app-shell-palette-entries.ts; this is the dialog, the shortcut and the buttons
// that open it (the sidebar's "Search" row, and the header's on a phone, where the sidebar is a
// sheet).
//
// command.tsx is vendored shadcn (packages/ui/src/components/ui/AGENTS.md), so the palette's own look lives
// here, in the classNames it passes: flush rows edge to edge instead of upstream's inset, rounded
// ones, and a borderless search row. Two parts are composed here instead: the search row is cmdk's
// input under the palette's own markup, because upstream's CommandInput wraps it in an InputGroup
// that takes no className; and the dialog is Dialog's parts, because upstream's CommandDialog puts
// its sr-only title outside the popup, where a screen reader finds a "Search" heading on every page
// even while the palette is closed.
import { useEffect, useState, useSyncExternalStore } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { CheckIcon, SearchIcon } from "lucide-react";
import {
  filterPaletteEntries,
  type AppPaletteEntry,
  type PaletteEntry,
  type SidebarNavItem,
} from "./app-shell-palette-entries.ts";
import { Button } from "#/components/ui/button.tsx";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "#/components/ui/command.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog.tsx";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "#/components/ui/sidebar.tsx";

type PaletteRow =
  | (PaletteEntry & { kind: "nav"; element: HTMLElement })
  | (PaletteEntry & { kind: "app"; onSelect: () => void });

/** Nothing to subscribe to: the platform does not change under a page. */
const subscribeToNothing = () => () => {};

/** The shortcut as this platform spells it. */
function useShortcutLabel() {
  return useSyncExternalStore(
    subscribeToNothing,
    () => (/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K"),
    () => "⌘K",
  );
}

/** ⌘K (Ctrl+K off a Mac) anywhere on the page toggles the palette — in a text field too, as the
 *  sidebar's ⌘B does. Null: the app has no palette, and the keys stay the browser's. */
export function usePaletteShortcut(toggle: (() => void) | null) {
  useEffect(() => {
    if (!toggle) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.shiftKey) return;
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      toggle?.();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);
}

/** The sidebar's "Search" row, above the app's navigation: an icon with a tooltip when the sidebar
 *  is collapsed to its rail. */
export function PaletteSidebarButton({ onOpen }: { onOpen: () => void }) {
  const shortcut = useShortcutLabel();
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton type="button" tooltip={`Search (${shortcut})`} onClick={onOpen}>
          <SearchIcon />
          <span>Search</span>
          <kbd className="ml-auto font-sans text-xs text-muted-foreground">{shortcut}</kbd>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/** The header's search button, on a phone: there the sidebar is a sheet, closed until asked for. */
export function PaletteHeaderButton({ onOpen }: { onOpen: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="md:hidden"
      aria-label="Search"
      title="Search"
      onClick={onOpen}
    >
      <SearchIcon />
    </Button>
  );
}

/** The dialog. `nav` is the sidebar's navigation as it read when the palette opened, null while
 *  closed. A nav row clicks the sidebar's own element, and an entry the app handed over runs its
 *  `onSelect`. */
export function AppShellPalette({
  nav,
  entries,
  onClose,
}: {
  nav: SidebarNavItem[] | null;
  entries: AppPaletteEntry[];
  onClose: () => void;
}) {
  return (
    <Dialog
      open={Boolean(nav)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        // near the top, not centred: the list grows and shrinks under the input as you type
        className="top-[12svh] translate-y-0 overflow-hidden p-0 sm:max-w-lg"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Search</DialogTitle>
          <DialogDescription>Go to a page</DialogDescription>
        </DialogHeader>
        {nav ? <PaletteBody nav={nav} entries={entries} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

/** Mounted per opening, so the query starts empty each time. */
function PaletteBody({
  nav,
  entries,
  onClose,
}: {
  nav: SidebarNavItem[];
  entries: AppPaletteEntry[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const navRows = nav.map(({ element, label, group, detail, active }, index): PaletteRow => ({
    kind: "nav",
    id: `nav:${index}`,
    label,
    group,
    detail,
    active,
    element,
  }));
  const appRows = entries.map((entry, index): PaletteRow => ({
    kind: "app",
    id: `app:${index}`,
    ...entry,
  }));
  const groups = filterPaletteEntries([...navRows, ...appRows], query);
  return (
    <Command shouldFilter={false} loop className="p-0">
      <div className="flex items-center gap-2 px-3 py-2">
        <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <CommandPrimitive.Input
          data-slot="command-input"
          className="flex h-8 w-full min-w-0 bg-transparent text-sm outline-hidden placeholder:text-muted-foreground"
          placeholder="Search…"
          aria-label="Search"
          value={query}
          onValueChange={setQuery}
        />
      </div>
      <CommandList className="max-h-[min(24rem,60svh)] border-t">
        <CommandEmpty className="text-muted-foreground">Nothing matches.</CommandEmpty>
        {groups.map(({ group, entries }) => (
          <CommandGroup
            key={group}
            heading={group}
            className="p-0 **:[[cmdk-group-heading]]:px-3 **:[[cmdk-group-heading]]:py-2"
          >
            {entries.map((row) => (
              <CommandItem
                key={row.id}
                value={row.id}
                className="rounded-none px-3 py-2 in-data-[slot=dialog-content]:rounded-none!"
                onSelect={() => {
                  onClose();
                  if (row.kind === "app") row.onSelect();
                  else row.element.click();
                }}
              >
                <PaletteRowLabel row={row} />
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  );
}

function PaletteRowLabel({ row }: { row: PaletteRow }) {
  return (
    <>
      <span className="truncate">{row.label}</span>
      {row.detail ? (
        <span className="truncate text-xs text-muted-foreground">{row.detail}</span>
      ) : null}
      {row.active ? (
        <CommandShortcut>
          <CheckIcon aria-label="current" />
        </CommandShortcut>
      ) : null}
    </>
  );
}
