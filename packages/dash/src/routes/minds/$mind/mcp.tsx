// /minds/<address>/mcp — connect a coding agent to this mind over MCP: the server, the
// one-line installs for Claude Code and the Codex CLI, and the sign-in that follows (the mind's
// own issuer). Every command is copyable.
import { createFileRoute } from "@tanstack/react-router";
import { mindMcpUrlOf } from "iterate/mind-api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@iterate-com/ui/components/ui/card";
import { Identifier } from "../../../components/identifier.tsx";

export const Route = createFileRoute("/minds/$mind/mcp")({
  staticData: { page: "MCP" },
  head: ({ params }) => ({ meta: [{ title: `MCP · ${params.mind} · Dash` }] }),
  component: MindMcp,
});

/** A command or value to copy, on its own line — the shared identifier pill, allowed to wrap. */
function Copyable({ value }: { value: string }) {
  return (
    <Identifier
      value={value}
      className="max-w-full rounded-md bg-muted px-2 py-1"
      textClassName="whitespace-normal break-all"
    />
  );
}

function MindMcp() {
  const { mind } = Route.useRouteContext();
  const server = mindMcpUrlOf(mind);
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-4 md:p-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">MCP</h1>
        <p className="font-readme text-sm text-muted-foreground">
          One tool, <code>run</code>: a script evaluated at this mind's root (<code>/</code>), as
          you. Every script you run is recorded on the mind root's log.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Server</CardTitle>
          <CardDescription>
            The mind's MCP server. You sign in to it the same way as to this app.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Copyable value={server} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Claude Code</CardTitle>
          <CardDescription>
            Add the server, then sign in from inside Claude Code: run <code>/mcp</code>, pick{" "}
            <code>iterate</code>, Authenticate.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Copyable value={`claude mcp add --transport http iterate ${server}`} />
          <Copyable value="/mcp" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Codex CLI</CardTitle>
          <CardDescription>Add the server, then sign in.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Copyable value={`codex mcp add iterate --url ${server}`} />
          <Copyable value="codex mcp login iterate" />
        </CardContent>
      </Card>
    </div>
  );
}
