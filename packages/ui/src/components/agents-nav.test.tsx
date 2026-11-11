// The sidebar and the home page import no router: each row is a link to the address the page
// gives, so a page with no client router still opens an agent, in a new tab too.
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { agentRowsOf } from "../lib/agent-summary.ts";
import { AgentsHome } from "./agents-home.tsx";
import { AgentsNav } from "./agents-nav.tsx";
import { SidebarProvider } from "./ui/sidebar.tsx";

test("the sidebar links New agent to the home page and each agent to its chat", () => {
  const html = renderToStaticMarkup(
    <SidebarProvider>
      <AgentsNav project="example.com" agents={agents()} agent={undefined} agentHref={agentHref} />
    </SidebarProvider>,
  );
  expect(hrefs(html)).toEqual(["./", "?agent=%2Fagents%2Fweb%2Fone"]);
  expect(html).toContain("First");
});

test("the home page links each recent agent to its chat", () => {
  const html = renderToStaticMarkup(
    <AgentsHome
      agents={agents()}
      agentHref={agentHref}
      onCreate={async () => {}}
      onMessage={async () => {}}
    />,
  );
  expect(hrefs(html)).toEqual(["?agent=%2Fagents%2Fweb%2Fone"]);
});

// A folder that holds one agent: the folder is not listed, the agent is.
function agents() {
  return agentRowsOf({
    agents: {
      "/agents/web": { createdAt: "2026-11-11T10:00:00.000Z" },
      "/agents/web/one": {
        createdAt: "2026-11-11T10:00:00.000Z",
        parent: "/agents/web",
        kind: "iterate",
        title: "First",
      },
    },
  });
}

function agentHref(path: string | undefined) {
  return path ? `?agent=${encodeURIComponent(path)}` : "./";
}

function hrefs(html: string) {
  return [...html.matchAll(/<a [^>]*href="([^"]*)"/g)].map((match) => match[1]);
}
