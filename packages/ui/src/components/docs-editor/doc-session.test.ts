// @vitest-environment jsdom
// A tab's session on one doc, against a fake mind whose doc processor keeps the text as a Y.Doc,
// relays frames to every tab, reduces comments and says when a save landed: joining and syncing,
// edits out and in, two tabs converging, comment threads, the save state. The real processor, its
// saves and merges are the mind's config's; the editor's look is not tested here.
import { expect, test, vi } from "vitest";
import * as Y from "yjs";
import { reduceComments } from "./comments.ts";
import type { DocsMind } from "./create-doc.ts";
import { cursorColor, DocSession } from "./doc-session.ts";
import { AWARENESS_FRAME, EDIT_FRAME, fromBase64, toBase64, type DocLiveState } from "./frames.ts";

test("a tab joins the doc, syncs, and shows the processor's text, saved", async () => {
  const mind = fakeMind("# Plan\n\nWe fly in on Tuesday.\n");
  using tab = open(mind, "ada@example.com", "# Plan\n");

  await vi.waitFor(() => expect(tab.session.state()).toMatchObject({ status: { kind: "saved" } }));
  expect(tab.text()).toBe("# Plan\n\nWe fly in on Tuesday.\n");
  expect([...mind.opened]).toEqual(["docs/opened:/docs/config/plan.md"]);
});

test("a local edit goes out as an edit frame, and a frame from the processor comes in", async () => {
  const mind = fakeMind("# Plan\n");
  using tab = open(mind, "ada@example.com", "# Plan\n");
  await vi.waitFor(() => expect(tab.session.state()).toMatchObject({ status: { kind: "saved" } }));

  tab.type(tab.text().length, "Bring a coat.\n");
  await vi.waitFor(() => expect(mind.text()).toBe("# Plan\nBring a coat.\n"));
  expect(mind.frames).toContainEqual(expect.objectContaining({ type: EDIT_FRAME }));
  // the processor took an edit it has not saved yet
  await vi.waitFor(() =>
    expect(tab.session.state()).toMatchObject({ status: { kind: "editing" } }),
  );

  // a commit an agent made, merged by the processor into the text
  mind.processorEdit((text) => text.insert(0, "Draft\n"));
  await vi.waitFor(() => expect(tab.text()).toBe("Draft\n# Plan\nBring a coat.\n"));
});

test("two tabs on one doc type at once and converge on the same text", async () => {
  const mind = fakeMind("# Plan\n");
  using ada = open(mind, "ada@example.com", "# Plan\n");
  using grace = open(mind, "grace@example.com", "# Plan\n");
  await vi.waitFor(() => {
    expect(ada.session.state()).toMatchObject({ status: { kind: "saved" } });
    expect(grace.session.state()).toMatchObject({ status: { kind: "saved" } });
  });

  ada.type(0, "Ada was here. ");
  grace.type(grace.text().length, "Grace too.\n");

  await vi.waitFor(() => {
    expect(ada.text()).toBe("Ada was here. # Plan\nGrace too.\n");
    expect(grace.text()).toBe(ada.text());
    expect(mind.text()).toBe(ada.text());
  });
  // each sees the other by name, through the awareness frames
  await vi.waitFor(() => {
    expect(ada.session.state()).toMatchObject({ others: ["Grace"] });
    expect(grace.session.state()).toMatchObject({ others: ["Ada"] });
  });
  expect(mind.frames).toContainEqual(expect.objectContaining({ type: AWARENESS_FRAME }));
});

test("a comment on the selection is added, replied to, resolved and reopened", async () => {
  const mind = fakeMind("We fly in on Tuesday.\n");
  using ada = open(mind, "ada@example.com", "We fly in on Tuesday.\n");
  using grace = open(mind, "grace@example.com", "We fly in on Tuesday.\n");
  await vi.waitFor(() =>
    expect(grace.session.state()).toMatchObject({ status: { kind: "saved" } }),
  );

  ada.select("Tuesday");
  expect(ada.session.startComment()).toBe(true);
  const thread = ada.session.state().draft!.thread;
  await ada.session.postDraft("Wednesday?");
  await vi.waitFor(() =>
    expect(ada.session.state()).toMatchObject({
      draft: null,
      threads: [{ id: thread, quote: { exact: "Tuesday" }, attached: true, resolved: null }],
    }),
  );

  await grace.session.reply(thread, "Flights are cheaper.");
  await grace.session.resolve(thread);
  await vi.waitFor(() =>
    expect(ada.session.state()).toMatchObject({
      threads: [
        {
          id: thread,
          resolved: { by: "grace@example.com" },
          comments: [
            { author: "ada@example.com", body: "Wednesday?" },
            { author: "grace@example.com", body: "Flights are cheaper." },
          ],
        },
      ],
    }),
  );

  await ada.session.reopen(thread);
  await vi.waitFor(() =>
    expect(grace.session.state()).toMatchObject({ threads: [{ id: thread, resolved: null }] }),
  );
});

