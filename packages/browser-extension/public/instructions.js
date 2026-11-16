export function agentInstructions(address, name, members) {
  const spelled = `itx.cd("/").${name.replace(/^itx\./, "")}`;
  const call = `\`await ${spelled}`;
  return [
    `My Chrome is lent to the mind ${address} as \`${name}\` on its root context, while sharing is on; closing my Iterate side panel does not end the lend. You drive the tabs in the "${address}" tab group of this Chrome. From an agent's script, spell it \`${spelled}\`:`,
    "",
    `- ${call}.tabs()\`: the tabs in the group, as [{ tabId, url, title, attached }]. If this call fails, sharing or the connection may have ended: tell me.`,
    `- ${call}.openPage({ url })\`: opens an http(s) page in a new tab in the group and answers { tabId, url } once it has loaded.`,
    `- ${call}.cdp(tabId, method, params)\`: one Chrome DevTools Protocol command on a tab in the group, for example \`"Runtime.evaluate", { expression: "document.title", returnByValue: true }\`, \`"Page.navigate", { url }\`, \`"Page.captureScreenshot", {}\` or \`"Accessibility.getFullAXTree", {}\`.`,
    `- ${call}.detach(tabId)\`: removes Chrome's debugging bar; the tab stays drivable.`,
    `- ${call}.page(tabId)\`: prototype Playwright-shaped handle. ${call}.page(tabId).getByRole("button", { name: "Save", exact: true }).click()\`. Locators also support getByText/getByLabel/locator, nth/first, count/textContent, fill(text), press("Enter" | "Tab" | "Backspace" | "Escape" | "ArrowLeft" | "ArrowRight"). Actions take { timeout: 5000 } (1–30000 ms). Main frame only; string matchers only. No navigation wait or automatic action replay.`,
    `- While you are attached to a tab, I see a frame around it and a label on top with what you do and a Stop button (Stop takes the tab out of the group). Screenshots leave them out. \`detach(tabId)\` when you are done removes them. \`Page.disable\` and \`Runtime.disable\` do nothing: the extension keeps both domains on.`,
    `- A page can report to the mind: \`cdp(tabId, "Runtime.enable", {})\` and \`cdp(tabId, "Runtime.addBinding", { name, executionContextName: "iterate" })\`; then \`cdp(tabId, "Page.getFrameTree", {})\` for the main frame's id, \`cdp(tabId, "Page.createIsolatedWorld", { frameId, worldName: "iterate" })\` for its \`executionContextId\`, and \`cdp(tabId, "Runtime.evaluate", { expression, contextId: executionContextId })\` with a script that calls \`window[name](string)\`. The page's own scripts cannot see that world. Each call appends \`events.iterate.com/chrome/binding-called { lendName, tabId, name, payload }\` to the mind's root stream. To keep the script on every page the tab loads, also send \`cdp(tabId, "Page.addScriptToEvaluateOnNewDocument", { source: expression, worldName: "iterate" })\` (a mind whose stack is older than this refuses the \`source\` argument: then the script lives in the current page only).`,

    "",
    "Run openPage and cdp in separate scripts, so a failed cdp does not lose the tabId. You can drive only the tabs in the group: I add a tab by dragging it into the group, and take it back by dragging it out.",
    "",
    members.length ? "Tabs in the group right now:" : "No tabs are in the group right now.",
    ...members.map((tab) => `- ${tab.tabId}: ${tab.title || "(no title)"} (${tab.url})`),
  ].join("\n");
}
