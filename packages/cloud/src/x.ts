// cloud/x.ts — A PERSON'S X ACCOUNT, connected to the Cloud through the Cloud's own X client: the
// consent's options for the platform's OAuth attempt, who the tokens are for, and a request to X's
// API on the person's behalf. Each request carries the person's token as a placeholder, which the
// project's egress fills (the person's context reaches it through a rule: worker.ts `setUpPerson`);
// no code reads it, and X's rotating tokens are refreshed by the platform.
import { z } from "zod";
import type { XClient } from "./records.ts";

/** What the Cloud asks of a person's X: their posts, likes and bookmarks, their direct messages,
 *  who they are, and a refresh token.
 *  https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/authorization-code */
const X_SCOPES = [
  "tweet.read",
  "users.read",
  "like.read",
  "bookmark.read",
  "dm.read",
  "offline.access",
];

const X_API = "https://api.x.com";

/** The person's X secret: the platform's, at the Cloud's root, where the OAuth attempt stores the
 *  tokens. One per person. Its name is SHORT: the platform signs the secret's context into the
 *  OAuth `state`, with the person's id and the page to return to, and X grants a consent only when
 *  `state` is at most 500 characters (docs.x.com, OAuth 2.0 authorization code). Sixteen hex digits
 *  of the platform's `user_<32 hex>` id name the person apart; any other id is carried whole,
 *  cleaned. */
export const xSecretOf = (sub: string) => {
  const hex = /^user_([0-9a-f]{32})$/.exec(sub)?.[1];
  return `/secrets/x-${hex ? hex.slice(0, 16) : sub.replace(/[^a-zA-Z0-9._-]/g, "")}`;
};

/** The token as a request carries it: the placeholder egress fills. */
const xPlaceholderOf = (sub: string) => `getSecret("${xSecretOf(sub)}", { field: "accessToken" })`;

/** The platform's OAuth attempt for the person's X secret: X's consent through `client` with PKCE
 *  (X's token endpoint takes the client credential as HTTP basic auth), completed only in a browser
 *  signed in as `person`, then back to `next`, a page of the project's own. X's token response names
 *  no one: `/2/users/me` does, read once with the new token. */
export const xConnectOptionsOf = (
  client: XClient,
  person: string,
  next: { routingSlug?: string; path: string },
) => ({
  authorizationEndpoint: "https://x.com/i/oauth2/authorize",
  tokenEndpoint: `${X_API}/2/oauth2/token`,
  clientId: client.clientId,
  clientSecret: `getSecret("${client.secret}", { field: "clientSecret" })`,
  next,
  completedByUserId: person,
  clientAuth: "client_secret_basic" as const,
  scope: X_SCOPES.join(" "),
  urls: [X_API],
  account: { url: `${X_API}/2/users/me`, id: "data.id", name: "data.username" },
});

const XUser = z.object({ data: z.object({ id: z.string(), username: z.string() }) });

/** Who the person's token is for, as X names them. */
export async function xUserOf(sub: string) {
  const response = await fetch(`${X_API}/2/users/me`, {
    headers: { authorization: `Bearer ${xPlaceholderOf(sub)}` },
  });
  if (!response.ok) throw new Error(`X named no user: HTTP ${response.status}`);
  return XUser.parse(await response.json()).data;
}

export const XRequest = z.object({
  method: z.enum(["GET", "POST", "DELETE"]).default("GET"),
  /** The path under X's API origin, with its query: `/2/users/me/bookmarks?max_results=10`. */
  path: z.string().regex(/^\/2\/[^\s]*$/, "a path under X's API, /2/…"),
  /** The request's JSON body; empty for none. */
  body: z.string().default(""),
});
export type XRequest = z.infer<typeof XRequest>;

/** One request to X's API on the person's behalf, through the project's egress, as the Cloud's
 *  router makes it for the person's deployments (packages/cloud-router). The answer whole: X's
 *  status and its body as text, which the router hands on as X's answer. */
export async function xFetch(sub: string, request: XRequest) {
  const response = await fetch(`${X_API}${request.path}`, {
    method: request.method,
    headers: {
      authorization: `Bearer ${xPlaceholderOf(sub)}`,
      ...(request.body && { "content-type": "application/json" }),
    },
    body: request.body || null,
  });
  return {
    status: response.status,
    contentType: response.headers.get("content-type") || "application/json",
    body: await response.text(),
  };
}

