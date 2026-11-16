// Real Chromium DOM and trusted CDP input on local fixtures. No user browser or network sites.
import { createServer } from "node:http";
import { chromium, type Page } from "@playwright/test";
import { build } from "esbuild";
import { newMessagePortRpcSession } from "capnweb";
import { test, expect } from "vitest";
import { ChromePage, type Cdp } from "./page.ts";

const runtime = await build({
  entryPoints: [new URL("./locator-runtime.ts", import.meta.url).pathname],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "globalThis.__iterateControls",
});
const source = runtime.outputFiles[0].text;

test("role, accessible name, labels, text and strict RPC chains use Ivya semantics", async () => {
  await fixture(async ({ page, controls }) => {
    await page.setContent(
      `<span id="name">Publish report</span><button aria-labelledby="name">Icon</button><label for="email">Email address</label><input id="email"><p>  A   message </p><div id="shadow"></div>`,
    );
    await page.evaluate(() => {
      document
        .querySelector("#shadow")
        ?.attachShadow({ mode: "open" })
        .append(Object.assign(document.createElement("button"), { textContent: "Shadow action" }));
    });
    const channel = new MessageChannel();
    using _server = newMessagePortRpcSession(channel.port1, controls);
    using remote = newMessagePortRpcSession<ChromePage>(channel.port2);
    await remote.getByLabel("Email address", { exact: true }).fill("a@example.test");
    await remote.getByRole("button", { name: "Publish report", exact: true }).click();
    expect(await remote.getByText("A message", { exact: true }).textContent()).toBe(
      "  A   message ",
    );
    expect(await remote.getByRole("button", { name: "Shadow action" }).count()).toBe(1);
    expect(await page.inputValue("#email")).toBe("a@example.test");
  });
});

test("click, fill, clearing and keyboard actions produce trusted browser events", async () => {
  await fixture(async ({ page, controls }) => {
    await page.setContent(
      `<button>Send</button><label>Message<input value="before"></label><script>window.events=[]; for(const t of ['click','input','keydown','keyup']) document.addEventListener(t,e=>events.push({type:e.type,trusted:e.isTrusted,key:e.key}));</script>`,
    );
    await controls.getByRole("button", { name: "Send" }).click();
    await controls.getByLabel("Message").fill("hello");
    await controls.getByLabel("Message").press("ArrowLeft");
    await controls.getByLabel("Message").press("Backspace");
    expect(await page.inputValue("input")).toBe("helo");
    await controls.getByLabel("Message").fill("");
    await controls.getByLabel("Message").press("Enter");
    expect(await page.inputValue("input")).toBe("");
    const events =
      await page.evaluate<Array<{ type: string; trusted: boolean; key?: string }>>("events");
    expect(events).toEqual(
      expect.arrayContaining([
        { type: "click", trusted: true },
        { type: "input", trusted: true },
        { type: "keydown", trusted: true, key: "Enter" },
        { type: "keyup", trusted: true, key: "Enter" },
      ]),
    );
    expect(events.filter((e: { trusted: boolean }) => !e.trusted)).toHaveLength(0);
  });
});

test("textarea replacement and Enter submit use native editing behavior", async () => {
  await fixture(async ({ page, controls }) => {
    await page.setContent(
      '<label>Notes<textarea>before</textarea></label><form onsubmit="event.preventDefault();document.body.dataset.submitted=\'true\'"><label>Email<input type="email"></label></form>',
    );
    await controls.getByLabel("Notes").fill("two\nlines");
    expect(await page.inputValue("textarea")).toBe("two\nlines");
    await controls.locator("form").getByLabel("Email").fill("agent@example.test");
    await controls.getByLabel("Email").press("Enter");
    expect(await page.getAttribute("body", "data-submitted")).toBe("true");
  });
});

test("locators wait for delayed DOM and re-resolve replaced nodes", async () => {
  await fixture(async ({ page, controls }) => {
    const field = controls.getByLabel("Later");
    await page.evaluate(() => {
      setTimeout(() => {
        document.body.innerHTML = "<label>Later<input></label>";
      }, 120);
    });
    await field.fill("first");
    await page.evaluate(() => {
      const input = document.querySelector("input");
      input?.replaceWith(input.cloneNode());
    });
    await field.fill("second");
    expect(await page.inputValue("input")).toBe("second");
  });
});

test("duplicates fail strictly while first and nth select deliberately", async () => {
  await fixture(async ({ page, controls }) => {
    await page.setContent(`<button>Same</button><button>Same</button>`);
    await expect(controls.getByRole("button", { name: "Same" }).click()).rejects.toThrow(
      /strict mode violation: 2 matches/,
    );
    expect(await controls.getByRole("button").count()).toBe(2);
    await controls.getByRole("button").first().click();
    await controls.getByRole("button").nth(1).click();
  });
});

