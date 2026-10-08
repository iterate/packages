// /sessions: every grant the signed-in user holds (browsers and connected apps, which are OAuth
// grants; personal access tokens and devices' keys), each endable on its own, and the one place in
// the Dash a personal access token is minted, in the New token sheet (`?token=1`): a name, the
// projects it may reach and when it expires → `api.grants.mint` → the key, shown ONCE in the sheet
// (the account keeps only its hash). The list is one page
// of `grants.list(cursor)` — the route's loader, `?cursor=` in the URL; a mint or an end
// invalidates the router, which reloads it. "Connected accounts" are the person's own connections
// (the `account` facet's live `integrations` on `session.user`): a sign-in with Google, Cloudflare or
// GitHub keeps one, and so does connecting Google or Cloudflare here, or
// GitHub, which adds it as a sign-in to the account (`?error=` when the issuer refused). A project
// uses one when its Integrations page connects it there; disconnecting one here ends every
// project's use of it.
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useRef, useState, type FormEvent } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { z } from "zod";
import { cn } from "cn";
import {
  INTEGRATION_PROVIDER_NAMES,
  INTEGRATION_PROVIDERS,
  type GrantKind,
  type GrantRecord,
} from "iterate/api";
import { Avatar, AvatarFallback, AvatarImage } from "@iterate-com/ui/components/ui/avatar";
import { Button, buttonVariants } from "@iterate-com/ui/components/ui/button";
import { Checkbox } from "@iterate-com/ui/components/ui/checkbox";
import { Input } from "@iterate-com/ui/components/ui/input";
import { Label } from "@iterate-com/ui/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@iterate-com/ui/components/ui/native-select";
import { NotRecorded } from "@iterate-com/ui/components/not-recorded";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@iterate-com/ui/components/ui/sheet";
import { Spinner } from "@iterate-com/ui/components/ui/spinner";
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
import { ConnectButton } from "@iterate-com/ui/components/connect-button";
import { facetSnapshotOf, useContextStub, useFacetLiveState } from "iterate/react";
import { Identifier } from "../../components/identifier.tsx";
import { addGithubSignInHref } from "../../lib/origins.ts";
import { dateOf } from "../../lib/dates.ts";
import { AllowAccount } from "../../components/allow-account.tsx";

const GRANT_KIND_LABELS: Record<GrantKind, string> = {
  pending: "Pending sign-in",
  device: "Device",
  personal: "Personal access token",
  session: "Session",
};

export const Route = createFileRoute("/_auth/sessions")({
  validateSearch: z.object({
    cursor: z.string().optional().catch(undefined),
    /** The New token sheet. */
    token: z.literal(1).optional().catch(undefined),
    /** Why the issuer refused to add a sign-in (core/os identity.ts, "ADD A SIGN-IN"). */
    error: z.string().optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ cursor: search.cursor }),
  staticData: { page: "Sessions" },
  // `account` is optional at consent: without it there is no list to load — the page offers the
  // step-up instead of the error the API would answer with. The person's account state comes with
  // it, as `useFacetLiveState`'s `initial`.
  loader: async ({ context, deps }) => {
    if (!context.info.scopes.includes("account")) return null;
    const [page, account] = await context.read((api) =>
      Promise.all([
        api.grants.list(deps.cursor),
        facetSnapshotOf(api.user, "account").catch(() => undefined),
      ]),
    );
    return { ...page, account };
  },
  head: () => ({ meta: [{ title: "Sessions · Dash" }] }),
  component: SessionsPage,
});

/** How long a new key lives, in days; `never` mints one that ends only when it is revoked. */
const TOKEN_LIFETIMES = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "never", label: "No expiry" },
];

/** A session row's details on two lines: what it is (its kind, host and projects), then when (since,
 *  last used, expiry). */
function metaOf(item: GrantRecord, slugOf: Map<string, string>) {
  const what = [
    item.resource === "mcp"
      ? `${GRANT_KIND_LABELS[item.kind]} (MCP)`
      : GRANT_KIND_LABELS[item.kind],
    item.clientDomain,
    item.projects?.map((id) => slugOf.get(id) ?? id).join(", "),
  ];
  const when = [
    `Since ${dateOf(item.createdAt)}`,
    item.lastUsedAt ? `used ${dateOf(item.lastUsedAt)}` : "not used yet",
    item.expired ? "expired" : item.expiresAt ? `expires ${dateOf(item.expiresAt)}` : undefined,
  ];
  return [what, when].map((line) => line.filter((part): part is string => Boolean(part)));
}

