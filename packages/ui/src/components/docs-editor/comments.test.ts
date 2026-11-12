// Carried over from iterate/docs@fba5c21 (packages/docs/src/processor.test.ts, its comment tests).
// The comments reducer: what each comment event does to a doc's threads, and what it ignores. The
// processor that runs it (re-anchoring after a save included) is the mind's config's.
import { expect, test } from "vitest";
import type { StreamEvent } from "iterate/stream/processor";
import { quoteAt } from "./anchor.ts";
import {
  authorOf,
  COMMENT_ADDED,
  COMMENT_DELETED,
  COMMENT_EDITED,
  COMMENT_REANCHORED,
  COMMENT_REOPENED,
  COMMENT_REPLIED,
  COMMENT_RESOLVED,
  COMMENT_ROUTED,
  CommentAdded,
  CommentDeleted,
  CommentEdited,
  CommentReanchored,
  CommentReplied,
  CommentRouted,
  Quote,
  reduceComments,
  ThreadRef,
} from "./comments.ts";

const text = "# Plan\n\nWe fly in on Tuesday.\n";
const tuesday = quoteAt(text, text.indexOf("Tuesday"), text.indexOf("Tuesday") + "Tuesday".length);
const agent = "/agents/assistant/2026-10-31-comment-t1";

test.for([
  {
    name: "people comment, reply and resolve, an agent replies for one of them, and only a comment's author edits or deletes it",
    events: [
      by("ada@example.com", COMMENT_ADDED, { thread: "t1", quote: tuesday, body: "Wednesday?" }),
      // Grace's Claude Code, over MCP: a script run for Grace, which calls as the mind's code
      forPerson("grace@example.com", COMMENT_REPLIED, {
        thread: "t1",
        comment: "c2",
        body: "Flights are cheaper.",
        via: "Claude Code",
      }),
      // not her comment: ignored
      by("grace@example.com", COMMENT_EDITED, { thread: "t1", comment: "t1", body: "Thursday?" }),
      by("ada@example.com", COMMENT_EDITED, {
        thread: "t1",
        comment: "t1",
        body: "Wednesday, surely?",
      }),
      by("grace@example.com", COMMENT_RESOLVED, { thread: "t1" }),
      by("ada@example.com", COMMENT_ADDED, { thread: "t2", quote: null, body: "Who's booking?" }),
      by("ada@example.com", COMMENT_DELETED, { thread: "t2", comment: "t2" }),
    ],
    expected: [
      {
        id: "t1",
        quote: { exact: "Tuesday" },
        detached: false,
        resolved: { by: "grace@example.com" },
        comments: [
          { author: "ada@example.com", via: null, body: "Wednesday, surely?", edited: true },
          { author: "grace@example.com", via: "Claude Code", body: "Flights are cheaper." },
        ],
      },
    ],
  },
  {
    name: "a resolved thread reopened is open again",
    events: [
      by("ada@example.com", COMMENT_ADDED, { thread: "t1", quote: null, body: "Book it?" }),
      by("grace@example.com", COMMENT_RESOLVED, { thread: "t1" }),
      by("ada@example.com", COMMENT_REOPENED, { thread: "t1" }),
    ],
    expected: [{ id: "t1", resolved: null }],
  },
  {
    name: "a thread routed to the agent that answers it says which, until it's routed elsewhere",
    events: [
      by("ada@example.com", COMMENT_ADDED, { thread: "t1", quote: null, body: "Flights?" }),
      asMindCode(COMMENT_ROUTED, { thread: "t1", to: agent }),
    ],
    expected: [{ id: "t1", routedTo: agent }],
  },
  {
    name: "a thread routed nowhere after an agent is routed to none",
    events: [
      by("ada@example.com", COMMENT_ADDED, { thread: "t1", quote: null, body: "Flights?" }),
      asMindCode(COMMENT_ROUTED, { thread: "t1", to: agent }),
      asMindCode(COMMENT_ROUTED, { thread: "t1", to: null }),
    ],
    expected: [{ id: "t1", routedTo: null }],
  },
  {
    name: "a re-anchored quote replaces the old one; none detaches the thread and keeps its quote",
    events: [
      by("ada@example.com", COMMENT_ADDED, { thread: "t1", quote: tuesday, body: "Wednesday?" }),
      by("ada@example.com", COMMENT_ADDED, { thread: "t2", quote: tuesday, body: "Or Monday?" }),
      asMindCode(COMMENT_REANCHORED, {
        thread: "t1",
        quote: { exact: "Tuesdays", prefix: "on ", suffix: "." },
      }),
      asMindCode(COMMENT_REANCHORED, { thread: "t2", quote: null }),
    ],
    expected: [
      { id: "t1", quote: { exact: "Tuesdays" }, detached: false },
      { id: "t2", quote: { exact: "Tuesday" }, detached: true },
    ],
  },
  {
    name: "a thread added twice, a reply to no thread and a payload that doesn't parse change nothing",
    events: [
      by("ada@example.com", COMMENT_ADDED, { thread: "t1", quote: null, body: "First" }),
      by("grace@example.com", COMMENT_ADDED, { thread: "t1", quote: null, body: "Again" }),
      by("grace@example.com", COMMENT_REPLIED, { thread: "nope", comment: "c2", body: "Hi" }),
      by("grace@example.com", COMMENT_REPLIED, { thread: "t1", body: "no comment id" }),
    ],
    expected: [{ id: "t1", comments: [{ body: "First" }] }],
  },
])("$name", ({ events, expected }) => {
  // an array matches only an array of its length: an extra thread fails the row
  expect(events.reduce(reduceComments, [])).toMatchObject(expected);
});

