// @vitest-environment jsdom
// The call in a tab: a camera pressed when this page has no sending connection says why, and no
// call outside the tab is made for it.
import { expect, test, vi } from "vitest";
import { createCall } from "./call-engine.ts";

test("Camera on, pressed before this page's sending connection is up, says why instead of nothing", async () => {
  const facet = vi.fn(async () => ({}));
  const call = createCall({ facet, page: "page-a" });
  await call.toggleCamera();
  expect(call.ui).toMatchObject({
    camera: false,
    error: "No camera: this page's connection to the call is not up. Join the call first.",
  });
  expect(facet).not.toHaveBeenCalled();
  call.dispose();
});