/** A personal access token as the form just minted it — held only in the sheet's state, shown
 *  once; a reload forgets it, as the server already has. */
type MintedPersonalAccessToken = { name: string; token: string; expiresAt: number | null };

function SessionsPage() {
  const data = Route.useLoaderData();
  const { info } = Route.useRouteContext();
  if (!data)
    return (
      <AllowAccount
        title="Sessions"
        next="/sessions"
        description="This session may not manage your sessions and personal access tokens."
        action="Allow the dash to manage them"
      />
    );
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-4 md:p-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Sessions</h1>
        {/* whose: the address and the person's id, copyable */}
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {info.principal.email ? <span>{info.principal.email}</span> : null}
          <Identifier value={info.principal.actor} textClassName="text-xs" />
        </p>
      </div>
      <SessionList
        items={data.items}
        nextCursor={data.cursor}
        projects={data.projects}
        canMintToken={data.canMintToken}
      />
      <ConnectedAccounts projects={data.projects} />
      <TokenSheet projects={data.projects} canMintToken={data.canMintToken} />
    </div>
  );
}

/** The loader's page of grants, this browser's first, each ended on its own, and the links to the
 *  first page and the next. */
function SessionList({
  items,
  nextCursor,
  projects,
  canMintToken,
}: {
  items: GrantRecord[];
  nextCursor: string | undefined;
  projects: { id: string; slug: string }[];
  canMintToken: boolean;
}) {
  const { cursor } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { api } = Route.useRouteContext();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  // Ending THIS browser's grant is a sign-out: the app's own logout clears the session and its
  // cookie too (a bare redirect to `/` would bounce a still-cached token back into /projects).
  const logout = useRef<HTMLFormElement>(null);
  const slugOf = new Map(projects.map((project) => [project.id, project.slug]));
  return (
    <>
      <form ref={logout} method="post" action="/.auth/logout" hidden />
      {error && (
        <p role="alert" data-type="error" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <section className="flex flex-col gap-2" aria-labelledby="sessions-heading">
        <div className="flex items-center justify-between gap-3">
          <h2 id="sessions-heading" className="font-medium">
            Signed in
          </h2>
          {canMintToken ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void navigate({ search: { cursor, token: 1 } })}
            >
              New token
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">Tokens need an HTTPS deployment</span>
          )}
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing on this page.</p>
        ) : (
          <ul className="flex flex-col divide-y border-y" aria-label="Sessions">
            {[...items]
              // this browser first, then by last use, newest first (a page of the list, as listed)
              .sort(
                (a, b) =>
                  Number(Boolean(b.current)) - Number(Boolean(a.current)) ||
                  (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0) ||
                  b.createdAt - a.createdAt,
              )
              .map((item) => (
                <li key={item.id} className="flex items-center gap-3 py-3">
                  <Avatar className="rounded-md after:rounded-md" aria-hidden="true">
                    {/* Base UI sets the referrer policy on its preloader and on the image it shows */}
                    <AvatarImage
                      src={item.logoUri}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="rounded-md object-contain"
                    />
                    <AvatarFallback className="rounded-md text-xs">
                      {item.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium [overflow-wrap:anywhere]">
                      {item.name}
                      {item.current && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          This browser
                        </span>
                      )}
                    </p>
                    {metaOf(item, slugOf).map((line, lineIndex) => (
                      <p key={line[0]} className="text-xs text-muted-foreground">
                        {line.map((part, index) => (
                          <span key={part}>
                            {index > 0 ? " · " : ""}
                            {/* a host may break anywhere; a date stays whole */}
                            <span
                              className={
                                lineIndex === 0 ? "[overflow-wrap:anywhere]" : "whitespace-nowrap"
                              }
                            >
                              {part}
                            </span>
                          </span>
                        ))}
                      </p>
                    ))}
                    {item.impersonatedBy && (
                      <p className="text-xs text-muted-foreground">
                        Started by {item.impersonatedBy}, signed in as you
                      </p>
                    )}
                    {item.mintedBy && (
                      <p className="text-xs text-muted-foreground">
                        Made by{" "}
                        {items.find((session) => session.id === item.mintedBy)?.name ??
                          "a session no longer listed"}
                      </p>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      setError(null);
                      try {
                        await api.grants.end(item.id);
                        if (item.current) logout.current?.requestSubmit();
                        else await router.invalidate();
                      } catch (caught) {
                        setError(caught instanceof Error ? caught.message : String(caught));
                      }
                    }}
                  >
                    {item.expired
                      ? "Remove"
                      : item.kind === "personal" || item.kind === "device"
                        ? "Revoke"
                        : "Log out"}
                  </Button>
                </li>
              ))}
          </ul>
        )}
        {(cursor || nextCursor) && (
          <p className="flex gap-3 text-sm">
            {cursor && (
              <Link to="/sessions" search={{}} className="underline-offset-4 hover:underline">
                First page
              </Link>
            )}
            {nextCursor && (
              <Link
                to="/sessions"
                search={{ cursor: nextCursor }}
                className="underline-offset-4 hover:underline"
              >
                Next page
              </Link>
            )}
          </p>
        )}
      </section>
    </>
  );
}