// ── the Cloud as @iterate ───────────────────────────────────────────────────────────────────────

/** The Cloud's own X secret: the @iterate account's tokens, which a member connected. */
export const ITERATE_X_SECRET = "/secrets/cloud-x-iterate";
const iteratePlaceholder = `getSecret("${ITERATE_X_SECRET}", { field: "accessToken" })`;

/** What the Cloud asks of @iterate: its direct messages and mentions, and to answer them. */
const ITERATE_X_SCOPES = [
  "tweet.read",
  "tweet.write",
  "users.read",
  "dm.read",
  "dm.write",
  "offline.access",
];

/** The platform's OAuth attempt for the Cloud's own X secret: X's consent through `client`,
 *  completed by a member of the project signed in at X as @iterate. */
export const iterateConnectOptionsOf = (
  client: XClient,
  next: { routingSlug?: string; path: string },
) => ({
  authorizationEndpoint: "https://x.com/i/oauth2/authorize",
  tokenEndpoint: `${X_API}/2/oauth2/token`,
  clientId: client.clientId,
  clientSecret: `getSecret("${client.secret}", { field: "clientSecret" })`,
  next,
  clientAuth: "client_secret_basic" as const,
  scope: ITERATE_X_SCOPES.join(" "),
  urls: [X_API],
  account: { url: `${X_API}/2/users/me`, id: "data.id", name: "data.username" },
});

/** Who the Cloud's own token is for. */
export async function iterateUserOf() {
  const response = await fetch(`${X_API}/2/users/me`, {
    headers: { authorization: `Bearer ${iteratePlaceholder}` },
  });
  if (!response.ok) throw new Error(`X named no user for the Cloud: HTTP ${response.status}`);
  return XUser.parse(await response.json()).data;
}

/** One message to @iterate: a direct message or a mention, as X delivered it. */
export const InboxMessage = z.object({
  kind: z.enum(["dm", "mention"]),
  /** X's id of the event (a DM event id, a post id). */
  id: z.string(),
  text: z.string(),
  at: z.string(),
  from: z.object({ xUserId: z.string() }),
  /** A direct message's conversation, which a reply goes to; a mention's post, which a reply
   *  answers. */
  conversationId: z.string().nullable(),
});
export type InboxMessage = z.infer<typeof InboxMessage>;

const Page = z.object({ next_token: z.string().optional() }).optional();
const DmEvents = z.object({
  meta: Page,
  data: z
    .array(
      z.object({
        id: z.string(),
        text: z.string().default(""),
        sender_id: z.string(),
        created_at: z.string(),
        dm_conversation_id: z.string().optional(),
      }),
    )
    .default([]),
});
const Mentions = z.object({
  meta: Page,
  data: z
    .array(
      z.object({
        id: z.string(),
        text: z.string(),
        author_id: z.string(),
        created_at: z.string(),
        conversation_id: z.string().optional(),
      }),
    )
    .default([]),
});

/** The newest messages to @iterate since the cursor, newest first: direct messages, then mentions.
 *  X lists DM events newest first with no `since`, so the read pages on until it meets the event
 *  already seen; mentions take `since_id` and page on until X has no more. A read that has not
 *  reached its cursor after `PAGES` pages throws, so the cursor stays and nothing older is skipped;
 *  an operator then moves it by hand. A first read, with no cursor, takes the newest page of each
 *  and starts the cursors there. @iterate's own messages are not its inbox.
 *  https://docs.x.com/x-api/direct-messages/get-dm-events
 *  https://docs.x.com/x-api/posts/get-user-mentions */
