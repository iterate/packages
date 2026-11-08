import { expect, test } from "vitest";
import { installIterateCloud, iterateCloud } from "./index.ts";

test("the install is one keyed fan-out row on /iterate-cloud, through the project's root, signed with the project's secret", async () => {
  const { itx, appended } = fakeItx();
  await installIterateCloud(itx, { router: "https://iterate2.app/anything", hook: "dep_1" });
  expect(appended).toEqual([
    {
      at: "/iterate-cloud",
      event: {
        type: "events.iterate.com/itx/subscription-configured",
        idempotencyKey: "iterate-cloud/hook:https://iterate2.app/.cloud/hooks/dep_1",
        payload: {
          name: "iterate-cloud",
          target: [
            "itx",
            ["cd", "/"],
            "webhooks",
            [
              "get",
              {
                url: "https://iterate2.app/.cloud/hooks/dep_1",
                signingSecret: "/secrets/iterate-cloud",
              },
            ],
            "deliverEvent",
          ],
          consumes: ["iterate-cloud/email-requested"],
          ordered: false,
        },
      },
    },
  ]);
});

test("a message asked for is an event from the project's own address, and its offset; one with no body is refused before anything lands", async () => {
  const { itx, appended } = fakeItx();
  const cloud = iterateCloud(itx);
  expect(
    await cloud.email.send({ to: ["ada@example.com"], subject: "Hello", text: "Hi Ada" }),
  ).toEqual({ offset: 7 });
  expect(appended).toEqual([
    {
      at: "/iterate-cloud",
      event: {
        type: "iterate-cloud/email-requested",
        payload: {
          to: ["ada@example.com"],
          subject: "Hello",
          text: "Hi Ada",
          from: "notes@iterate2.app",
        },
      },
    },
  ]);
  await expect(cloud.email.send({ to: ["ada@example.com"], subject: "Empty" })).rejects.toThrow(
    /a text or an html body/,
  );
  expect(appended).toHaveLength(1);
});

// ── helpers ──

/** A project's itx as far as the package reaches it: `cd(path).append` recorded, the slug
 *  `notes`. */
function fakeItx() {
  const appended: { at: string; event: unknown }[] = [];
  const itx = {
    cd: (at: string) => ({
      append: async (event: unknown) => {
        appended.push({ at, event });
        return [{ offset: 7 }];
      },
    }),
    whoami: async () => ({ projectId: "prj_1", path: "/", projectSlug: "notes" }),
  };
  // The package's two functions reach `cd(path).append` and `whoami` alone, which this answers.
  return { itx: itx as unknown as Parameters<typeof iterateCloud>[0], appended };
}
