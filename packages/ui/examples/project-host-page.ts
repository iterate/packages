// project-host-page.ts — A NO-BUILD PAGE ON A PROJECT'S OWN HOST (packages/ui/AGENTS.md "Signing in"):
// the project's config worker serves it to a signed-in member, and it reads one of the project's
// contexts live, with the host's own session (`createIterateClient`) and @iterate-com/ui from esm.sh.
// Copy this file into a project's config repo beside worker.ts, and route a slug to it in `fetch`:
//
//   if (routingSlug === "contexts") {
//     const denied = this.auth.require(request);
//     if (denied) return denied;
//     using itx = this.getItx();
//     return await projectHostPage(itx); // awaited: `using` releases itx when the function returns
//   }
//
// It is then `contexts--<project>.iterate.app` (or `/projects/<project>/contexts/` where projects
// are paths). test/playwright/ui/sign-in.spec.ts commits it to a fresh project and opens it. A page
// you keep pins an exact version of @iterate-com/ui in place of `@main`.

/** The page, with what only the worker knows written into it: which project this host is, and its
 *  contexts (the `project` facet's registry), for the path box. */
export async function projectHostPage(itx: {
  whoami(): Promise<{ projectId: string; projectSlug: string }>;
  facets: { get(name: "project"): { snapshot(): Promise<{ state: { contexts?: object } }> } };
}) {
  const { projectId, projectSlug } = await itx.whoami();
  const { state } = await itx.facets.get("project").snapshot();
  const project = {
    id: projectId,
    slug: projectSlug,
    paths: ["/", ...Object.keys(state.contexts || {}).sort()],
  };
  // JSON inside a script element, `<` escaped so no value can close the element
  const data = JSON.stringify(project).replaceAll("<", "\\u003c");
  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Contexts</title>
    <script type="importmap">
      { "imports": { "@iterate-com/ui/": "https://esm.sh/@iterate-com/ui@main/" } }
    </script>
    <link rel="stylesheet" href="https://esm.sh/@iterate-com/ui@main/styles.css" />
    <script type="application/json" id="project">${data}</script>
  </head>
  <body>
    <div id="root" class="flex h-screen flex-col">
      <p class="p-4 text-sm text-muted-foreground">Connecting…</p>
    </div>
    <script type="module">
      import { html, render, useState } from "@iterate-com/ui/page";
      import { ContextView } from "@iterate-com/ui/components/context-view/context-view";
      import { Button } from "@iterate-com/ui/components/ui/button";
      import { Input } from "@iterate-com/ui/components/ui/input";
      import { createIterateClient, useContextStub, useIterateContext } from "@iterate-com/ui/live";

      // what the worker knows and the page doesn't: which project this host is, and its contexts
      const project = JSON.parse(document.getElementById("project").textContent);
      // the session this host's sign-in set (the worker only serves a signed-in member)
      const { api, info } = await createIterateClient().authenticate(location.href);

      function App() {
        const [path, setPath] = useState(new URLSearchParams(location.search).get("path") || "/");
        // the view's own state: the open inspector, the search, the filters
        const [state, setState] = useState({});
        const root = useContextStub(() => api.projects.get(project.id), []);
        const shown = useContextStub(root.stub ? () => root.stub.cd(path) : null, [root.stub, path]);
        const context = useIterateContext(shown.stub);
        const open = (event) => {
          event.preventDefault();
          const next = String(new FormData(event.currentTarget).get("path") || "/");
          history.replaceState(null, "", "?path=" + encodeURIComponent(next));
          setState({});
          setPath(next);
        };
        return html\`
          <header class="flex flex-wrap items-center gap-3 border-b px-4 py-2 text-sm">
            <span class="font-medium">\${project.slug}</span>
            <span class="text-muted-foreground">as \${info.principal.email || info.principal.actor}</span>
            <form class="ml-auto flex items-center gap-2" onSubmit=\${open}>
              <\${Input} name="path" list="paths" defaultValue=\${path} aria-label="Context" className="h-8 w-80 font-mono" />
              <datalist id="paths">\${project.paths.map((option) => html\`<option value=\${option} />\`)}</datalist>
              <\${Button} type="submit" size="sm">Open<//>
            </form>
          </header>
          <\${ContextView}
            title=\${path}
            context=\${context}
            error=\${root.error || shown.error}
            state=\${state}
            onStateChange=\${(patch) => setState((previous) => ({ ...previous, ...patch }))}
            onAppend=\${shown.stub ? (events) => shown.stub.append(...events) : undefined}
            className="min-h-0 flex-1"
          />
        \`;
      }

      render(html\`<\${App} />\`, document.getElementById("root"));
    </script>
  </body>
</html>
`,
    {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    },
  );
}
