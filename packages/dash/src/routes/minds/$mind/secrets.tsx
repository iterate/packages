// /minds/<address>/secrets — the mind's secrets as `itx.secrets.list()` shows them: each one's
// path, the origins it may be sent to, its refresh strategy's kind, when it was first set and its
// public fields (an OAuth client's ID: no secret) — never a secret value — with an update and a
// delete per row. Setting one is a SHEET (the dash's form shape, like
// the repos' New repo), opened by "New secret" (`?new=1`) or a row's Update (`?update=<name>`),
// so either is a deep link: a name (the path `/secrets/<name>` an outbound request's
// `getSecret("/secrets/<name>")` placeholder spells), a value (a string, or a JSON object whose
// fields the placeholder's `{ field }` picks) and the origins the value may be sent to. Update is
// the same sheet on an existing row: the name locked, the pin pre-filled, the value pasted again —
// the current one is never shown, and a pin only ever enters together with the value it guards (the
// platform has no verb that changes a pin alone). The list is the route's loader; a set or a delete
// invalidates the router, which reloads it. A mind that does not serve `itx.secrets` yet gets
// one line that says so (lib/served.ts).
// `?new=1&name=<name>&urls=<origins>` opens New secret with the name and the origins filled, so a
// person types only the value: the installer's wizard links here. The value never comes from the URL.

import { useRef, useState, type FormEvent, type RefObject } from "react";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { z } from "zod";
import type { AuthenticatedApp } from "iterate/app";
import type { SecretCatalogEntry } from "iterate/api";
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
import { Button } from "@iterate-com/ui/components/ui/button";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@iterate-com/ui/components/ui/table";
import { Textarea } from "@iterate-com/ui/components/ui/textarea";
import { Identifier } from "../../../components/identifier.tsx";
import { NotServedYet } from "../../../components/not-served-yet.tsx";
import { SECRET_NAME, SECRETS_PREFIX, secretMaterialOf } from "../../../lib/secrets.ts";
import { servesRoot } from "../../../lib/served.ts";

export const Route = createFileRoute("/minds/$mind/secrets")({
  // the sheet's state is the URL: `?new=1` sets a new secret, `?update=<name>` updates that one;
  // `name` and `urls` fill New secret, checked as the form checks them
  validateSearch: z.object({
    new: z.literal(1).optional().catch(undefined),
    update: z.string().optional().catch(undefined),
    name: z.string().regex(SECRET_NAME).optional().catch(undefined),
    urls: z
      .string()
      .refine((urls) => {
        const origins = originsOf(urls);
        return origins.length > 0 && origins.every((origin) => URL.canParse(origin));
      })
      .optional()
      .catch(undefined),
  }),
  // react-doctor-disable-next-line react-doctor/tanstack-start-loader-parallel-fetch -- the list is read only once the root is known to be there
  loader: async ({ context }) =>
    (await servesRoot(context.read, "secrets"))
      ? { served: true as const, secrets: await context.read((itx) => itx.secrets.list()) }
      : { served: false as const },
  staticData: { page: "Secrets" },
  head: ({ params }) => ({ meta: [{ title: `Secrets · ${params.mind} · Dash` }] }),
  component: MindSecrets,
});

function MindSecrets() {
  const data = Route.useLoaderData();
  if (!data.served) return <NotServedYet title="Secrets" what="secrets" />;
  return <Secrets secrets={data.secrets} />;
}

