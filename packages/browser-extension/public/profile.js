// profile.js — WHAT A MIND SAYS OF ITSELF: its name and its logo, for the panel's header and the
// label on a tab. The mind's website answers them to anyone at `/.well-known/iterate-profile`
// (`{ name, description, icon }`, with `access-control-allow-origin: *`), so the read needs no host
// permission and carries no credential.
//
// THE PROFILE IS THE OWNER'S OWN WORDS, UNSIGNED: it proves nothing about who the mind is. So the
// address is always shown beside it, the name is text of bounded length, and the logo is an
// `https:` address on the mind's own hosts that is only ever shown as an image (`<img src>`).
// Anything else in the answer is dropped.

/** Where the mind's website answers its profile. */
const PROFILE_PATH = "/.well-known/iterate-profile";
/** A profile's answer is small: a larger one is not read as a profile. */
const ANSWER_MAX_LENGTH = 16 * 1024;
/** Control characters, and the characters that change the direction of the text after them. */
const UNSAFE_IN_A_NAME = /[\p{Cc}\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;

/** The mind's address, as the panel and the tab group show it: the issuer's hostname without its
 *  `iterate.` label. */
export const mindAddressOf = (issuer) => new URL(issuer).hostname.replace(/^iterate\./, "");

/** The origin of the mind's website: the issuer's without its `iterate.` label. */
function websiteOf(issuer) {
  const url = new URL(issuer);
  url.hostname = mindAddressOf(issuer);
  return url.origin;
}

/** `{ name, icon }` from a profile's answer, for the mind whose issuer is `issuer`. `name` is ""
 *  for a mind that gave itself none (the profile then answers the hostname, which the address
 *  already says); `icon` is null for a mind with no logo that may be shown. */
export function mindProfileOf(answer, issuer) {
  const address = mindAddressOf(issuer);
  const said =
    typeof answer?.name === "string"
      ? answer.name
          .replace(UNSAFE_IN_A_NAME, " ")
          .replace(/\s+/g, " ")
          .trim()
          // the profile's own bound for a name (core/configs/default/profile.ts)
          .slice(0, 80)
          .trim()
      : "";
  const name = [address, `iterate.${address}`].includes(said.toLowerCase()) ? "" : said;
  return { name, icon: iconOf(answer?.icon, issuer) };
}

/** The logo's address, when it is an `https:` address on the mind's website or a host under it. */
function iconOf(icon, issuer) {
  if (typeof icon !== "string" || icon.length > 2048) return null;
  let url;
  try {
    url = new URL(icon);
  } catch {
    return null;
  }
  const website = new URL(websiteOf(issuer));
  if (url.protocol !== "https:" || url.username || url.password || url.port !== website.port)
    return null;
  if (url.hostname !== website.hostname && !url.hostname.endsWith(`.${website.hostname}`))
    return null;
  return url.href;
}

/** The profile of the mind whose issuer is `issuer`, or null when its website answered none
 *  (no such route, no network, an answer that is not a profile). */
export async function readMindProfile(issuer) {
  try {
    const answer = await fetch(`${websiteOf(issuer)}${PROFILE_PATH}`, {
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(5_000),
    });
    if (!answer.ok) return null;
    const text = await answer.text();
    if (text.length > ANSWER_MAX_LENGTH) return null;
    const json = JSON.parse(text);
    if (!json || typeof json !== "object" || Array.isArray(json)) return null;
    return mindProfileOf(json, issuer);
  } catch {
    return null;
  }
}
