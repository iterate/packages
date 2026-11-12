// THE INTEGRATIONS PAGE OF A DASH: what the mind's packages registered (iterate/integrations), live:
// a card for each integration with its connections beneath it, and each button a link that the page
// composes. It reads ONE thing: the `integration` facet's live state on `/integrations`, through
// one subscription. It asks nothing on a timer and nothing of the vault.
//
// It knows no router. The page opens the registry's context and names the mind:
//
//   <IntegrationsPage openRegistry={() => itx.cd("/integrations")} deps={[itx]} mind="example.com" />
import { useSyncExternalStore, type DependencyList } from "react";
import { z } from "zod";
import { cn } from "cn";
import {
  IntegrationCard,
  IntegrationConnection,
  type IntegrationStatus,
  type IntegrationTarget,
} from "iterate/integrations";
import { useFacetView } from "../lib/facet-view.ts";
import { integrationTargetHrefOf } from "../lib/mind-site.ts";
import { buttonVariants } from "#/components/ui/button.tsx";
import { Card, CardContent } from "#/components/ui/card.tsx";
import { Spinner } from "#/components/ui/spinner.tsx";

/** The registry's state (iterate/integrations `IntegrationRegistryState`), each card and row left
 *  unparsed: the page parses them one by one (`IntegrationsGrid`). */
const RegistryLive = z.looseObject({
  integrations: z.record(z.string(), z.unknown()),
  connections: z.record(z.string(), z.unknown()),
});

export function IntegrationsPage({
  openRegistry,
  deps,
  seed,
  mind,
}: {
  /** Opens the registry's context (`itx.cd("/integrations")`), held while `deps` stand and then
   *  released. Null while it cannot be named yet. */
  openRegistry: Parameters<typeof useFacetView>[0];
  deps: DependencyList;
  /** The facet's snapshot, when the page read one before it drew: shown until the subscription
   *  answers. */
  seed?: Parameters<typeof useFacetView>[3];
  /** The mind's address: a button that names a place of the mind leads to that host. */
  mind: string;
}) {
  const registryView = useFacetView(openRegistry, deps, "integration", seed, RegistryLive);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 md:p-8">
      <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
        Integrations
        {/* a snapshot shows while its subscription connects */}
        {registryView.seeding ? <Spinner /> : null}
      </h1>
      {registryView.error ? (
        <p role="alert" data-type="error" className="text-sm text-destructive">
          Couldn't load this mind's integrations: {registryView.error}
        </p>
      ) : null}
      {registryView.settled ? null : (
        <p role="status" className="text-sm text-muted-foreground">
          Loading…
        </p>
      )}
      {/* nothing is said about the registry until it has answered: a page with no `seed` would
          say "No integrations" beside "Loading…" */}
      {registryView.state ? (
        <IntegrationsGrid
          registry={registryView.state}
          hrefOf={(target) => integrationTargetHrefOf(mind, target)}
        />
      ) : null}
    </div>
  );
}

/** THE PACKAGES' CARDS: one per integration a package registered, with the connections it
 *  registered beneath it. A package appends the null that takes a card or a row away; the Dash
 *  shows what stands. Each card and row is parsed on its own, so one this page cannot read (a newer
 *  contract's) leaves out only itself. */
function IntegrationsGrid({
  registry,
  hrefOf,
}: {
  registry: z.infer<typeof RegistryLive>;
  /** Where a target leads (`integrationTargetHrefOf`). */
  hrefOf: (target: IntegrationTarget) => string | null;
}) {
  const cards = Object.entries(registry.integrations).flatMap(([integration, value]) => {
    const card = IntegrationCard.safeParse(value).data;
    return card ? [{ integration, card }] : [];
  });
  const rows = Object.entries(registry.connections).flatMap(([key, value]) => {
    const row = IntegrationConnection.safeParse(value).data;
    // the key is `<integration>/<connection>`, and neither name can hold a "/"
    const slash = key.indexOf("/");
    return row ? [{ integration: key.slice(0, slash), connection: key.slice(slash + 1), row }] : [];
  });
  if (cards.length === 0) return <NoIntegrations />;
  return (
    <div className="flex flex-col gap-3">
      {cards.map(({ integration, card }) => (
        <IntegrationCardView
          key={integration}
          integration={integration}
          card={card}
          rows={rows.filter((entry) => entry.integration === integration)}
          hrefOf={hrefOf}
        />
      ))}
    </div>
  );
}

/** The packages' empty state: nothing registered yet. */
function NoIntegrations() {
  return (
    <p className="text-sm text-muted-foreground">
      No integrations are registered yet. A package of the mind's worker adds its card here when the
      worker is published.{" "}
      <a
        href="https://github.com/jonastemplestein/iterategrations"
        target="_blank"
        rel="noreferrer"
        className="underline underline-offset-4"
      >
        iterategrations
      </a>{" "}
      has some to start from.
    </p>
  );
}