function Secrets({ secrets }: { secrets: SecretCatalogEntry[] }) {
  const { itx } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const router = useRouter();
  const [pending, setPending] = useState(false);
  // where the sheet lands focus: the value on an update or a filled name, the name otherwise
  const valueField = useRef<HTMLTextAreaElement>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const closeSheet = () => navigate({ search: {}, replace: true });
  /** The row `?update=<name>` names — none when the name is not (or no longer) a secret. */
  const updating =
    (search.update && secrets.find((secret) => secret.path === SECRETS_PREFIX + search.update)) ||
    null;

  const deleteSecret = async (secretPath: string) => {
    setError(null);
    setStatus(null);
    setDeleting(secretPath);
    try {
      await itx.secrets.delete(secretPath);
      setStatus(`${secretPath} is deleted.`);
      await router.invalidate({ sync: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-4 md:p-8">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">Secrets</h1>
          <Button onClick={() => void navigate({ search: { new: 1 } })}>
            <Plus data-icon="inline-start" />
            New secret
          </Button>
        </div>
        <p className="font-readme text-sm text-muted-foreground">
          A secret is its path. In a worker or a script, put{" "}
          <code>getSecret("/secrets/&lt;name&gt;")</code> in an outbound request's URL or headers:
          the platform substitutes the value as the request leaves, and only towards the origins
          pinned here. A value never comes back out.
        </p>
      </div>
      {error && (
        <p role="alert" data-type="error" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {status && (
        <p role="status" className="font-readme text-sm text-muted-foreground">
          {status}
        </p>
      )}
      {secrets.length === 0 ? (
        <p className="font-readme text-sm text-muted-foreground">No secrets yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table data-testid="secrets">
            <TableHeader>
              <TableRow>
                <TableHead>Path</TableHead>
                <TableHead>Sent to</TableHead>
                <TableHead>Refresh</TableHead>
                <TableHead>Set</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {secrets.map((secret) => (
                <TableRow key={secret.path}>
                  <TableCell>
                    <Identifier value={secret.path} />
                    {secret.public ? (
                      <ul className="mt-1 flex flex-col gap-0.5 font-mono text-xs text-muted-foreground">
                        {Object.entries(secret.public).map(([name, value]) => (
                          <li key={name} className="wrap-anywhere">
                            {name}={value}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <ul className="flex flex-col gap-0.5 font-mono text-xs">
                      {secret.urls.map((url) => (
                        <li key={url}>{url}</li>
                      ))}
                    </ul>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {secret.refresh === "worker" && secret.refreshSourceSha256
                      ? `refreshed by code (${secret.refreshSourceSha256.slice(0, 12)})`
                      : secret.refresh || "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {/* a stack's vault lists whether a secret is set, and no time */}
                    {Number.isNaN(Date.parse(secret.createdAt))
                      ? `${"set" in secret && secret.set === false ? "not " : ""}set`
                      : new Date(secret.createdAt).toISOString()}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`Update ${secret.path}`}
                        onClick={() =>
                          void navigate({
                            search: { update: secret.path.slice(SECRETS_PREFIX.length) },
                          })
                        }
                      >
                        Update
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger
                          render={<Button variant="outline" size="sm" />}
                          aria-label={`Delete ${secret.path}`}
                          disabled={deleting === secret.path}
                        >
                          {deleting === secret.path ? "Deleting…" : "Delete"}
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete {secret.path}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              The value is forgotten and requests that spell this placeholder fail
                              until it is set again. There is no undo.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => void deleteSecret(secret.path)}>
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Sheet
        open={search.new === 1 || Boolean(search.update)}
        onOpenChange={(open) => {
          if (open || pending) return;
          void closeSheet();
        }}
      >
        <SheetContent
          side="right"
          showCloseButton={!pending}
          initialFocus={updating || search.name ? valueField : undefined}
          className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-md"
        >
          <SecretForm
            // mounted with the sheet, keyed by what it opens on, so every opening starts from its row
            key={search.update || "new"}
            itx={itx}
            secrets={secrets}
            initialName={search.update || search.name || ""}
            initialUrls={updating ? updating.urls.join(" ") : search.urls || ""}
            updating={updating}
            valueField={valueField}
            pending={pending}
            setPending={setPending}
            onDone={async (message) => {
              setError(null);
              setStatus(message);
              await router.invalidate({ sync: true });
              await closeSheet();
            }}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** The sheet's body: the name, the value and the pin — one `secrets.set`. On an existing row
 *  (`updating`) the name is locked and the pin pre-filled; the value is always typed here. */
function SecretForm({
  itx,
  secrets,
  initialName,
  initialUrls,
  updating,
  valueField,
  pending,
  setPending,
  onDone,
}: {
  itx: AuthenticatedApp["itx"];
  secrets: SecretCatalogEntry[];
  initialName: string;
  initialUrls: string;
  updating: SecretCatalogEntry | null;
  valueField: RefObject<HTMLTextAreaElement | null>;
  pending: boolean;
  setPending: (pending: boolean) => void;
  /** The secret is written: the line the page shows for it. */
  onDone: (message: string) => Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  const [value, setValue] = useState("");
  const [urls, setUrls] = useState(initialUrls);
  const [error, setError] = useState<string | null>(null);
  const origins = originsOf(urls);
  const path = `${SECRETS_PREFIX}${name.trim()}`;
  const existing = secrets.find((secret) => secret.path === path);

  const setSecret = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    // the platform pins ORIGINS, so each entry must be a whole URL — said here, where it was typed
    const notAUrl = origins.find((origin) => !URL.canParse(origin));
    if (notAUrl) {
      setError(`"${notAUrl}" is not a URL — write the whole origin, like https://api.example.com`);
      return;
    }
    setPending(true);
    try {
      // a row with public fields keeps them public: the new value, a JSON object, carries each
      const publicNames = Object.keys(existing?.public || {});
      await itx.secrets.set(
        path,
        secretMaterialOf(value),
        publicNames.length ? { urls: origins, public: publicNames } : { urls: origins },
      );
      await onDone(
        `${path} is ${existing ? "updated" : "set"}. The value is stored encrypted and is not shown again.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={setSecret} className="flex h-full flex-col">
      <SheetHeader className="border-b">
        <SheetTitle>{updating ? `Update ${updating.path}` : "New secret"}</SheetTitle>
        <SheetDescription>
          {updating
            ? "Paste the value again — the current one is never shown — and check the origins: a pin only ever changes together with the value it guards."
            : "Stored encrypted and never shown again; the log records who set what and when, never the value."}
        </SheetDescription>
      </SheetHeader>
      <FieldGroup className="flex-1 p-4">
        <Field>
          <FieldLabel htmlFor="secret-name">Name</FieldLabel>
          <div className="flex items-center gap-1">
            <span className="font-mono text-sm text-muted-foreground">{SECRETS_PREFIX}</span>
            <Input
              id="secret-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              pattern={SECRET_NAME.source}
              title="Letters, digits, dots, underscores and dashes"
              placeholder="stripe"
              autoComplete="off"
              spellCheck={false}
              required
              readOnly={Boolean(updating)}
              className="font-mono read-only:bg-muted read-only:text-muted-foreground"
            />
          </div>
          <FieldDescription>
            {updating
              ? "A secret is its path; to move it, set a new name and delete this one."
              : "Letters, digits, dots, underscores and dashes — the path is what the placeholder spells."}
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="secret-value">{updating ? "New value" : "Value"}</FieldLabel>
          <Textarea
            id="secret-value"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="sk_live_…"
            autoComplete="off"
            spellCheck={false}
            required
            ref={valueField}
            rows={4}
            className="font-mono"
          />
          <FieldDescription>
            One string, or a JSON object — then{" "}
            <code>
              getSecret("/secrets/name", {"{"} field: "a.b" {"}"})
            </code>{" "}
            picks one of its fields.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="secret-urls">Sent to</FieldLabel>
          <Input
            id="secret-urls"
            value={urls}
            onChange={(event) => setUrls(event.target.value)}
            placeholder="https://api.stripe.com"
            autoComplete="off"
            spellCheck={false}
            required
            className="font-mono"
          />
          <FieldDescription>
            The origins the value may be sent to, separated by spaces or commas. A request to any
            other host is refused, and the value is never sent there.
          </FieldDescription>
        </Field>
        {existing?.refresh && (
          <p role="note" className="font-readme text-sm text-muted-foreground">
            This secret refreshes itself ({existing.refresh}). A value set from here has no refresh
            strategy — to keep one, set it from code with <code>refresh</code>.
          </p>
        )}
        {existing?.public && (
          <p role="note" className="font-readme text-sm text-muted-foreground">
            This secret has public fields ({Object.keys(existing.public).join(", ")}), which the
            mind reads from its list of secrets. The new value is a JSON object that carries each of
            them, and they stay public.
          </p>
        )}
        {error && (
          <p role="alert" data-type="error" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </FieldGroup>
      <SheetFooter className="border-t sm:flex-row sm:justify-end">
        <SheetClose disabled={pending} render={<Button type="button" variant="outline" />}>
          Cancel
        </SheetClose>
        <Button type="submit" disabled={pending || !name.trim() || !value || origins.length === 0}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {existing ? "Update secret" : "Set secret"}
        </Button>
      </SheetFooter>
    </form>
  );
}

/** The origins field's text as its entries: separated by spaces or commas. */
function originsOf(urls: string) {
  return urls.split(/[\s,]+/).filter(Boolean);
}
