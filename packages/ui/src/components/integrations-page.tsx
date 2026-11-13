// THE INTEGRATIONS PAGE OF A DASH: what the mind's packages registered (iterate/integrations), live:
// a card for each integration with its connections beneath it, and each button a link that the page
// composes. Above them it says how anything gets here: a person asks their agent. Cards that name a
// section stand under its heading (a mark, a title, a few sentences), the sections first. It reads ONE thing: the `integration` facet's live state on `/integrations`, through
// one subscription. It asks nothing on a timer and nothing of the vault.
//
// It knows no router. The page opens the registry's context and names the mind:
//
//   <IntegrationsPage openRegistry={() => itx.cd("/integrations")} deps={[itx]} mind="example.com" />
import { ArrowUpRight, ChevronRight } from "lucide-react";
import { useSyncExternalStore, type DependencyList } from "react";
import { z } from "zod";
import { cn } from "cn";
import {
  IntegrationCard,
  IntegrationConnection,
  type IntegrationIcon,
  type IntegrationStatus,
  type IntegrationTarget,
} from "iterate/integrations";
import { useFacetView } from "../lib/facet-view.ts";
import { integrationTargetHrefOf } from "../lib/mind-site.ts";
import { buttonVariants } from "#/components/ui/button.tsx";
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
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-4 md:p-8">
      <header className="flex flex-col gap-1.5">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          Integrations
          {/* a snapshot shows while its subscription connects */}
          {registryView.seeding ? <Spinner /> : null}
        </h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          To connect an account or a service, ask your agent: "connect my Gmail", "set up a Telegram
          bot". What it connects shows here.
        </p>
      </header>
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
          say "Nothing is connected" beside "Loading…" */}
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
  // by title: the registry keeps the card that changed last at its end, and a card that moves
  // each time its package says something is hard to find again
  cards.sort((a, b) => a.card.title.localeCompare(b.card.title));
  // A card that other cards name as their `section` is a heading: its mark, title and
  // description stand above them. One that no card names is a card like any other.
  const sections = cards
    .flatMap((entry) => {
      const own = cards.filter(({ card }) => card.section === entry.integration);
      return own.length
        ? [{ section: entry.integration, heading: entry.card, entry, cards: own }]
        : [];
    })
    .sort((a, b) => a.heading.title.localeCompare(b.heading.title));
  // a card that names no section, or one with no heading, stands with the mind's other cards
  const placed = new Set(sections.flatMap((section) => [section.entry, ...section.cards]));
  const others = cards.filter((entry) => !placed.has(entry));
  const cardsOf = (entries: typeof cards) =>
    entries.map(({ integration, card }) => (
      <IntegrationCardView
        key={integration}
        integration={integration}
        card={card}
        rows={rows.filter((entry) => entry.integration === integration)}
        hrefOf={hrefOf}
      />
    ));
  // one bordered list per section, its cards as rows split by hairlines: little chrome, one edge
  const list = (entries: typeof cards) => (
    <div className="divide-y overflow-hidden rounded-lg border bg-card">{cardsOf(entries)}</div>
  );
  return (
    <div className="flex flex-col gap-10">
      {sections.map(({ section, heading, cards: own }) => (
        <section
          key={section}
          aria-labelledby={`integrations-section-${section}`}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              {/* a heading's mark is its icon alone: a letter in a box beside a heading reads as
                  a placeholder */}
              {heading.icon ? (
                <IntegrationMark title={heading.title} icon={heading.icon} hrefOf={hrefOf} small />
              ) : null}
              {/* one step above a card's title, so a section reads as the level above its cards */}
              <h2
                id={`integrations-section-${section}`}
                className="text-base font-semibold tracking-tight"
              >
                {heading.title}
              </h2>
            </div>
            {heading.description && (
              <p className="max-w-prose text-sm text-muted-foreground">{heading.description}</p>
            )}
          </div>
          {list(own)}
        </section>
      ))}
      {others.length ? (
        <section aria-label="This mind's own integrations" className="flex flex-col gap-3">
          {/* a heading only when a section stands above: alone, the page's title says it */}
          {sections.length ? (
            <h2 className="text-base font-semibold tracking-tight">This mind's own</h2>
          ) : null}
          {list(others)}
        </section>
      ) : null}
    </div>
  );
}

