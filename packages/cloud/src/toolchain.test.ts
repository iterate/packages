import { expect, test, vi } from "vitest";
import { ProcessorEngine } from "iterate/stream/processor";
import { memoryStorage, memoryStream } from "iterate/stream/test-support";
import type { ToolchainState } from "./records.ts";
import { ToolchainProcessor } from "./toolchain.ts";

const image = {
  account: "11111111222222223333333344444444",
  secret: "/secrets/cloud-image-source",
  digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};

test("a request prepares the toolchain once; one while it runs is refused; the next starts after it", async () => {
  const log = memoryStream("/toolchain");
  let finish!: () => void;
  const prepared: number[] = [];
  const engine = new ProcessorEngine(
    new ToolchainProcessor({
      prepare: (requestOffset) => {
        prepared.push(requestOffset);
        return new Promise(
          (resolve) =>
            (finish = () =>
              resolve({ status: "succeeded", snapshot: `s-${requestOffset}`, core: "abc1234" })),
        );
      },
    }),
    { stream: log.stream, storage: memoryStorage() },
  );
  log.engines.push(engine);
  const state = async () => (await engine.snapshot()).state as ToolchainState;

  log.stream.append({ type: "cloud/toolchain-requested", payload: { image } });
  await vi.waitFor(() => expect(prepared).toHaveLength(1));
  log.stream.append({ type: "cloud/toolchain-requested", payload: { image } });
  await vi.waitFor(() =>
    expect(
      log.events.find((event) => event.type === "cloud/toolchain-settled")?.payload,
    ).toMatchObject({
      status: "failed",
      error: expect.stringContaining("A preparation is running"),
    }),
  );
  finish();
  await vi.waitFor(async () =>
    expect((await state()).ready).toMatchObject({
      snapshot: `s-${prepared[0]}`,
      core: "abc1234",
      image,
    }),
  );

  log.stream.append({ type: "cloud/toolchain-requested", payload: { image } });
  await vi.waitFor(() => expect(prepared).toHaveLength(2));
  finish();
  await vi.waitFor(async () => expect((await state()).ready?.snapshot).toBe(`s-${prepared[1]}`));
});
