import { expect, test, vi } from "vitest";
import { Wizard, type Draft, type PersonView, type WizardDeps } from "./wizard.ts";

test("the first deployment: connect, come back, choose the account, name it, review, install", async () => {
  const { wizard, deps } = start("");
  wizard.update(person());
  expect(wizard.view()).toMatchObject({ step: "connect", last: null });
  await wizard.connect();
  expect(deps.navigate).toHaveBeenCalledWith("https://os.example/.secrets/oauth/start/abc");

  // the round trip to Cloudflare is a new page: the URL names the connection, the draft is the tab's
  const back = start("?connection=aaaabbbbcccc", deps.storage);
  back.wizard.update(person([connected("aaaabbbbcccc", [personal, work])]));
  await back.wizard.settleReturn();
  expect(back.deps.settle).toHaveBeenCalledWith("aaaabbbbcccc");
  expect(back.wizard.view()).toMatchObject({
    step: "account",
    choices: [{ account: personal }, { account: work }],
  });

  back.wizard.choose({ connection: "aaaabbbbcccc", account: work, cloudflareUser: null });
  expect(back.wizard.view()).toMatchObject({ step: "name", value: "iterate" });
  back.wizard.type("Not A Name");
  await back.wizard.submitName();
  expect(back.wizard.view()).toMatchObject({
    step: "name",
    error: expect.stringContaining("lowercase"),
  });

  back.deps.checkName.mockResolvedValueOnce({
    status: "taken",
    message: "Work already has a Worker named jeeves.",
  });
  back.wizard.type("jeeves");
  await back.wizard.submitName();
  expect(back.wizard.view()).toMatchObject({
    step: "name",
    error: "Work already has a Worker named jeeves.",
  });

  back.wizard.type("my-iterate");
  await back.wizard.submitName();
  expect(back.wizard.view()).toMatchObject({
    step: "review",
    name: "my-iterate",
    choice: { account: work },
  });
  await back.wizard.install();
  expect(back.deps.create).toHaveBeenCalledWith({
    request: "request-0000000001",
    connection: "aaaabbbbcccc",
    accountId: work.id,
    name: "my-iterate",
  });
  expect(back.deps.navigate).toHaveBeenLastCalledWith("/deployments/dep_aaaabbbbccccdddd");
  // the next visit to /new is a new deployment, through the same connection
  expect(back.deps.storage.read()).toEqual({ connection: "aaaabbbbcccc" });
});

test("a closed tab comes back to the step it left", () => {
  const storage = memory({
    connection: "aaaabbbbcccc",
    accountId: personal.id,
    name: "my-iterate",
  });
  const { wizard } = start("", storage);
  wizard.update(person([connected("aaaabbbbcccc", [personal, work])]));
  expect(wizard.view()).toMatchObject({
    step: "name",
    value: "my-iterate",
    choice: { account: personal },
  });
});

test("a connect that came back unfinished says so, and a lost answer to Install keeps its request id", async () => {
  const { wizard } = start("?connection=aaaabbbbcccc");
  wizard.update(person([{ ...connected("aaaabbbbcccc", []), status: "pending", accounts: [] }]));
  await wizard.settleReturn();
  expect(wizard.view()).toMatchObject({ step: "connect", last: { status: "pending" } });

  const storage = memory({
    connection: "aaaabbbbcccc",
    accountId: personal.id,
    name: "my-iterate",
  });
  const retry = start("", storage);
  retry.wizard.update(person([connected("aaaabbbbcccc", [personal])]));
  await retry.wizard.submitName();
  retry.deps.create.mockRejectedValueOnce(new Error("socket closed"));
  await retry.wizard.install();
  expect(retry.wizard.view()).toMatchObject({ step: "review", error: "socket closed" });
  await retry.wizard.install();
  expect(retry.deps.create.mock.calls.map(([input]) => input.request)).toEqual([
    "request-0000000001",
    "request-0000000001",
  ]);
});

test("back from Cloudflare, the live state lands before the connect is settled: the wizard waits, then moves on with the settled account, not the one it had", async () => {
  // the draft still names an older connection's account
  const storage = memory({ connection: "ddddccccbbbb", accountId: work.id });
  const { wizard, deps } = start("?connection=aaaabbbbcccc", storage);
  let settled = () => {};
  deps.settle.mockImplementationOnce(() => new Promise<void>((resolve) => (settled = resolve)));
  const pending = { ...connected("aaaabbbbcccc", []), status: "pending" as const, accounts: [] };
  const older = connected("ddddccccbbbb", [work]);
  const settling = wizard.settleReturn();
  wizard.update(person([older, pending]));
  expect(wizard.view()).toMatchObject({ step: "loading" });
  // the settlement answers before its live state lands: the connect still reads pending
  settled();
  await settling;
  expect(wizard.view()).toMatchObject({ step: "name", choice: { account: work } });
  // then the settled connection arrives, and the wizard takes its account
  wizard.update(person([older, connected("aaaabbbbcccc", [personal])]));
  expect(wizard.view()).toMatchObject({
    step: "name",
    choice: { connection: "aaaabbbbcccc", account: personal },
  });
});

test("a connect whose settlement fails says so, even when an older connected account lets the wizard go on", async () => {
  const storage = memory({ connection: "ddddccccbbbb", accountId: work.id });
  const { wizard, deps } = start("?connection=aaaabbbbcccc", storage);
  deps.settle.mockRejectedValueOnce(new Error("Cloudflare listed no accounts: HTTP 500"));
  wizard.update(person([connected("ddddccccbbbb", [work])]));
  await wizard.settleReturn();
  expect(wizard.view()).toMatchObject({ step: "name", choice: { account: work } });
  expect(wizard.returnError()).toBe("Cloudflare listed no accounts: HTTP 500");
});

function start(search: string, storage = memory({})) {
  let requests = 0;
  const deps = {
    connect: vi.fn(async () => ({ url: "https://os.example/.secrets/oauth/start/abc" })),
    settle: vi.fn<WizardDeps["settle"]>(async () => undefined),
    create: vi.fn<WizardDeps["create"]>(async () => ({ id: "dep_aaaabbbbccccdddd" })),
    checkName: vi.fn<WizardDeps["checkName"]>(async () => ({ status: "free", message: "free" })),
    navigate: vi.fn(),
    storage,
    search,
    newRequestId: () => `request-${String(++requests).padStart(10, "0")}`,
  };
  return { wizard: new Wizard(deps), deps };
}

function memory(initial: Draft) {
  let draft = initial;
  return { read: () => draft, write: (next: Draft) => void (draft = next) };
}

const person = (
  connections: PersonView["connections"] = [],
  deployments: PersonView["deployments"] = [],
): PersonView => ({
  sub: "user_aaaabbbbccccddddaaaabbbbccccdddd",
  email: "ada@example.test",
  platform: null,
  x: null,
  connections,
  deployments,
});
const connected = (
  id: string,
  accounts: { id: string; name: string }[],
): PersonView["connections"][number] => ({
  id,
  requestOffset: 2,
  status: "connected",
  startedAt: "2026-11-06T12:00:00.000Z",
  cloudflareUser: "ada@example.test",
  accounts,
  scopes: [],
  error: null,
  settledAt: "2026-11-06T12:01:00.000Z",
});
const personal = { id: "11111111111111111111111111111111", name: "Ada" };
const work = { id: "33333333bbbbbbbbbbbbbbbbbbbbbbbb", name: "Work" };
