// address.js — THE MIND'S ADDRESS, from what a person typed in the panel's field, and the mind's
// issuer, which is the origin at that address. The rule is iterate/mind-api's `mindAddressOf`,
// written again here because the extension carries its own code (README.md);
// test/address.test.ts holds the two to the same answers.
//
// The rule is applied ONCE, to what was typed. The issuer it answers is kept in the session and
// used as it is from then on: the bearer goes to that origin and to no other.

/** A hostname is taken as typed, lowercased, with a scheme, a path and a trailing dot dropped.
 *  The one shorthand is for a bare `something.tld` with nothing else typed, which means
 *  `iterate.something.tld`. A URL keeps its hostname: `https://example.com/` is the mind whose
 *  control plane is `example.com`. */
export function mindIssuerOf(typed) {
  const text = typed.trim().toLowerCase();
  if (!text) throw new Error("Enter the mind's address, like iterate.example.com.");
  let hostname;
  try {
    ({ hostname } = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(text) ? text : `https://${text}`));
  } catch {
    throw new Error("Enter the mind's address, like iterate.example.com.");
  }
  hostname = hostname.replace(/\.$/, "");
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith("["))
    throw new Error("A mind's address is a hostname, not an IP address.");
  if (!hostname.includes("."))
    throw new Error("Enter the mind's whole address, like iterate.example.com.");
  const address = /^[a-z0-9-]+\.[a-z0-9-]+\.?$/.test(text) ? `iterate.${hostname}` : hostname;
  if (!/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(address))
    throw new Error("That is no hostname. Enter the mind's address, like iterate.example.com.");
  return `https://${address}`;
}

/** `issuer`, once it answers as an OAuth issuer. */
export async function answeringIssuer(issuer) {
  const answer = await fetch(`${issuer}/.well-known/oauth-authorization-server`).catch(() => null);
  if (!answer?.ok) throw new Error(`No mind signs in at ${issuer}.`);
  return issuer;
}
