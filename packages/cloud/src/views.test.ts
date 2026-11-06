import { expect, test } from "vitest";
import type { Run } from "./records.ts";
import { installStatusOf, installStepsOf } from "./views.ts";

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
