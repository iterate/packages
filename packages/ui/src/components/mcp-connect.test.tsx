// @vitest-environment jsdom
// The commands the MCP page gives a person to copy.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { McpConnect } from "./mcp-connect.tsx";

test("each command names the server by the mind, with no dot: two minds are two servers, and Claude Code takes the name", async () => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(() => root.render(<McpConnect server="https://iterate.example.com/mcp" />));
  expect([...host.querySelectorAll("code")].map((code) => code.textContent)).toEqual(
    expect.arrayContaining([
      "https://iterate.example.com/mcp",
      "claude mcp add --transport http example-com https://iterate.example.com/mcp",
      "codex mcp add example-com --url https://iterate.example.com/mcp",
      "codex mcp login example-com",
    ]),
  );
  // what Claude Code's /mcp lists is that name too
  expect(host.textContent).toContain("pick example-com, Authenticate.");
  await act(() => root.unmount());
});