export async function readInbox(
  self: string,
  since: { dmSince: string | null; mentionSince: string | null },
) {
  const headers = { authorization: `Bearer ${iteratePlaceholder}` };
  const messages: InboxMessage[] = [];
  const dmQuery = new URLSearchParams({
    max_results: "50",
    event_types: "MessageCreate",
    "dm_event.fields": "sender_id,created_at,dm_conversation_id,text",
  });
  // a first read, with no cursor, takes the newest page alone and starts the cursor there: the
  // account's history is not the inbox
  let caughtUp = false;
  for (let page = 0; page < (since.dmSince ? PAGES : 1) && !caughtUp; page++) {
    const dms = await fetch(`${X_API}/2/dm_events?${dmQuery}`, { headers });
    if (!dms.ok)
      throw new Error(`X listed no direct messages: HTTP ${dms.status} ${await dms.text()}`);
    const listed = DmEvents.parse(await dms.json());
    for (const event of listed.data) {
      if (event.id === since.dmSince) {
        caughtUp = true;
        break;
      }
      if (event.sender_id === self) continue;
      messages.push({
        kind: "dm",
        id: event.id,
        text: event.text,
        at: event.created_at,
        from: { xUserId: event.sender_id },
        conversationId: event.dm_conversation_id || null,
      });
    }
    if (!since.dmSince || !listed.meta?.next_token || listed.data.length === 0) {
      caughtUp = true;
      break;
    }
    dmQuery.set("pagination_token", listed.meta.next_token);
  }
  if (!caughtUp)
    throw new Error(
      `X's direct messages run past ${PAGES} pages without reaching the last one read (${since.dmSince}): the inbox's cursor needs a hand`,
    );
  const mentionQuery = new URLSearchParams({
    max_results: "20",
    "tweet.fields": "author_id,created_at,conversation_id",
  });
  if (since.mentionSince) mentionQuery.set("since_id", since.mentionSince);
  let exhausted = false;
  for (let page = 0; page < (since.mentionSince ? PAGES : 1); page++) {
    const mentions = await fetch(`${X_API}/2/users/${self}/mentions?${mentionQuery}`, { headers });
    if (!mentions.ok)
      throw new Error(`X listed no mentions: HTTP ${mentions.status} ${await mentions.text()}`);
    const listed = Mentions.parse(await mentions.json());
    for (const post of listed.data) {
      if (post.author_id === self) continue;
      messages.push({
        kind: "mention",
        id: post.id,
        text: post.text,
        at: post.created_at,
        from: { xUserId: post.author_id },
        conversationId: post.conversation_id || null,
      });
    }
    if (!since.mentionSince || !listed.meta?.next_token || listed.data.length === 0) {
      exhausted = true;
      break;
    }
    mentionQuery.set("pagination_token", listed.meta.next_token);
  }
  if (!exhausted)
    throw new Error(
      `X's mentions run past ${PAGES} pages since ${since.mentionSince}: the inbox's cursor needs a hand`,
    );
  return messages;
}

/** How many pages of each list one read takes at most before it gives up rather than skip. */
const PAGES = 20;

export const Reply = z.union([
  /** A direct message to the person, as @iterate. */
  z.object({ kind: z.literal("dm"), to: z.string(), text: z.string().min(1).max(10_000) }),
  /** A post answering the person's mention, as @iterate. */
  z.object({
    kind: z.literal("mention"),
    inReplyTo: z.string(),
    text: z.string().min(1).max(280),
  }),
]);
export type Reply = z.infer<typeof Reply>;

/** Send a reply as @iterate: a direct message, or a post in the mention's thread. Answers X's id
 *  of what was sent.
 *  https://docs.x.com/x-api/direct-messages/create-dm-by-participant
 *  https://docs.x.com/x-api/posts/create-post */
export async function sendReply(reply: Reply) {
  const headers = {
    authorization: `Bearer ${iteratePlaceholder}`,
    "content-type": "application/json",
  };
  const response =
    reply.kind === "dm"
      ? await fetch(`${X_API}/2/dm_conversations/with/${reply.to}/messages`, {
          method: "POST",
          headers,
          body: JSON.stringify({ text: reply.text }),
        })
      : await fetch(`${X_API}/2/tweets`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            text: reply.text,
            reply: { in_reply_to_tweet_id: reply.inReplyTo },
          }),
        });
  const body = await response.text();
  if (!response.ok)
    throw new Error(`X refused the reply: HTTP ${response.status} ${body.slice(0, 300)}`);
  const sent = z
    .object({ data: z.object({ id: z.string().optional(), dm_event_id: z.string().optional() }) })
    .parse(JSON.parse(body)).data;
  return { id: sent.dm_event_id || sent.id || "" };
}
