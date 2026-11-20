// THE INTEGRATIONS PAGE OF A DASH: what the mind's packages registered (iterate/integrations), live:
// a card for each integration with its connections beneath it, and each button a link that the page
// composes, a change that asks first and is sent from the page (`ConfirmedPost`), or a call of one
// function of the mind's config at the press (`CallButton`). Above them it says how anything gets here: a person asks their agent. Cards that name a
// section stand under its heading (a mark, a title, a few sentences), the sections first. It reads ONE thing: the `integration` facet's live state on `/integrations`, through
// one subscription. It asks nothing on a timer and nothing of the vault.
//
// It knows no router. The page opens the registry's context:
//
//   <IntegrationsPage
//     openRegistry={() => itx.cd("/integrations")}
//     deps={[itx]}
//     callConfig={(name, args) => itx.config[name](...args)}
//     mind="iterate.example.com"
//   />
//
// `callConfig` is how a `call` button reaches the mind's config, from the host's own `itx`: no new
// socket. A host that gives none draws each `call` button disabled, with a title that says why.
// `mind` is the mind's control-plane hostname: the one host a call's link may lead to
// (iterate/integrations `callAnswerLink`). A call button calls only a function that the config
// offers to buttons (`INTEGRATION_CALLS`); it acts on the press, and asks first only for a `confirm`.
import { ArrowUpRight, ChevronRight } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DependencyList,
} from "react";
import { z } from "zod";
import { cn } from "cn";
import {
  callAnswerLink,
  callText,
  INTEGRATION_CALLS,
  IntegrationCallAnswer,
  IntegrationCallsOffered,
  IntegrationCard,
  IntegrationConnection,
  type IntegrationCall,
  type IntegrationIcon,
  type IntegrationStatus,
} from "iterate/integrations";
import { errorCode } from "iterate/lib";
import { useFacetView } from "../lib/facet-view.ts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "#/components/ui/alert-dialog.tsx";
import { Button, buttonVariants } from "#/components/ui/button.tsx";
import { Spinner } from "#/components/ui/spinner.tsx";

/** The registry's state (iterate/integrations `IntegrationRegistryState`), each card and row left
 *  unparsed: the page parses them one by one (`IntegrationsGrid`). */
const RegistryLive = z.looseObject({
  integrations: z.record(z.string(), z.unknown()),
  connections: z.record(z.string(), z.unknown()),
});

/** How a `call` button reaches the mind's config: `itx.config[name](...args)`, as the member. */
export type CallConfig = (name: string, args: unknown[]) => Promise<unknown>;

/** What a `call` button needs of its page: the call; the mind's control-plane hostname, the one
 *  host its answer's link may lead to; and the names the config offers to buttons, read once. */
type Caller = {
  call: CallConfig;
  controlPlane: string;
  offered: () => Promise<ReadonlySet<string>>;
};

/** A page's `Caller`: it asks the config which functions it offers to buttons
 *  (iterate/integrations `INTEGRATION_CALLS`) at the first press, and again after a failed ask. A
 *  config with no such method (`NOT_A_METHOD`, as an arrow field is too: Workers RPC reaches
 *  methods alone) offers none. */
function callerOf(call: CallConfig, controlPlane: string): Caller {
  let offered: Promise<ReadonlySet<string>> | undefined;
  const ask = async () => {
    try {
      return new Set(IntegrationCallsOffered.parse(await call(INTEGRATION_CALLS, [])));
    } catch (caught) {
      if (errorCode(caught) === "NOT_A_METHOD") return new Set<string>();
      offered = undefined;
      throw caught;
    }
  };
  return { call, controlPlane, offered: () => (offered ||= ask()) };
}

