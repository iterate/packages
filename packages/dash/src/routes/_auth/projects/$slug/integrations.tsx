// /projects/<slug>/integrations — what the project is connected to, in two parts. FIRST the
// integrations its packages registered (iterate/integrations: the `integration` facet's live state
// on `/integrations`): a card per integration, its connections beneath it, and every button a link
// the page composes for this deployment. THEN the deployment's shared apps
// (`info.iterateAppProviders`) with the project's connections through them (the `project` facet's
// live state on `/`), each provider's Connect sheet, and the agent recipe for any other service.
// Those flows — a person's own account, iterate's app, moving an account another project holds —
// are in core/os/docs/integrations.md. The sheet is one URL, and every way in is a link:
// `?connect=<provider>` (`&scopes=` from an agent's `requestFromUser`), `?move=<offer>`,
// `?other=1`.
import { useEffect, useState, type ReactNode } from "react";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Blocks, CheckIcon, CopyIcon } from "lucide-react";
import { z } from "zod";
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
} from "@iterate-com/ui/components/ui/alert-dialog";
import { Button, buttonVariants } from "@iterate-com/ui/components/ui/button";
import { Card, CardContent } from "@iterate-com/ui/components/ui/card";
import { ConnectButton } from "@iterate-com/ui/components/connect-button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@iterate-com/ui/components/ui/field";
import { Input } from "@iterate-com/ui/components/ui/input";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@iterate-com/ui/components/ui/sheet";
import { Spinner } from "@iterate-com/ui/components/ui/spinner";
import { cn } from "cn";
import { missingScopes } from "iterate/integration-scopes";
import {
  INTEGRATION_PROVIDER_NAMES,
  INTEGRATION_PROVIDERS,
  type IntegrationProvider,
  type SignInProvider,
} from "iterate/api";
import {
  INTEGRATIONS_PATH,
  IntegrationCard,
  IntegrationConnection,
  type IntegrationStatus,
  type IntegrationTarget,
} from "iterate/integrations";
import { errorCode } from "iterate/lib";
import { facetSnapshotOf } from "iterate/react";
import { type FacetHost, type FacetView, useFacetView } from "../../../../lib/facet-view.ts";
import {
  addGithubSignInHref,
  httpOriginOf,
  integrationTargetHrefOf,
} from "../../../../lib/origins.ts";
import { stepUpUrl } from "../../../../lib/scopes.ts";

const Provider = z.enum(INTEGRATION_PROVIDERS);
type Provider = z.infer<typeof Provider>;

const Connection = z.object({
  provider: Provider,
  connection: z.string(),
  account: z.string(),
  externalId: z.string().optional(),
  scopes: z.array(z.string()).optional(),
  /** A member's own account, used by the project: whose. */
  ownerUserId: z.string().optional(),
  ownerEmail: z.string().optional(),
});
type Connection = z.infer<typeof Connection>;

/** The project's connections and the deployment's keys shared with it; a person's own connections
 *  (the account's state has the same `integrations`). */
const IntegrationsLive = z.looseObject({
  integrations: z.record(z.string(), Connection),
  secrets: z.record(
    z.string(),
    z.looseObject({
      borrowed: z
        .object({ lender: z.object({ instance: z.literal(true).optional() }).loose() })
        .optional(),
      /** The secret's pin: a sign-in's names the provider and its API, the API last. */
      urls: z.array(z.string()).optional(),
    }),
  ),
});

/** The project's own state adds its primary hostname (core/os project/contract.ts), which the
 *  registry's links to the project's pages compose on. */
const ProjectLive = IntegrationsLive.extend({ primaryHostname: z.string().nullable() });

/** The registry's state (iterate/integrations `IntegrationRegistryState`), each card and row left
 *  unparsed: the page parses them one by one (`Registry`). */
const RegistryLive = z.looseObject({
  integrations: z.record(z.string(), z.unknown()),
  connections: z.record(z.string(), z.unknown()),
});

/** What `integrations.connect` answers when it sends the browser to a provider. */
const ConnectAnswer = z.object({ authorizationUrl: z.string().url() });

/** Each published provider, its name, and what one of its connections is. */
const PROVIDERS = INTEGRATION_PROVIDERS.map((provider) => ({
  provider,
  title: INTEGRATION_PROVIDER_NAMES[provider],
  noun: provider === "slack" ? "workspace" : "account",
}));
type ProviderEntry = (typeof PROVIDERS)[number];

/** The providers a person has an account of their own with by signing in (core/os identity.ts). */
const SIGN_IN_PROVIDERS: readonly SignInProvider[] = ["google", "cloudflare", "github"];

/** The page's search: which sheet is open, and what it was opened with. */
const IntegrationsSearch = z.object({
  /** The Connect sheet of one provider — an agent's ask (`itx.integrations.requestFromUser`) too. */
  connect: Provider.optional().catch(undefined),
  /** What an agent's ask needs beyond iterate's app's own scopes, space-separated. */
  scopes: z.string().optional().catch(undefined),
  /** A provider's callback's offer to move an account another project holds here (signed by the
   *  platform, core/os integrations/connections.ts `IntegrationMoveOffer`). */
  move: z.string().optional().catch(undefined),
  /** Another service: how to connect one this page has no row for. */
  other: z.literal(1).optional().catch(undefined),
  /** Why the issuer refused to add a GitHub sign-in (core/os identity.ts, "ADD A SIGN-IN"). */
  error: z.string().optional().catch(undefined),
});
type IntegrationsSearch = z.input<typeof IntegrationsSearch>;

export const Route = createFileRoute("/_auth/projects/$slug/integrations")({
  validateSearch: IntegrationsSearch,
  // `useFacetLiveState`'s `initial` for the project, its registry and, with `account`, the person,
  // each on its own: a read that fails leaves only its own view waiting on its subscription
  loader: ({ context }) =>
    context
      .read(async (api) => {
        using project = api.projects.get(context.project.id);
        using registry = project.cd(INTEGRATIONS_PATH);
        const [projectSeed, registrySeed, personSeed] = await Promise.allSettled([
          facetSnapshotOf(project, "project"),
          facetSnapshotOf(registry, "integration"),
          context.info.scopes.includes("account")
            ? facetSnapshotOf(api.user, "account")
            : undefined,
        ]);
        return {
          project: settledValueOf(projectSeed),
          registry: settledValueOf(registrySeed),
          person: settledValueOf(personSeed),
        };
      })
      .catch(() => ({ project: undefined, registry: undefined, person: undefined })),
  staticData: { page: "Integrations" },
  head: ({ params }) => ({ meta: [{ title: `Integrations · ${params.slug} · Dash` }] }),
  component: ProjectIntegrations,
});

