import { expect, test, vi } from "vitest";
import { serveSignIn } from "./sign-in.ts";

// The Cloud under paths ingress: the edge hands it the URL without `/projects/cloud`.
const platform = "https://os.example.test";
const basePath = "/projects/cloud";

test("the client document names the Cloud's address under its base path", async () => {
  const answer = await serve(new Request(`${platform}/sign-in/client.json`));
  expect(await answer!.json()).toMatchObject({
    client_id: `${platform}${basePath}/sign-in/client.json`,
    client_uri: `${platform}${basePath}`,
    redirect_uris: [`${platform}${basePath}/sign-in/callback`],
  });
});

test("a sign-in returns under the base path, and never to another project's page", async () => {
  vi.stubGlobal("fetch", async () =>
    Response.json({
      issuer: platform,
      authorization_endpoint: `${platform}/oauth2/auth`,
      token_endpoint: `${platform}/oauth2/token`,
      revocation_endpoint: `${platform}/oauth2/revoke`,
    }),
  );
  const answer = await serve(
    new Request(`${platform}/sign-in?next=/projects/other/x`, { method: "POST" }),
  );
  const target = new URL(answer!.headers.get("location")!);
  expect(target.searchParams.get("redirect_uri")).toBe(`${platform}${basePath}/sign-in/callback`);
  expect(target.searchParams.get("client_id")).toBe(`${platform}${basePath}/sign-in/client.json`);
  const flow = /__Host-cloud-sign-in=([^;]+)/.exec(answer!.headers.get("set-cookie")!)![1]!;
  const next = JSON.parse(atob(flow.replaceAll("-", "+").replaceAll("_", "/"))).next;
  expect(next).toBe(`${basePath}/`);
});

function serve(request: Request) {
  const kv = { get: async () => null, put: async () => ({}), delete: async () => ({}) };
  return serveSignIn(request, { kv, issuer: platform, basePath, signedIn: async () => undefined });
}