/** ONE CARD: its mark, title and status; its description; the connections the package lists
 *  beneath it (the account, a few facts, its status and buttons); and the package's buttons. */
function IntegrationCardView({
  integration,
  card,
  rows,
  hrefOf,
}: {
  integration: string;
  card: IntegrationCard;
  rows: { connection: string; row: IntegrationConnection }[];
  hrefOf: (target: IntegrationTarget) => string | null;
}) {
  const heading = `integration-${integration}-heading`;
  return (
    <section aria-labelledby={heading} className="flex min-w-0 flex-col">
      <Card size="sm" className="flex-1">
        <CardContent className="flex h-full min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <IntegrationMark title={card.title} icon={card.icon} />
            <h2 id={heading} className="min-w-0 flex-1 font-medium [overflow-wrap:anywhere]">
              {card.title}
            </h2>
            {card.status ? <StatusText status={card.status} /> : null}
          </div>
          {card.description && (
            <p className="line-clamp-2 text-xs text-muted-foreground" title={card.description}>
              {card.description}
            </p>
          )}
          {rows.length === 0 ? null : (
            <ul
              className="flex flex-col divide-y border-t"
              aria-label={`${card.title} connections`}
            >
              {rows.map(({ connection, row }) => (
                <RegistryRow key={connection} row={row} hrefOf={hrefOf} />
              ))}
            </ul>
          )}
          {card.actions.length ? (
            <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
              <TargetLinks actions={card.actions} hrefOf={hrefOf} />
            </div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}

/** A card's mark: the package's icon, or the title's first letter. */
function IntegrationMark({ title, icon }: { title: string; icon: string | undefined }) {
  if (icon) return <img src={icon} alt="" className="size-8 shrink-0 rounded-md object-contain" />;
  return (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold uppercase"
    >
      {title.slice(0, 1)}
    </span>
  );
}

/** One connection a package registered: the account, a few facts about it, its status and buttons. */
function RegistryRow({
  row,
  hrefOf,
}: {
  row: IntegrationConnection;
  hrefOf: (target: IntegrationTarget) => string | null;
}) {
  return (
    <li className="flex flex-col gap-1 py-2">
      <p className="truncate text-sm" title={row.account}>
        {row.account}
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {row.status && <StatusText status={row.status} />}
        {row.details && (
          <dl className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
            {Object.entries(row.details).map(([label, value]) => (
              <div key={label}>
                <dt className="inline">{label}: </dt>
                <dd className="inline">{value}</dd>
              </div>
            ))}
          </dl>
        )}
        <TargetLinks actions={row.actions} hrefOf={hrefOf} className="ml-auto" />
      </div>
    </li>
  );
}

/** How an integration or a connection is doing, in its package's words: a quiet line when all is
 *  well, amber when a person should act, red when it failed. */
function StatusText({ status }: { status: IntegrationStatus }) {
  return (
    <p
      data-type={status.kind === "error" ? "error" : undefined}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-left text-2xs font-medium [overflow-wrap:anywhere]",
        status.kind === "ok" && "bg-success/10 text-success",
        status.kind === "attention" && "bg-warning/10 text-warning",
        status.kind === "error" && "bg-destructive/10 text-destructive",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          { ok: "bg-success", attention: "bg-warning", error: "bg-destructive" }[status.kind],
        )}
      />
      {status.text || { ok: "OK", attention: "Needs attention", error: "Failed" }[status.kind]}
    </p>
  );
}

/** A page's origin never changes: the store that reads it has nothing to tell. */
const subscribeToNothing = () => () => {};

/** A card's or a row's buttons, each a link to where its target leads (`integrationTargetHrefOf`):
 *  a URL on another origin than the page's opens beside it, a page of the mind's in its place,
 *  and a target that leads nowhere is no link. Two buttons alike — the same label to the same place
 *  — are one. */
function TargetLinks({
  actions,
  hrefOf,
  className,
}: {
  actions: IntegrationCard["actions"];
  hrefOf: (target: IntegrationTarget) => string | null;
  className?: string;
}) {
  // The page's own origin, kept out of a server render (useSyncExternalStore): there no link
  // opens beside the page, and the browser's first render says which do.
  const origin = useSyncExternalStore(
    subscribeToNothing,
    () => window.location.origin,
    () => "",
  );
  const links = new Map<string, { label: string; href: string; beside: boolean }>();
  for (const action of actions) {
    const href = hrefOf(action);
    if (href)
      links.set(`${action.label}\n${href}`, {
        label: action.label,
        href,
        beside: "url" in action && new URL(href).origin !== origin,
      });
  }
  if (links.size === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {[...links].map(([key, { label, href, beside }]) => (
        <a
          key={key}
          href={href}
          {...(beside && { target: "_blank", rel: "noreferrer" })}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          {label}
        </a>
      ))}
    </div>
  );
}