test("a comment with nothing selected is on the whole doc", async () => {
  const mind = fakeMind("# Plan\n");
  using ada = open(mind, "ada@example.com", "# Plan\n");
  await vi.waitFor(() => expect(ada.session.state()).toMatchObject({ status: { kind: "saved" } }));

  ada.session.startComment();
  await ada.session.postDraft("Who's booking?");

  await vi.waitFor(() =>
    expect(ada.session.state()).toMatchObject({
      threads: [{ quote: null, comments: [{ body: "Who's booking?" }] }],
    }),
  );
});

test("the save state follows the processor: editing, then saved at the commit it says landed", async () => {
  const mind = fakeMind("# Plan\n");
  using ada = open(mind, "ada@example.com", "# Plan\n");
  await vi.waitFor(() =>
    expect(ada.session.state()).toMatchObject({ status: { kind: "saved", oid: "c0" } }),
  );

  ada.type(0, "Hi. ");
  await vi.waitFor(() =>
    expect(ada.session.state()).toMatchObject({ status: { kind: "editing" } }),
  );

  mind.saved("c1", ["ada@example.com"]);
  await vi.waitFor(() =>
    expect(ada.session.state()).toMatchObject({
      status: { kind: "saved", oid: "c1", by: ["ada@example.com"] },
    }),
  );

  mind.saveFailed("the commit was refused");
  await vi.waitFor(() =>
    expect(ada.session.state()).toMatchObject({
      status: { kind: "save-failed", message: "the commit was refused" },
    }),
  );
});

test("a mind whose config lacks the processors leaves the doc unavailable, and Try again opens it once it has them", async () => {
  const mind = fakeMind("# Plan\n");
  mind.refuseProcessors("no class DocsDurableObject in apps/docs/processors.ts");
  using ada = open(mind, "ada@example.com", "# Plan\n");

  await vi.waitFor(() =>
    expect(ada.session.state()).toMatchObject({
      status: {
        kind: "unavailable",
        message: "no class DocsDurableObject in apps/docs/processors.ts",
      },
    }),
  );
  // the page's text stays in the editor meanwhile
  expect(ada.text()).toBe("# Plan\n");

  mind.refuseProcessors(null);
  ada.session.reconnect();
  await vi.waitFor(() => expect(ada.session.state()).toMatchObject({ status: { kind: "saved" } }));
  ada.type(0, "Hi. ");
  await vi.waitFor(() => expect(mind.text()).toBe("Hi. # Plan\n"));
});

