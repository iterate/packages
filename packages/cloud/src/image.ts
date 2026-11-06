// cloud/image.ts — THE SANDBOX IMAGE IN THE CUSTOMER'S ACCOUNT. A deployment's sandboxes start
// `iterate-dev-image`, and Cloudflare's Containers take an image only from the account's own
// registry (or a managed one), so each plan and deploy puts it there before Alchemy runs: the digest
// the toolchain's request named (`ImageSource.digest`, the pin of the core it prepared), copied by
// `crane` from the source's registry when the account lacks it, prepared for Containers, and handed
// to Alchemy as `ITERATE_IMAGE_PINS`. A deploy that finds the
// digest in the account copies nothing.
//
// OPTIONAL, AND THE COPY IS BROKEN: a toolchain asked for with no image has no source, and its runs
// skip all of this (runs.ts `NO_IMAGE_STEP`). The copy itself fails for an account that lacks the
// image: crane uploads each layer through the project's egress, which gives a request 50 seconds,
// and a large layer takes longer (`504 Gateway Timeout: itx.fetch: the pinned host
// https://registry.cloudflare.com sent no answer within 50 s`).
//
// Two registry credentials, both egress placeholders, so neither enters the sandbox. The registry
// takes only credentials its account's API mints (user `v1`, a JWT), as Basic auth, and egress
// fills a placeholder inside `Basic base64(user:getSecret(…))`. The destination's is minted before
// each run with the connection's token, push and pull for an hour, at `registrySecretOf(id)`. The
// source's is `ImageSource.secret`. crane keeps a credential per repository (docker config keys
// `registry.cloudflare.com/<account>/<image>`), so one `crane copy` carries both.
import type { IterateContextApi } from "iterate/api";
import { z } from "zod";
import type { DeploymentRecord, ImageSource } from "./records.ts";

/** The image core's sandboxes start (core/os/src/sandbox/contract.ts `SANDBOX_IMAGE`), and its
 *  repository's name in every registry. */
const IMAGE = "iterate-dev-image";
const registrySecretOf = (deployment: string) => `/secrets/cloud-registry-${deployment}`;

const REGISTRY = "registry.cloudflare.com";

/** A registry user as the script may hold it: Cloudflare's registry names `v1`. */
const REGISTRY_USER = /^[A-Za-z0-9._-]{1,64}$/;

/** The run's line that names the pin: `runAttempt` reads it, and the deployment page shows it. */
export const PIN_LINE = /^== image pin (\S+@sha256:[0-9a-f]{64})$/;

/** crane, pinned: the release's tarball, checked against its SHA-256 (the release's checksums.txt
 *  and GitHub's asset digest agree). The toolchain installs it; a sandbox from an older snapshot
 *  installs it when it first copies. */
const CRANE_VERSION = "0.22.1";
// allow-high-entropy-next-line: crane's release tarball's published SHA-256
export const CRANE_INSTALL = `{ [ "$(crane version 2>/dev/null)" = ${CRANE_VERSION} ] || { curl -fsSL -o /tmp/crane.tgz https://github.com/google/go-containerregistry/releases/download/v${CRANE_VERSION}/go-containerregistry_Linux_x86_64.tar.gz && echo "0ab7a1d6932a213aed964ce97666c3077fe691c8606413674a8b3e0b9ec4cda0  /tmp/crane.tgz" | sha256sum -c --quiet && tar -xzf /tmp/crane.tgz -C /usr/local/bin crane && rm -f /tmp/crane.tgz && echo "crane $(crane version) installed"; }; }`;

/** What the step needs that only the facet can learn: the destination's user (its credential just
 *  minted), and the source's user, null when the project has no `ImageSource.secret`. */
export type ImageStep = { destinationUser: string; sourceUser: string | null };

/** Before a plan or deploy: mint the account's push credential into its secret, and find the other
 *  two. An error is the run's: it fails with it. */
export async function imageStepFor(
  root: IterateContextApi,
  deployment: Pick<DeploymentRecord, "accountId" | "id">,
  image: ImageSource,
  token: string,
): Promise<ImageStep | { error: string }> {
  const source = (await root.secrets.list()).find((s) => s.path === image.secret);
  const response = await root.fetch(
    new Request(
      `https://api.cloudflare.com/client/v4/accounts/${deployment.accountId}/containers/registries/${REGISTRY}/credentials`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          permissions: ["push", "pull"],
          expiration_minutes: 60,
        }),
      },
    ),
  );
  const answer = RegistryCredentials.safeParse(await response.json().catch(() => null)).data;
  const { username, password } = answer?.result || {};
  // the user is written into the run's script: a strict pattern, like everything the script holds
  if (username && !REGISTRY_USER.test(username))
    return {
      error: `the account's registry named a user that is not a plain name: ${JSON.stringify(username.slice(0, 60))}`,
    };
  if (!answer?.success || !username || !password)
    return {
      error: `the account's registry gave no push credential (HTTP ${response.status}): ${JSON.stringify(answer?.errors ?? null).slice(0, 300)}`,
    };
  await root.secrets.set(
    registrySecretOf(deployment.id),
    { username, password },
    { urls: [`https://${REGISTRY}`], public: ["username"] },
  );
  const sourceUser = source ? source.public?.username || "v1" : null;
  if (sourceUser && !REGISTRY_USER.test(sourceUser))
    return { error: `${image.secret} names a user that is not a plain name` };
  return { destinationUser: username, sourceUser };
}

