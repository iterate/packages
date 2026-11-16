// Real offscreen sockets and Chrome grants, using only an isolated profile and local TLS API.
import { execFileSync } from "node:child_process";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { createServer as createTlsServer } from "node:https";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { RpcSession, RpcTarget, type RpcStub } from "capnweb";
import { expect, test } from "vitest";
import { WebSocketServer } from "ws";
import type { ChromePage } from "./page.ts";

test("signed-in lends recover a dropped connection and enforce group changes, sign-out and mind switching", async () => {
  const directory = await mkdtemp(join(tmpdir(), "iterate-lending-fixture-"));
  const extension = join(directory, "extension");
  cpSync(new URL("../dist/", import.meta.url), extension, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(extension, "manifest.json"), "utf8"));
  expect(manifest.host_permissions).toBeUndefined();
  // The fixture starts after sign-in: grant only its two local hosts, without a headless prompt.
  manifest.host_permissions = [
    "https://iterate.first.test/*",
    "wss://iterate.first.test/*",
    "https://iterate.second.test/*",
    "wss://iterate.second.test/*",
  ];
  writeFileSync(join(extension, "manifest.json"), JSON.stringify(manifest));
  const server = createServer((_, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(
      '<button id="top" style="position:fixed;top:8px;left:50%;transform:translateX(-80px);width:60px;height:28px" onclick="document.body.dataset.top=event.isTrusted">Top action</button><main style="padding:100px"><label>Message<input></label><button onclick="document.body.dataset.trusted=event.isTrusted">Send</button></main>',
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server has no TCP port");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:P-256",
      "-nodes",
      "-keyout",
      join(directory, "key.pem"),
      "-out",
      join(directory, "cert.pem"),
      "-subj",
      "/CN=iterate.first.test",
      "-days",
      "1",
    ],
    { stdio: "ignore" },
  );
  const authorization = "Bearer fixture-only-grant";
  let authorizedChecks = 0;
  let refusedChecks = 0;
  const tls = createTlsServer(
    {
      key: readFileSync(join(directory, "key.pem")),
      cert: readFileSync(join(directory, "cert.pem")),
    },
    (request, response) => {
      const valid = request.headers.authorization === authorization;
      if (request.method === "POST" && valid) authorizedChecks += 1;
      if (request.method === "POST" && !valid) refusedChecks += 1;
      response.writeHead(valid ? 200 : 401);
      response.end();
    },
  );
  const webSockets = new WebSocketServer({
    server: tls,
    verifyClient: ({ req }: { req: IncomingMessage }) =>
      req.headers.authorization === authorization,
  });
  await new Promise<void>((resolve) => tls.listen(0, "127.0.0.1", resolve));
  const tlsAddress = tls.address();
  if (!tlsAddress || typeof tlsAddress === "string") throw new Error("TLS fixture has no port");
  const launch = () =>
    chromium.launchPersistentContext(join(directory, "profile"), {
      channel: "chromium",
      headless: true,
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
        "--ignore-certificate-errors",
        "--host-resolver-rules=MAP iterate.first.test 127.0.0.1,MAP iterate.second.test 127.0.0.1",
      ],
    });
  let context = await launch();
  const lends: { host: string; browser: RpcStub<LentChrome> }[] = [];
  const stubs: { [Symbol.dispose](): void }[] = [];
  const sockets: { close(code?: number, reason?: string): void; terminate(): void }[] = [];
  let failNextProvide = false;
  let refusedProvides = 0;
  try {
    webSockets.on("connection", (socket, request) => {
      expect(request.headers.authorization === authorization).toBe(true);
      const host = new URL(`https://${request.headers.host}`).hostname;
      sockets.push(socket);
      const queue: string[] = [];
      let waiting: { resolve(value: string): void; reject(reason: Error): void } | undefined;
      let closed = false;
      socket.on("message", (message) => {
        const text = typeof message === "string" ? message : message.toString();
        if (waiting) {
          const current = waiting;
          waiting = undefined;
          current.resolve(text);
        } else queue.push(text);
      });
      socket.on("close", () => {
        closed = true;
        waiting?.reject(new Error("Fixture socket closed"));
      });
      let providedBrowser: RpcStub<LentChrome> | undefined;
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
            if (failNextProvide) {
              failNextProvide = false;
              refusedProvides += 1;
              throw new Error("Durable Object is overloaded. Requests queued for too long.");
            }
            providedBrowser = browser.dup();
            lends.push({ host, browser: providedBrowser });
            return new FixtureLend();
          },
          append: async () => ({}),
          invoke: async (steps: unknown[]) => {
            const terminal = steps.at(-1);
            if (!providedBrowser || !Array.isArray(terminal) || terminal[0] !== "tabs")
              throw new Error("Unexpected fixture probe");
            return providedBrowser.tabs();
          },
        },
      );
      stubs.push(session.getRemoteMain());
    });
    const worker = context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
    let controller = await context.newPage();
    await controller.goto(`chrome-extension://${new URL(worker.url()).host}/index.html`);
    // Test-only grants are created here. No real session, cookie, profile or token is imported.
    const signIn = async (mind: string) => {
      await controller.evaluate(`chrome.storage.local.set({
        mind: "${mind}.test", browserName: "fixture",
        "oauth:session": { issuer: "https://iterate.${mind}.test:${tlsAddress.port}", clientId: "fixture-client", accessToken: "fixture-only-grant", expiresAt: Date.now() + 3_600_000 },
      })`);
      await controller.reload();
      await controller.getByRole("button", { name: "Share this browser", exact: true }).click();
      await expect
        .poll(
          async () => ({
            lends: lends.filter((lend) => lend.host === `iterate.${mind}.test`).length,
            panel: await controller.locator("#connection").innerText(),
          }),
          { timeout: 5_000 },
        )
        .toMatchObject({ lends: 1 });
      await expect.poll(() => controller.locator("#copy").count()).toBe(1);
      const lend = lends.find((lend) => lend.host === `iterate.${mind}.test`);
      if (!lend) throw new Error("Fixture was not lent");
      return lend.browser;
    };
    let first = await signIn("first");
    const screenshots = process.env.ITERATE_EXTENSION_SCREENSHOTS_DIR;
    if (screenshots)
      await controller.screenshot({ path: join(screenshots, "chrome-082-sharing-on.png") });
    await controller.close();
    expect(await first.tabs()).toEqual([]);
    controller = await context.newPage();
    await controller.goto(`chrome-extension://${new URL(worker.url()).host}/index.html`);
    await expect.poll(() => controller.locator("#copy").count()).toBe(1);
    expect(lends).toHaveLength(1);
    const { tabId } = await first.openPage({ url: `http://127.0.0.1:${address.port}/form` });
    await first.openPage({ url: `http://127.0.0.1:${address.port}/anchor` });
    let page = first.page(tabId);
    await page.getByLabel("Message").fill("signed-in panel");
    await first.cdp(tabId, "Input.insertText", { text: " activity proof " });
    await expect
      .poll(() => controller.locator("#tabs .badge").allTextContents())
      .toContain("typing");
    expect(await controller.locator("#instructions").textContent()).toContain(
      "while sharing is on",
    );
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
    sockets[0].terminate(); // Abnormal1006, as in the deploy incident.
    await expect
      .poll(() => lends.filter((lend) => lend.host === "iterate.first.test").length, {
        timeout: 5_000,
      })
      .toBe(2);
    await expect.poll(() => controller.locator("#copy").count()).toBe(1);
    await expect(stalePage.getByLabel("Message").fill("stale connection")).rejects.toThrow();
    first = lends[1].browser;
    // The redial succeeds, then its pager is cut and the following lend is refused.
    failNextProvide = true;
    sockets[1].terminate();
    await expect.poll(() => refusedProvides, { timeout: 5_000 }).toBe(1);
    await expect
      .poll(() => controller.getByRole("heading", { name: /Reconnecting, try/ }).count())
      .toBe(1);
    await controller.close();
    await expect
      .poll(() => lends.filter((lend) => lend.host === "iterate.first.test").length, {
        timeout: 65_000,
      })
      .toBe(3);
    first = lends[2].browser;
    controller = await context.newPage();
    await controller.goto(`chrome-extension://${new URL(worker.url()).host}/index.html`);
    await expect.poll(() => controller.locator("#copy").count()).toBe(1);
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
    const beforeRefusal = lends.length;
    await controller.evaluate(`chrome.storage.local.set({
      mind: "second.test", "oauth:session": { issuer: "https://iterate.second.test:${tlsAddress.port}",
      clientId: "fixture-client", accessToken: "revoked-fixture-grant", expiresAt: Date.now() + 3_600_000 }
    })`);
    await controller.reload();
    await controller.getByRole("button", { name: "Share this browser", exact: true }).click();
    await expect
      .poll(() => controller.getByRole("heading", { name: "Not connected", exact: true }).count())
      .toBe(1);
    expect(refusedChecks).toBe(1);
    expect(lends.length).toBe(beforeRefusal);
    const refusedCdp = await context.browser()!.newBrowserCDPSession();
    const refusedWorker = (await refusedCdp.send("Target.getTargets")).targetInfos.find(
      (target) => target.type === "service_worker" && target.url === worker.url(),
    );
    if (!refusedWorker) throw new Error("Missing refused worker");
    await refusedCdp.send("Target.closeTarget", { targetId: refusedWorker.targetId });
    await controller.reload();
    await expect
      .poll(() => controller.getByRole("heading", { name: "Not connected", exact: true }).count())
      .toBe(1);
    expect(refusedChecks).toBe(1);
    expect(lends.length).toBe(beforeRefusal);
    await controller.getByRole("button", { name: "Sign out", exact: true }).click();
    await refusedCdp.detach();
    const second = await signIn("second");
    expect(await second.tabs()).toHaveLength(0);
    await expect(second.page(tabId).getByLabel("Message").fill("other mind")).rejects.toThrow(
      /not in.*tab group/,
    );
    const other = await second.openPage({ url: `http://127.0.0.1:${address.port}/second` });
    await second.page(other.tabId).getByLabel("Message").fill("second mind");
    await controller.close();
    await second.page(other.tabId).getByLabel("Message").fill("closed panel still lent");
    const cdp = await context.browser()!.newBrowserCDPSession();
    const beforeDocumentLoss = lends.filter((lend) => lend.host === "iterate.second.test").length;
    const { targetInfos: documents } = await cdp.send("Target.getTargets");
    const document = documents.find((target) => target.url.includes("/offscreen.html?transport="));
    if (!document) throw new Error("Missing offscreen transport document");
    await cdp.send("Target.closeTarget", { targetId: document.targetId });
    await expect
      .poll(() => lends.filter((lend) => lend.host === "iterate.second.test").length, {
        timeout: 5_000,
      })
      .toBe(beforeDocumentLoss + 1);
    await lends
      .at(-1)!
      .browser.page(other.tabId)
      .getByLabel("Message")
      .fill("offscreen document restored");
    const { targetInfos } = await cdp.send("Target.getTargets");
    const target = targetInfos.find(
      (target) => target.type === "service_worker" && target.url === worker.url(),
    );
    if (!target) throw new Error("Missing extension service worker target");
    await cdp.send("Target.closeTarget", { targetId: target.targetId });
    await expect
      .poll(() => lends.filter((lend) => lend.host === "iterate.second.test").length, {
        timeout: 65_000,
      })
      .toBe(beforeDocumentLoss + 2);
    const restored = lends.at(-1)!.browser;
    await restored.page(other.tabId).getByLabel("Message").fill("worker restored");
    await expect(
      second.page(other.tabId).getByLabel("Message").fill("retired worker"),
    ).rejects.toThrow();
    controller = await context.newPage();
    await controller.goto(`chrome-extension://${new URL(worker.url()).host}/index.html`);
    await expect.poll(() => controller.locator("#copy").count()).toBe(1);
    await controller.getByRole("button", { name: "Turn sharing off", exact: true }).click();
    await expect.poll(() => controller.locator("#share").count()).toBe(1);
    await expect(restored.tabs()).rejects.toThrow();
    await cdp.detach();
    await controller.getByRole("button", { name: "Share this browser", exact: true }).click();
    await expect.poll(() => controller.locator("#copy").count()).toBe(1);
    const prior = lends.length;
    await context.close();
    context = await launch();
    const restartedWorker =
      context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
    controller = await context.newPage();
    await controller.goto(`chrome-extension://${new URL(restartedWorker.url()).host}/index.html`);
    await expect
      .poll(() => controller.getByRole("heading", { name: "Sharing off", exact: true }).isVisible())
      .toBe(true);
    await expect
      .poll(() =>
        controller.getByRole("button", { name: "Share this browser", exact: true }).isVisible(),
      )
      .toBe(true);
    expect(lends).toHaveLength(prior);
    expect(authorizedChecks).toBeGreaterThanOrEqual(lends.length);
    await controller.getByRole("button", { name: "Share this browser", exact: true }).click();
    await expect.poll(() => controller.locator("#copy").count()).toBe(1);
    const tokenTab = await lends
      .at(-1)!
      .browser.openPage({ url: `http://127.0.0.1:${address.port}/token-renewal` });
    const beforeTokenExpiry = lends.length;
    sockets.at(-1)!.close(1008, "the sign-in for this session ended: sign in again");
    await expect.poll(() => lends.length, { timeout: 5_000 }).toBe(beforeTokenExpiry + 1);
    await expect.poll(() => controller.locator("#copy").count()).toBe(1);
    expect(await lends.at(-1)!.browser.tabs()).toEqual(
      expect.arrayContaining([expect.objectContaining({ tabId: tokenTab.tabId })]),
    );
    await lends.at(-1)!.browser.page(tokenTab.tabId).getByLabel("Message").fill("token renewed");
    if (screenshots)
      await controller.screenshot({ path: join(screenshots, "chrome-082-sharing-off.png") });
  } finally {
    for (const lend of lends) lend.browser[Symbol.dispose]();
    for (const stub of stubs) stub[Symbol.dispose]();
    await context.close();
    for (const socket of webSockets.clients) socket.terminate();
    await new Promise<void>((resolve) => webSockets.close(() => resolve()));
    await new Promise<void>((resolve) => tls.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}, 180_000);

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
