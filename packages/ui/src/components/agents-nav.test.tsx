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
      <AgentsNav mind="example.com" agents={agents()} agent={undefined} agentHref={agentHref} />
    </SidebarProvider>,
  );
  expect(hrefs(html)).toEqual(["./", "?agent=%2Fagents%2Fweb%2Fone"]);
  expect(html).toContain("First");
});

test("the home page links each recent agent to its chat", () => {
  const html = renderToStaticMarkup(
    <AgentsHome
      agents={agents()}
      offers={[]}
      choice={undefined}
      values={{}}
      onChoice={() => {}}
      onField={() => {}}
      onStart={async () => {}}
      onStarted={() => {}}
      agentHref={agentHref}
      onCreate={async () => {}}
      onMessage={async () => {}}
    />,
  );
  expect(hrefs(html)).toEqual(["?agent=%2Fagents%2Fweb%2Fone"]);
});

test("the sidebar lists a person's own agents first, and another person's agent says whose it is; the folders are not listed", () => {
  const rows = agentRowsOf({
    agents: {
      "/agents/people": { createdAt: "2026-11-11T10:00:00.000Z" },
      "/agents/people/jonas": { createdAt: "2026-11-11T10:00:00.000Z", parent: "/agents/people" },
      "/agents/people/jonas/web": {
        createdAt: "2026-11-11T10:00:00.000Z",
        parent: "/agents/people/jonas",
      },
      "/agents/people/jonas/web/mine": {
        createdAt: "2026-11-11T10:00:00.000Z",
        parent: "/agents/people/jonas/web",
        kind: "iterate",
        title: "Mine",
      },
      "/agents/people/misha": { createdAt: "2026-11-11T10:00:00.000Z", parent: "/agents/people" },
      "/agents/people/misha/web": {
        createdAt: "2026-11-11T10:00:00.000Z",
        parent: "/agents/people/misha",
      },
      "/agents/people/misha/web/theirs": {
        createdAt: "2026-11-11T11:00:00.000Z",
        parent: "/agents/people/misha/web",
        kind: "iterate",
        title: "Theirs",
      },
      "/agents/web": { createdAt: "2026-11-11T10:00:00.000Z" },
      "/agents/web/old": {
        createdAt: "2026-11-11T12:00:00.000Z",
        parent: "/agents/web",
        kind: "iterate",
        title: "From before",
      },
    },
  });
  const html = renderToStaticMarkup(
    <SidebarProvider>
      <AgentsNav
        mind="example.com"
        agents={rows}
        agent={undefined}
        person="jonas"
        agentHref={agentHref}
      />
    </SidebarProvider>,
  );
  // mine first, though it moved last of the three; then the others by what moved last
  expect(hrefs(html)).toEqual([
    "./",
    "?agent=%2Fagents%2Fpeople%2Fjonas%2Fweb%2Fmine",
    "?agent=%2Fagents%2Fweb%2Fold",
    "?agent=%2Fagents%2Fpeople%2Fmisha%2Fweb%2Ftheirs",
  ]);
  // one muted word, on the other person's agent alone
  expect(html.match(/data-agent-person[^>]*>([^<]*)</g)).toHaveLength(1);
  expect(html).toMatch(/data-agent-person[^>]*>misha/);
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