test("an event that changes nothing hands back the same threads", () => {
  const threads = [
    by("ada@example.com", COMMENT_ADDED, { thread: "t1", quote: null, body: "Hi" }),
  ].reduce(reduceComments, []);
  const ignored = by("grace@example.com", COMMENT_EDITED, {
    thread: "t1",
    comment: "t1",
    body: "x",
  });
  expect(reduceComments(threads, ignored)).toBe(threads);
});

test.for([
  {
    name: "a person, by email",
    source: { principal: { actor: "u1", email: "ada@example.com" } },
    author: "ada@example.com",
  },
  {
    name: "a person with no email, by actor id",
    source: { principal: { actor: "u1" } },
    author: "u1",
  },
  {
    name: "a script run for a person, as that person",
    source: { onBehalfOf: { principal: { actor: "u2", email: "grace@example.com" } } },
    author: "grace@example.com",
  },
  {
    name: "an agent's own code, by the context it wrote from",
    source: {},
    author: "/docs/config/plan.md",
  },
])("a comment's author is $name", ({ source, author }) => {
  expect({ author: authorOf(event(COMMENT_ADDED, {}, source)) }).toMatchObject({ author });
});

// The session appends these payloads and the doc's processor parses them with these schemas: each
// row is one event as a page writes it.
test.for([
  { name: "a quote", schema: Quote, payload: tuesday },
  {
    name: "a new thread",
    schema: CommentAdded,
    payload: { thread: "t1", quote: null, body: "Hi" },
  },
  {
    name: "a reply by an agent for its person",
    schema: CommentReplied,
    payload: { thread: "t1", comment: "c2", body: "Yes.", via: "Claude Code" },
  },
  {
    name: "an edit",
    schema: CommentEdited,
    payload: { thread: "t1", comment: "c2", body: "Yes!" },
  },
  { name: "a deletion", schema: CommentDeleted, payload: { thread: "t1", comment: "c2" } },
  { name: "a resolve or reopen", schema: ThreadRef, payload: { thread: "t1" } },
  { name: "a detaching", schema: CommentReanchored, payload: { thread: "t1", quote: null } },
  { name: "a routing", schema: CommentRouted, payload: { thread: "t1", to: agent } },
])("the wire takes $name", ({ schema, payload }) => {
  expect(schema.safeParse(payload)).toMatchObject({ success: true });
});

/** A durable event a person appended, as the Docs page appends a comment. */
function by(email: string, type: string, payload: Record<string, unknown>) {
  return event(type, payload, { principal: { actor: email, email } });
}

/** An event a script run for `email` appended: it calls as the mind's code. */
function forPerson(email: string, type: string, payload: Record<string, unknown>) {
  return event(type, payload, { onBehalfOf: { principal: { actor: email, email } } });
}

/** An event the mind's own code appended: an agent's, or the doc's processor's. */
function asMindCode(type: string, payload: Record<string, unknown>) {
  return event(type, payload, {});
}

function event(
  type: string,
  payload: Record<string, unknown>,
  source: Partial<StreamEvent["source"]>,
): StreamEvent {
  return {
    type,
    payload,
    offset: 1,
    createdAt: "2026-11-12T10:00:00.000Z",
    path: "/docs/config/plan.md",
    source: { origin: "/docs/config/plan.md", ...source },
  };
}
