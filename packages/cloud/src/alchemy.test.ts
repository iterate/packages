import { expect, test } from "vitest";
import { foldAlchemyEvent, readAlchemyLine } from "./alchemy.ts";
import type { Resource } from "./records.ts";

// Lines as Alchemy's CLI printed them in a real deploy on the playground (2026-11-06, the dev
// account, `pnpm alchemy deploy --yes --log-format json`), the Worker's plan row cut to two of its
// bindings and the times and trace ids zeroed.
const printed = [
  `{"time":1700000000000,"level":"info","kind":"event","process":"cli","scope":"project","trace":{"traceId":"00000000000000000000000000000001","spanId":"0000000000000001"},"attributes":{},"data":{"type":"plan.resource.started","fqn":"DB","logicalId":"DB","resourceType":"Cloudflare.D1Database","total":8}}`,
  `{"time":1700000000000,"level":"info","kind":"event","process":"cli","scope":"project","trace":{"traceId":"00000000000000000000000000000001","spanId":"0000000000000001"},"attributes":{},"data":{"type":"plan.resource.completed","fqn":"Worker","logicalId":"Worker","resourceType":"Cloudflare.Worker","action":"create","bindings":[{"sid":"AI","action":"create"},{"sid":"DB","action":"create"}],"providerMode":"live","completed":8,"total":8}}`,
  `{"time":1700000000000,"level":"info","kind":"event","process":"cli","scope":"project","trace":{"traceId":"00000000000000000000000000000001","spanId":"0000000000000001"},"attributes":{},"data":{"type":"apply.resource.status","fqn":"DB","id":"DB","resourceType":"Cloudflare.D1Database","status":"pending","providerMode":"live"}}`,
  `{"time":1700000000000,"level":"info","kind":"event","process":"cli","scope":"project","trace":{"traceId":"00000000000000000000000000000001","spanId":"0000000000000001"},"attributes":{},"data":{"type":"apply.resource.status","fqn":"Worker","id":"Worker","resourceType":"Cloudflare.Worker","status":"creating","providerMode":"live"}}`,
  `{"time":1700000000000,"level":"info","kind":"event","process":"cli","scope":"project","trace":{"traceId":"00000000000000000000000000000001","spanId":"0000000000000001"},"attributes":{"fqn":"iterate-dev-image"},"data":{"type":"apply.resource.note","fqn":"iterate-dev-image","id":"iterate-dev-image","message":"Preparing iterate-dev-image image… 0m 0s","kind":"status"}}`,
  `{"time":1700000000000,"level":"info","kind":"event","process":"cli","scope":"project","trace":{"traceId":"00000000000000000000000000000001","spanId":"0000000000000001"},"attributes":{},"data":{"type":"apply.resource.status","fqn":"Worker","id":"Worker","resourceType":"Cloudflare.Worker","status":"created","providerMode":"live"}}`,
];

test("Alchemy's events fold into its resources: each with its type, its planned action and its newest status", () => {
  let resources: Resource[] = [];
  for (const line of printed) {
    const read = readAlchemyLine(line);
    if (!read || !("event" in read)) throw new Error(`not an event: ${line}`);
    resources = foldAlchemyEvent(resources, read.event);
  }
  expect(resources).toEqual([
    {
      fqn: "DB",
      id: "DB",
      type: "Cloudflare.D1Database",
      action: null,
      status: "pending",
      note: null,
    },
    {
      fqn: "Worker",
      id: "Worker",
      type: "Cloudflare.Worker",
      action: "create",
      status: "created",
      note: null,
    },
    {
      fqn: "iterate-dev-image",
      id: "iterate-dev-image",
      type: "",
      action: null,
      status: null,
      note: "Preparing iterate-dev-image image… 0m 0s",
    },
  ]);
});

test("a record of another kind, and a line that is no record, are text lines of the alchemy step", () => {
  expect(
    readAlchemyLine(
      `{"time":1700000000000,"level":"info","kind":"log","process":"cli","scope":"project","trace":{"traceId":"00000000000000000000000000000001","spanId":"0000000000000001"},"attributes":{},"data":{"message":"Cloudflare: using environment variables (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN).","cause":null}}`,
    ),
  ).toEqual({
    text: "Cloudflare: using environment variables (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN).",
  });
  expect(readAlchemyLine("✓ Refreshing Cloudflare State Store credentials")).toEqual({
    text: "✓ Refreshing Cloudflare State Store credentials",
  });
  expect(readAlchemyLine("{ url: 'https://spec-d77c77.iterate-dev-preview.workers.dev' }")).toEqual(
    {
      text: "{ url: 'https://spec-d77c77.iterate-dev-preview.workers.dev' }",
    },
  );
});