/** A settled read's value, or undefined for one that failed. */
function settledValueOf<T>(settled: PromiseSettledResult<T>) {
  return settled.status === "fulfilled" ? settled.value : undefined;
}

/** The person's own state: their accounts, and their context, whose egress reaches GitHub. */
type PersonView = FacetView<
  FacetHost & { fetch(request: Request): Promise<Response> },
  z.infer<typeof IntegrationsLive>
>;

/** A verb that failed, said beside the verb: its key, and the words. */
type Failure = { key: string; message: string };
/** What a component that shows a verb reads: the verb under way, the last that failed, and how to
 *  clear that once it was seen. */
type VerbState = { busy: string | null; failed: Failure | null; dismiss: () => void };

/** ONE VERB AT A TIME: the verb under way (`busy`, its key) and the last one that failed. A call
 *  that answers ends its verb, except one that leaves for a provider (its spinner stays until the
 *  browser has gone) and a Disconnect or a Remove (`dropped`), whose call can answer before the
 *  project's live state drops its row: its spinner goes with the row, in the same render, or when
 *  that live state fails (its error shows). A failure while the call is still out unlocks nothing. */
function useVerbs(project: { listed: ReadonlySet<string>; failed: boolean }) {
  const [busy, setBusy] = useState<{ key: string; until?: "leaving" | "dropped" } | null>(null);
  const [failed, setFailed] = useState<Failure | null>(null);
  // state adjusted while rendering (react.dev, "You Might Not Need an Effect"), not in an effect:
  // no commit shows the lock without its row
  if (busy?.until === "dropped" && (!project.listed.has(busy.key) || project.failed)) setBusy(null);
  const fail = (key: string, caught: unknown) =>
    setFailed({ key, message: caught instanceof Error ? caught.message : String(caught) });
  const run = async (key: string, work: () => Promise<"leaving" | "dropped" | void>) => {
    setFailed(null);
    setBusy({ key });
    try {
      const until = await work();
      setBusy(until ? { key, until } : null);
    } catch (caught) {
      fail(key, caught);
      setBusy(null);
    }
  };
  return { busy: busy?.key || null, failed, run, fail, dismiss: () => setFailed(null) };
}
type Verbs = ReturnType<typeof useVerbs>;

/** This page's own URLs, as the router builds them from its search: the path, for a step-up on
 *  this origin to come back to, and the whole URL on the origin the router serves, for a provider's
 *  consent or the issuer to send the browser back to. */
function useReturnUrls() {
  const router = useRouter();
  const { project } = Route.useRouteContext();
  const pathOf = (search: IntegrationsSearch) =>
    router.buildLocation({ to: Route.fullPath, params: { slug: project.slug }, search }).publicHref;
  return {
    pathOf,
    urlOf: (search: IntegrationsSearch) => new URL(pathOf(search), router.origin).href,
  };
}

/** The project's connections, and the keys this deployment shares with it. */
function listsOf(state: z.infer<typeof ProjectLive> | undefined) {
  return {
    rows: Object.values(state?.integrations || {}),
    fromDeployment: Object.entries(state?.secrets || {}).flatMap(([path, row]) =>
      row.borrowed?.lender.instance ? [path] : [],
    ),
  };
}

/** A provider's mark, beside its name. */
function ProviderLogo({ provider }: { provider: Provider }) {
  return <img src={`/logos/${provider}.svg`} alt="" className="size-5" />;
}

/** A failure, in the page's red, announced as it appears. */
function ErrorText({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p role="alert" data-type="error" className={cn("text-sm text-destructive", className)}>
      {children}
    </p>
  );
}

function ProjectIntegrations() {
  const { api, info, project } = Route.useRouteContext();
  const seeds = Route.useLoaderData();
  const projectView = useFacetView(
    () => api.projects.get(project.id),
    [api, project.id],
    "project",
    seeds.project,
    ProjectLive,
  );
  const registryView = useFacetView(
    async () => {
      // the project's context is only the way there: released once the registry's is held
      using projectContext = api.projects.get(project.id);
      return await projectContext.cd(INTEGRATIONS_PATH);
    },
    [api, project.id],
    "integration",
    seeds.registry,
    RegistryLive,
  );
  // the person's own accounts: a session without `account` (a device's key) offers none
  const personView = useFacetView(
    info.scopes.includes("account") ? () => Promise.resolve(api.user) : null,
    [api, info.scopes],
    "account",
    seeds.person,
    IntegrationsLive,
  );
  const { rows, fromDeployment } = listsOf(projectView.state);
  const verbs = useVerbs({
    listed: new Set([...rows.map(disconnectKeyOf), ...fromDeployment.map(removeKeyOf)]),
    failed: projectView.failed,
  });
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-8">
      <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
        Integrations
        {/* a loader's snapshot shows while its subscription connects: what an action changes
            reaches the page once the subscription is live */}
        {projectView.seeding || registryView.seeding ? <Spinner /> : null}
      </h1>
      {projectView.error ? (
        <ErrorText>Couldn't load this project's connections: {projectView.error}</ErrorText>
      ) : null}
      {registryView.error ? (
        <ErrorText>Couldn't load this project's integrations: {registryView.error}</ErrorText>
      ) : null}
      {projectView.settled && registryView.settled ? null : (
        <p role="status" className="text-sm text-muted-foreground">
          Loading…
        </p>
      )}
      {registryView.state ? (
        <Registry
          state={registryView.state}
          // the primary hostname is unknown until the project's state loads; meanwhile the ingress
          // URL serves, and a page visit there goes on to the primary hostname
          // (core/os primary-hostname-redirect.ts)
          hrefOf={(target) =>
            integrationTargetHrefOf(
              info,
              { slug: project.slug, primaryHostname: projectView.state?.primaryHostname || null },
              target,
            )
          }
        />
      ) : null}
      <SharedApps
        rows={rows}
        loaded={Boolean(projectView.state)}
        verbs={verbs}
        onDisconnect={(row) =>
          void verbs.run(disconnectKeyOf(row), async () => {
            await api.projects
              .get(project.id)
              .integrations.disconnect(row.provider, row.connection);
            return "dropped";
          })
        }
      />
      <OtherServices />
      <SharedByDeployment
        paths={fromDeployment}
        verbs={verbs}
        onRemove={(path) =>
          void verbs.run(removeKeyOf(path), async () => {
            await api.projects.get(project.id).secrets.delete(path);
            return "dropped";
          })
        }
      />
      <IntegrationsSheet rows={rows} person={personView} verbs={verbs} />
    </div>
  );
}

