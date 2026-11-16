export function issuerCandidatesOf(typed) {
  const text = typed.trim().toLowerCase();
  const { hostname } = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(text) ? text : `https://${text}`);
  if (!hostname.includes(".")) throw new Error("Enter the mind's address, like example.com.");
  const under = hostname.startsWith("iterate.") ? hostname.slice("iterate.".length) : "";
  const addresses = under.includes(".") ? [under, hostname] : [hostname];
  return addresses.map((address) => `https://iterate.${address}`);
}

/** The first candidate that answers as an OAuth issuer. */
export async function issuerOf(candidates) {
  for (const issuer of candidates) {
    const answer = await fetch(`${issuer}/.well-known/oauth-authorization-server`).catch(
      () => null,
    );
    if (answer?.ok) return issuer;
  }
  throw new Error(`No mind signs in at ${candidates.join(" or ")}.`);
}