/** The empty state: nothing is registered yet. The line above the cards says how to change that. */
function NoIntegrations() {
  return <p className="text-sm text-muted-foreground">Nothing is connected yet.</p>;
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
  // The header says the worst of the card and its connections: a card that says "Connected"
  // above a row that failed would contradict it. The row keeps the words that say why.
  const worst = rows
    .flatMap(({ row }) => (row.status ? [row.status.kind] : []))
    .toSorted((a, b) => SEVERITY[b] - SEVERITY[a])[0];
  const shown =
    worst && SEVERITY[worst] > SEVERITY[card.status?.kind || "ok"] ? { kind: worst } : card.status;
  return (
    <section aria-labelledby={heading} className="flex min-w-0 flex-col">
      <div className="flex min-w-0 flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 gap-3">
          <IntegrationMark title={card.title} icon={card.icon} hrefOf={hrefOf} />
          {/* a title alone stands level with its mark, and the header is no taller than the mark */}
          <div
            className={cn(
              "flex min-w-0 flex-1 flex-col gap-0.5",
              !card.description && !shown && "self-center",
            )}
          >
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
              <h3 id={heading} className="text-sm font-semibold [overflow-wrap:anywhere]">
                {card.title}
              </h3>
              {shown ? <StatusText status={shown} /> : null}
            </div>
            {/* whole: a card's description is where its package says what it is for (400
                characters at most, iterate/integrations) */}
            {card.description && (
              <p className="max-w-prose text-xs/5 text-muted-foreground">{card.description}</p>
            )}
          </div>
        </div>
        <TargetLinks
          actions={card.actions}
          hrefOf={hrefOf}
          // A card with no status and no connection is not set up yet: its first button is the
          // one thing to do. A package that is in use says so with a status.
          first={rows.length === 0 && !card.status ? "default" : "secondary"}
          className="shrink-0 pl-11 sm:pl-0"
        />
      </div>
      {rows.length === 0 ? null : (
        // inset on both sides: the hairlines start at the title's indent and end at the buttons'
        // edge, and the last row keeps the header's padding below it
        <ul
          className="mr-4 mb-1 ml-15 flex flex-col divide-y border-t"
          aria-label={`${card.title} connections`}
        >
          {rows.map(({ connection, row }) => (
            <RegistryRow key={connection} row={row} hrefOf={hrefOf} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** A card's or a section's mark: its icon (a URL, or a file its package serves in the mind), or
 *  the title's first letter. A section's is small, and the section shows it only when it has an
 *  icon. */
function IntegrationMark({
  title,
  icon,
  hrefOf,
  small,
}: {
  title: string;
  icon: IntegrationIcon | undefined;
  hrefOf: (target: IntegrationTarget) => string | null;
  small?: boolean;
}) {
  const src = typeof icon === "string" ? icon : icon && hrefOf(icon);
  const size = small ? "size-5 rounded" : "size-8 rounded-md";
  if (src) return <img src={src} alt="" className={cn("shrink-0 object-contain", size)} />;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center border bg-muted text-xs font-semibold text-muted-foreground uppercase",
        size,
      )}
    >
      {title.slice(0, 1)}
    </span>
  );
}

/** One connection a package registered. What is said and what can be pressed look different: a
 *  dot in the status's colour before the account, the status's words and the facts as plain text
 *  under it, and the buttons, which look like buttons, at the row's end. */
function RegistryRow({
  row,
  hrefOf,
}: {
  row: IntegrationConnection;
  hrefOf: (target: IntegrationTarget) => string | null;
}) {
  return (
    <li className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-start sm:gap-3">
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        {row.status ? (
          <StatusDot status={row.status} className="mt-1.5" />
        ) : (
          <span className="size-2 shrink-0" />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="truncate text-sm font-medium" title={row.account}>
            {row.account}
          </p>
          {/* a row that is well says so with its dot alone, unless its package has words for it */}
          {row.status && (row.status.kind !== "ok" || row.status.text) ? (
            <StatusWords status={row.status} />
          ) : null}
          {row.details && (
            <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
              {Object.entries(row.details).map(([label, value]) => (
                <div key={label} className="min-w-0 [overflow-wrap:anywhere]">
                  <dt className="inline">{label} </dt>
                  <dd className="inline text-foreground/80">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
      <TargetLinks actions={row.actions} hrefOf={hrefOf} className="shrink-0 pl-4.5 sm:pl-0" />
    </li>
  );
}

const STATUS_WORDS = { ok: "OK", attention: "Needs attention", error: "Failed" };

const SEVERITY = { ok: 0, attention: 1, error: 2 };

/** The dot of a status: green when all is well, amber when a person should act, red when it
 *  failed. */
function StatusDot({ status, className }: { status: IntegrationStatus; className?: string }) {
  return (
    <span
      role="img"
      aria-label={STATUS_WORDS[status.kind]}
      className={cn(
        "size-2 shrink-0 rounded-full",
        { ok: "bg-success", attention: "bg-warning", error: "bg-destructive" }[status.kind],
        className,
      )}
    />
  );
}

/** A status's words, in its package's own: plain text, quiet when all is well, in the status's
 *  colour when not. Never a pill: nothing here can be pressed. */
function StatusWords({ status }: { status: IntegrationStatus }) {
  return (
    <p
      data-type={status.kind === "error" ? "error" : undefined}
      className={cn(
        "text-xs [overflow-wrap:anywhere]",
        status.kind === "ok" && "text-muted-foreground",
        status.kind === "attention" && "text-warning",
        status.kind === "error" && "text-destructive",
      )}
    >
      {status.text || STATUS_WORDS[status.kind]}
    </p>
  );
}

/** A card's status, at the end of its title's line: the dot, then the words. */
function StatusText({ status }: { status: IntegrationStatus }) {
  return (
    <div className="flex max-w-full items-center gap-1.5">
      <StatusDot status={status} />
      <StatusWords status={status} />
    </div>
  );
}

/** A page's origin never changes: the store that reads it has nothing to tell. */
const subscribeToNothing = () => () => {};

/** A card's or a row's buttons, each a link to where its target leads (`integrationTargetHrefOf`):
 *  a URL on another origin than the page's opens beside it, a page of the mind's in its place,
 *  and a target that leads nowhere is no link. Each is filled, with an arrow that says which of
 *  the two it does: the only filled things on a card are the things to press. Two buttons alike — the same label to the same place
 *  — are one. */
function TargetLinks({
  actions,
  hrefOf,
  first = "secondary",
  className,
}: {
  actions: IntegrationCard["actions"];
  hrefOf: (target: IntegrationTarget) => string | null;
  /** How the first button is filled: dark when it is the one thing to do. */
  first?: "default" | "secondary";
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
      {[...links].map(([key, { label, href, beside }], index) => (
        <a
          key={key}
          href={href}
          {...(beside && { target: "_blank", rel: "noreferrer" })}
          className={buttonVariants({ variant: index === 0 ? first : "secondary", size: "sm" })}
        >
          {label}
          {beside ? (
            <ArrowUpRight data-icon="inline-end" />
          ) : (
            <ChevronRight data-icon="inline-end" />
          )}
        </a>
      ))}
    </div>
  );
}