test("a person's cursor colour is one of the page's tokens, the same in every tab", () => {
  expect(cursorColor("ada@example.com")).toMatch(/^var\(--/);
  expect(cursorColor("ada@example.com")).toBe(cursorColor("ada@example.com"));
});

/** A tab: a session on /repos/config's plan.md for `email`, mounted in its own element. Disposing
 *  it unmounts the editor, which leaves the doc. */
function open(mind: ReturnType<typeof fakeMind>, email: string, text: string) {
  // jsdom lays nothing out, and CodeMirror measures the cursor's place with a Range's rects:
  // empty ones, once for the file, keep its measuring quiet
  Range.prototype.getClientRects ||= () => Object.assign([], { item: () => null });
  Range.prototype.getBoundingClientRect ||= () => new DOMRect();
  const name = email.split("@")[0]!.replace(/^./, (first) => first.toUpperCase());
  const session = new DocSession({
    itx: mind.as(email),
    repo: "/repos/config",
    path: "plan.md",
    kind: "markdown",
    text,
    user: { name, email, color: cursorColor(email) },
    commentOnly: false,
    facetSpec: (className) => ({
      className,
      mainModule: "apps/docs/processors.ts",
      source: ["itx", ["cd", "/"], "repos", ["get", "/repos/config"], ["modules"]],
      cacheKey: "docs-processors:abc123",
    }),
  });
  const unmount = session.mount(document.body.appendChild(document.createElement("div")));
  const text_ = () => {
    let current = "";
    session.run((view) => {
      current = view.state.doc.toString();
      return true;
    });
    return current;
  };
  return {
    session,
    text: text_,
    type: (at: number, insert: string) =>
      session.run((view) => {
        view.dispatch({ changes: { from: at, insert } });
        return true;
      }),
    select: (part: string) =>
      session.run((view) => {
        const at = text_().indexOf(part);
        view.dispatch({ selection: { anchor: at, head: at + part.length } });
        return true;
      }),
    [Symbol.dispose]: () => unmount?.(),
  };
}

/** A mind with one doc open, /repos/config's plan.md, and its processor: the text as a Y.Doc,
 *  frames relayed to every tab's subscription, comments reduced into the live state, and saves as
 *  the test says them. `as(email)` is the mind's root as that person's page holds it: what it
 *  appends is theirs. */
function fakeMind(initial: string) {
  const doc = new Y.Doc();
  doc.getText("file").insert(0, initial);
  let live: { rev: number; state: DocLiveState } = {
    rev: 1,
    state: { commitOid: "c0", dirty: false, savedBy: [], saveError: null, threads: [] },
  };
  const subscriptions = new Set<{ consumes: string[]; target: (events: unknown[]) => void }>();
  const frames: { type: string; payload: unknown }[] = [];
  const opened = new Set<string>();
  // why the root refuses to enable the processors, while it does: a config without their classes
  let refusal: string | null = null;
  let offset = 0;

  const deliver = (event: { type: string; payload: unknown }) => {
    for (const subscription of subscriptions)
      if (subscription.consumes.includes(event.type))
        queueMicrotask(() => subscription.target([event]));
  };
  const publish = (state: Partial<DocLiveState>) => {
    live = { rev: live.rev + 1, state: { ...live.state, ...state } };
    // no patch: the tab reads the snapshot again, as it does after a gap
    deliver({
      type: "events.iterate.com/itx/live-state-changed",
      payload: { key: "doc", from: live.rev - 1, to: live.rev, patch: null },
    });
  };
  doc.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin === "processor")
      deliver({ type: EDIT_FRAME, payload: { update: toBase64(update), client: "processor" } });
  });

  const docContext = (email: string) => ({
    processors: { enable: async (name: string) => ({ name }) },
    subscribe: async (input: { consumes: string[]; target: (events: unknown[]) => void }) => {
      subscriptions.add(input);
      return { [Symbol.dispose]: () => subscriptions.delete(input) };
    },
    append: async (...events: { type: string; payload: Record<string, unknown> }[]) =>
      events.map((input) => {
        const event = {
          ...input,
          offset: ++offset,
          createdAt: new Date().toISOString(),
          path: "/docs/config/plan.md",
          source: { origin: "/", principal: { actor: email, email } },
        };
        if (input.type === EDIT_FRAME) {
          const { update } = input.payload;
          Y.applyUpdate(doc, fromBase64(String(update)), "tab");
          publish({ dirty: true });
        }
        if (input.type === EDIT_FRAME || input.type === AWARENESS_FRAME) {
          frames.push(input);
          deliver(input);
        }
        const threads = reduceComments(live.state.threads, event);
        if (threads !== live.state.threads) publish({ threads });
        return event;
      }),
    facets: {
      get: () => ({
        sync: async (stateVector: string) => ({
          update: toBase64(Y.encodeStateAsUpdate(doc, fromBase64(stateVector))),
          stateVector: toBase64(Y.encodeStateVector(doc)),
        }),
      }),
    },
    invoke: async () => structuredClone(live),
    [Symbol.dispose]: () => {},
  });

  const root = (email: string) => ({
    processors: {
      enable: async (name: string) => {
        if (refusal) throw new Error(refusal);
        return { name };
      },
    },
    // an idempotency key the root has seen appends nothing again
    append: async (...events: { idempotencyKey: string }[]) => {
      for (const { idempotencyKey } of events) opened.add(idempotencyKey);
      return [];
    },
    cd: () => docContext(email),
  });

  return {
    // the fake holds only what a session calls; the type is the whole capnweb stub of the mind
    as: (email: string) => root(email) as unknown as DocsMind,
    refuseProcessors: (why: string | null) => {
      refusal = why;
    },
    frames,
    opened,
    text: () => doc.getText("file").toString(),
    processorEdit: (change: (text: Y.Text) => void) =>
      doc.transact(() => change(doc.getText("file")), "processor"),
    saved: (commitOid: string, savedBy: string[]) =>
      publish({ commitOid, savedBy, dirty: false, saveError: null }),
    saveFailed: (saveError: string) => publish({ saveError }),
  };
}
