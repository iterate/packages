// /minds/<address>/mcp — connect a coding agent to this mind over MCP (packages/ui `McpConnect`).
import { createFileRoute } from "@tanstack/react-router";
import { mindMcpUrlOf } from "iterate/mind-api";
import { McpConnect } from "@iterate-com/ui/components/mcp-connect";

export const Route = createFileRoute("/minds/$mind/mcp")({
  staticData: { page: "MCP" },
  head: ({ params }) => ({ meta: [{ title: `MCP · ${params.mind} · Dash` }] }),
  component: MindMcp,
});

function MindMcp() {
  const { mind } = Route.useRouteContext();
  return <McpConnect server={mindMcpUrlOf(mind)} />;
}
