// HOW TO CONNECT A CODING AGENT TO A MIND OVER MCP: the server's address, and the commands that
// add it to Claude Code and to the Codex CLI, each with a button that copies it. The sign-in that
// follows is the mind's own. It is one column for a page's width; the page gives the scrolling.
//
//   <McpConnect server="https://iterate.example.com/mcp" />
import { CopyText } from "#/components/copy-text.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card.tsx";

export function McpConnect({
  server,
}: {
  /** The mind's MCP server (`mindMcpUrlOf(address)`, or `https://iterate.<domain>/mcp`). */
  server: string;
}) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-4 md:p-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">MCP</h1>
        <p className="text-sm text-muted-foreground">
          One tool, <code>run</code>: a script evaluated at this mind's root (<code>/</code>), as
          you. Every script you run is recorded on the mind root's log.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Server</CardTitle>
          <CardDescription>
            The mind's MCP server. You sign in to it as you sign in to the mind.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Command text={server} label="the server's address" />
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
          <Command
            text={`claude mcp add --transport http iterate ${server}`}
            label="the command for Claude Code"
          />
          <Command text="/mcp" label="/mcp" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Codex CLI</CardTitle>
          <CardDescription>Add the server, then sign in.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Command text={`codex mcp add iterate --url ${server}`} label="the command for Codex" />
          <Command text="codex mcp login iterate" label="the sign-in command for Codex" />
        </CardContent>
      </Card>
    </div>
  );
}

/** A command or an address to copy, shown whole: a long one wraps where `CopyText` would cut it. */
function Command({ text, label }: { text: string; label: string }) {
  return (
    <CopyText
      text={text}
      label={label}
      className="[&>code]:overflow-visible [&>code]:break-all [&>code]:whitespace-normal"
    />
  );
}
