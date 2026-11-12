// /minds/<address>/secrets — the mind's secrets (packages/ui `SecretsPage`). This route is the
// page's wiring to the router: the list is the route's loader, a set or a delete reloads this route
// alone, and the sheet's state is the URL's search, so New secret (`?new=1`, with `name` and
// `urls` filled by the installer's wizard) and a row's Update (`?update=<name>`) are links. A mind
// that does not serve `itx.secrets` yet gets one line that says so (lib/served.ts).
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { SecretsPage, SecretsPageState } from "@iterate-com/ui/components/secrets-page";
import { NotServedYet } from "../../../components/not-served-yet.tsx";
import { servesRoot } from "../../../lib/served.ts";

export const Route = createFileRoute("/minds/$mind/secrets")({
  validateSearch: SecretsPageState,
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
  const { itx } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const router = useRouter();
  if (!data.served) return <NotServedYet title="Secrets" what="secrets" />;
  return (
    <SecretsPage
      itx={itx}
      secrets={data.secrets}
      state={search}
      onStateChange={(next, replace) => void navigate({ search: next, replace })}
      onChanged={() =>
        router.invalidate({ sync: true, filter: (match) => match.routeId === Route.id })
      }
    />
  );
}
