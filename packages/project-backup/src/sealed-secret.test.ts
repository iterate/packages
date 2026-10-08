// Opening a sealed secret with the key of the deployment that sealed it, as restore does in the
// worker. That the platform's own cells open is test/vitest/os/project-backup-sealed-secret.test.ts.
import { expect, test } from "vitest";
import { openSealedSecret } from "./sealed-secret.ts";
import { sealSecret } from "./test-support.ts";

const binding = {
  context: "prj_source.iterate/secrets/openai",
  urls: ["https://api.openai.com"],
  nonce: "nonce-2",
};

test.for([
  { name: "the key that sealed it", keys: { current: "source" }, opens: true },
  {
    name: "the previous key, during a rotation",
    keys: { current: "rotated", previous: "source" },
    opens: true,
  },
  { name: "another key", keys: { current: "another" }, opens: false },
])("$name", async ({ keys, opens }) => {
  const cell = await sealSecret({ apiKey: "sk-test" }, binding, "source");
  const opened = openSealedSecret(cell, keys);
  if (opens) await expect(opened).resolves.toEqual({ apiKey: "sk-test" });
  else await expect(opened).rejects.toThrow();
});

test("a cell moved to another path does not open", async () => {
  const cell = await sealSecret("sk-test", binding, "source");
  await expect(
    openSealedSecret(
      { ...cell, context: "prj_source.iterate/secrets/other" },
      { current: "source" },
    ),
  ).rejects.toThrow();
});