/** THROUGH ITERATE'S APPS: the apps this deployment holds, each with the project's connections
 *  through it; a self-host without them shows none. */
function SharedApps({
  rows,
  loaded,
  verbs,
  onDisconnect,
}: {
  rows: Connection[];
  /** Whether the project's state has loaded, so "Not connected" is known. */
  loaded: boolean;
  verbs: VerbState;
  onDisconnect: (row: Connection) => void;
}) {
  const { info } = Route.useRouteContext();
  const iterateApps = new Set(info.iterateAppProviders);
  // a provider the deployment has an app for, and one it connected through before it dropped the
  // app: its connections still list and disconnect, with nothing to connect another through
  const providers = PROVIDERS.filter(
    ({ provider }) => iterateApps.has(provider) || rows.some((row) => row.provider === provider),
  );
  if (providers.length === 0) return null;
  return (
    <section className="flex flex-col gap-2" aria-labelledby="iterate-apps-heading">
      <h2 id="iterate-apps-heading" className="font-medium">
        Through iterate's apps
      </h2>
      <div className="flex flex-col divide-y border-y">
        {providers.map((entry) => (
          <ProviderSection
            key={entry.provider}
            entry={entry}
            connections={rows.filter((row) => row.provider === entry.provider)}
            connectable={iterateApps.has(entry.provider)}
            loaded={loaded}
            verbs={verbs}
            onDisconnect={onDisconnect}
          />
        ))}
      </div>
    </section>
  );
}

/** One provider: the project's connections through it, and Connect, a link to its sheet
 *  (`?connect=`), while the deployment has the app. */
