// page.ts — THE BACKUP PAGE: one page, two jobs, no build step.
//
// Export is a plain form: the parts ticked, then `export.zip?part=…`, which the worker answers
// (serve.ts). **Back up now** keeps a backup in the project's own files instead, and the page lists
// the ones kept there.
//
// Restore is a wizard that runs in the browser: the person chooses a backup, the page opens the zip
// right there (fflate from esm.sh) and lists what is in it, the person ticks what to restore and,
// when the backup holds sealed secrets, types the secrets key of the deployment it was taken on.
// The chosen parts go to the worker as a smaller zip, the key in a header of that one request, and
// the worker restores them as the project (restore.ts): it opens each sealed secret with the key
// and sets it, and answers the report the page shows. The key is the deployment's, so it is typed
// only into a page whose code the person trusts (tasks/project-backup.md "Secrets").
//
// The Content-Security-Policy lets the page reach its own origin and run scripts from esm.sh only,
// so a script the page loads cannot send the key anywhere else.
import { BACKUPS_FOLDER } from "./export.ts";

/** The page for the project `whoami` names, with the backups kept in its files. */
export function backupPage(
  project: { projectId: string; projectSlug?: string },
  kept: { path: string; size: number }[],
) {
  const nonce = crypto.randomUUID();
  const slug = project.projectSlug || project.projectId;
  // JSON inside a script element, `<` escaped so no value can close the element
  const data = JSON.stringify({ id: project.projectId, slug }).replaceAll("<", "\\u003c");
  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Backup · ${escapeHtml(slug)}</title>
    <script type="application/json" id="project">${data}</script>
    <style>
      body { font: 15px/1.5 system-ui, sans-serif; max-width: 44rem; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
      h1 { font-size: 1.4rem; } h2 { font-size: 1.1rem; margin-top: 2rem; }
      label { display: block; margin: 0.2rem 0; } .note { color: dimgray; font-size: 0.9rem; }
      fieldset { border: 1px solid #ddd; border-radius: 6px; } button { margin-top: 0.8rem; }
      pre { background: #f5f5f5; padding: 0.8rem; overflow-x: auto; white-space: pre-wrap; }
    </style>
  </head>
  <body>
    <h1>Backup of ${escapeHtml(slug)}</h1>

    <h2>Export</h2>
    <form action="export.zip" method="get">
      <fieldset>
        <legend>Parts</legend>
        <label><input type="checkbox" name="part" value="kv" checked /> kv: every key and value</label>
        <label><input type="checkbox" name="part" value="files" checked /> Files (up to 48 MB in all; the rest are named in the manifest)</label>
        <label><input type="checkbox" name="part" value="config" checked /> The config repo, at its tip</label>
        <label><input type="checkbox" name="part" value="secrets" checked /> Secrets: their paths and pins, never their values</label>
        <label><input type="checkbox" name="part" value="routes" checked /> Fetch routes (a record)</label>
        <label><input type="checkbox" name="part" value="schedules" checked /> Schedules (a record)</label>
        <label><input type="checkbox" name="part" value="integrations" checked /> Integration connections (a record)</label>
        <label><input type="checkbox" name="part" value="hostnames" checked /> Custom hostnames (a record)</label>
      </fieldset>
      <button type="submit">Download the backup</button>
    </form>

    <h2>Backups kept in this project</h2>
    <form action="backup" method="post">
      <button type="submit">Back up now</button>
      <span class="note">Every part, into the project's files at /backups/, with up to 24 MB of files.</span>
    </form>
    ${
      kept.length === 0
        ? '<p class="note">None yet.</p>'
        : `<ul>${kept
            .map(({ path, size }) => ({
              name: escapeHtml(path.slice(BACKUPS_FOLDER.length)),
              size,
            }))
            // newest first: a kept backup is named after the time it was taken
            .sort((a, b) => b.name.localeCompare(a.name))
            .map(
              ({ name, size }) =>
                `<li><a href="backups/${name}">${name}</a> (${size} bytes) <button type="button" data-open="backups/${name}">Restore from it</button></li>`,
            )
            .join("")}</ul>`
    }

    <h2>Restore</h2>
    <p><label>1. Choose a backup: <input type="file" id="archive" accept=".zip,application/zip" /></label>
      <span class="note">or press <b>Restore from it</b> beside a backup kept above.</span></p>
    <div id="steps" hidden>
      <p id="source"></p>
      <fieldset><legend>2. What to restore</legend><div id="parts"></div></fieldset>
      <p id="key-step" hidden>
        <label>3. The secrets key of the deployment this backup was taken on (optional):
          <input type="password" id="key" autocomplete="off" spellcheck="false" /></label>
        <span class="note">It is sent once, with the restore, to this host only: the project's worker opens the sealed secrets with it and sets them. Without it, each secret gets a link that asks for its value again.</span>
      </p>
      <button type="button" id="restore">Restore</button>
      <p id="restoring" class="note" data-spinner="true" hidden>Restoring… each part is written in turn, and the report follows.</p>
    </div>
    <pre id="report" hidden></pre>

    <script type="module" nonce="${nonce}">
      import { strFromU8, strToU8, unzipSync, zipSync } from "https://esm.sh/fflate@0.8.3";

      const project = JSON.parse(document.getElementById("project").textContent);
      const byId = (id) => document.getElementById(id);
      const records = ["routes", "schedules", "integrations", "hostnames"];
      let entries = null;
      let manifest = null;
      const json = (name) => JSON.parse(strFromU8(entries[name]));
      const describe = {
        secrets: () => {
          const secrets = json("secrets.json");
          return secrets.length + " secrets, " + secrets.filter((secret) => secret.sealed).length + " with sealed values";
        },
        kv: () => strFromU8(entries["kv.jsonl"]).split("\\n").filter(Boolean).length + " keys",
        files: () => {
          const files = json("files/index.json");
          return files.length + " files, " + files.reduce((sum, file) => sum + file.size, 0) + " bytes";
        },
        config: () => {
          const count = Object.keys(entries).filter((name) => name.startsWith("config/files/")).length;
          return count + " files at commit " + String(json("config/repo.json").commitOid).slice(0, 7);
        },
      };

      byId("archive").addEventListener("change", async (event) =>
        open(new Uint8Array(await event.target.files[0].arrayBuffer())),
      );
      for (const button of document.querySelectorAll("[data-open]"))
        button.addEventListener("click", async () => {
          const response = await fetch(button.dataset.open);
          if (!response.ok) return show(response.status + " " + (await response.text()));
          await open(new Uint8Array(await response.arrayBuffer()));
        });

      async function open(zip) {
        byId("report").hidden = true;
        // the whole zip is read and every part listed before anything on screen changes: a zip
        // that fails part-way leaves the one open as it was, entries and manifest included
        const previous = { entries, manifest };
        let labels, keyNeeded;
        try {
          entries = unzipSync(zip);
          manifest = JSON.parse(strFromU8(entries["manifest.json"]));
          if (manifest.format !== "iterate-project-backup") throw new Error("This zip is not a project backup.");
          labels = manifest.parts.map((part) => {
            const label = document.createElement("label");
            const box = Object.assign(document.createElement("input"), { type: "checkbox", name: "restore-part", value: part });
            box.checked = !records.includes(part);
            box.disabled = records.includes(part);
            const what = records.includes(part) ? json(part + ".json").length + " recorded; restore them by hand (the report says how)" : describe[part]();
            label.append(box, " " + part + ": " + what);
            return label;
          });
          keyNeeded = manifest.parts.includes("secrets") && json("secrets.json").some((secret) => secret.sealed);
        } catch (error) {
          ({ entries, manifest } = previous);
          return show(String(error));
        }
        const from = manifest.source.projectSlug || manifest.source.projectId;
        byId("source").textContent = "Taken from " + from + " at " + manifest.capturedAt +
          (manifest.source.projectId === project.id ? "." : ": another project than this one.");
        byId("parts").replaceChildren(...labels);
        byId("key-step").hidden = !keyNeeded;
        byId("steps").hidden = false;
        byId("steps").scrollIntoView();
      }

      byId("restore").addEventListener("click", async () => {
        const ticked = [...document.querySelectorAll("input[name=restore-part]:checked")].map((box) => box.value);
        // the records go along with whatever is ticked: the report says what to do with each, and a
        // connection's secret is told from its connection
        const parts = [...ticked, ...manifest.parts.filter((part) => records.includes(part))];
        const key = byId("key").value;
        byId("key").value = "";
        byId("report").hidden = true;
        byId("restore").disabled = true;
        byId("restoring").hidden = false;
        const lines = [];
        try {
          const subset = { "manifest.json": strToU8(JSON.stringify({ ...manifest, parts })) };
          for (const [name, bytes] of Object.entries(entries))
            if (parts.some((part) => name === part + ".json" || name === part + ".jsonl" || name.startsWith(part + "/")))
              subset[name] = bytes;
          // the key rides this one request, to this origin, and the worker opens the cells with it
          const headers = { "content-type": "application/zip" };
          if (key) headers["x-secrets-key"] = key;
          const response = await fetch("restore?" + parts.map((part) => "part=" + encodeURIComponent(part)).join("&"), {
            method: "POST",
            headers,
            body: zipSync(subset),
          });
          lines.push(response.ok ? JSON.stringify(await response.json(), null, 2) : response.status + " " + (await response.text()));
        } catch (error) {
          lines.push(String(error));
        }
        byId("restoring").hidden = true;
        byId("restore").disabled = false;
        show(lines.join("\\n"));
      });

      function show(text) {
        byId("report").textContent = text;
        byId("report").hidden = false;
      }
    </script>
  </body>
</html>
`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy": [
          "default-src 'none'",
          `script-src 'nonce-${nonce}' https://esm.sh`,
          "style-src 'unsafe-inline'",
          "connect-src 'self'",
          "form-action 'self'",
          "base-uri 'none'",
          "frame-ancestors 'none'",
        ].join("; "),
      },
    },
  );
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"]/g, (character) => `&#${character.charCodeAt(0)};`);
