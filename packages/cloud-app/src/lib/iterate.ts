// The Cloud's page and the platform: one client of the platform's `/api` (iterate/app), signed in
// with the identity scope alone, as the Dash's is with its own (docs/frontend-development.md). The
// Cloud has no API of its own. The project lends the person their own facets (@iterate-com/cloud
// durable-object.ts): `cloud-person` on their context, `cloud-deployment` on each deployment's.
// Under subdomains the page's `/api` is the Cloud host's, and its session the identity grant that
// host's sign-in made; under paths it is the platform's, and the session the issuer's.
import { createContext, useContext } from "react";
import type { RpcStub } from "capnweb";
import { z } from "zod";
import { createIterateClient } from "iterate/app";
import type { IterateSessionApi } from "iterate/api";
import { useContextStub, useFacetLiveState } from "iterate/react";
import type { CloudDeploymentMethods, CloudPersonMethods } from "@iterate-com/cloud";
import { PersonView } from "@iterate-com/cloud/records";
import { DeploymentView } from "@iterate-com/cloud/views";

export const iterateClient = createIterateClient({ scopes: ["identity"] });

/** The project that serves the Cloud: prd's, and the playground's. */
const CLOUD_PROJECT = "cloud";

type Api = RpcStub<IterateSessionApi>;

/** Whether anyone is signed in, asked of `/api` without leaving the page: a 401 is nobody, as
 *  iterate/app's own probe reads it. */
export async function signedIn() {
  const probe = await fetch("/api", {
    method: "POST",
    body: "",
    signal: AbortSignal.timeout(10_000),
  });
  await probe.body?.cancel();
  if (probe.status === 401) return false;
  if (!probe.ok) throw new Error(`iterate is unavailable (${probe.status}). Please retry.`);
  return true;
}

/** The signed-in person: the session, and who it says they are. */
export type Me = { api: Api; sub: string; email: string | null };

export const MeContext = createContext<Me | null>(null);

export function useMe() {
  const me = useContext(MeContext);
  if (!me) throw new Error("useMe outside the signed-in shell (routes/_app.tsx)");
  return me;
}

const personPath = (sub: string) => `/people/${sub}`;
const deploymentPath = (id: string) => `/deployments/${id}`;

/** One call on a facet lent to the person: through the session's current socket, each handle on
 *  the way held only for the call. A capnweb stub of `facets.get` erases the facet's methods
 *  (iterate/api `facets.get`), so the facet is typed by its class's `lentMethods`. */
async function callFacet<M, T>(
  api: Api,
  path: string,
  facet: string,
  call: (methods: M) => Promise<T>,
): Promise<T> {
  using project = api.projects.get(CLOUD_PROJECT);
  using context = project.cd(path);
  using handle = context.facets.get(facet);
  // safe: the platform lets a lendee reach the facet's `lentMethods` alone, which `M` is
  // (@iterate-com/cloud `CloudPersonMethods`, `CloudDeploymentMethods`)
  return await call(handle as unknown as M);
}

/** A call on the person's own facet. */
export const callPerson = <T>(me: Me, call: (person: CloudPersonMethods) => Promise<T>) =>
  callFacet(me.api, personPath(me.sub), "cloud-person", call);

/** A call on one of the person's deployments. */
export const callDeployment = <T>(
  me: Me,
  id: string,
  call: (deployment: CloudDeploymentMethods) => Promise<T>,
) => callFacet(me.api, deploymentPath(id), "cloud-deployment", call);

/** A facet's live state, parsed, on a context the page holds while it shows it. */
function useFacet<T>(me: Me, path: string, facet: string, schema: z.ZodType<T>) {
  const opened = useContextStub(async () => {
    // the project's handle only leads to the context, which the hook holds and disposes
    using project = me.api.projects.get(CLOUD_PROJECT);
    return await project.cd(path);
  }, [me.api, path]);
  const live = useFacetLiveState(opened.stub, facet);
  const read = live.value === undefined ? undefined : schema.safeParse(live.value);
  return {
    value: read?.data,
    status: live.status,
    error: opened.error || live.error || (read?.error ? z.prettifyError(read.error) : undefined),
  };
}

export type PersonLive = ReturnType<typeof usePersonLive>;

/** The person's live state: their connections and deployments. */
export const usePersonLive = (me: Me) =>
  useFacet(me, personPath(me.sub), "cloud-person", PersonView);

/** One deployment's live state. */
export const useDeploymentLive = (me: Me, id: string) =>
  useFacet(me, deploymentPath(id), "cloud-deployment", DeploymentView);

export const PersonContext = createContext<PersonLive | null>(null);

export function usePerson() {
  const live = useContext(PersonContext);
  if (!live) throw new Error("usePerson outside PersonProvider (components/person-provider.tsx)");
  return live;
}
