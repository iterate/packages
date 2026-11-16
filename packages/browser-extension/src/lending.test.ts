// The unmodified signed-in panel and its real group policy, with isolated fixture grants and API.
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { RpcSession, RpcTarget, type RpcStub } from "capnweb";
import { expect, test } from "vitest";
import type { ChromePage } from "./page.ts";

test("signed-in lends recover a dropped connection and enforce group changes, sign-out and mind switching", async () => {
  const directory = await mkdtemp(join(tmpdir(), "iterate-lending-fixture-"));
  const extension = new URL("../dist/", import.meta.url).pathname;
  const server = createServer((_, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(
      '<button id="top" style="position:fixed;top:8px;left:50%;transform:translateX(-80px);width:60px;height:28px" onclick="document.body.dataset.top=event.isTrusted">Top action</button><main style="padding:100px"><label>Message<input></label><button onclick="document.body.dataset.trusted=event.isTrusted">Send</button></main>',
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
  const lends: { host: string; browser: RpcStub<LentChrome> }[] = [];
  const stubs: { [Symbol.dispose](): void }[] = [];
  const sockets: { close(): void }[] = [];
  try {
    await context.routeWebSocket(/^wss:\/\/iterate\.(first|second)\.test\/api$/, (socket) => {
      const host = new URL(socket.url()).host;
      sockets.push(socket);
      const queue: string[] = [];
      let waiting: { resolve(value: string): void; reject(reason: Error): void } | undefined;
      let closed = false;
      socket.onMessage((message) => {
        const text = typeof message === "string" ? message : message.toString();
        if (waiting) {
          const current = waiting;
          waiting = undefined;
          current.resolve(text);
        } else queue.push(text);
      });
      socket.onClose(() => {
        closed = true;
        waiting?.reject(new Error("Fixture socket closed"));
      });
      const session = new RpcSession(
        {
          send: (message: string) => socket.send(message),
          receive: () => {
            const message = queue.shift();
            if (message) return Promise.resolve(message);
            if (closed) return Promise.reject(new Error("Fixture socket closed"));
            return new Promise<string>((resolve, reject) => {
              waiting = { resolve, reject };
            });
          },
          abort: () => socket.close(),
        },
        {
          whoami: async () => ({ mindSlug: host, principal: { email: "fixture@example.test" } }),
          provide: async (_name: string, browser: RpcStub<LentChrome>) => {
            lends.push({ host, browser: browser.dup() });
            return new FixtureLend();
          },
          append: async () => ({}),
        },
      );
      stubs.push(session.getRemoteMain());
    });
    const worker = context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
    const controller = await context.newPage();
    await controller.goto(`chrome-extension://${new URL(worker.url()).host}/index.html`);
    // Test-only grants are created here. No real session, cookie, profile or token is imported.
    const signIn = async (mind: string) => {
      await controller.evaluate(`chrome.storage.local.set({
        mind: "${mind}.test", browserName: "fixture",
        "oauth:session": { issuer: "https://iterate.${mind}.test", clientId: "fixture-client", accessToken: "fixture-only-grant", expiresAt: Date.now() + 3_600_000 },
      })`);
      await controller.reload();
      await expect
        .poll(() => lends.filter((lend) => lend.host === `iterate.${mind}.test`).length)
        .toBe(1);
      await expect.poll(() => controller.locator("#copy").count()).toBe(1);
      const lend = lends.find((lend) => lend.host === `iterate.${mind}.test`);
      if (!lend) throw new Error("Fixture was not lent");
      return lend.browser;
    };
    let first = await signIn("first");
    const { tabId } = await first.openPage({ url: `http://127.0.0.1:${address.port}/form` });
    await first.openPage({ url: `http://127.0.0.1:${address.port}/anchor` });
    let page = first.page(tabId);
    await page.getByLabel("Message").fill("signed-in panel");
    await page.getByRole("button", { name: "Top action", exact: true }).click();
    await page.getByRole("button", { name: "Send" }).click();
    expect(
      await first.cdp(tabId, "Runtime.evaluate", {
        expression: "document.body.dataset.trusted",
        returnByValue: true,
      }),
    ).toMatchObject({ result: { value: "true" } });
    const waiting = first
      .page(tabId)
      .getByRole("button", { name: "Not present" })
      .click({ timeout: 500 });
    const queued = first.page(tabId).getByLabel("Message").fill("queued", { timeout: 100 });
    await expect(queued).rejects.toThrow(/Timed out in page queue/);
    await expect(waiting).rejects.toThrow(/Timed out/);
    const transient = await first.openPage({ url: `http://127.0.0.1:${address.port}/transient` });
    const closedPage = first.page(transient.tabId);
    await closedPage.getByLabel("Message").fill("temporary");
    await controller.evaluate(`chrome.tabs.remove(${transient.tabId})`);
    await expect(closedPage.getByLabel("Message").fill("closed tab")).rejects.toThrow();
    await page.getByLabel("Message").fill("other tab still works");
    const stopPointerEvents = await controller.evaluate<string>(`(async () => {
      const {root} = await chrome.debugger.sendCommand({tabId:${tabId}}, 'DOM.getDocument', {depth:-1,pierce:true});
      function stop(node) {
        if (node.nodeName === 'BUTTON' && node.children?.some(child => child.nodeValue === 'Stop')) return node;
        for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) { const found=stop(child); if(found) return found; }
      }
      const button=stop(root); if(!button) throw new Error('Missing indicator Stop');
      const {object}=await chrome.debugger.sendCommand({tabId:${tabId}}, 'DOM.resolveNode', {nodeId:button.nodeId});
      const {result,exceptionDetails}=await chrome.debugger.sendCommand({tabId:${tabId}}, 'Runtime.callFunctionOn', {
        objectId:object.objectId, functionDeclaration:'function(){const pointer=getComputedStyle(this).pointerEvents;this.click();return pointer;}',returnByValue:true
      });
      if(exceptionDetails) throw new Error(exceptionDetails.text);
      return result.value;
    })()`);
    expect(stopPointerEvents).toBe("auto");
    await expect
      .poll(() => first.tabs())
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ tabId })]));
    await expect(page.getByLabel("Message").fill("stopped")).rejects.toThrow(/not in.*tab group/);
    const anchorGroup = await controller.evaluate<number>(
      `chrome.tabs.query({}).then(tabs=>tabs.find(tab=>tab.groupId !== -1).groupId)`,
    );
    await controller.evaluate(`chrome.tabs.group({groupId:${anchorGroup},tabIds:[${tabId}]})`);
    await page.getByLabel("Message").fill("returned after Stop");
    await first.detach(tabId);
    expect(await first.tabs()).toEqual(
      expect.arrayContaining([expect.objectContaining({ tabId, attached: false })]),
    );
    await page.getByLabel("Message").fill("reattached");
    const groupId = await controller.evaluate<number>(
      `chrome.tabs.get(${tabId}).then(tab => tab.groupId)`,
    );
    await controller.evaluate(`chrome.tabs.ungroup(${tabId})`);
    await expect(page.getByLabel("Message").fill("refused")).rejects.toThrow(/not in.*tab group/);
    await expect(first.cdp(tabId, "Runtime.evaluate", { expression: "1" })).rejects.toThrow(
      /not in.*tab group/,
    );
    await controller.evaluate(`chrome.tabs.group({groupId:${groupId},tabIds:[${tabId}]})`);
    await page.getByLabel("Message").fill("group restored");
    await controller.evaluate(`chrome.tabGroups.update(${groupId},{title:"not-the-mind"})`);
    await expect(page.getByLabel("Message").fill("refused")).rejects.toThrow(/not in.*tab group/);
    await controller.evaluate(`chrome.tabGroups.update(${groupId},{title:"first.test"})`);
    await page.getByLabel("Message").fill("title restored");
    const stalePage = page;
    sockets[0].close();
    await expect
      .poll(() => lends.filter((lend) => lend.host === "iterate.first.test").length, {
        timeout: 5_000,
      })
      .toBe(2);
    await expect.poll(() => controller.locator("#copy").count()).toBe(1);
    await expect(stalePage.getByLabel("Message").fill("stale connection")).rejects.toThrow();
    first = lends[1].browser;
    page = first.page(tabId);
    await page.getByLabel("Message").fill("recovered connection");
    await page.getByRole("button", { name: "Send" }).click();
    expect(
      await first.cdp(tabId, "Runtime.evaluate", {
        expression:
          "({value:document.querySelector('input').value,trusted:document.body.dataset.trusted})",
        returnByValue: true,
      }),
    ).toMatchObject({ result: { value: { value: "recovered connection", trusted: "true" } } });
    await controller.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect.poll(() => controller.locator("#logout").count()).toBe(0);
    await expect(page.getByLabel("Message").fill("signed out")).rejects.toThrow();
    const second = await signIn("second");
    expect(await second.tabs()).toHaveLength(0);
    await expect(second.page(tabId).getByLabel("Message").fill("other mind")).rejects.toThrow(
      /not in.*tab group/,
    );
    const other = await second.openPage({ url: `http://127.0.0.1:${address.port}/second` });
    await second.page(other.tabId).getByLabel("Message").fill("second mind");
    await controller.close();
    await expect(
      second.page(other.tabId).getByLabel("Message").fill("closed panel"),
    ).rejects.toThrow();
  } finally {
    for (const lend of lends) lend.browser[Symbol.dispose]();
    for (const stub of stubs) stub[Symbol.dispose]();
    await context.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

class FixtureLend extends RpcTarget {
  lendEnded() {
    return new Promise<string>(() => {});
  }
}

type LentChrome = {
  openPage(input: { url: string }): Promise<{ tabId: number }>;
  page(tabId: number): Promise<ChromePage>;
  tabs(): Promise<{ tabId: number; attached: boolean }[]>;
  cdp(tabId: number, method: string, params: Record<string, unknown>): Promise<unknown>;
  detach(tabId: number): Promise<void>;
};
