import { expect, test } from "vitest";
import { titleWithCount } from "./approvals-read.ts";

test("the tab's title carries the count of what waits, once, and loses it at zero", () => {
  expect(titleWithCount("Approvals · example.com · Dash", 2)).toBe(
    "(2) Approvals · example.com · Dash",
  );
  // the router wrote a new title, or the count changed: one count, never two
  expect(titleWithCount("(2) Secrets · example.com · Dash", 3)).toBe(
    "(3) Secrets · example.com · Dash",
  );
  expect(titleWithCount("(3) Secrets · example.com · Dash", 0)).toBe(
    "Secrets · example.com · Dash",
  );
  expect(titleWithCount("example.com · Dash", 0)).toBe("example.com · Dash");
});
