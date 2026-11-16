// The packaged facade through chrome.debugger in a fresh headless extension profile.
import { cp, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { expect, test } from "vitest";

test("the packaged extension renders valid calls, sends trusted input and obeys revocation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "iterate-extension-fixture-"));
  const extension = join(directory, "extension");
  await cp(new URL("../dist/", import.meta.url), extension, { recursive: true });
  const server = createServer((_, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(
      '<label>Message<input></label><button onclick="document.body.dataset.trusted=event.isTrusted">Send</button>',
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server has no TCP port");
  const context = await chromium.launchPersistentContext(join(directory, "profile"), {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const worker = context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
    const controller = await context.newPage();
    await controller.goto(`chrome-extension://${new URL(worker.url()).host}/index.html`);
    const instructions = await controller.evaluate<string>(
      `import('./panel.js').then(({agentInstructions}) => agentInstructions('fixture.test','itx.chrome.fixture.browser',[]))`,
    );
    expect(instructions).toContain(
      '`await itx.cd("/").chrome.fixture.browser.page(tabId).getByRole("button", { name: "Save", exact: true }).click()`',
    );
    expect(instructions).toContain('- `await itx.cd("/").chrome.fixture.browser.page(tabId)`:');
    expect(instructions).not.toContain("``");
    // This fixture grants its own local tab only. It does not sign in or lend a Chrome to a mind.
    const tabId = await controller.evaluate<number>(`(async () => {
      const { ChromePage } = await import('./page.js');
      const { locatorSource } = await import('./locator-source.js');
      const tab = await chrome.tabs.create({url: 'http://127.0.0.1:${address.port}', active: false});
      await new Promise(resolve => {
        const listener = (id, change) => { if(id === tab.id && change.status === 'complete') { chrome.tabs.onUpdated.removeListener(listener); resolve(); } };
        chrome.tabs.onUpdated.addListener(listener);
        chrome.tabs.get(tab.id).then(current => listener(tab.id, {status: current.status}));
      });
      await chrome.debugger.attach({tabId:tab.id}, '1.3');
      globalThis.fixtureGranted = true;
      globalThis.fixturePage = new ChromePage((method, params) => {
        if (!globalThis.fixtureGranted) throw new Error('fixture tab revoked');
        return chrome.debugger.sendCommand({tabId:tab.id},method,params);
      }, locatorSource);
      return tab.id;
    })()`);
    await controller.evaluate(`fixturePage.getByLabel('Message').fill('from extension')`);
    await controller.evaluate(`fixturePage.getByRole('button', {name:'Send'}).click()`);
    const result = await controller.evaluate<{
      result: { value: { value: string; trusted: string } };
    }>(
      `chrome.debugger.sendCommand({tabId:${tabId}},'Runtime.evaluate',{expression:'({value:document.querySelector("input").value,trusted:document.body.dataset.trusted})',returnByValue:true})`,
    );
    expect(result).toMatchObject({
      result: { value: { value: "from extension", trusted: "true" } },
    });
    await controller.evaluate("globalThis.fixtureGranted = false");
    await expect(
      controller.evaluate(`fixturePage.getByLabel('Message').fill('revoked')`),
    ).rejects.toThrow(/fixture tab revoked/);
  } finally {
    await context.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