function ProviderSection({
  entry: { provider, title, noun },
  connections,
  connectable,
  loaded,
  verbs,
  onDisconnect,
}: {
  entry: ProviderEntry;
  connections: Connection[];
  /** Whether the deployment has the app to connect another through. */
  connectable: boolean;
  loaded: boolean;
  verbs: VerbState;
  onDisconnect: (row: Connection) => void;
}) {
  const { info } = Route.useRouteContext();
  const another = connections.length > 0;
  return (
    <section className="py-3" aria-labelledby={`${provider}-heading`}>
      <div className="flex items-center gap-3">
        <ProviderLogo provider={provider} />
        <h3 id={`${provider}-heading`} className="flex-1 font-medium">
          {title}
        </h3>
        {loaded && !another ? (
          <span className="text-xs text-muted-foreground">Not connected</span>
        ) : null}
        {connectable ? (
          <Link
            from={Route.fullPath}
            to="."
            search={{ connect: provider }}
            aria-label={another ? `Connect another ${title} ${noun}` : `Connect ${title}`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {another ? "Connect another" : "Connect"}
          </Link>
        ) : null}
      </div>
      {another ? (
        <ul className="mt-1 flex flex-col pl-8" aria-label={`${title} connections`}>
          {connections.map((row) => (
            <ConnectionItem
              key={row.connection}
              row={row}
              yours={row.ownerUserId === info.principal.actor}
              noun={noun}
              verbs={verbs}
              onDisconnect={() => onDisconnect(row)}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** OTHER SERVICES: a link to the sheet (`?other=1`) that says how a coding agent connects one. */
function OtherServices() {
  return (
    <section className="flex items-center gap-3 border-y py-3" aria-labelledby="other-heading">
      <Blocks aria-hidden="true" className="size-5 text-muted-foreground" />
      <h2 id="other-heading" className="flex-1 font-medium">
        Other services
      </h2>
      <Link
        from={Route.fullPath}
        to="."
        search={{ other: 1 }}
        aria-label="Connect another service"
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        Connect
      </Link>
    </section>
  );
}

/** SHARED BY THIS DEPLOYMENT: the keys its operator shares with the project, each removable. */
function SharedByDeployment({
  paths,
  verbs,
  onRemove,
}: {
  paths: string[];
  verbs: VerbState;
  onRemove: (path: string) => void;
}) {
  if (paths.length === 0) return null;
  return (
    <section className="flex flex-col gap-2" aria-labelledby="deployment-heading">
      <h2 id="deployment-heading" className="font-medium">
        Shared by this deployment
      </h2>
      <ul className="flex flex-col divide-y border-y" aria-label="Shared by this deployment">
        {paths.map((path) => (
          <li key={path} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <code className="text-sm [overflow-wrap:anywhere]">{path}</code>
              {verbs.failed?.key === removeKeyOf(path) ? (
                <ErrorText className="text-xs">{verbs.failed.message}</ErrorText>
              ) : null}
            </div>
            <ConfirmButton
              verb="Remove"
              name={path}
              description="Agents here stop using it. Only this deployment's operator can share it again."
              verbKey={removeKeyOf(path)}
              verbs={verbs}
              onConfirm={() => onRemove(path)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** ONE SHEET, opened by the URL alone: the move offer, a provider's Connect sheet, or another
 *  service's recipe. It stays open while a verb it runs is under way (a move, an install, a Use),
 *  so what the verb ends by closing is the sheet it began in. */
function IntegrationsSheet({
  rows,
  person,
  verbs,
}: {
  rows: Connection[];
  person: PersonView;
  verbs: Verbs;
}) {
  const { api, info, project } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const connecting = search.connect
    ? PROVIDERS.find((known) => known.provider === search.connect)
    : undefined;
  const moveOffer = search.move ? moveOfferOf(search.move) : null;
  const blocking = Boolean(verbs.busy);
  const closeSheet = () => {
    verbs.dismiss();
    return navigate({ search: {}, replace: true });
  };
  const moveFailure = verbs.failed?.key === "move" ? verbs.failed.message : null;
  return (
    <Sheet
      open={Boolean(connecting || moveOffer || search.other)}
      onOpenChange={(open) => !open && !blocking && void closeSheet()}
    >
      <SheetContent
        side="right"
        showCloseButton={!blocking}
        className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-md"
      >
        {moveOffer ? (
          <MoveOffer
            offer={moveOffer}
            pending={verbs.busy === "move"}
            error={moveFailure}
            onConfirm={() =>
              void verbs.run("move", async () => {
                await api.projects
                  .get(project.id)
                  .facets.get("project")
                  .invoke([["confirmIntegrationMove", { offer: search.move }]]);
                await closeSheet();
              })
            }
          />
        ) : connecting ? (
          <ConnectSheet
            entry={connecting}
            rows={rows}
            person={person}
            verbs={verbs}
            closeSheet={closeSheet}
          />
        ) : search.other ? (
          <OtherService
            projectSlug={project.slug}
            mcpServer={mcpServerOf(info)}
            platformOrigin={httpOriginOf(info.platformOrigin)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** What the person's own accounts can be asked for: only Google's, Cloudflare's and X's consents
 *  add scopes to an account they already have — iterate's app's own, and what an agent asked. */
function yourConsentScopesOf(
  provider: Provider,
  appScopes: Partial<Record<IntegrationProvider, string[]>>,
  askedScopes: string[] | undefined,
) {
  return provider === "google" || provider === "cloudflare" || provider === "x"
    ? [...(appScopes[provider] || []), ...(askedScopes || [])]
    : [];
}

/** What an agent's ask says it needs, as the sheet's description: the access, or the account. */
function askOf(askedScopes: string[], { title, noun }: ProviderEntry) {
  const access = accessLabelOf(askedScopes);
  return access ? `An agent needs ${access} access.` : `An agent needs a ${title} ${noun}.`;
}

/** Whether "Your accounts" can show: the session may not read them (no `account`), or they are
 *  loading, failed, or loaded. */
function yourAccountsStatusOf(
  scopes: string[],
  person: PersonView,
): "no-access" | "loading" | "failed" | "loaded" {
  if (!scopes.includes("account")) return "no-access";
  if (person.error) return "failed";
  return person.value ? "loaded" : "loading";
}

/** A PROVIDER'S CONNECT SHEET: the person's own accounts, where iterate's GitHub App is installed,
 *  and another account through iterate's app. */
function ConnectSheet({
  entry,
  rows,
  person,
  verbs,
  closeSheet,
}: {
  entry: ProviderEntry;
  rows: Connection[];
  person: PersonView;
  verbs: Verbs;
  closeSheet: () => Promise<void>;
}) {
  const { api, info, project } = Route.useRouteContext();
  const search = Route.useSearch();
  const urls = useReturnUrls();
  const { provider, title, noun } = entry;
  const askedScopes = search.scopes?.split(" ").filter(Boolean);
  const yours = Object.values(person.state?.integrations || {}).filter(
    (row) => row.provider === provider,
  );
  /** Whether a person's own account not connected here yet is on offer: its Use is then the
   *  sheet's one primary action, and connecting another account is secondary. */
  const offersYourOwn = yours.some(
    (row) => !rows.some((here) => Boolean(here.ownerUserId) && here.connection === row.connection),
  );
  /** "another", or the article the next word takes when the person has none of their own. */
  const another = (nextWord: string) =>
    yours.length > 0 ? "another" : /^[aeioux]/i.test(nextWord) ? "an" : "a";
  const connectLabel =
    provider === "github"
      ? `Install on ${another("GitHub")} GitHub account`
      : `Connect ${another(title)} ${title} ${noun}`;
  const failure =
    (provider === "github" && verbs.failed?.key.startsWith("install:")) ||
    verbs.failed?.key === `connect:${provider}`
      ? verbs.failed.message
      : null;
  /** One of the person's own accounts connected to this project: at once, or through the
   *  provider's consent for what it lacks, back here. */
  const connectYours = (row: Connection) =>
    void verbs.run(`use:${row.connection}`, async () => {
      try {
        const { authorizationUrl } = z
          .object({ authorizationUrl: z.string().url().optional() })
          .parse(
            await api.projects.get(project.id).integrations.connect(row.provider, {
              account: row.account,
              scopes: askedScopes,
              next: urls.urlOf({}),
            }),
          );
        if (authorizationUrl) {
          window.location.assign(authorizationUrl);
          return "leaving";
        }
        await closeSheet();
      } catch (caught) {
        // a refusal's own words are meant for the person, and trying again won't change them;
        // anything else says "try again", its raw reason in the console
        console.error("Connecting your account failed", caught);
        const refused = ["FORBIDDEN", "INVALID_INPUT"].includes(errorCode(caught) ?? "");
        throw new Error(
          refused && caught instanceof Error ? caught.message : "Couldn't connect it. Try again.",
        );
      }
    });
  return (
    <div className="flex h-full flex-col">
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <ProviderLogo provider={provider} />
          {rows.some((row) => row.provider === provider)
            ? `Connect another ${title} ${noun}`
            : `Connect ${title}`}
        </SheetTitle>
        {askedScopes ? <SheetDescription>{askOf(askedScopes, entry)}</SheetDescription> : null}
      </SheetHeader>
      <div className="flex flex-1 flex-col gap-6 px-4 pb-4">
        {failure ? <ErrorText>{failure}</ErrorText> : null}
        <YourAccounts
          provider={provider}
          status={yourAccountsStatusOf(info.scopes, person)}
          accounts={yours}
          connectedHere={rows}
          askedScopes={yourConsentScopesOf(provider, info.iterateAppScopes, askedScopes)}
          verbs={verbs}
          stepUpNext={urls.pathOf({ connect: provider, scopes: search.scopes })}
          onUse={connectYours}
        />
        {provider === "github" && info.iterateAppProviders.includes("github") ? (
          <GithubInstallations
            person={person.stub}
            state={person.state}
            connectedHere={rows}
            verbs={verbs}
            onConnect={(installationId) =>
              void verbs.run(`install:${installationId}`, async () => {
                const { authorizationUrl } = ConnectAnswer.parse(
                  await api.projects.get(project.id).integrations.connect("github", {
                    installationId,
                    next: urls.urlOf({}),
                  }),
                );
                window.location.assign(authorizationUrl);
                return "leaving";
              })
            }
          />
        ) : null}
        {info.iterateAppProviders.includes(provider) ? (
          <ConnectButton
            provider={provider}
            variant={offersYourOwn ? "outline" : "default"}
            scopes={askedScopes}
            disabled={Boolean(verbs.busy)}
            connect={async (input) =>
              ConnectAnswer.parse(
                await api.projects.get(project.id).integrations.connect(input.provider, {
                  scopes: input.scopes,
                  next: urls.urlOf({}),
                }),
              )
            }
            onError={(caught) => verbs.fail(`connect:${provider}`, caught)}
          >
            {connectLabel}
          </ConnectButton>
        ) : null}
      </div>
    </div>
  );
}

/** The integrations the project's packages registered (iterate/integrations): a card each, its
 *  connections beneath it, every button a link to where it leads. A package appends the null that
 *  takes a card or a row away; the Dash shows what stands. Each card and row is parsed on its own,
 *  so one this page cannot read (a newer contract's) leaves out only itself. */
function Registry({
  state,
  hrefOf,
}: {
  state: z.infer<typeof RegistryLive>;
  /** Where a target leads, or null for no link (`integrationTargetHrefOf`). */
  hrefOf: (target: IntegrationTarget) => string | null;
}) {
  const cards = Object.entries(state.integrations).flatMap(([integration, value]) => {
    const card = IntegrationCard.safeParse(value).data;
    return card ? [{ integration, card }] : [];
  });
  const rows = Object.entries(state.connections).flatMap(([key, value]) => {
    const row = IntegrationConnection.safeParse(value).data;
    // the key is `<integration>/<connection>`, and neither name can hold a "/"
    const slash = key.indexOf("/");
    return row ? [{ integration: key.slice(0, slash), connection: key.slice(slash + 1), row }] : [];
  });
  if (cards.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        No integrations are registered yet. An integration is a package in the project's worker: it
        adds its card here when the worker is published.{" "}
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
  return (
    <div className="flex flex-col gap-4">
      {cards.map(({ integration, card }) => (
        <RegisteredIntegration
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

/** ONE INTEGRATION's card — its title, description, status and buttons — and its connections as
 *  its package lists them: the account, a few facts about it, its status and buttons. */
function RegisteredIntegration({
  integration,
  card,
  rows,
  hrefOf,
}: {
  integration: string;
  card: IntegrationCard;
  rows: { integration: string; connection: string; row: IntegrationConnection }[];
  hrefOf: (target: IntegrationTarget) => string | null;
}) {
  const heading = `integration-${integration}-heading`;
  return (
    <section aria-labelledby={heading}>
      <Card size="sm">
        <CardContent className="flex min-w-0 flex-col gap-1">
          <h2 id={heading} className="text-base font-medium [overflow-wrap:anywhere]">
            {card.title}
          </h2>
          {card.description && <p className="text-muted-foreground">{card.description}</p>}
          {card.status && <StatusText status={card.status} />}
          <TargetLinks actions={card.actions} hrefOf={hrefOf} className="pt-1" />
        </CardContent>
        {rows.length > 0 && (
          <CardContent>
            <ul
              className="flex flex-col divide-y border-t"
              aria-label={`${card.title} connections`}
            >
              {rows.map(({ connection, row }) => (
                <li key={connection} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm [overflow-wrap:anywhere]">{row.account}</p>
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
                  </div>
                  {row.status && <StatusText status={row.status} />}
                  <TargetLinks actions={row.actions} hrefOf={hrefOf} />
                </li>
              ))}
            </ul>
          </CardContent>
        )}
      </Card>
    </section>
  );
}

/** How an integration or a connection is doing, in its package's words: a quiet line when all is
 *  well, amber when a person should act, red when it failed. */
function StatusText({ status }: { status: IntegrationStatus }) {
  return (
    <p
      data-type={status.kind === "error" ? "error" : undefined}
      className={cn(
        "flex items-center gap-1.5 text-xs",
        status.kind === "ok" && "text-muted-foreground",
        status.kind === "error" && "text-destructive",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          { ok: "bg-emerald-500", attention: "bg-amber-500", error: "bg-destructive" }[status.kind],
        )}
      />
      {status.text || { ok: "OK", attention: "Needs attention", error: "Failed" }[status.kind]}
    </p>
  );
}

/** A card's or a row's buttons, each a link to where its target leads (`integrationTargetHrefOf`):
 *  a URL on another origin than the Dash's opens beside it, a page of the project's in its place,
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
  const { origin } = useRouter();
  const links = new Map<string, { label: string; href: string; beside: boolean }>();
  for (const action of actions) {
    const href = hrefOf(action);
    if (href)
      links.set(`${action.label}\n${href}`, {
        label: action.label,
        href,
        beside: "url" in action && httpOriginOf(href) !== origin,
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

/** Disconnect or Remove, behind a confirmation that says what it takes away. The dialog may be
 *  left while its verb runs (the button keeps the spinner until the live state drops the row); a
 *  failure shows here while the dialog is open, and on the row once it is closed. */
function ConfirmButton({
  verb,
  name,
  description,
  verbKey,
  verbs,
  onConfirm,
}: {
  verb: "Disconnect" | "Remove";
  /** What it takes away, as the page shows it: a connection's account, a shared key's path. */
  name: string;
  description: string;
  /** The page's `busy` while this verb runs. */
  verbKey: string;
  verbs: VerbState;
  onConfirm: () => void;
}) {
  const pending = verbs.busy === verbKey;
  return (
    <AlertDialog onOpenChange={(open) => !open && verbs.dismiss()}>
      <AlertDialogTrigger
        render={<Button variant="ghost" size="sm" />}
        aria-label={`${verb} ${name}`}
        disabled={Boolean(verbs.busy)}
      >
        {pending ? <Spinner data-icon="inline-start" /> : null}
        {verb}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {verb} {name}?
          </AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {verbs.failed?.key === verbKey ? <ErrorText>{verbs.failed.message}</ErrorText> : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={pending} onClick={onConfirm}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {verb}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** What a person recognises a scope as — Gmail, Calendar, Docs, Drive — or null for one they
 *  would not (the identity, a Cloudflare permission's name). */
function scopeLabelOf(scope: string) {
  if (scope.includes("/auth/gmail")) return "Gmail";
  if (scope.includes("/auth/calendar")) return "Calendar";
  if (scope.includes("/auth/documents")) return "Docs";
  if (scope.includes("/auth/drive")) return "Drive";
  return null;
}

/** The identity scopes a person does not read as access (Google's, OpenID's, Cloudflare's). */
const IDENTITY_SCOPES = new Set([
  "openid",
  "email",
  "profile",
  "offline_access",
  "user-details.read",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
]);

/** What access `scopes` name, as a person reads them: the labels (Gmail, Calendar…), else each
 *  scope's last part ("contacts.readonly"), the identity left out — or "" when nothing is left. */
function accessLabelOf(scopes: string[]) {
  return [
    ...new Set(
      scopes
        .filter((scope) => !IDENTITY_SCOPES.has(scope))
        .map((scope) => scopeLabelOf(scope) || scope.split("/").at(-1) || scope),
    ),
  ].join(", ");
}

/** What `granted` lacks of `asked` (`missingScopes`, the platform's own rule), as a
 *  person reads it ("Gmail access", "contacts.readonly access"), "more access" for identity scopes
 *  alone, or null. */
function missingAccessOf(provider: Provider, granted: string[], asked: string[]) {
  const missing = missingScopes(provider, granted, asked);
  if (missing.length === 0) return null;
  const label = accessLabelOf(missing);
  return label ? `${label} access` : "more access";
}

/** A small label over one of the Connect sheet's lists. */
function ListLabel({ children }: { children: string }) {
  return <p className="text-xs font-medium text-muted-foreground">{children}</p>;
}

/** THE ACCOUNTS YOU ALREADY HAVE for a provider, each one click away: connected here already (and
 *  complete), connected but lacking what the project needs ("Add access"), or ready ("Use"). None,
 *  and the sheet says nothing about them. */
function YourAccounts({
  provider,
  status,
  accounts,
  connectedHere,
  askedScopes,
  verbs,
  stepUpNext,
  onUse,
}: {
  provider: Provider;
  status: "no-access" | "loading" | "failed" | "loaded";
  accounts: Connection[];
  connectedHere: Connection[];
  askedScopes: string[];
  verbs: VerbState;
  /** Where the step-up to the `account` scope comes back to. */
  stepUpNext: string;
  onUse: (row: Connection) => void;
}) {
  const title = INTEGRATION_PROVIDER_NAMES[provider];
  if (status === "no-access")
    // only a sign-in provider has accounts of yours worth stepping up for
    return SIGN_IN_PROVIDERS.some((name) => name === provider) ? (
      <p className="text-sm text-muted-foreground">
        <a href={stepUpUrl(stepUpNext)} className="underline underline-offset-4">
          Show your {title} accounts
        </a>
      </p>
    ) : null;
  if (status === "loading")
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Your accounts
      </p>
    );
  if (status === "failed")
    return <ErrorText>Couldn't load your accounts. Reload to try again.</ErrorText>;
  if (accounts.length === 0) return null;
  const connected = (row: Connection) =>
    connectedHere.some(
      (here) =>
        here.provider === row.provider &&
        Boolean(here.ownerUserId) &&
        here.connection === row.connection,
    );
  // one primary per sheet: the first account not connected here yet
  const primary = accounts.find((row) => !connected(row));
  return (
    <div className="flex flex-col gap-1">
      <ListLabel>Your accounts</ListLabel>
      <ul className="flex flex-col divide-y" aria-label="Your accounts">
        {accounts.map((row) => {
          const here = connected(row);
          const missing = missingAccessOf(provider, row.scopes || [], askedScopes);
          const meta = missing
            ? `${title} asks for ${missing}`
            : provider === "github" && !here
              ? "Acts as you"
              : null;
          return (
            <li key={row.connection} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="[overflow-wrap:anywhere]">{row.account}</p>
                {meta && <p className="text-xs text-muted-foreground">{meta}</p>}
                {verbs.failed?.key === `use:${row.connection}` && (
                  <ErrorText className="text-xs">{verbs.failed.message}</ErrorText>
                )}
              </div>
              {here && !missing ? (
                <span className="text-xs text-muted-foreground">Connected</span>
              ) : (
                <Button
                  size="sm"
                  variant={row === primary ? "default" : "outline"}
                  // the name begins with the button's words (WCAG 2.5.3); the row says what is missing
                  aria-label={here ? `Add access to ${row.account}` : `Use ${row.account}`}
                  disabled={Boolean(verbs.busy)}
                  onClick={() => onUse(row)}
                >
                  {verbs.busy === `use:${row.connection}` ? (
                    <Spinner data-icon="inline-start" />
                  ) : null}
                  {here ? "Add access" : "Use"}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The page's `busy` while a connection's Disconnect runs: its provider and name, which together
 *  name one connection. */
function disconnectKeyOf(row: Connection) {
  return `disconnect:${row.provider}/${row.connection}`;
}

/** The page's `busy` while Remove takes a key the deployment shares out of the project: its path. */
function removeKeyOf(path: string) {
  return `remove:${path}`;
}

/** What a Disconnect takes away, as its confirmation says it: a member's account stays theirs. */
function disconnectDescriptionOf(row: Connection, yours: boolean, noun: string) {
  if (row.ownerUserId)
    return `Agents here stop using it. It stays connected to ${yours ? "you" : "its owner"}.`;
  return row.provider === "slack" || row.provider === "github"
    ? `Its token is deleted and events from this ${noun} stop.`
    : "Its token is deleted.";
}

/** One of the project's connections: its account, whose it is and what it holds, and Disconnect —
 *  which, for a member's account, takes it out of this project alone. */
function ConnectionItem({
  row,
  yours,
  noun,
  verbs,
  onDisconnect,
}: {
  row: Connection;
  yours: boolean;
  /** What one of the provider's connections is: a workspace, an account. */
  noun: string;
  verbs: VerbState;
  onDisconnect: () => void;
}) {
  const whose = row.ownerUserId ? (yours ? "Yours" : `${row.ownerEmail || "A member"}'s`) : null;
  const detail = [
    ...new Set((row.scopes || []).flatMap((scope) => scopeLabelOf(scope) || [])),
  ].join(", ");
  const meta = [whose, detail].filter(Boolean).join(" · ");
  return (
    <li className="flex items-center gap-3 py-2" data-connection={row.connection}>
      <div className="min-w-0 flex-1">
        <p className="text-sm [overflow-wrap:anywhere]">{row.account}</p>
        {meta && <p className="text-xs text-muted-foreground">{meta}</p>}
        {verbs.failed?.key === disconnectKeyOf(row) ? (
          <ErrorText className="text-xs">{verbs.failed.message}</ErrorText>
        ) : null}
      </div>
      <ConfirmButton
        verb="Disconnect"
        name={row.account}
        description={disconnectDescriptionOf(row, yours, noun)}
        verbKey={disconnectKeyOf(row)}
        verbs={verbs}
        onConfirm={onDisconnect}
      />
    </li>
  );
}

/** What the Dash reads of a move offer: the platform signed it, and the platform checks it again on
 *  the move; the page only words it. */
const MoveOfferShown = z.object({
  kind: z.literal("integration-move"),
  provider: z.enum(["slack", "github"]),
  account: z.string(),
  holderSlug: z.string().nullable(),
});

/** The offer's claims, off its signed token (base64url of UTF-8 JSON before the signature, as
 *  core/os integrations/connections.ts reads it), or null. */
function moveOfferOf(token: string) {
  try {
    const binary = atob(token.split(".")[0]!.replaceAll("-", "+").replaceAll("_", "/"));
    const json = new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
    return MoveOfferShown.parse(JSON.parse(json));
  } catch {
    return null;
  }
}

/** THE MOVE: an account another project holds, which the person proved they may connect (a GitHub
 *  installation they administer, a Slack workspace Slack let them install into) — one sentence on
 *  what the other project loses, one button. */
function MoveOffer({
  offer,
  pending,
  error,
  onConfirm,
}: {
  offer: z.infer<typeof MoveOfferShown>;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
}) {
  const title = INTEGRATION_PROVIDER_NAMES[offer.provider];
  return (
    <div className="flex h-full flex-col">
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <ProviderLogo provider={offer.provider} />
          Move {offer.account} here?
        </SheetTitle>
        <SheetDescription>
          {offer.account} is connected to {offer.holderSlug || "another project"}. Moving it here
          stops that project's {title} access and events.
        </SheetDescription>
      </SheetHeader>
      {error && <ErrorText className="px-4">{error}</ErrorText>}
      <SheetFooter className="border-t sm:flex-row sm:justify-end">
        <SheetClose disabled={pending} render={<Button type="button" variant="outline" />}>
          Cancel
        </SheetClose>
        <Button variant="destructive" disabled={pending} onClick={onConfirm}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          Move here
        </Button>
      </SheetFooter>
    </div>
  );
}

/** A GitHub installation as `GET /user/installations` answers it. */
const GithubInstallation = z.object({
  id: z.union([z.number(), z.string()]).transform(String),
  account: z.object({ login: z.string() }),
});

/** WHERE iterate's GitHub App IS INSTALLED that the person reaches: `GET /user/installations` with
 *  their GitHub sign-in's token (a user token of iterate's App lists that App's installations),
 *  through their own egress. Each connects here without GitHub's configure page. */
function GithubInstallations({
  person,
  state,
  connectedHere,
  verbs,
  onConnect,
}: {
  person: { fetch(request: Request): Promise<Response> } | undefined;
  /** The person's own state, once read. */
  state: z.infer<typeof IntegrationsLive> | undefined;
  connectedHere: Connection[];
  verbs: VerbState;
  onConnect: (installationId: string) => void;
}) {
  const signIn = Object.values(state?.integrations || {}).find((row) => row.provider === "github");
  const secretPath = signIn ? `/secrets/github-${signIn.connection}` : null;
  // the sign-in's secret is pinned to GitHub and its API: the API is the last origin
  const apiOrigin = secretPath ? state?.secrets[secretPath]?.urls?.at(-1) : undefined;
  const [installations, setInstallations] = useState<
    z.infer<typeof GithubInstallation>[] | "loading" | "failed"
  >("loading");
  useEffect(() => {
    if (!person || !secretPath || !apiOrigin) return;
    let current = true;
    /** Every page of them (GitHub answers at most 100 a page). */
    const everyPage = async () => {
      const all: z.infer<typeof GithubInstallation>[] = [];
      for (let page = 1; ; page++) {
        const response = await person.fetch(
          new Request(`${apiOrigin}/user/installations?per_page=100&page=${page}`, {
            headers: {
              accept: "application/vnd.github+json",
              authorization: `Bearer getSecret("${secretPath}", { field: "accessToken" })`,
            },
          }),
        );
        if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
        const { installations } = z
          .object({ installations: z.array(GithubInstallation) })
          .parse(await response.json());
        all.push(...installations);
        if (installations.length < 100) return all;
      }
    };
    void everyPage()
      .then((installations) => current && setInstallations(installations))
      .catch(() => current && setInstallations("failed"));
    return () => {
      current = false;
    };
  }, [person, secretPath, apiOrigin]);
  const { info } = Route.useRouteContext();
  const { error } = Route.useSearch();
  const urls = useReturnUrls();
  // your account not read yet, or not readable by this session: "Your accounts" says which
  if (!state) return null;
  if (!secretPath || !apiOrigin) {
    // back to this sheet once the issuer has added it (or says why not)
    const addSignIn = info.signInProviders.includes("github")
      ? addGithubSignInHref(info, urls.urlOf({ connect: "github" }))
      : null;
    return (
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          Your account has no GitHub sign-in, so where iterate's app is installed can't be listed.{" "}
          {addSignIn && (
            <a href={addSignIn} className="underline underline-offset-4">
              Add GitHub sign-in
            </a>
          )}
        </p>
        {error && <ErrorText>{error}</ErrorText>}
      </div>
    );
  }
  if (installations === "loading")
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Where iterate's app is installed
      </p>
    );
  if (installations === "failed")
    return (
      <p className="text-sm text-muted-foreground">
        Couldn't ask GitHub where iterate's app is installed.
      </p>
    );
  if (installations.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <ListLabel>iterate's app is installed on</ListLabel>
      <ul className="flex flex-col divide-y" aria-label="Where iterate's app is installed">
        {installations.map((installation) => {
          const here = connectedHere.some(
            (row) => row.provider === "github" && row.externalId === installation.id,
          );
          return (
            <li key={installation.id} className="flex items-center gap-3 py-2">
              <p className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                {installation.account.login}
              </p>
              {here ? (
                <span className="text-xs text-muted-foreground">Connected</span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Connect ${installation.account.login}`}
                  disabled={Boolean(verbs.busy)}
                  onClick={() => onConnect(installation.id)}
                >
                  {verbs.busy === `install:${installation.id}` ? (
                    <Spinner data-icon="inline-start" />
                  ) : null}
                  Connect
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The project's MCP server, as the MCP page gives it: the deployment's own MCP origin, else `/mcp`
 *  on the platform's; null when the deployment reports neither as an http(s) origin. */
function mcpServerOf(info: { mcpOrigin: string; platformOrigin: string }) {
  const mcpOrigin = httpOriginOf(info.mcpOrigin);
  const platformOrigin = httpOriginOf(info.platformOrigin);
  return mcpOrigin ? `${mcpOrigin}/` : platformOrigin ? `${platformOrigin}/mcp` : null;
}

/** What a person pastes to their coding agent, once it reaches this project over MCP: connect
 *  `service` with the platform's own verbs, keys never in the chat. */
function agentPromptOf(service: string, projectSlug: string, platformOrigin: string | null) {
  const name = service.trim() || "<service>";
  const guide = platformOrigin ? `${platformOrigin}/connect-a-service.md` : "connect-a-service.md";
  return [
    `Connect ${name} to my iterate project "${projectSlug}", using iterate's MCP server.`,
    `First read the whole guide at ${guide}, through iterate's run tool: async (itx) => (await itx.fetch(new Request("${guide}"))).text()`,
    "Then follow it step by step.",
    "Never ask me for a key in the chat: send me a link whenever I have to do something, and wait for me to say done.",
    `Before you say it's connected, show me one read-only call to ${name} that works.`,
  ].join("\n");
}

/** ANOTHER SERVICE: the easiest way is the person's own coding agent, connected to this project over
 *  MCP and asked to connect it by the platform's recipe (core/os/public/connect-a-service.md). */
function OtherService({
  projectSlug,
  mcpServer,
  platformOrigin,
}: {
  projectSlug: string;
  mcpServer: string | null;
  platformOrigin: string | null;
}) {
  const [service, setService] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const prompt = agentPromptOf(service, projectSlug, platformOrigin);
  const copy = (label: string, value: string) =>
    void navigator.clipboard.writeText(value).then(
      () => setCopied(label),
      // refused (no permission, the page not focused): nothing says it was copied
      () => setCopied(null),
    );
  return (
    <div className="flex h-full flex-col">
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <Blocks aria-hidden="true" className="size-5 text-muted-foreground" />
          Connect another service
        </SheetTitle>
        <SheetDescription>
          The easiest way: connect your coding agent to this project over MCP, then ask it to
          connect the service.
        </SheetDescription>
      </SheetHeader>
      <FieldGroup className="flex-1 px-4 pb-4">
        {mcpServer && (
          <Field>
            <FieldLabel>1. Add this project to Claude Code</FieldLabel>
            <div className="flex items-start gap-2">
              <code className="min-w-0 flex-1 rounded-md bg-muted px-2 py-1.5 text-xs break-all">
                claude mcp add --transport http iterate {mcpServer}
              </code>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label={copied === "mcp" ? "Copied" : "Copy the command"}
                title={copied === "mcp" ? "Copied" : "Copy the command"}
                onClick={() => copy("mcp", `claude mcp add --transport http iterate ${mcpServer}`)}
              >
                {copied === "mcp" ? <CheckIcon /> : <CopyIcon />}
              </Button>
            </div>
            <FieldDescription>
              Then run <code>/mcp</code> in Claude Code and sign in, ticking {projectSlug}. Other
              agents: the{" "}
              <Link
                to="/projects/$slug/mcp"
                params={{ slug: projectSlug }}
                className="underline underline-offset-4"
              >
                MCP page
              </Link>
              .
            </FieldDescription>
          </Field>
        )}
        <Field>
          <FieldLabel htmlFor="other-service">{mcpServer ? "2. " : ""}The service</FieldLabel>
          <Input
            id="other-service"
            placeholder="Linear, Stripe, Notion…"
            value={service}
            onChange={(event) => {
              setService(event.target.value);
              // the prompt changed: nothing copied says it any more
              setCopied(null);
            }}
          />
        </Field>
        <Field>
          <div className="flex items-center justify-between gap-2">
            <FieldLabel>{mcpServer ? "3. " : ""}Paste this to your agent</FieldLabel>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => copy("prompt", prompt)}
            >
              {copied === "prompt" ? (
                <CheckIcon data-icon="inline-start" />
              ) : (
                <CopyIcon data-icon="inline-start" />
              )}
              {copied === "prompt" ? "Copied" : "Copy"}
            </Button>
          </div>
          <pre className="rounded-md bg-muted px-3 py-2 text-xs whitespace-pre-wrap">{prompt}</pre>
        </Field>
        {platformOrigin && (
          <p className="text-sm text-muted-foreground">
            The recipe your agent follows, for doing it by hand too:{" "}
            <a
              href={`${platformOrigin}/connect-a-service.md`}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
            >
              connect-a-service.md
            </a>
          </p>
        )}
      </FieldGroup>
    </div>
  );
}
