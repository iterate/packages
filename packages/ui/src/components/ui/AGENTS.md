# Vendored shadcn components

shadcn has no styled package, so we vendor its components. Each `.tsx` file here, plus
`src/hooks/use-mobile.ts`, is byte for byte what the pinned shadcn CLI writes through
`packages/ui/components.json` (style `base-nova`, on Base UI). `VENDORINGS` in
`scripts/ci/shadcn-drift.ts` lists them.

- Do not edit a file here. Customise at the call site (a `className`, a prop) or in a wrapper
  component in `src/components/`. Earlier local changes now live in these places: the full-width
  sheet (the `SheetContent` call site, and a rule in `globals.css` below `sm`), closing the phone's
  sidebar on a link click (`SidebarNav` in `app-shell.tsx`), and the ⌘K look
  (`app-shell-palette.tsx`).
- Keep the `dark:` classes. `dark:` follows the class `dark` on `<html>` (`globals.css`), as the
  palettes do.
- `cn` comes from the `cn` package. `components.json` maps `aliases.utils` to it, so there is no
  `lib/utils.ts`.
- `globals.css` imports `shadcn/tailwind.css` (the `data-*` variants and a few utilities that these
  files use) from the `shadcn` devDependency, which is also the CLI.
- oxlint, oxfmt and the `rules/` review rules exclude these files by name.
  `scripts/ci/shadcn-drift.test.ts` fails when one of those lists misses a vendored file.

## Refresh, bump, add

```sh
node scripts/ci/shadcn-drift.ts refresh   # shadcn add <every item> -o -y
git diff                                  # review what upstream changed; there are no patches to re-apply
pnpm --dir packages/ui exec shadcn add button --dry-run --diff src/components/ui/button.tsx   # one file, nothing written
```

Keep any dependency the CLI adds to `package.json`, run `pnpm install`, then typecheck
`packages/ui` and each app. To bump the CLI, change the `shadcn` pin in the catalog
(`pnpm-workspace.yaml`) and refresh. To vendor another item, run
`pnpm --dir packages/ui exec shadcn add <item>`, then add it to `items` in `VENDORINGS` (and an
extra file it writes to `extraFiles`).

## The drift check

`.depot/workflows/shadcn-drift.yml` runs on a pull request that touches a vendored file or an
input of the CLI. It compares each file with the CLI's dry run against shadcn's live registry and
fails on any byte difference (stricter than the CLI's own "identical"). The fix is a refresh, also
when upstream moved and nobody edited a file. The check needs the network, so it is not a required
check. The same workflow runs the registry round trip (`shadcn-registry.ts round-trip`).
