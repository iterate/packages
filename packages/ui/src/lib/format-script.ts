/** THE MODEL'S SCRIPT, PRETTIFIED, for the Agents app's Script tab: Prettier's browser build with
 *  its Babel parser in TypeScript mode, which takes a script body as the loop runs it (top-level
 *  `await` and `return`). It loads the first time a script is shown, in a chunk of its own
 *  (browser-entries.ts, `vendor-prettier`), so a page that shows no script never loads it. A
 *  script that does not parse comes back as it was: the tab shows what the model wrote. */
export async function formatScript(code: string): Promise<string> {
  try {
    const [{ format }, babel, estree] = await Promise.all([
      import("prettier/standalone"),
      import("prettier/plugins/babel"),
      import("prettier/plugins/estree"),
    ]);
    const formatted = await format(code, {
      parser: "babel-ts",
      plugins: [babel, estree],
      printWidth: 100,
    });
    return formatted.trimEnd();
  } catch {
    return code;
  }
}
