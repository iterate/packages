import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import { z } from "zod";

const output = new URL("../dist/", import.meta.url);
const dist = new URL("assets/", output);
rmSync(output, { recursive: true, force: true });
mkdirSync(new URL("downloads/", dist), { recursive: true });
cpSync(new URL("../public/", import.meta.url), dist, { recursive: true });

// The Chrome extension's build writes the unpacked extension to its dist/; the download is that, zipped.
const extension = new URL("../../browser-extension/", import.meta.url);
execFileSync("pnpm", ["--dir", fileURLToPath(extension), "run", "build"], { stdio: "inherit" });
const unpacked = new URL("dist/", extension);
const manifest = z
  .object({ version: z.string().regex(/^\d+(\.\d+){0,3}$/) })
  .parse(JSON.parse(readFileSync(new URL("manifest.json", unpacked), "utf8")));
writeFileSync(
  new URL(`downloads/iterate-chrome-extension-${manifest.version}.zip`, dist),
  zipSync(
    Object.fromEntries(
      readdirSync(unpacked).map((name) => [name, readFileSync(new URL(name, unpacked))]),
    ),
  ),
);
writeFileSync(
  new URL("downloads/index.html", dist),
  `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Iterate Chrome extension</title>
<body style="max-width:40rem;margin:4rem auto;padding:0 1.5rem;font:16px/1.6 system-ui">
<h1>Iterate Chrome extension</h1>
<p><a href="iterate-chrome-extension-${manifest.version}.zip">Download version ${manifest.version}</a></p>
<ol><li>Unzip the download.</li><li>Open <a id="extensions" href="chrome://extensions"><code>chrome://extensions</code></a> and enable Developer mode.
<span id="copied" role="status" hidden></span></li>
<li>Choose <strong>Load unpacked</strong> and select the extracted folder.</li></ol>
<p>Updating an existing copy? Replace the files in its installed folder, then click <strong>Reload</strong> on its extension card.
Close and reopen the side panel; the heading shows the installed version. Turn on <strong>Share this browser</strong>.</p>
<p>Sharing stays on when the side panel closes. After Chrome restarts or the extension reloads,
open the panel and turn sharing on again. Only tabs in the mind's tab group are shared.</p>
<script>
// Chrome lets no web page open chrome://: it sends such a link to about:blank#blocked. So a press
// stays on this page, copies the address, and says what to do, also when the copy is refused.
const WHY = "Chrome lets no web page open that address.";
document.getElementById("extensions").addEventListener("click", (event) => {
  event.preventDefault();
  const say = (words) => {
    const note = document.getElementById("copied");
    note.textContent = " " + words + " " + WHY;
    note.hidden = false;
  };
  const copy = navigator.clipboard ? navigator.clipboard.writeText("chrome://extensions") : Promise.reject();
  copy.then(
    () => say("Copied: paste it into the address bar."),
    () => say("Type it into the address bar."),
  );
});
</script>
</body></html>\n`,
);
