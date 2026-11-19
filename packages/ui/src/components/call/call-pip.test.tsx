// @vitest-environment jsdom
// The call's floating window: no button where the browser has no Document Picture-in-Picture; where
// it has, a press moves the tiles to the window and "Back to the tab" brings them back.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { CallPipButton, CallPipPlace, useCallPip } from "./call-pip.tsx";
import type { CallUi, CallVideo } from "#/lib/call-engine.ts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
test("a browser with no Document Picture-in-Picture gets no button", async () => {
  using page = await mount({ videos: [CAMERA] } as CallUi);
  expect(page.host.querySelector("button")).toBeNull();
  expect(page.host.querySelector("#tiles")).not.toBeNull();
});

test("Pop out moves the tiles to the floating window; Back to the tab brings them home", async () => {
  const floating = document.implementation.createHTMLDocument("pip");
  const close = vi.fn();
  const window = { document: floating, close, addEventListener: () => {} };
  using _api = documentPip({ requestWindow: vi.fn(async () => window) });
  {
    // nobody has a picture on: nothing to pop out
    using page = await mount({ videos: [] as CallVideo[] } as CallUi);
    expect(page.host.querySelector("button")).toMatchObject({ disabled: true });
  }
  using page = await mount({ videos: [CAMERA] } as CallUi);
  await act(async () => page.host.querySelector("button")!.click());
  expect(floating.body.querySelector("#tiles")).not.toBeNull();
  expect(page.host.querySelector("#tiles")).toBeNull();
  expect(page.host.querySelector("button")?.getAttribute("aria-label")).toBe("Back to the tab");
  await act(async () => page.host.querySelector("button")!.click());
  expect(close).toHaveBeenCalledOnce();
  expect(page.host.querySelector("#tiles")).not.toBeNull();
  expect(page.host.querySelector("button")?.getAttribute("aria-label")).toBe("Pop out");
});

const CAMERA = { key: "a:camera", name: "Ada", kind: "camera", local: false } as CallVideo;

function Page({ ui }: { ui: CallUi }) {
  const pip = useCallPip(ui);
  return (
    <>
      <CallPipButton pip={pip} />
      <CallPipPlace pip={pip}>
        <p id="tiles">tiles</p>
      </CallPipPlace>
    </>
  );
}

async function mount(ui: CallUi) {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(<Page ui={ui} />));
  return {
    host,
    [Symbol.dispose]: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

/** The browser's Document Picture-in-Picture, for one test. */
function documentPip(api: object) {
  Object.assign(globalThis, { documentPictureInPicture: api });
  return {
    [Symbol.dispose]: () => {
      delete (globalThis as { documentPictureInPicture?: unknown }).documentPictureInPicture;
    },
  };
}
