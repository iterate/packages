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
  expect(pressed(page.host)).toEqual(["Pop out", "true", "Back to the tab"]);
  await act(async () => page.host.querySelector("button")!.click());
  expect(close).toHaveBeenCalledOnce();
  expect(page.host.querySelector("#tiles")).not.toBeNull();
  expect(pressed(page.host)).toEqual(["Pop out", "false", "Pop out"]);
});

test("the window closes by itself when nothing shows, and the browser may still open it later", async () => {
  const floating = document.implementation.createHTMLDocument("pip");
  // a window that says `pagehide` as it closes, as Chrome's does
  const events = new EventTarget();
  const close = vi.fn(() => events.dispatchEvent(new Event("pagehide")));
  const window = {
    document: floating,
    close,
    addEventListener: events.addEventListener.bind(events),
  };
  using _api = documentPip({ requestWindow: vi.fn(async () => window) });
  using page = await mount({ videos: [CAMERA] } as CallUi);
  await act(async () => page.host.querySelector("button")!.click());
  await page.render({ videos: [] as CallVideo[] } as CallUi);
  expect(close).toHaveBeenCalledOnce();
  expect(page.host.querySelector("#tiles")).not.toBeNull();
  // still on: the browser opens it by itself when something shows and the tab is hidden
  expect(page.host.querySelector("button")?.getAttribute("aria-pressed")).toBe("true");
});

test("a window that comes after the last picture went is closed, and the tiles stay home", async () => {
  const floating = document.implementation.createHTMLDocument("pip");
  const close = vi.fn();
  const window = { document: floating, close, addEventListener: () => {} };
  let answer = (_window: object) => {};
  const asked = new Promise<object>((resolve) => (answer = resolve));
  using _api = documentPip({ requestWindow: vi.fn(() => asked) });
  using page = await mount({ videos: [CAMERA] } as CallUi);
  await act(async () => void page.host.querySelector("button")!.click());
  await page.render({ videos: [] as CallVideo[] } as CallUi);
  await act(async () => answer(window));
  expect(close).toHaveBeenCalledOnce();
  expect(page.host.querySelector("#tiles")).not.toBeNull();
});

/** The button's fixed name, whether it is on, and what a press does (its title's first words). */
function pressed(host: HTMLElement) {
  const button = host.querySelector("button")!;
  return [
    button.getAttribute("aria-label"),
    button.getAttribute("aria-pressed"),
    button.title.split(":")[0],
  ];
}

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
  const render = (next: CallUi) => act(async () => root.render(<Page ui={next} />));
  await render(ui);
  return {
    host,
    render,
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
