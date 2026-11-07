// cloud/config.ts — A DEPLOYMENT'S ITERATE CONFIG, one of the three inputs of every run (with its
// Cloudflare account and the grant's placeholder): the fields of core/os's iterate config
// (core/os/src/iterate-config.ts) that the Cloud sets, its three secrets among them. The person's
// facet mints it once, when the person asks for the deployment, and it rides `cloud/deployment-requested` onto the
// deployment's log (contract.ts says what that costs). The deployment's state keeps it; its live
// state, which reaches the browser, has the secrets masked (`maskedConfigOf`).
//
// Each run writes it into the sandbox as one file (`configFileOf`) with `files.write`, never through
// a command line or a command's output, which the sandbox's log keeps. The sandbox's disk is a cache:
// a lost disk is rebuilt from the toolchain and this config, and the deployment keeps its key.
import { z } from "zod";
import type { DeploymentRecord } from "./records.ts";

const IterateSignIn = z.strictObject({ iterate: z.strictObject({ issuer: z.url() }) });
const PasswordSignIn = z.strictObject({
  password: z.strictObject({ password: z.string().min(20) }),
});

export const DeploymentConfig = z.object({
  cloudflare: z.object({
    accountId: z.string().regex(/^[0-9a-f]{32}$/),
    /** Every resource's name starts with it: the deployment's name. */
    resourcePrefix: z.string().regex(/^[a-z][a-z0-9-]{1,30}[a-z0-9]$/),
    workersDev: z.literal(true),
  }),
  login: z.object({
    /** Its owner, the one person who may sign in. */
    allow: z.array(z.object({ email: z.email() })).length(1),
    /** How the owner signs in: through the platform the Cloud runs on (log in with iterate, the
     *  only method, so a signed-out page load goes straight to it), or, for a deployment made
     *  before that, a password the Cloud minted and shows the owner (durable-object.ts
     *  `signInPassword`). */
    methods: z.union([IterateSignIn, PasswordSignIn]),
  }),
  /** `ITERATE__ADMIN_BEARER`: the operator's bearer of the deployed platform. */
  adminBearer: z.string().regex(/^[0-9a-f]{64}$/),
  /** `ITERATE__SECRETS_ENCRYPTION__KEY`: seals the secrets the deployed platform stores. */
  secretsEncryption: z.object({ key: z.string().regex(/^[0-9a-f]{64}$/) }),
  /** The Dash the deployment's `/` sends its owner to: its Cloud's platform's own, when the
   *  Cloud's config names one; otherwise core/os's default, iterate's (`urls.dash`). */
  urls: z.object({ dash: z.url().optional() }).default({}),
});
export type DeploymentConfig = z.infer<typeof DeploymentConfig>;

/** A new config for `record`, with fresh secrets: the facet's, once per deployment. Its owner
 *  signs in through `platform.issuer`, the platform the Cloud runs on, and opens that platform's
 *  Dash when it names one. */
export function mintConfig(
  record: DeploymentRecord,
  platform: { issuer: string; dash: string | null },
): DeploymentConfig {
  return DeploymentConfig.parse({
    cloudflare: { accountId: record.accountId, resourcePrefix: record.name, workersDev: true },
    login: {
      allow: [{ email: record.owner.email }],
      methods: { iterate: { issuer: platform.issuer } },
    },
    adminBearer: hex(32),
    secretsEncryption: { key: hex(32) },
    urls: { dash: platform.dash || undefined },
  });
}

/** The config's file in the sandbox, `ITERATE_CONFIG_FILE` of the run (runs.ts): core/os's own
 *  config from the environment, with these fields over it. Every value is a JSON literal. */
export const configFileOf = (
  config: DeploymentConfig,
  os: string,
) => `// written by Iterate Cloud: the deployment's config (cloud/config.ts)
import type { IterateConfigInput } from "${os}/src/iterate-config.ts";
import base from "${os}/iterate.config.ts";

const cloud = ${JSON.stringify(config, null, 2)};

export default {
  ...base,
  cloudflare: { ...base.cloudflare, ...cloud.cloudflare },
  login: { ...base.login, allow: cloud.login.allow, methods: { ...base.login?.methods, ...cloud.login.methods } },
  adminBearer: cloud.adminBearer,
  secretsEncryption: { ...base.secretsEncryption, key: cloud.secretsEncryption.key },
  ...(cloud.urls?.dash ? { urls: { ...base.urls, dash: cloud.urls.dash } } : {}),
} satisfies IterateConfigInput;
`;

/** Where a secret was: the page says it is stored by the Cloud and not shown. */
export const MASKED = { masked: true } as const;
const Masked = z.object({ masked: z.literal(true) }).strict();

/** The config as the browser sees it: every secret replaced by `MASKED`. */
export const MaskedConfig = DeploymentConfig.extend({
  login: DeploymentConfig.shape.login.extend({
    methods: z.union([IterateSignIn, z.strictObject({ password: z.object({ password: Masked }) })]),
  }),
  adminBearer: Masked,
  secretsEncryption: z.object({ key: Masked }),
});
export type MaskedConfig = z.infer<typeof MaskedConfig>;

export function maskedConfigOf(config: DeploymentConfig): MaskedConfig {
  return {
    ...config,
    login: {
      ...config.login,
      methods:
        "password" in config.login.methods
          ? { password: { password: MASKED } }
          : config.login.methods,
    },
    adminBearer: MASKED,
    secretsEncryption: { key: MASKED },
  };
}

/** How the owner of a deployment with `config` signs in there: through its Cloud's platform, or,
 *  made before that, with a password. */
export const signInOf = (config: Pick<DeploymentConfig, "login"> | Pick<MaskedConfig, "login">) =>
  "iterate" in config.login.methods ? ("iterate" as const) : ("password" as const);

/** Whether `value` is where a secret was (`MASKED`). */
export const isMasked = (value: unknown): value is typeof MASKED => Masked.safeParse(value).success;

const hex = (bytes: number) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