/** The step, in bash, inside the run's script: after the Artifacts namespace, before Alchemy. It
 *  exports `ITERATE_IMAGE_PINS` and prints PIN_LINE, or fails the run with an `image:` line. `dir`
 *  is the run's own: the docker config there holds placeholders only. */
export function imageStepOf(
  deployment: Pick<DeploymentRecord, "accountId" | "id">,
  image: ImageSource,
  step: ImageStep,
  dir: string,
): string {
  const SOURCE_ACCOUNT = image.account;
  const SOURCE_SECRET = image.secret;
  const source = `${SOURCE_ACCOUNT}/${IMAGE}`;
  const destination = `${deployment.accountId}/${IMAGE}`;
  const destinationSecret = registrySecretOf(deployment.id);
  const password = (secret: string) => `getSecret("${secret}", { field: "password" })`;
  const auths: Record<string, { username: string; password: string }> = {
    [`${REGISTRY}/${destination}`]: {
      username: step.destinationUser,
      password: password(destinationSecret),
    },
  };
  if (step.sourceUser)
    auths[`${REGISTRY}/${source}`] = {
      username: step.sourceUser,
      password: password(SOURCE_SECRET),
    };
  return `# The sandbox image (cloud/image.ts): core's pin, in this account's registry, prepared.
echo "== step image"
image_failed() { echo "image: $*"; echo "__EXIT__:1"; exit 1; }
basic() { printf 'Basic %s' "$(printf '%s:getSecret("%s", { field: "password" })' "$1" "$2" | base64 -w0)"; }
manifest() { curl -sS -o /dev/null -w '%{http_code}' -I -H "Authorization: $(basic "$2" "$3")" -H 'accept: application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.docker.distribution.manifest.list.v2+json' "https://${REGISTRY}/v2/$1/manifests/$digest"; }
mkdir -p ${dir}
export DOCKER_CONFIG=${dir}
cat > ${dir}/config.json <<'JSON'
${JSON.stringify({ auths })}
JSON
digest=${image.digest}
reference="${REGISTRY}/${destination}@$digest"
echo "the toolchain pins $digest"
held=$(manifest ${destination} ${step.destinationUser} ${destinationSecret})
if [ "$held" = 200 ]; then
  echo "the account's registry holds it: no copy"
elif [ "$held" = 404 ]; then
  [ -n "${step.sourceUser || ""}" ] || image_failed "the account's registry lacks it, and the project has no ${SOURCE_SECRET} to copy it with"
  from=$(manifest ${source} ${step.sourceUser || "v1"} ${SOURCE_SECRET})
  [ "$from" = 200 ] || image_failed "iterate's registry answered HTTP $from for ${REGISTRY}/${source}@$digest: ${SOURCE_SECRET} is refused or expired"
  ${CRANE_INSTALL} || image_failed "crane ${CRANE_VERSION} did not install"
  started=$(date +%s)
  crane copy "${REGISTRY}/${source}@$digest" "${REGISTRY}/${destination}:cloud-\${digest:7:12}" || image_failed "crane copy ended with $?"
  [ "$(manifest ${destination} ${step.destinationUser} ${destinationSecret})" = 200 ] || image_failed "the copy is not in the account's registry"
  echo "copied in $(( $(date +%s) - started ))s"
else
  image_failed "the account's registry answered HTTP $held for $reference"
fi
started=$(date +%s); said=""
for i in $(seq 1 100); do
  answer=$(curl -sS -X POST "https://api.cloudflare.com/client/v4/accounts/${deployment.accountId}/containers/image-preparations" -H "Authorization: Bearer $ITERATE__CLOUDFLARE__API_TOKEN" -H 'content-type: application/json' --data '{"image":"'"$reference"'"}')
  status=$(jq -r '.result.status // empty' <<<"$answer" 2>/dev/null)
  reason=$(jq -r '.result.reason // empty' <<<"$answer" 2>/dev/null)
  now="$status\${reason:+ ($reason)}"
  [ "$now" = "$said" ] || echo "preparation: $now, +$(( $(date +%s) - started ))s"
  said=$now
  [ "$status" = pending ] || break
  sleep 6
done
[ "$status" = ready ] || image_failed "Cloudflare did not prepare $reference: $(head -c 300 <<<"$answer")"
export ITERATE_IMAGE_PINS='{"${IMAGE}":"'"$digest"'"}'
echo "== image pin $reference"
`;
}

/** What Cloudflare answers for registry credentials, as far as the image step reads it. A refusal
 *  is the same envelope with `result: null`, and its `errors` say why. */
const RegistryCredentials = z.object({
  success: z.boolean().optional(),
  result: z.object({ username: z.string().optional(), password: z.string().optional() }).nullish(),
  errors: z.unknown(),
});

/** `value` as one shell word. */
export const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
