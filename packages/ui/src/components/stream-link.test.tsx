// @vitest-environment jsdom
// StreamLink builds canonical Dash context URLs via pure `dashPaths` without registering Dash
// path mode on `page-url.ts` (so apps like Docs that embed StreamLink keep query-mode URLs).
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { StreamLink, streamHref } from "./stream-link.tsx";
import { pageHref } from "#/lib/page-url.ts";

test("streamHref formats canonical Dash context URLs and handles null dashOrigin", () => {
  expect(streamHref({ dashOrigin: null, path: "/repos/config" })).toBeNull();
  expect(streamHref({ dashOrigin: "https://dash.example.com", path: "/repos/config" })).toBe(
    "https://dash.example.com/contexts/repos/config",
  );
  expect(streamHref({ dashOrigin: "https://dash.example.com/", path: "/secrets" })).toBe(
    "https://dash.example.com/contexts/secrets",
  );
  expect(
    streamHref({
      dashOrigin: "https://dash.example.com",
      path: "/agents/canvas2/ada@example.com/notes.md",
    }),
  ).toBe("https://dash.example.com/contexts/agents/canvas2/ada@example.com/notes.md");
  expect(streamHref({ dashOrigin: "https://dash.example.com", path: "/agents/a." })).toBe(
    "https://dash.example.com/contexts/agents/a%2E",
  );
  expect(streamHref({ dashOrigin: "https://dash.example.com", path: "/" })).toBe(
    "https://dash.example.com/contexts?contextPath=/",
  );
  expect(streamHref({ dashOrigin: "https://dash.example.com", path: "/a/../b" })).toBe(
    "https://dash.example.com/contexts?contextPath=/a/../b",
  );
});

test("StreamLink renders an anchor with the canonical context URL and leaves page-url in query mode", () => {
  // Importing StreamLink must never register dashPaths on page-url.
  expect(pageHref("docs", { repo: "config" })).toBe("?page=docs&repo=config");

  const html = renderToStaticMarkup(
    <StreamLink
      dashOrigin="https://dash.example.com"
      platformOrigin="https://iterate.example.com"
      mind="example.com"
      path="/docs/config/README.md"
    />,
  );
  expect(html).toContain('href="https://dash.example.com/contexts/docs/config/README.md"');
  expect(
    renderToStaticMarkup(
      <StreamLink
        dashOrigin={null}
        platformOrigin="https://iterate.example.com"
        mind="example.com"
        path="/docs/config/README.md"
      />,
    ),
  ).toBe("");
});