test("missing elements time out with the locator and no input", async () => {
  await fixture(async ({ controls, commands }) => {
    await expect(
      controls.getByRole("button", { name: "Absent" }).click({ timeout: 1000 }),
    ).rejects.toThrow(/Timed out: click.*Absent.*no match/s);
    expect(commands.filter((method) => method.startsWith("Input."))).toHaveLength(0);
  });
});

test.for([
  {
    name: "hidden",
    html: '<button style="visibility:hidden">Act</button>',
    release: 'document.querySelector("button").style.visibility="visible"',
    reason: "hidden",
  },
  {
    name: "disabled fieldset",
    html: "<fieldset disabled><button>Act</button></fieldset>",
    release: 'document.querySelector("fieldset").disabled=false',
    reason: "disabled",
  },
  {
    name: "ARIA disabled",
    html: '<div role="group" aria-disabled="true"><button>Act</button></div>',
    release: 'document.querySelector("div").removeAttribute("aria-disabled")',
    reason: "disabled",
  },
  {
    name: "inert",
    html: "<div inert><button>Act</button></div>",
    release: 'document.querySelector("div").inert=false',
    reason: "disabled or inert",
  },
  {
    name: "covered",
    html: '<button>Act</button><div id="cover" style="position:fixed;inset:0;background:red"></div>',
    release: 'document.querySelector("#cover").remove()',
    reason: "covered",
  },
])("$name controls wait without input and recover", async ({ html, release, reason }) => {
  await fixture(async ({ page, controls, commands }) => {
    await page.setContent(html);
    await expect(controls.locator("button").click({ timeout: 1000 })).rejects.toThrow(
      new RegExp(reason),
    );
    expect(commands.filter((method) => method.startsWith("Input."))).toHaveLength(0);
    await page.evaluate(`setTimeout(() => { ${release} }, 120)`);
    await controls.locator("button").click();
  });
});

test("read-only fill waits and unsupported controls fail before input", async () => {
  await fixture(async ({ page, controls, commands }) => {
    await page.setContent(
      '<input aria-label="Read only" readonly><input type="number" aria-label="Number"><div contenteditable aria-label="Editor"></div>',
    );
    await expect(controls.getByLabel("Read only").fill("x", { timeout: 1000 })).rejects.toThrow(
      /read-only/,
    );
    await expect(controls.getByLabel("Number").fill("1")).rejects.toThrow(/input type number/);
    await expect(controls.getByLabel("Editor").fill("x")).rejects.toThrow(
      /text inputs and textareas only/,
    );
    await expect(controls.getByLabel("Read only").press("Control+A")).rejects.toThrow(
      /Unsupported key/,
    );
    expect(commands.filter((method) => method.startsWith("Input."))).toHaveLength(0);
  });
});

test("moving targets settle before click and replaced targets are re-resolved", async () => {
  await fixture(async ({ page, controls }) => {
    await page.setContent(
      '<button style="position:absolute;left:0">Move</button><script>let n=0; const t=setInterval(()=>{const b=document.querySelector("button");b.style.left=(++n*10)+"px"; if(n===8) {clearInterval(t);b.replaceWith(b.cloneNode(true));}},20);</script>',
    );
    await controls.getByRole("button", { name: "Move" }).click();
    expect(await page.locator("button").evaluate((el) => el.getBoundingClientRect().left)).toBe(80);
  });
});

test("retained locators resolve in a new document and actions do not wait for navigation", async () => {
  await fixture(async ({ page, controls, url }) => {
    const button = controls.getByRole("button", { name: "Fixture" });
    await button.click();
    await page.goto(`${url}/next`);
    await button.click();
    expect(await page.evaluate("window.clicked")).toBe(1);
    await page.setContent(`<a href="${url}/next">Navigate</a>`);
    await controls.getByRole("link", { name: "Navigate" }).click();
    await page.waitForURL(`${url}/next`);
    await button.click();
    expect(await page.evaluate("window.clicked")).toBe(1);
  });
});

test("navigation between readiness and input fails without replay", async () => {
  await fixture(async ({ page, controls, commands, intercept, url }) => {
    let frames = 0;
    intercept.current = async (method) => {
      if (method === "Page.getFrameTree" && ++frames === 3) await page.goto(`${url}/next`);
    };
    await expect(controls.getByRole("button", { name: "Fixture" }).click()).rejects.toThrow(
      /Navigation changed the document/,
    );
    expect(commands.filter((method) => method.startsWith("Input."))).toEqual([
      "Input.dispatchMouseEvent",
    ]);
  });
});