export function IntegrationsPage({
  openRegistry,
  deps,
  seed,
  callConfig,
  mind,
}: {
  /** Opens the registry's context (`itx.cd("/integrations")`), held while `deps` stand and then
   *  released. Null while it cannot be named yet. */
  openRegistry: Parameters<typeof useFacetView>[0];
  deps: DependencyList;
  /** The facet's snapshot, when the page read one before it drew: shown until the subscription
   *  answers. */
  seed?: Parameters<typeof useFacetView>[3];
  /** Calls one function of the mind's config for a `call` button (`CallConfig`). Without it, each
   *  `call` button is drawn disabled. */
  callConfig?: CallConfig;
  /** The mind's control-plane hostname (`iterate.example.com`), which the host knows: the one
   *  host a call's link may lead to. Without it, no link is followed. */
  mind?: string;
}) {
  // one ask of the offered names for the page's life, while its host's call and mind stand
  const caller = useMemo(
    () => (callConfig ? callerOf(callConfig, mind || "") : undefined),
    [callConfig, mind],
  );
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
        <IntegrationsGrid registry={registryView.state} caller={caller} />
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
  caller,
}: {
  registry: z.infer<typeof RegistryLive>;
  caller: Caller | undefined;
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
        caller={caller}
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
                <IntegrationMark title={heading.title} icon={heading.icon} small />
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
  caller,
}: {
  integration: string;
  card: IntegrationCard;
  rows: { connection: string; row: IntegrationConnection }[];
  caller: Caller | undefined;
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
          <IntegrationMark title={card.title} icon={card.icon} />
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
          caller={caller}
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
            <RegistryRow key={connection} row={row} caller={caller} />
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
  small,
}: {
  title: string;
  icon: IntegrationIcon | undefined;
  small?: boolean;
}) {
  const size = small ? "size-5 rounded" : "size-8 rounded-md";
  if (icon) return <img src={icon} alt="" className={cn("shrink-0 object-contain", size)} />;
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
function RegistryRow({ row, caller }: { row: IntegrationConnection; caller: Caller | undefined }) {
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
      <TargetLinks actions={row.actions} caller={caller} className="shrink-0 pl-4.5 sm:pl-0" />
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

/** A button as `TargetLinks` draws it: a link with where it opens, or a call. */
type Shown =
  | { label: string; href: string; beside: boolean; confirm: string | undefined }
  | { label: string; call: IntegrationCall; confirm: string | undefined };

/** A card's or a row's buttons. A LINK: a URL on another origin than the page's opens beside it,
 *  one of this origin in its place, each with an arrow that says which of the two it does. A
 *  `confirm` question makes a link a change, not a link (`ConfirmedPost`): only one on the page's
 *  own origin is drawn. A CALL runs one function of the mind's config at the press (`CallButton`).
 *  The only filled things on a card are the things to press. Two buttons alike — the same label to
 *  the same place or the same call — are one. */
function TargetLinks({
  actions,
  caller,
  first = "secondary",
  className,
}: {
  actions: IntegrationCard["actions"];
  caller: Caller | undefined;
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
  const buttons = new Map<string, Shown>();
  for (const action of actions) {
    if ("call" in action) {
      const { label, call, confirm } = action;
      buttons.set(`${label}\ncall ${call.name} ${JSON.stringify(call.args || [])}`, {
        label,
        call,
        confirm,
      });
      continue;
    }
    const beside = new URL(action.url).origin !== origin;
    // a change sent to another site would carry this page's sign-in nowhere it means
    if (action.confirm && beside) continue;
    buttons.set(`${action.label}\n${action.url}`, {
      label: action.label,
      href: action.url,
      beside,
      confirm: action.confirm,
    });
  }
  // what the last press came to, under the group: words under one button would push the others apart
  const [outcome, report] = useState<Outcome | null>(null);
  if (buttons.size === 0) return null;
  return (
    <div className={cn("flex flex-col items-start gap-1 sm:items-end", className)}>
      <div className="flex flex-wrap gap-2">
        {[...buttons].map(([key, shown], index) => {
          const variant = index === 0 && !shown.confirm ? first : "secondary";
          if ("call" in shown)
            return (
              <CallButton
                key={key}
                label={shown.label}
                call={shown.call}
                question={shown.confirm}
                variant={variant}
                caller={caller}
                report={report}
              />
            );
          const { label, href, beside, confirm } = shown;
          if (confirm)
            return (
              <ConfirmedPost
                key={key}
                label={label}
                url={href}
                question={confirm}
                report={report}
              />
            );
          return (
            <a
              key={key}
              href={href}
              {...(beside && { target: "_blank", rel: "noreferrer" })}
              className={buttonVariants({ variant, size: "sm" })}
            >
              {label}
              {beside ? (
                <ArrowUpRight data-icon="inline-end" />
              ) : (
                <ChevronRight data-icon="inline-end" />
              )}
            </a>
          );
        })}
      </div>
      {outcome ? <OutcomeWords outcome={outcome} /> : null}
    </div>
  );
}

/** A BUTTON THAT CHANGES SOMETHING (Remove): the kit's dialog asks the package's question, as the
 *  Secrets page's Delete does, and a yes sends a POST to the button's URL on this page's origin.
 *  What changed comes back through the registry, live: a removed row goes by itself. A refusal
 *  shows its own words under the button. */
function ConfirmedPost({
  label,
  url,
  question,
  report,
}: {
  label: string;
  url: string;
  question: string;
  report: (outcome: Outcome | null) => void;
}) {
  const [sending, setSending] = useState(false);
  const send = async () => {
    setSending(true);
    report(null);
    try {
      const answer = await fetch(url, { method: "POST" });
      if (!answer.ok)
        report({ error: (await answer.text()) || `${label} failed (${answer.status}).` });
    } catch (caught) {
      report({ error: wordsOf(caught) });
    } finally {
      setSending(false);
    }
  };
  return <Confirmed label={label} question={question} busy={sending} onYes={() => void send()} />;
}

/** The trigger of a button that asks first, and the kit's dialog with the package's question: a
 *  question's first sentence is the dialog's title ("Remove @ada?"), and the rest says what
 *  happens; one sentence alone is said under the button's own label. */
function Confirmed({
  label,
  question,
  busy,
  onYes,
}: {
  label: string;
  question: string;
  /** What the button says while its change runs, or false: a busy button is not pressed again. */
  busy: string | boolean;
  onYes: () => void;
}) {
  const end = question.indexOf("? ");
  const title = end > 0 ? question.slice(0, end + 1) : `${label}?`;
  const description = end > 0 ? question.slice(end + 2) : question;
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={<Button variant="secondary" size="sm" />}
        disabled={Boolean(busy)}
        aria-busy={Boolean(busy) || undefined}
      >
        {busy ? (typeof busy === "string" ? busy : `${label}…`) : label}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              // the dialog's action is a plain button: the yes closes it here
              setOpen(false);
              onYes();
            }}
          >
            {label}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** What a press came to: a failure's words, or what the call said it did. */
type Outcome = { error: string } | { said: string };

/** An outcome's words, under the buttons: a failure as an error. */
function OutcomeWords({ outcome }: { outcome: Outcome }) {
  if ("error" in outcome)
    return (
      <p role="alert" data-type="error" className="max-w-xs text-xs text-destructive sm:text-right">
        {outcome.error}
      </p>
    );
  return (
    <p role="status" className="max-w-xs text-xs text-muted-foreground sm:text-right">
      {outcome.said}
    </p>
  );
}

const wordsOf = (caught: unknown) => (caught instanceof Error ? caught.message : String(caught));

/** A BUTTON THAT CALLS THE MIND'S CONFIG. A press acts at once: the page calls
 *  `itx.config[name](...args)` through its host's `callConfig`, as the member, when the config
 *  offers `name` to buttons (`Caller.offered`, the boundary). The whole call, `name(args)`
 *  (`callText`: each character outside printable ASCII as its code), is the button's title and its
 *  accessible description, so a screen reader and a keyboard member get it too. A row with a
 *  `confirm` (Remove, Disconnect) asks first: the kit's dialog sets the question apart as the
 *  card's words, then says, in the page's own words, "This button calls" and the whole call, in a
 *  block that scrolls and is drawn left to right. The row wrote the label and the question, so
 *  neither begins a sentence of the page's. The button says it is busy, and a press while the call
 *  runs does nothing. Then, by the answer (iterate/integrations `IntegrationCallAnswer`):
 *  - a `link` that is https and on the mind's control plane (`callAnswerLink`): the page goes
 *    there IN THIS TAB, unless the member has left the page, and the button says the host it
 *    opens. A connect's consent page sends the member back to `/integrations`, so
 *    one tab reads as one errand; a tab opened at the press would stand blank while the call runs,
 *    and stay blank when it fails. Any other link is not followed, and the card says why and
 *    names its host.
 *  - `said`: shown under the button. What changed comes back through the registry, live.
 *  A call that throws shows its words under the button, as an error. A host with no `callConfig`
 *  draws the button disabled, with a title that says why. */
function CallButton({
  label,
  call,
  question,
  variant,
  caller,
  report,
}: {
  label: string;
  call: IntegrationCall;
  question: string | undefined;
  variant: "default" | "secondary";
  caller: Caller | undefined;
  report: (outcome: Outcome | null) => void;
}) {
  const [busy, setBusy] = useState<string | false>(false);
  const [asking, setAsking] = useState(false);
  const describedBy = useId();
  // a second press before React has drawn the busy button still finds the call running
  const running = useRef(false);
  // a call that answers after the member left the page sends the tab nowhere
  const shownNow = useRef(true);
  useEffect(() => {
    shownNow.current = true;
    return () => {
      shownNow.current = false;
    };
  }, []);
  // a page the browser keeps and shows again after the member went back (its back-forward cache)
  // still says "Opening …": it is idle again
  useEffect(() => {
    const shown = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      running.current = false;
      setBusy(false);
    };
    window.addEventListener("pageshow", shown);
    return () => window.removeEventListener("pageshow", shown);
  }, []);
  if (!caller) {
    const why = "This page cannot call the mind's config: its host gave it no way to.";
    return (
      <span title={why} className="inline-flex">
        <Button variant={variant} size="sm" disabled title={why}>
          {label}
        </Button>
      </span>
    );
  }
  const run = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(`${label}…`);
    report(null);
    let leaving = false;
    try {
      // only a function that the config offers to buttons: a row chooses among those alone
      const offered = await caller.offered();
      if (!offered.has(call.name)) {
        report({
          error: offered.size
            ? `This button calls ${call.name}, which this mind's config does not offer to buttons.`
            : "This mind's config offers no function to buttons, so this button calls nothing.",
        });
        return;
      }
      const answer = await caller.call(call.name, call.args || []);
      const words = IntegrationCallAnswer.safeParse(answer).data?.said;
      const leads = callAnswerLink(answer, caller.controlPlane);
      if (leads && "follow" in leads) {
        if (!shownNow.current) return;
        leaving = true;
        setBusy(`Opening ${leads.follow.hostname}…`);
        window.location.assign(leads.follow.href);
        return;
      }
      if (leads)
        report({
          error: `This button's call answered ${leads.refused}: the page does not follow it.`,
        });
      else if (words) report({ said: words });
    } catch (caught) {
      report({ error: `This button's call failed: ${wordsOf(caught)}`.slice(0, 400) });
    } finally {
      // the page leaves: the button stays busy until it has gone
      if (!leaving) {
        running.current = false;
        setBusy(false);
      }
    }
  };
  const calls = callText(call);
  const face = (
    <>
      {busy || label}
      {busy ? <Spinner data-icon="inline-end" /> : null}
    </>
  );
  // the whole call, for a screen reader and a keyboard: no visible line
  const description = (
    <span id={describedBy} className="sr-only">
      {calls}
    </span>
  );
  const shared = {
    disabled: Boolean(busy),
    "aria-busy": Boolean(busy) || undefined,
    "aria-describedby": describedBy,
    title: calls,
  };
  if (!question)
    return (
      <>
        <Button variant={variant} size="sm" {...shared} onClick={() => void run()}>
          {face}
        </Button>
        {description}
      </>
    );
  return (
    <AlertDialog open={asking} onOpenChange={setAsking}>
      <AlertDialogTrigger render={<Button variant={variant} size="sm" />} {...shared}>
        {face}
      </AlertDialogTrigger>
      {description}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Call this mind's config?</AlertDialogTitle>
          <AlertDialogDescription
            render={<div />}
            className="flex w-full min-w-0 flex-col gap-3 text-left"
          >
            <figure className="flex flex-col gap-1 border-l-2 border-border pl-3">
              <figcaption className="text-xs">The card says:</figcaption>
              <blockquote className="text-foreground [overflow-wrap:anywhere]">
                {question}
              </blockquote>
            </figure>
            <p>This button calls</p>
            <pre
              dir="ltr"
              data-slot="call-text"
              className="max-h-48 w-full overflow-auto rounded-md bg-muted p-2 text-left font-mono text-xs whitespace-pre-wrap text-foreground [overflow-wrap:anywhere] [unicode-bidi:isolate]"
            >
              <bdi dir="ltr">{calls}</bdi>
            </pre>
            <p>in this mind's config, as you.</p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              // the dialog's action is a plain button: the yes closes it here
              setAsking(false);
              void run();
            }}
          >
            {label}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
