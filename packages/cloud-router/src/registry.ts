// cloud-router/registry.ts — WHAT THE ROUTER KNOWS, in its KV namespace, every value sealed with
// AES-GCM under `CLOUD_ROUTER_KV_KEY`, so the namespace alone gives no origin and no credential
// away. scripts/registry.ts writes the rows; the Worker reads them. Each row is parsed with its
// schema when it is read back.
//
//   deployment:<id>            { origin, bearer, hookSecret }  the deployment's admin bearer, and the
//                                                            secret its mail-out hook signs with
//   hook:<sha256(hookSecret)>  { deployment }                 who a hook secret belongs to (egress);
//                                                            a new secret retires the old row
//   route:<slug>               { deployment, projectId }      `<slug>.iterate2.app`, `<slug>@iterate2.app`,
//                                                            and which project of the deployment it is
//   lends:<id>                 { <name>: <secret> }           the secrets the Cloud lends the deployment
import { z } from "zod";

export const Deployment = z.object({
  origin: z.url(),
  bearer: z.string().min(1),
  hookSecret: z.string().min(1),
});
export type Deployment = z.infer<typeof Deployment>;
const Route = z.object({ deployment: z.string().min(1), projectId: z.string().min(1) });
export type Route = z.infer<typeof Route>;
const Owner = z.object({ deployment: z.string().min(1) });
const Lends = z.record(z.string(), z.string());

/** The KV calls the registry makes: Workers KV, the Cloudflare API from a script, a test's map. */
export type Store = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<unknown>;
  delete(key: string): Promise<unknown>;
};

export class Registry {
  readonly #store: Store;
  readonly #key: Promise<CryptoKey>;

  constructor(store: Store, base64Key: string) {
    this.#store = store;
    this.#key = crypto.subtle.importKey("raw", fromBase64(base64Key), "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
  }

  deployment = (id: string) => this.#get(`deployment:${id}`, Deployment);
  /** A deployment's row, and the hook row its secret is found by: a secret the row held before
   *  stops opening anything. */
  async setDeployment(id: string, deployment: Deployment) {
    const before = await this.deployment(id);
    if (before && before.hookSecret !== deployment.hookSecret)
      await this.#store.delete(`hook:${await sha256Hex(before.hookSecret)}`);
    await this.#put(`deployment:${id}`, deployment);
    await this.#put(`hook:${await sha256Hex(deployment.hookSecret)}`, { deployment: id });
  }
  /** The deployment whose hook secret this is, with its id, or null. */
  async deploymentByHookSecret(secret: string) {
    const row = await this.#get(`hook:${await sha256Hex(secret)}`, Owner);
    const deployment = row && (await this.deployment(row.deployment));
    return deployment ? { id: row.deployment, ...deployment } : null;
  }
  route = (slug: string) => this.#get(`route:${slug}`, Route);
  setRoute = (slug: string, route: Route) => this.#put(`route:${slug}`, route);
  lends = (id: string) => this.#get(`lends:${id}`, Lends);
  setLends = (id: string, lends: Record<string, string>) => this.#put(`lends:${id}`, lends);

  /** The deployment `<slug>` is routed to, with its id and the route, or null. */
  async routed(slug: string) {
    const route = await this.route(slug);
    const deployment = route && (await this.deployment(route.deployment));
    return deployment ? { id: route.deployment, projectId: route.projectId, ...deployment } : null;
  }

  async #put(key: string, value: unknown) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = new TextEncoder().encode(JSON.stringify(value));
    const sealed = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await this.#key, plain),
    );
    await this.#store.put(key, btoa(String.fromCharCode(...iv, ...sealed)));
  }

  async #get<T>(key: string, schema: z.ZodType<T>): Promise<T | null> {
    const stored = await this.#store.get(key);
    if (!stored) return null;
    const bytes = fromBase64(stored);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, 12) },
      await this.#key,
      bytes.slice(12),
    );
    return schema.parse(JSON.parse(new TextDecoder().decode(plain)));
  }
}

const fromBase64 = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

export async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
