// /projects/<project>/ — the overview: the project, its role, its site — and, while the project's own
// creation runs, where it stands: the `project` facet's LIVE STATE on `/` (core/os/src/project/),
// rendered as a creation checklist until `project/created` lands, or as the failure the
// processor reported. The frame the project's own pages fill in over time. Its organization's owner
// deletes the project here (`session.projects.delete`). The config repo's remote is linked, pulled
// and pushed here too (`itx.repos.get("/repos/config")`: `origin`, `setOrigin`, `pull`, `push`).
import {
  type ComponentProps,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createFileRoute, getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { ArrowUpRight, CheckIcon, CircleXIcon, MoreHorizontalIcon } from "lucide-react";
import { z } from "zod";
import type { AuthenticatedApp } from "iterate/app";
import { errorCode } from "iterate/lib";
import { facetSnapshotOf, useContextStub, useFacetLiveState } from "iterate/react";
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
import { Badge } from "@iterate-com/ui/components/ui/badge";
import { Button, buttonVariants } from "@iterate-com/ui/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@iterate-com/ui/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@iterate-com/ui/components/ui/dropdown-menu";
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
import { Identifier } from "../../../../components/identifier.tsx";
import {
  reloadOrganizationTree,
  useOrganizationTree,
} from "../../../../components/organization-tree.tsx";
import { projectSiteOf } from "../../../../lib/origins.ts";

const shell = getRouteApi("/_auth");

/** The project facet's live state, the fields this page reads: where the project's own creation
 *  stands, as the offset of the event that says so (null until `project/create-requested` lands). */
const ProjectLive = z.looseObject({
  creation: z
    .object({ status: z.enum(["requested", "created", "failed"]), offset: z.number() })
    .nullable(),
  /** the catalog's repos, by path: the seeded config repo is the saga's first visible step */
  repos: z.record(z.string(), z.unknown()),
  /** the project's connections: its GitHub ones list the repositories the config repo can link to */
  integrations: z.record(
    z.string(),
    z.looseObject({ provider: z.string(), connection: z.string(), account: z.string() }),
  ),
  /** the hostname the project claimed as its primary, which its site's button opens */
  primaryHostname: z.string().nullable().catch(null),
});

export const Route = createFileRoute("/_auth/projects/$slug/")({
  validateSearch: z.object({
    /** The sheet that links the config repo to a remote. */
    configRepo: z.literal("link").optional().catch(undefined),
  }),
  // `useFacetLiveState`'s `initial`; a failed read leaves the page waiting on its subscription
  loader: ({ context }) =>
    context
      .read(async (api) => {
        using project = api.projects.get(context.project.id);
        return await facetSnapshotOf(project, "project");
      })
      .catch(() => undefined),
  component: ProjectOverview,
});

function ProjectOverview() {
  const { project } = Route.useRouteContext();
  const { api, info } = shell.useRouteContext();
  // its organization — the name and the person's role — from the tree
  const org = useOrganizationTree().organizations.find(
    (candidate) => candidate.id === project.orgId,
  );
  // the project's root context, held for the page's life; the route resolved the project already,
  // so a refusal leaves the plain overview
  const opened = useContextStub(() => api.projects.get(project.id), [api, project.id]);
  const context = opened.stub;
  const live = useFacetLiveState(context, "project", Route.useLoaderData());
  const parsed = ProjectLive.safeParse(live.value).data;
  const creation = parsed?.creation || null;
  // Until the facet's first value lands — the loader's snapshot or the subscription's — the page
  // cannot tell a project still being created from one that is done: `projects.create` answers
  // before its saga does. A refused context, or a live state that failed or does not parse, leaves
  // the plain overview.
  const creationKnown =
    Boolean(live.value) || live.status !== "connecting" || Boolean(opened.error);
  const creating = creation?.status === "requested" || creation?.status === "failed";
  const configRepoSeeded = Boolean(parsed?.repos["/repos/config"]);
  const githubConnections = Object.values(parsed?.integrations || {}).filter(
    (row) => row.provider === "github",
  );
  // the hostname the project claimed is unknown until its live state lands; meanwhile the ingress
  // URL serves, and a page visit there goes on to it (core/os primary-hostname-redirect.ts)
  const host = projectSiteOf(info, {
    id: project.id,
    slug: project.slug,
    primaryHostname: parsed?.primaryHostname || null,
  });
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-4 md:p-8">
      {creation?.status === "requested" ? (
        <ProjectCreationProgress configRepoSeeded={configRepoSeeded} />
      ) : null}
      {creation?.status === "failed" && context ? (
        <ProjectCreationFailed context={context} offset={creation.offset} />
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <h1 className="font-mono text-2xl font-semibold tracking-tight">{project.slug}</h1>
          {org?.role ? <Badge variant="secondary">{org.role}</Badge> : null}
        </div>
        {host ? (
          <a
            href={host}
            target="_blank"
            rel="noreferrer"
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            Open {new URL(host).host}
            <ArrowUpRight />
          </a>
        ) : null}
      </div>
      {/* the ids, copyable: the project's, and its organization's beside the name */}
      <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-muted-foreground">Project id</dt>
        <dd>
          <Identifier value={project.id} />
        </dd>
        <dt className="text-muted-foreground">Organization</dt>
        <dd className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {org ? <span>{org.name}</span> : null}
          <Identifier value={project.orgId} />
        </dd>
      </dl>
      {/* a project still being created, or whose creation failed, may have no config repo yet */}
      {creating ? null : creationKnown ? (
        <ConfigRepo key={project.id} project={project} githubConnections={githubConnections} />
      ) : (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
      {org?.role === "owner" ? <DeleteProject project={project} /> : null}
    </div>
  );
}

/** What the config repo's section is doing, one action at a time. */
type ConfigRepoAction = "link" | "pull" | "push" | "force-pull" | "force-push" | "unlink";

/** A remote as the page shows it (`describeOrigin`). */
type Remote = ReturnType<typeof describeOrigin>;

/** A choice the page waits on, with the remote it is about: after a pull or a push against it that
 *  was not a fast-forward (`diverged`, the sheet), or replacing iterate's main with it (`replace`,
 *  the confirm). Its actions use that remote, whatever origin is by then. */
type ConfigRepoChoice = { kind: "diverged" | "replace"; remote: Remote };

/** `ConfigRepo`'s one action at a time: busy while `work` runs, the origin read again after. */
type RunAction = (action: ConfigRepoAction, work: () => Promise<unknown>) => Promise<void>;

/** `ConfigRepo`'s pull or push of main against a remote's URL, forced or not. */
type SyncMain = (verb: "pull" | "push", url: string, force?: true) => Promise<void>;

/** The config repo's remote, git's `origin`, read again after every action, and its main pulled and
 *  pushed by hand. Every pull and push names the remote the page shows, so a link changed elsewhere
 *  since is never the one acted on, and a pending choice goes when a read finds origin changed. The
 *  sheet links it (`?configRepo=link`) or holds a diverged choice; replacing asks in a confirm. */
function ConfigRepo({
  project,
  githubConnections,
}: {
  project: { id: string; slug: string };
  githubConnections: { connection: string; account: string }[];
}) {
  const { api } = shell.useRouteContext();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [read, setRead] = useState<{ origin: string | null }>();
  const [busy, setBusy] = useState<ConfigRepoAction | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<ConfigRepoChoice | null>(null);
  const configRepo = useCallback(
    () => api.projects.get(project.id).repos.get("/repos/config"),
    [api, project.id],
  );
  /** Counts origin reads and actions: a read answers for the page only while no later read or
   *  action started, so one that answers late never overwrites what a later action did. */
  const originRequests = useRef(0);
  const readOrigin = useCallback(() => {
    const request = ++originRequests.current;
    return configRepo()
      .origin()
      .then(
        (origin) => {
          if (request !== originRequests.current) return;
          setRead({ origin });
          setChoice((pending) => (pending?.remote.url === origin ? pending : null));
        },
        (caught: unknown) => request === originRequests.current && setError(messageOf(caught)),
      );
  }, [configRepo]);
  useEffect(() => void readOrigin(), [readOrigin]);

  const remote = read?.origin ? describeOrigin(read.origin) : null;
  const linking = !choice && search.configRepo === "link";
  const diverged = choice?.kind === "diverged" ? choice.remote : null;
  /** Closes the sheet or the confirm, with the choice and the error it showed. */
  const dismiss = async () => {
    setChoice(null);
    setError(null);
    await navigate({ search: {}, replace: true });
  };
  /** Pull or push main against `url`: the outcome said and the sheet closed, or, when it is not a
   *  fast-forward (only an unforced one throws that), the sheet on the choice about that remote. */
  const sync: SyncMain = async (verb, url, force) => {
    try {
      const result = await configRepo()[verb]({ remote: url, force });
      setOutcome(
        result.status === "up-to-date"
          ? "Already up to date"
          : `${verb === "pull" ? "Pulled" : "Pushed"} ${(result.commitOid || "").slice(0, 7)}`,
      );
      await dismiss();
    } catch (caught) {
      if (errorCode(caught) !== "NOT_FAST_FORWARD") throw caught;
      setChoice({ kind: "diverged", remote: describeOrigin(url) });
    }
  };
  /** One action, busy while its own calls run. The origin read after it runs with the buttons
   *  enabled: the action's button, and its spinner, may be gone with the sheet by then. */
  const run: RunAction = async (action, work) => {
    originRequests.current += 1;
    setBusy(action);
    setError(null);
    setOutcome(null);
    await work().catch((caught: unknown) => setError(messageOf(caught)));
    setBusy(null);
    await readOrigin();
  };
  const link = (url: string) =>
    run("link", async () => {
      setRead(await configRepo().setOrigin(url));
      await sync("pull", url);
    });

  return (
    <section aria-labelledby="config-repo-heading" className="flex flex-col gap-3">
      <h2 id="config-repo-heading" className="text-lg font-semibold tracking-tight">
        Config repo
      </h2>
      {remote ? (
        <RemoteRow
          remote={remote}
          outcome={outcome}
          busy={busy}
          run={run}
          sync={sync}
          onReplace={() => setChoice({ kind: "replace", remote })}
          onUnlink={async () => setRead(await configRepo().setOrigin(null))}
        />
      ) : read ? (
        <div className="flex items-center justify-between gap-3 border-y py-3">
          <p className="text-sm text-muted-foreground">Not linked to a git remote</p>
          <Button type="button" onClick={() => void navigate({ search: { configRepo: "link" } })}>
            Link
          </Button>
        </div>
      ) : error ? null : (
        <Spinner />
      )}
      {choice || linking ? null : <Failure error={error} />}
      <ReplaceConfirm
        choice={choice}
        remote={remote}
        error={error}
        busy={busy}
        run={run}
        sync={sync}
        onDismiss={dismiss}
      />
      <ConfigRepoSheet
        project={project}
        githubConnections={githubConnections}
        linking={linking}
        diverged={diverged}
        error={error}
        busy={busy}
        run={run}
        sync={sync}
        onLink={link}
        onDismiss={dismiss}
      />
    </section>
  );
}

/** A button that runs one config repo action: disabled while any runs, its spinner while it does. */
function ActionButton({
  action,
  busy,
  run,
  work,
  variant = "outline",
  className,
  children,
}: {
  action: ConfigRepoAction;
  busy: ConfigRepoAction | null;
  run: RunAction;
  work: () => Promise<unknown>;
  variant?: ComponentProps<typeof Button>["variant"];
  className?: string;
  children: string;
}) {
  return (
    <Button
      type="button"
      variant={variant}
      className={className}
      disabled={Boolean(busy)}
      onClick={() => void run(action, work)}
    >
      {busy === action ? <Spinner data-icon="inline-start" /> : null}
      {children}
    </Button>
  );
}

/** The linked remote: where it is, what the last pull or push did, Pull and Push, and under More,
 *  Replace (a confirm) and Unlink. */
function RemoteRow({
  remote,
  outcome,
  busy,
  run,
  sync,
  onReplace,
  onUnlink,
}: {
  remote: Remote;
  outcome: string | null;
  busy: ConfigRepoAction | null;
  run: RunAction;
  sync: SyncMain;
  onReplace: () => void;
  onUnlink: () => Promise<unknown>;
}) {
  return (
    <div className="flex flex-col gap-3 border-y py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-0.5">
        <a
          href={remote.href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex max-w-full items-center gap-1 font-mono text-sm font-medium hover:underline"
        >
          <span className="break-all">{remote.label}</span>
          <ArrowUpRight aria-hidden="true" className="size-3.5 shrink-0" />
        </a>
        {outcome ? (
          <p role="status" className="text-sm text-muted-foreground">
            {outcome}
          </p>
        ) : null}
      </div>
      <div className="flex gap-2">
        <ActionButton
          action="pull"
          busy={busy}
          run={run}
          work={() => sync("pull", remote.url)}
          className="flex-1 sm:flex-none"
        >
          Pull
        </ActionButton>
        <ActionButton
          action="push"
          busy={busy}
          run={run}
          work={() => sync("push", remote.url)}
          className="flex-1 sm:flex-none"
        >
          Push
        </ActionButton>
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={Boolean(busy)}
            render={
              <Button type="button" variant="outline" size="icon" title="More" aria-label="More" />
            }
          >
            {busy === "unlink" ? <Spinner /> : <MoreHorizontalIcon aria-hidden="true" />}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto">
            <DropdownMenuItem onClick={onReplace}>
              Replace with {remote.name}&apos;s main…
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => void run("unlink", onUnlink)}>
              Unlink
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/** Replacing iterate's main with the remote's, behind a confirm: the commits only iterate has are
 *  dropped. */
function ReplaceConfirm({
  choice,
  remote,
  error,
  busy,
  run,
  sync,
  onDismiss,
}: {
  choice: ConfigRepoChoice | null;
  /** the remote origin is: what the title names while the confirm closes */
  remote: Remote | null;
  error: string | null;
  busy: ConfigRepoAction | null;
  run: RunAction;
  sync: SyncMain;
  onDismiss: () => Promise<void>;
}) {
  return (
    <AlertDialog
      open={choice?.kind === "replace"}
      onOpenChange={(open) => !open && !busy && void onDismiss()}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Replace iterate&apos;s main with {choice?.remote.name || remote?.name}&apos;s?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Commits only iterate has are dropped, and the project republishes.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Failure error={error} />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={Boolean(busy)}>Cancel</AlertDialogCancel>
          {choice ? (
            <ActionButton
              action="force-pull"
              busy={busy}
              run={run}
              work={() => sync("pull", choice.remote.url, true)}
              variant="destructive"
            >
              Replace
            </ActionButton>
          ) : null}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The config repo's sheet: linking it (`?configRepo=link`), or the choice a pull or a push left
 *  when the two mains have diverged. */
function ConfigRepoSheet({
  project,
  githubConnections,
  linking,
  diverged,
  error,
  busy,
  run,
  sync,
  onLink,
  onDismiss,
}: {
  project: { id: string; slug: string };
  githubConnections: { connection: string; account: string }[];
  linking: boolean;
  diverged: Remote | null;
  error: string | null;
  busy: ConfigRepoAction | null;
  run: RunAction;
  sync: SyncMain;
  onLink: (url: string) => Promise<void>;
  onDismiss: () => Promise<void>;
}) {
  const firstField = useRef<HTMLInputElement>(null);
  return (
    <Sheet
      open={Boolean(diverged) || linking}
      onOpenChange={(open) => !open && !busy && void onDismiss()}
    >
      <SheetContent
        side="right"
        showCloseButton={!busy}
        initialFocus={linking ? firstField : undefined}
        className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-md"
      >
        {diverged ? (
          <DivergedChoice diverged={diverged} error={error} busy={busy} run={run} sync={sync} />
        ) : linking ? (
          <LinkForm
            project={project}
            githubConnections={githubConnections}
            error={error}
            busy={busy}
            urlField={firstField}
            onLink={onLink}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** Linking the config repo: a repository of one of the project's GitHub connections, picked, or any
 *  git URL over https, typed. The field keeps what was typed when the link fails. */
function LinkForm({
  project,
  githubConnections,
  error,
  busy,
  urlField,
  onLink,
}: {
  project: { id: string; slug: string };
  githubConnections: { connection: string; account: string }[];
  error: string | null;
  busy: ConfigRepoAction | null;
  /** the sheet's first field, focused as it opens */
  urlField: RefObject<HTMLInputElement | null>;
  onLink: (url: string) => Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const githubListed = githubConnections.length > 0;
  return (
    <form className="flex h-full flex-col" action={() => void onLink(url.trim())}>
      <SheetHeader className="border-b">
        <SheetTitle>Link config repo</SheetTitle>
      </SheetHeader>
      <FieldGroup className="flex-1 p-4">
        {githubConnections.map((row) => (
          <GithubRepositories
            key={row.connection}
            projectId={project.id}
            connection={row.connection}
            account={row.account}
            disabled={Boolean(busy)}
            onPick={onLink}
          />
        ))}
        <Field>
          <FieldLabel htmlFor="config-repo-url">
            {githubListed ? "Or any git URL" : "Git URL"}
          </FieldLabel>
          <Input
            id="config-repo-url"
            ref={urlField}
            type="url"
            required
            pattern="https://[^@]+"
            title="An https:// URL with no credentials in it"
            placeholder="https://github.com/acme/site.git"
            className="font-mono"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
          <FieldDescription>
            Public, over https.
            {githubListed ? null : (
              <>
                {" "}
                For a private repo, connect GitHub on{" "}
                <Link to="/projects/$slug/integrations" params={{ slug: project.slug }}>
                  Integrations
                </Link>
                .
              </>
            )}
          </FieldDescription>
        </Field>
        <Failure error={error} />
      </FieldGroup>
      <SheetFooter className="border-t sm:flex-row sm:justify-end">
        <SheetClose disabled={Boolean(busy)} render={<Button type="button" variant="outline" />}>
          Cancel
        </SheetClose>
        <Button type="submit" disabled={Boolean(busy)}>
          {busy === "link" ? <Spinner data-icon="inline-start" /> : null}
          Link
        </Button>
      </SheetFooter>
    </form>
  );
}

/** The choice a pull or a push against `diverged` left, the two mains having diverged: keep the
 *  remote's, or iterate's. */
function DivergedChoice({
  diverged,
  error,
  busy,
  run,
  sync,
}: {
  diverged: Remote;
  error: string | null;
  busy: ConfigRepoAction | null;
  run: RunAction;
  sync: SyncMain;
}) {
  return (
    <div className="flex h-full flex-col">
      <SheetHeader className="border-b">
        <SheetTitle>{`${diverged.name}'s main and iterate's have diverged`}</SheetTitle>
        <SheetDescription>Each has commits the other doesn&apos;t. Keep one.</SheetDescription>
      </SheetHeader>
      <FieldGroup className="flex-1 p-4">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <ActionButton
              action="force-pull"
              busy={busy}
              run={run}
              work={() => sync("pull", diverged.url, true)}
              variant="destructive"
            >
              {`Keep ${diverged.name}'s`}
            </ActionButton>
            <p className="text-sm text-muted-foreground">
              iterate&apos;s main becomes {diverged.name}&apos;s, and the project republishes.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <ActionButton
              action="force-push"
              busy={busy}
              run={run}
              work={() => sync("push", diverged.url, true)}
              variant="destructive"
            >
              Keep iterate&apos;s
            </ActionButton>
            <p className="text-sm text-muted-foreground">
              {diverged.name}&apos;s main is overwritten with iterate&apos;s.
            </p>
          </div>
        </div>
        <Failure error={error} />
      </FieldGroup>
      <SheetFooter className="border-t sm:flex-row sm:justify-end">
        <SheetClose disabled={Boolean(busy)} render={<Button type="button" variant="outline" />}>
          Cancel
        </SheetClose>
      </SheetFooter>
    </div>
  );
}

/** An origin for the page: its URL as stored, the remote's name, and how it shows and links. A
 *  GitHub repository shows as `owner/repo`, any other remote as its URL. Either way without the
 *  userinfo, where a secret's placeholder sits (unencoded, it holds slashes, so the host starts after
 *  the last `@`). */
function describeOrigin(url: string) {
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(url)?.[0] ?? "";
  const rest = url.slice(scheme.length);
  const bare = scheme + rest.slice(rest.lastIndexOf("@") + 1);
  const parsed = URL.parse(bare);
  const github =
    parsed?.host === "github.com"
      ? /^\/([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(parsed.pathname)?.[1]
      : null;
  return github
    ? { url, name: "GitHub", label: github, href: `https://github.com/${github}` }
    : { url, name: parsed?.host || "the remote", label: bare, href: bare };
}

/** An error's words for the page, with any secret placeholder (`getSecret(…)`) cut out. */
function messageOf(caught: unknown) {
  return (caught instanceof Error ? caught.message : String(caught)).replace(
    /getSecret\([^)]*\)?/g,
    "…",
  );
}

/** A failure's words, marked for the specs' ui-error-reporter. */
function Failure({ error }: { error?: string | null }) {
  return error ? (
    <p role="alert" data-type="error" className="text-sm text-destructive">
      {error}
    </p>
  ) : null;
}

/** GitHub's page of an installation's repositories, the one field read. */
const InstallationRepositories = z.object({
  repositories: z.array(z.object({ full_name: z.string() })),
});

/** One GitHub connection's repositories, every page, listed through the project's egress
 *  with the connection's token as its placeholder. A pick links over the same placeholder, so the
 *  origin never holds the token. */
function GithubRepositories({
  projectId,
  connection,
  account,
  disabled,
  onPick,
}: {
  projectId: string;
  connection: string;
  account: string;
  disabled: boolean;
  onPick: (url: string) => Promise<void>;
}) {
  const { api } = shell.useRouteContext();
  const [listed, setListed] = useState<{ names: string[]; error?: string }>();
  const token = `getSecret("/secrets/github-${connection}", { field: "accessToken" })`;
  useEffect(() => {
    const list = async () => {
      const names: string[] = [];
      for (let page = 1; ; page += 1) {
        const url = `https://api.github.com/installation/repositories?per_page=100&page=${page}`;
        const response = await api.projects.get(projectId).fetch(
          new Request(url, {
            headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}` },
          }),
        );
        // the status alone: a failed egress's body can quote the placeholder
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(`Couldn't list ${account}'s repositories (HTTP ${response.status})`);
        }
        const { repositories } = InstallationRepositories.parse(await response.json());
        names.push(...repositories.map((repository) => repository.full_name));
        if (repositories.length < 100) return names;
      }
    };
    // an answer for the connection or the project the row no longer shows changes nothing
    let current = true;
    list()
      .then((names) => {
        if (current) setListed({ names });
      })
      .catch((caught: unknown) => {
        if (current) setListed({ names: [], error: messageOf(caught) });
      });
    return () => {
      current = false;
    };
  }, [api, projectId, token, account]);
  return (
    <div className="flex flex-col gap-2">
      <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {account} on GitHub
        {listed ? null : <Spinner className="size-3" />}
      </span>
      <Failure error={listed?.error} />
      <ul className="flex flex-col divide-y" aria-label={`${account}'s repositories`}>
        {listed?.names.map((name) => (
          <li key={name} className="flex items-center justify-between gap-2 py-2">
            <span className="min-w-0 font-mono text-sm break-all">{name}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              aria-label={`Link ${name}`}
              onClick={() => void onPick(`https://x-access-token:${token}@github.com/${name}.git`)}
            >
              Link
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Its organization's owner deletes the project: the verb answers once its row is gone, and the
 *  tree, read again, drops it from the list; its contexts and storage go after, on the project's
 *  own deletion saga. */
function DeleteProject({ project }: { project: { id: string; slug: string } }) {
  const { api } = shell.useRouteContext();
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    setError(null);
    setDeleting(true);
    try {
      await api.projects.delete(project.id);
      await reloadOrganizationTree();
      await navigate({ to: "/projects", replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setDeleting(false);
    }
  };
  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle>Delete project</CardTitle>
        <CardDescription>
          Deletes the project, its site, custom hostnames, repositories, files and every agent and
          context in it. There is no undo.
        </CardDescription>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-3">
        <AlertDialog>
          <AlertDialogTrigger render={<Button variant="destructive" />} disabled={deleting}>
            {deleting ? <Spinner data-icon="inline-start" /> : null}
            Delete project
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {project.slug}?</AlertDialogTitle>
              <AlertDialogDescription>
                The project and everything in it go. There is no undo.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => void remove()}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {error ? (
          <p role="alert" data-type="error" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </CardFooter>
    </Card>
  );
}

/** The creation checklist: the request is in (the directory row and `project/create-requested` —
 *  this page exists because it is) and the certificate is what the project processor owes; the live
 *  state swaps this out the moment it lands. */
function ProjectCreationProgress({ configRepoSeeded }: { configRepoSeeded: boolean }) {
  const steps = [
    { key: "registered", label: "Registering project", done: true },
    { key: "repo", label: "Seeding the config repository", done: configRepoSeeded },
    { key: "created", label: "Publishing the homepage", done: false },
  ];
  return (
    <section className="rounded-lg border bg-card p-6" data-testid="project-creation-progress">
      <h2 className="text-lg font-semibold">Creating your project</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Setting everything up — this page updates live as each step lands.
      </p>
      <ol className="mt-5 space-y-3">
        {steps.map((step) => (
          <li
            key={step.key}
            className="flex items-center gap-3 text-sm"
            data-testid={`creation-step-${step.key}`}
            data-done={step.done ? "true" : undefined}
          >
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full border",
                step.done
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-muted-foreground/30 text-muted-foreground",
              )}
            >
              {step.done ? <CheckIcon aria-hidden="true" className="size-4" /> : <Spinner />}
            </span>
            <span className={step.done ? "text-foreground" : "text-muted-foreground"}>
              {step.label}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The project's root context as the page holds it: `api.projects.get(id)`, a capnweb stub. */
type ProjectContext = Awaited<ReturnType<AuthenticatedApp["api"]["projects"]["get"]>>;

/** The failure the project processor reported: the state keeps the OFFSET of `project/create-failed`
 *  on `/`, the event itself the words — read here, one row. */
function ProjectCreationFailed({ context, offset }: { context: ProjectContext; offset: number }) {
  const [error, setError] = useState<string>();
  useEffect(() => {
    let disposed = false;
    // `readEvents(after, limit)` answers the rows past `after`: the failure's own, first
    context
      .readEvents(offset - 1, 1)
      .then((page) => {
        if (disposed) return;
        const read = z.object({ error: z.string() }).safeParse(page.events[0]?.payload);
        setError(read.data?.error || "The failure's event could not be read.");
      })
      .catch(
        (caught: unknown) =>
          !disposed && setError(caught instanceof Error ? caught.message : String(caught)),
      );
    return () => {
      disposed = true;
    };
  }, [context, offset]);
  return (
    <section
      className="rounded-lg border border-destructive/40 bg-card p-6"
      data-testid="project-creation-failed"
    >
      <div className="flex items-center gap-2 text-destructive">
        <CircleXIcon aria-hidden="true" className="size-5" />
        <h2 className="text-lg font-semibold">Project creation failed</h2>
      </div>
      <p data-type="error" className="mt-3 text-sm text-muted-foreground">
        {error || "Reading what went wrong…"}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        Try again — creating the project once more from the projects page is a new attempt; the
        project's log keeps the whole trail.
      </p>
    </section>
  );
}
