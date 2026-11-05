// The connect button follows only a start link on the platform the app is signed in to.
import { expect, test } from "vitest";
import { ForeignStartLinkError, startLinkOn } from "./connect-button.tsx";

const platform = "https://os.iterate.com";

test.for([
  {
    name: "a start link on the platform is followed",
    link: "https://os.iterate.com/.secrets/oauth/start/Bt3mDijJ47oE1n0gZVTSFA",
    platform,
  },
  {
    name: "a self-hosted platform's own start link is followed",
    link: "https://iterate.templestein.com/.secrets/oauth/start/P-BrivkK0RVAokT6zKKUXQ",
    platform: "https://iterate.templestein.com/",
  },
])("$name", ({ link, platform }) => {
  expect(startLinkOn(link, platform)).toBe(link);
});

test.for([
  { name: "a provider's URL", link: "https://github.com/login/oauth/authorize?client_id=x" },
  { name: "another platform", link: "https://iterate.templestein.com/.secrets/oauth/start/x" },
  { name: "the platform's origin over http", link: "http://os.iterate.com/.secrets/oauth/start/x" },
  { name: "a look-alike host", link: "https://os.iterate.com.evil.example/.secrets/oauth/start/x" },
  { name: "a relative path", link: "/.secrets/oauth/start/x" },
  { name: "a javascript: URL", link: "javascript:alert(1)" },
])("$name is refused", ({ link }) => {
  expect(() => startLinkOn(link, platform)).toThrow(ForeignStartLinkError);
});
