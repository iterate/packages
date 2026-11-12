// Carried over from iterate/docs@fba5c21 (packages/docs-app/src/lib/doc-list.ts).
// One repo's files as a page's tree and the doc list show them, read when the page first wants
// them and again after each commit to the repo. The commit reaches the page as the mind root's
// `repo/commit-completed`, pushed to a subscription the list holds only while something on the page
// reads it (React's useSyncExternalStore: the first listener opens it, the last one leaving closes
// it). One list serves the whole page: make it once per repo and hand it to each reader.
import { z } from "zod";
import type { DocsMind } from "./create-doc.ts";

export type DocListState =
  | { kind: "loading" }
  | { kind: "loaded"; paths: string[] }
  | { kind: "failed"; message: string };

/** A commit's event as the list reads it: which repo it was to. */
const CommitCompleted = z.object({ payload: z.object({ path: z.string() }) });

export class DocList {
  #state: DocListState = { kind: "loading" };
  #listeners = new Set<() => void>();
  /** The mind's root context, as the page holds it. */
  mind: DocsMind;
  /** The repo listed, `/repos/<name>`. */
  repo: string;
  /** This opening of the list, once its subscription is in place: a read lands only while the
   *  opening it was made in still stands. Null while the list is closed or opening. */
  #opening: object | null = null;
  /** Lets go of the open subscription; null while nothing reads the list. */
  #close: (() => void) | null = null;

  constructor(mind: DocsMind, repo: string) {
    this.mind = mind;
    this.repo = repo;
  }

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    if (this.#listeners.size === 1) this.#start();
    return () => {
      this.#listeners.delete(listener);
      if (this.#listeners.size === 0) {
        this.#close?.();
        this.#close = null;
      }
    };
  };

  state = () => this.#state;

  /** Read the list again now: after this page made a doc, before the commit's event arrives. */
  reload() {
    if (this.#opening) void this.#read(this.#opening);
  }

  #set(state: DocListState) {
    this.#state = state;
    for (const listener of this.#listeners) listener();
  }

  #start() {
    let subscription: Disposable | null = null;
    let closed = false;
    const opening = {};
    this.#close = () => {
      closed = true;
      this.#opening = null;
      subscription?.[Symbol.dispose]();
    };
    void (async () => {
      // subscribed before the first read: a commit between the two is read again, never missed
      const opened = await this.mind.subscribe({
        consumes: ["events.iterate.com/repo/commit-completed"],
        target: (events) => {
          // capnweb hands each event as a proxy, which structuredClone refuses: a plain copy to parse
          const moved = z
            .array(z.unknown())
            // react-doctor-disable-next-line react-doctor/no-json-parse-stringify-clone -- a structured clone refuses a proxy; JSON reads one through its properties
            .parse(JSON.parse(JSON.stringify(events)))
            .some((event) => CommitCompleted.safeParse(event).data?.payload.path === this.repo);
          if (moved) void this.#read(opening);
        },
      });
      // what's opened after the list closed is let go at once
      if (closed) return opened[Symbol.dispose]();
      subscription = opened;
      this.#opening = opening;
      await this.#read(opening);
    })().catch((error: unknown) => {
      if (!closed) this.#set({ kind: "failed", message: messageOf(error) });
    });
  }

  async #read(opening: object) {
    try {
      using repo = this.mind.repos.get(this.repo);
      const { paths } = await repo.listFiles();
      if (this.#opening === opening) this.#set({ kind: "loaded", paths: paths.toSorted() });
    } catch (error) {
      if (this.#opening === opening) this.#set({ kind: "failed", message: messageOf(error) });
    }
  }
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
