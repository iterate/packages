import { expect, test } from "vitest";
import { DeploymentState, type Run } from "./records.ts";
import { installStatusOf, installStepsOf, nextStepsOf } from "./views.ts";

test("a deployment its creation reached but never requested is not started, which its page offers to start again", () => {
  // creation.ts makes the deployment reachable before it lists it: its state is the empty one
  const reached = DeploymentState.parse({});
  expect(installStatusOf(reached)).toBe("not-started");
  expect(installStepsOf(reached).map((step) => step.status)).not.toContain("running");
});

test("an install whose first deploy failed and whose retry succeeded is installed", () => {
  const retried = creation(deploy(9, "succeeded"), [deploy(5, "failed", "Alchemy exited with 1")]);
  // the installer's sandbox, then the deploy's namespace, image, build, alchemy and check
  expect(installStepsOf(retried).map((step) => step.status)).toEqual(Array(6).fill("succeeded"));
  // installStatusOf reads the record only for "not started"
  expect(installStatusOf({ ...retried, record: {} as never, url: null })).toBe("installed");
});

test("an update that fails after the install leaves the deployment installed", () => {
  const updated = creation(deploy(14, "failed", "Alchemy exited with 1"), [deploy(9, "succeeded")]);
  const url = "https://my-iterate.example.workers.dev";
  expect(installStatusOf({ ...updated, record: {} as never, url })).toBe("installed");
  expect(installStatusOf({ ...updated, record: {} as never, url: null })).toBe("failed");
});

test("a plan after the install keeps showing the newest deploy's steps", () => {
  const planned = creation({ ...deploy(12, "open"), kind: "plan" }, [
    deploy(5, "failed", "x"),
    deploy(9, "succeeded"),
  ]);
  expect(installStepsOf(planned).every((step) => step.status === "succeeded")).toBe(true);
});

test("a destroy that succeeded leaves the deployment destroyed until a deploy succeeds", () => {
  const destroy = { ...deploy(14, "succeeded"), kind: "destroy" as const };
  const statusOf = (run: Run, history: Run[], url: string | null = null) =>
    installStatusOf({ ...creation(run, history), record: {} as never, url });
  expect(statusOf(destroy, [deploy(9, "succeeded")])).toBe("destroyed");
  // a plan changes nothing in the account, and a deploy that fails installs nothing
  expect(
    statusOf({ ...deploy(16, "succeeded"), kind: "plan" }, [deploy(9, "succeeded"), destroy]),
  ).toBe("destroyed");
  expect(statusOf(deploy(18, "failed", "x"), [deploy(9, "succeeded"), destroy])).toBe("destroyed");
  expect(statusOf(deploy(18, "open"), [deploy(9, "succeeded"), destroy])).toBe("destroyed");
  // a deploy that succeeds sets the URL again
  const url = "https://my-iterate.example.workers.dev";
  expect(statusOf(deploy(20, "succeeded"), [deploy(9, "succeeded"), destroy], url)).toBe(
    "installed",
  );
});

test("the image copy shows only for a run that reached it: never before, during or after a run without one", () => {
  const ids = (run: Run | null) => installStepsOf(creation(run as Run, [])).map((step) => step.id);
  const withoutImage = (status: Run["status"]): Run => ({
    ...deploy(9, status),
    steps: deploy(9, status).steps.filter((step) => step.name !== "image"),
  });
  const noRow = ["sandbox", "namespace", "build", "alchemy", "check"];
  expect(ids(null)).toEqual(noRow);
  expect(ids(withoutImage("open"))).toEqual(noRow);
  expect(ids(withoutImage("succeeded"))).toEqual(noRow);
  // a toolchain with an image source: its run reached the copy
  expect(ids(deploy(9, "succeeded"))).toEqual([
    "sandbox",
    "namespace",
    "image",
    "build",
    "alchemy",
    "check",
  ]);
});

test("the end of the wizard: the project to create, the agent, MCP, the CLI and the deployment", () => {
  const steps = nextStepsOf(
    {
      name: "my-iterate",
      accountId: "1".repeat(32),
      project: "home",
      domain: { hostname: "example.com", zone: { id: "a".repeat(32), name: "example.com" } },
    },
    "https://my-iterate.ada.workers.dev",
    undefined,
  );
  // the platform at iterate.<domain>; the domain itself the project's site, as Jeeves's
  expect(steps).toMatchObject({
    dash: "https://iterate.example.com/.auth/sign-in/iterate?next=/",
    agents:
      "https://agents.iterate.com/.auth/connect?issuer=https%3A%2F%2Fiterate.example.com&next=%2Fprojects%2Fhome",
    site: "https://example.com/",
    mcp: "https://iterate.example.com/mcp",
    worker: "https://iterate.example.com",
  });
  expect(steps.cliCommands[0]).toBe(
    "npx iterate config set --name my-iterate --os-base-url https://iterate.example.com --default-project home",
  );
  // no domain: the workers.dev origin, projects as paths
  const plain = nextStepsOf(
    { name: "x-y-z", accountId: "1".repeat(32), project: "home", domain: null },
    "https://x-y-z.ada.workers.dev/",
    "https://cloud-dev-dash.iterate-dev-preview.workers.dev",
  );
  expect(plain).toMatchObject({ site: "https://x-y-z.ada.workers.dev/projects/home/" });
  // the playground's Dash has its Agents app beside it
  expect(plain.agents).toMatch(
    /^https:\/\/cloud-dev-agents\.iterate-dev-preview\.workers\.dev\/\.auth\/connect/,
  );
});

function deploy(requestOffset: number, status: Run["status"], error: string | null = null): Run {
  const failed = status === "failed";
  return {
    requestOffset,
    kind: "deploy",
    requestedAt: "2026-11-06T12:00:00.000Z",
    status,
    attempt: 1,
    lines: 0,
    steps: [
      { name: "namespace", status: "succeeded", lines: 0, tail: [] },
      { name: "image", status: "succeeded", lines: 0, tail: [] },
      { name: "build", status: "succeeded", lines: 0, tail: [] },
      { name: "alchemy", status: failed ? "failed" : "succeeded", lines: 0, tail: [] },
      { name: "check", status: failed ? "pending" : "succeeded", lines: 0, tail: [] },
    ],
    resources: [],
    error,
    settledAt: "2026-11-06T12:05:00.000Z",
  };
}

function creation(run: Run, history: Run[]) {
  return {
    record: null,
    preparation: { requestOffset: 1, status: "succeeded" as const, attempt: 1, error: null },
    run,
    history,
  };
}