test("frames are explicit limits and cross-frame contents are not selected", async () => {
  await fixture(async ({ page, controls }) => {
    await page.setContent('<iframe srcdoc="<button>Inside</button>"></iframe>');
    await expect(controls.locator("iframe").click()).rejects.toThrow(
      /Frame controls are unsupported/,
    );
    expect(await controls.getByRole("button", { name: "Inside" }).count()).toBe(0);
  });
});

test("transport revocation fails immediately and retained handles cannot bypass it", async () => {
  await fixture(async ({ controls, intercept, commands }) => {
    const retained = controls.getByRole("button", { name: "Fixture" });
    await retained.click();
    const count = commands.length;
    intercept.current = async () => {
      throw new Error("Tab is not in the mind's tab group");
    };
    await expect(retained.click()).rejects.toThrow(/not in the mind's tab group/);
    expect(commands.slice(count)).toEqual(["Page.getFrameTree"]);
  });
});

test("a stalled CDP command is bounded and a key press always attempts release", async () => {
  await fixture(async ({ controls, intercept, commands }) => {
    intercept.current = async (method, params) => {
      if (method === "Input.dispatchKeyEvent" && params.type === "keyDown")
        throw new Error("transport failed");
    };
    await expect(controls.getByRole("button", { name: "Fixture" }).press("Enter")).rejects.toThrow(
      /transport failed/,
    );
    expect(commands.slice(-2)).toEqual(["Input.dispatchKeyEvent", "Input.dispatchKeyEvent"]);
    intercept.current = async () => {
      await new Promise(() => {});
    };
    await expect(controls.locator("button").click({ timeout: 100 })).rejects.toThrow(
      /exceeded action deadline/,
    );
  });
});

test("queued actions have their own bounded deadline and never run after expiry", async () => {
  await fixture(async ({ controls, intercept, commands }) => {
    intercept.current = async () => {
      await new Promise(() => {});
    };
    const first = controls.locator("button").click({ timeout: 300 });
    const second = controls.locator("button").click({ timeout: 80 });
    await expect(second).rejects.toThrow(/Timed out in page queue/);
    await expect(first).rejects.toThrow(/exceeded action deadline/);
    expect(commands).toEqual(["Page.getFrameTree"]);
  });
});

test("hover replacement is checked again before the mouse goes down", async () => {
  await fixture(async ({ page, controls }) => {
    await page.setContent("<button>Save</button>");
    await page.evaluate(() => {
      document.querySelector("button")?.addEventListener(
        "mouseenter",
        (event) => {
          const button = document.createElement("button");
          button.textContent = "Save";
          button.addEventListener("click", () => {
            document.body.dataset.saved = "true";
          });
          if (event.target instanceof Element) event.target.replaceWith(button);
        },
        { once: true },
      );
    });
    await controls.getByRole("button", { name: "Save" }).click();
    expect(await page.getAttribute("body", "data-saved")).toBe("true");
  });
});

test("shadow buttons accept hits on assigned slot content", async () => {
  await fixture(async ({ page, controls }) => {
    await page.setContent("<x-save><span>Save</span></x-save>");
    await page.evaluate(() => {
      const host = document.querySelector("x-save");
      if (!host) throw new Error("Missing component");
      const button = document.createElement("button");
      button.append(document.createElement("slot"));
      button.addEventListener("click", () => {
        document.body.dataset.saved = "true";
      });
      host.attachShadow({ mode: "open" }).append(button);
    });
    await controls.getByRole("button", { name: "Save", exact: true }).click();
    expect(await page.getAttribute("body", "data-saved")).toBe("true");
  });
});

async function fixture(
  run: (fixture: {
    page: Page;
    controls: ChromePage;
    commands: string[];
    url: string;
    intercept: { current?: (method: string, params: Record<string, unknown>) => Promise<void> };
  }) => Promise<void>,
) {
  const server = createServer((_, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end('<button onclick="window.clicked=(window.clicked||0)+1">Fixture</button>');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server has no TCP port");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const url = `http://127.0.0.1:${address.port}`;
    await page.goto(url);
    const session = await page.context().newCDPSession(page);
    const commands: string[] = [];
    const intercept: {
      current?: (method: string, params: Record<string, unknown>) => Promise<void>;
    } = {};
    const cdp: Cdp = async (method, params) => {
      commands.push(method);
      await intercept.current?.(method, params);
      // The browser session accepts the same CDP method/params pairs as chrome.debugger.sendCommand.
      return session.send(method as Parameters<typeof session.send>[0], params) as ReturnType<Cdp>;
    };
    await run({ page, controls: new ChromePage(cdp, source), commands, url, intercept });
  } finally {
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
