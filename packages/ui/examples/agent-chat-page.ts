// agent-chat-page.ts — A NO-BUILD PAGE WITH AN AGENT'S CHAT (packages/ui/AGENTS.md "The agent
// chat"): the chat agents.iterate.com shows, `AgentChat`, on a project's own host, for a signed-in
// member. The worker writes the project's agents into the page. The page holds one agent's context
// with the host's session and hands `AgentChat` what `useIterateContext` reads of it. Under each
// thing a person said is a row of the page's own (`itemFooter`): here, a link that opens that
// event in the chat's Events tab.
// Copy this file into a project's config repo beside worker.ts, and route a slug to it in `fetch`:
//
//   if (routingSlug === "chat") {
//     const denied = this.auth.require(request);
//     if (denied) return denied;
//     using itx = this.getItx();
//     return await agentChatPage(itx); // awaited: `using` releases itx when the function returns
//   }
//
// It is then `chat--<project>.iterate.app` (or `/projects/<project>/chat/` where projects are
// paths). test/playwright/ui/agent-chat.spec.ts commits it to a fresh project and opens it. A page
// you keep pins an exact version of @iterate-com/ui in place of `@main`.

/** The page, with what only the worker knows written into it: which project this host is, and its
 *  agents, for the path box. */
export async function agentChatPage(scope: {
  whoami(): Promise<{ projectId: string; projectSlug: string }>;
}) {
  // The project's init case installs the agents app (`installAgents(itx)`, as the default
  // template's does), so its root has `itx.agents`, which a plain scope's type does not name.
  const itx = scope as typeof scope & { agents: { list(): Promise<{ path: string }[]> } };
  const [{ projectId, projectSlug }, agents] = await Promise.all([itx.whoami(), itx.agents.list()]);
  const project = { id: projectId, slug: projectSlug, agents: agents.map((agent) => agent.path) };
  // JSON inside a script element, `<` escaped so no value can close the element
  const data = JSON.stringify(project).replaceAll("<", "\\u003c");
  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Chat</title>
    <script type="importmap">
      { "imports": { "@iterate-com/ui/": "https://esm.sh/@iterate-com/ui@main/" } }
    </script>
    <link rel="stylesheet" href="https://esm.sh/@iterate-com/ui@main/styles.css" />
    <script type="application/json" id="project">${data}</script>
  </head>
  <body>
    <div id="root"><p class="p-4 text-sm text-muted-foreground">Connecting…</p></div>
    <script type="module">
      import { html, render, useState } from "@iterate-com/ui/page";
      import { AgentChat, agentChatContextOptions } from "@iterate-com/ui/components/agent-chat/agent-chat";
      import { Button } from "@iterate-com/ui/components/ui/button";
      import { Input } from "@iterate-com/ui/components/ui/input";
      import { Toaster } from "@iterate-com/ui/components/ui/sonner";
      import { createIterateClient, useContextStub, useIterateContext } from "@iterate-com/ui/live";

      // what the worker knows and the page doesn't: which project this host is, and its agents
      const project = JSON.parse(document.getElementById("project").textContent);
      // the session this host's sign-in set (the worker only serves a signed-in member)
      const { api, info } = await createIterateClient().authenticate(location.href);

      function Chat({ path }) {
        // the chat's own state: the tab, the open trace, the Events tab's choices
        const [state, setState] = useState({});
        const patch = (change) => setState((previous) => ({ ...previous, ...change }));
        const root = useContextStub(() => api.projects.get(project.id), []);
        const agent = useContextStub(root.stub ? () => root.stub.cd(path) : null, [root.stub, path]);
        // ONE live read of the agent's context, with the events and the history the chat asks for
        const context = useIterateContext(agent.stub, agentChatContextOptions);
        return html\`<\${AgentChat}
          path=\${path}
          context=\${context}
          error=\${root.error || agent.error}
          state=\${state}
          onStateChange=\${patch}
          onMessage=\${async ({ message, files }) => {
            // a handle of its own: a person can send before the chat's contexts have opened
            const itx = await api.projects.get(project.id);
            try {
              await itx.agents.get(path).message({ message, files });
            } finally {
              itx[Symbol.dispose]();
            }
          }}
          onAppend=\${agent.stub ? (events) => agent.stub.append(...events) : undefined}
          signedUrl=\${async (file) => {
            if (!agent.stub) throw new Error("not connected");
            return (await agent.stub.files.get(file).url()).url;
          }}
          itemFooter=\${(item) =>
            item.kind === "user" &&
            html\`<div class="flex justify-end pb-1">
              <\${Button} variant="link" size="xs" className="text-muted-foreground" onClick=\${() => patch({ view: "events", event: item.offset })}>
                event #\${item.offset}
              <//>
            </div>\`}
        />\`;
      }

      function App() {
        const [path, setPath] = useState(new URLSearchParams(location.search).get("agent") || project.agents[0] || "");
        const open = (event) => {
          event.preventDefault();
          const next = String(new FormData(event.currentTarget).get("agent") || "");
          history.replaceState(null, "", "?agent=" + encodeURIComponent(next));
          setPath(next);
        };
        // The chat fills a column of a set height. Its copy buttons answer with a toast, which
        // needs @iterate-com/ui's Toaster on the page, once.
        return html\`<div class="flex h-dvh flex-col">
          <header class="flex shrink-0 flex-wrap items-center gap-3 border-b px-4 py-2 text-sm">
            <span class="font-medium">\${project.slug}</span>
            <span class="text-muted-foreground">as \${info.principal.email || info.principal.actor}</span>
            <form class="ml-auto flex items-center gap-2" onSubmit=\${open}>
              <\${Input} name="agent" list="agents" defaultValue=\${path} aria-label="Agent" className="h-8 w-64 font-mono" />
              <datalist id="agents">\${project.agents.map((option) => html\`<option key=\${option} value=\${option} />\`)}</datalist>
              <\${Button} type="submit" size="sm">Open<//>
            </form>
            <form method="post" action="/.auth/logout">
              <\${Button} type="submit" variant="outline" size="sm">Sign out<//>
            </form>
          </header>
          \${path
            ? html\`<\${Chat} key=\${path} path=\${path} />\`
            : html\`<p class="p-4 text-sm text-muted-foreground">This project has no agents yet.</p>\`}
          <\${Toaster} theme="light" />
        </div>\`;
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
