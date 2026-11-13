// The member's itx on a mind's own host: when a closed socket reloads the page, and which mind a
// host is of.
import { expect, test } from "vitest";
import { mindOfHost, reloadAfterClose } from "./member-itx.ts";

test("three closes in a minute stop the reloads; a minute later the page reloads again", () => {
  const tab = storage();
  expect([0, 1_000, 2_000, 3_000].map((at) => reloadAfterClose(tab, at))).toEqual([
    true,
    true,
    true,
    false,
  ]);
  expect(reloadAfterClose(tab, 70_000)).toBe(true);
});

test("storage that cannot be read or holds something else is no close yet", () => {
  const broken = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {},
  };
  expect(reloadAfterClose(broken, 0)).toBe(true);
  const odd = storage();
  odd.setItem("itx-closes", '{"not":"a list"}');
  expect(reloadAfterClose(odd, 0)).toBe(true);
});

test("an app's host is one label under its mind", () => {
  expect(mindOfHost("dash.example.com")).toBe("example.com");
  expect(mindOfHost("localhost")).toBe("localhost");
});

/** A tab's session storage. */
function storage() {
  const kept = new Map<string, string>();
  return {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
  };
}