/** The New token sheet (`?token=1`), on a deployment that mints them. It cannot be closed while a
 *  key is being minted. */
function TokenSheet({
  projects,
  canMintToken,
}: {
  projects: { id: string; slug: string }[];
  canMintToken: boolean;
}) {
  const { cursor, token: tokenSheet } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [minting, setMinting] = useState(false);
  const close = () => {
    if (minting) return;
    void navigate({ search: { cursor }, replace: true });
  };
  return (
    <Sheet open={Boolean(tokenSheet && canMintToken)} onOpenChange={(open) => !open && close()}>
      <SheetContent
        side="right"
        showCloseButton={!minting}
        className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-md"
      >
        <NewToken projects={projects} minting={minting} setMinting={setMinting} onDone={close} />
      </SheetContent>
    </Sheet>
  );
}

/** The New token sheet's body: a name, the projects the key may reach and when it expires, then
 *  the key. Mounted with the sheet, so every opening starts blank and a minted key goes with the
 *  sheet however it closes (Back included). */
function NewToken({
  projects,
  minting,
  setMinting,
  onDone,
}: {
  projects: { id: string; slug: string }[];
  minting: boolean;
  setMinting: (minting: boolean) => void;
  onDone: () => void;
}) {
  const { api } = Route.useRouteContext();
  const router = useRouter();
  const [tokenName, setTokenName] = useState("");
  const [tokenLifetime, setTokenLifetime] = useState("30");
  const [excludedProjectIds, setExcludedProjectIds] = useState<Set<string>>(new Set());
  const [minted, setMinted] = useState<MintedPersonalAccessToken | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedProjectIds = projects
    .filter((project) => !excludedProjectIds.has(project.id))
    .map((project) => project.id);
  const mint = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = tokenName.trim();
    setError(null);
    setMinting(true);
    try {
      const { token, expiresAt } = await api.grants.mint({
        name,
        projects: selectedProjectIds,
        expiresAt:
          tokenLifetime === "never"
            ? undefined
            : Date.now() + Number(tokenLifetime) * 24 * 3600_000,
      });
      // a key whose sheet closed while it was minted is never shown (it is listed, to revoke)
      if (router.state.location.search.token) setMinted({ name, token, expiresAt });
      setTokenName("");
      await router.invalidate({ sync: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setMinting(false);
    }
  };
  if (minted) return <MintedToken minted={minted} onDone={onDone} />;
  return (
    <form onSubmit={mint} className="flex h-full flex-col">
      <SheetHeader>
        <SheetTitle>New token</SheetTitle>
        <SheetDescription>
          Acts as you on the projects you pick. Send it as <code>Authorization: Bearer</code>.
        </SheetDescription>
      </SheetHeader>
      <div className="flex flex-1 flex-col gap-4 px-4 pb-4">
        <Label className="flex flex-col items-start gap-2">
          Name
          <Input
            aria-label="Token name"
            value={tokenName}
            onChange={(event) => setTokenName(event.target.value)}
            maxLength={100}
            placeholder="My script"
            required
          />
        </Label>
        <Label className="flex flex-col items-start gap-2">
          Expires
          <NativeSelect
            aria-label="Token expiry"
            value={tokenLifetime}
            disabled={minting}
            onChange={(event) => setTokenLifetime(event.target.value)}
          >
            {TOKEN_LIFETIMES.map((lifetime) => (
              <NativeSelectOption key={lifetime.value} value={lifetime.value}>
                {lifetime.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Label>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">Projects</legend>
          {projects.length > 0 ? (
            projects.map((project) => (
              <Label key={project.id} className="gap-2 font-mono font-normal">
                <Checkbox
                  checked={!excludedProjectIds.has(project.id)}
                  disabled={minting}
                  onCheckedChange={(checked) => {
                    setExcludedProjectIds((current) => {
                      const next = new Set(current);
                      if (checked) next.delete(project.id);
                      else next.add(project.id);
                      return next;
                    });
                  }}
                />
                {project.slug}
              </Label>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">Create a project first.</p>
          )}
        </fieldset>
        {error && (
          <p role="alert" data-type="error" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <SheetFooter className="border-t sm:flex-row sm:justify-end">
        <Button
          type="submit"
          disabled={minting || selectedProjectIds.length === 0 || tokenName.trim().length === 0}
        >
          {minting ? <Spinner data-icon="inline-start" /> : null}
          Create token
        </Button>
      </SheetFooter>
    </form>
  );
}

/** The key just minted, shown this once: the account keeps only its hash. Never in a session replay
 *  or autocapture. */
function MintedToken({
  minted,
  onDone,
}: {
  minted: MintedPersonalAccessToken;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(minted.token);
      setCopied(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };
  return (
    <NotRecorded role="status" data-testid="minted" className="flex h-full flex-col">
      <SheetHeader>
        <SheetTitle>{minted.name}</SheetTitle>
        <SheetDescription>
          Copy it now: it isn't shown again.{" "}
          {minted.expiresAt ? `Expires ${dateOf(minted.expiresAt)}.` : "No expiry."}
        </SheetDescription>
      </SheetHeader>
      <div className="flex items-start gap-2 px-4">
        <code
          data-testid="minted-token"
          className="min-w-0 flex-1 rounded-md bg-muted px-2 py-1.5 text-xs break-all"
        >
          {minted.token}
        </code>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          title={copied ? "Copied" : "Copy token"}
          onClick={copy}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </Button>
      </div>
      {error && (
        <p role="alert" data-type="error" className="px-4 text-sm text-destructive">
          {error}
        </p>
      )}
      <SheetFooter className="border-t sm:flex-row sm:justify-end">
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </SheetFooter>
    </NotRecorded>
  );
}

/** The providers a person connects on their own account here (GitHub comes from signing in). */
const PERSONAL_CONNECT_PROVIDERS: ("google" | "cloudflare" | "x")[] = ["google", "cloudflare", "x"];

const AccountConnections = z.looseObject({
  integrations: z.record(
    z.string(),
    z.object({
      provider: z.enum(INTEGRATION_PROVIDERS),
      connection: z.string(),
      account: z.string(),
    }),
  ),
  /** The account's secrets, with the projects each one's connection is connected to (its lends). */
  secrets: z.record(
    z.string(),
    z.looseObject({ lends: z.record(z.string(), z.object({ to: z.string() })).optional() }),
  ),
});

/** One of the person's connections: its provider and name, which together name it. */
function connectionKeyOf(row: { provider: string; connection: string }) {
  return `${row.provider}/${row.connection}`;
}

/** THE PERSON'S ACCOUNT FACET, live and parsed: the loader's snapshot shows while the subscription
 *  connects (`seeding`); a stub that failed to open leaves its subscription connecting for good, so
 *  it fails the view too. */
function useAccountView(
  api: ReturnType<typeof Route.useRouteContext>["api"],
  initial: Parameters<typeof useFacetLiveState>[2],
) {
  const opened = useContextStub(() => Promise.resolve(api.user), [api]);
  const live = useFacetLiveState(opened.stub, "account", initial);
  const read = live.value ? AccountConnections.safeParse(live.value) : undefined;
  return {
    value: live.value,
    state: read?.data,
    error: opened.error || live.error || (read?.error ? z.prettifyError(read.error) : null),
    failed: Boolean(opened.error) || live.status === "error",
    seeding: live.status === "connecting" && Boolean(live.value),
  };
}

/** THE PERSON'S CONNECTED ACCOUNTS: listed live with the projects using each, disconnected (every
 *  project's use ends with it), or connected here (`ConnectAccounts`). */
function ConnectedAccounts({ projects }: { projects: { id: string; slug: string }[] }) {
  const { api } = Route.useRouteContext();
  const person = useAccountView(api, Route.useLoaderData()?.account);
  const accounts = Object.values(person.state?.integrations || {});
  const slugOf = new Map(projects.map((project) => [project.id, project.slug]));
  /** The projects a connection is connected to, by slug. */
  const usedBy = (row: { provider: string; connection: string }) =>
    Object.values(
      person.state?.secrets[`/secrets/${row.provider}-${row.connection}`]?.lends ?? {},
    ).map((lend) => slugOf.get(lend.to) || lend.to);
  const [error, setError] = useState<string | null>(null);
  /** The connection whose Disconnect runs (`connectionKeyOf`). */
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  // Disconnect stays busy until the account's live state drops the row, or fails: the call can
  // answer before the live state drops the row, and a spinner that ends first flashes the row back.
  // State adjusted while rendering (react.dev, "You Might Not Need an Effect"): the spinner goes in
  // the same render that drops the row, never a commit later.
  const disconnectingListed = accounts.some((row) => disconnecting === connectionKeyOf(row));
  if (disconnecting && (!disconnectingListed || person.failed)) setDisconnecting(null);
  const { error: addError } = Route.useSearch();
  return (
    <section className="flex flex-col gap-2" aria-labelledby="connected-accounts-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="connected-accounts-heading" className="flex items-center gap-2 font-medium">
          Connected accounts
          {person.seeding ? <Spinner /> : null}
        </h2>
        <ConnectAccounts
          githubListed={
            person.state ? accounts.some((row) => row.provider === "github") : undefined
          }
          onError={setError}
        />
      </div>
      {(error || addError) && (
        <p role="alert" data-type="error" className="text-sm text-destructive">
          {error || addError}
        </p>
      )}
      {person.error ? (
        <p role="alert" data-type="error" className="text-sm text-destructive">
          Couldn't load your connected accounts: {person.error}
        </p>
      ) : !person.value ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading…
        </p>
      ) : accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">None yet.</p>
      ) : (
        <ul className="flex flex-col divide-y border-y" aria-label="Connected accounts">
          {accounts.map((row) => {
            const projectsUsing = usedBy(row);
            const rowDisconnecting = disconnecting === connectionKeyOf(row);
            return (
              <li key={connectionKeyOf(row)} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium [overflow-wrap:anywhere]">{row.account}</p>
                  <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    {INTEGRATION_PROVIDER_NAMES[row.provider]}
                    {projectsUsing.length > 0 && ` · Used by ${projectsUsing.join(", ")}`}
                  </p>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger
                    render={<Button variant="ghost" size="sm" />}
                    aria-label={`Disconnect ${row.account}`}
                    disabled={Boolean(disconnecting)}
                  >
                    {rowDisconnecting ? <Spinner data-icon="inline-start" /> : null}
                    Disconnect
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Disconnect {row.account}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        {projectsUsing.length > 0
                          ? `${projectsUsing.join(", ")} ${projectsUsing.length === 1 ? "stops" : "stop"} using it, and its token is deleted.`
                          : "Its token is deleted."}{" "}
                        Sign in with it or connect it again to get it back.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      {/* the dialog stays open until the row goes, so the spinner is here too */}
                      <AlertDialogAction
                        variant="destructive"
                        disabled={rowDisconnecting}
                        onClick={async () => {
                          setError(null);
                          setDisconnecting(connectionKeyOf(row));
                          try {
                            await api.user.integrations.disconnect(row.provider, row.connection);
                          } catch (caught) {
                            setError(caught instanceof Error ? caught.message : String(caught));
                            setDisconnecting(null);
                          }
                        }}
                      >
                        {rowDisconnecting ? <Spinner data-icon="inline-start" /> : null}
                        Disconnect
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Connecting one more account of the person's own: Google, Cloudflare or X through iterate's app,
 *  and GitHub as a sign-in added to their account, until they have one (`githubListed` is unknown
 *  until their account state has loaded). Both come back to this page. */
function ConnectAccounts({
  githubListed,
  onError,
}: {
  githubListed: boolean | undefined;
  onError: (error: string) => void;
}) {
  const { api, info } = Route.useRouteContext();
  const router = useRouter();
  const next = new URL(
    router.buildLocation({ to: "/sessions", search: {} }).publicHref,
    router.origin,
  ).href;
  const iterateApps = new Set(info.iterateAppProviders);
  const addGithub =
    githubListed === false && info.signInProviders.includes("github")
      ? addGithubSignInHref(info, next)
      : null;
  return (
    <div className="flex flex-wrap gap-2">
      {PERSONAL_CONNECT_PROVIDERS.filter((provider) => iterateApps.has(provider)).map(
        (provider) => (
          <ConnectButton
            key={provider}
            provider={provider}
            variant="outline"
            size="sm"
            connect={async (input) =>
              z
                .object({ authorizationUrl: z.string().url() })
                .parse(await api.user.integrations.connect(input.provider, { next }))
            }
            onError={(caught) => onError(caught instanceof Error ? caught.message : String(caught))}
          >
            Connect {INTEGRATION_PROVIDER_NAMES[provider]}
          </ConnectButton>
        ),
      )}
      {addGithub && (
        <a href={addGithub} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Connect GitHub
        </a>
      )}
    </div>
  );
}
