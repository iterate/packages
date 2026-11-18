// member-itx.ts — THE MEMBER'S `itx` ON A MIND'S OWN HOST, for a no-build app's page: a capnweb
// session over a WebSocket to this host's `/itx` (the app answers it with `host.auth.itx(request)`),
// whose root is the mind's itx, as the member the platform signed in on this host.
//
// THE `itx` IS A PROXY TO THE CURRENT SESSION, and a closed socket costs a new session, not the
// page. A deploy cuts the socket for a few seconds, several times a day.
//
//   - A session is GOOD once its first call, a `whoami()` it is born with, resolves, or once it has
//     stayed open for `GOOD_AFTER_MS`. A refusal or an abort is no proof: an overloaded mind
//     answers with one and closes. The socket
//     of a good session that closes is dialled again at once, then after each of
//     `QUICK_WAITS_MS` (about 16 s in all). A socket that opens and closes before it is good is a
//     failed dial: the next dial waits for the next step of the same waits. So a host that accepts
//     and then closes costs the quick dials and then one dial every `SLOW_WAIT_MS`, never a dial
//     at once. A call made meanwhile waits in the new session and is sent when its socket opens.
//     When every quick dial has failed, the calls that waited are refused, and one dial every
//     `SLOW_WAIT_MS` goes on for as long as the page is up. A network that comes back, or a tab
//     that comes to the front, dials at once.
//   - An open session is asked `whoami()` every 30 s. One that leaves it unanswered for 15 s is
//     dead, and is replaced as a closed one is. The call is also the traffic that keeps Cloudflare
//     from shedding the socket as idle (a WebSocket ping does not count, and a browser cannot send
//     one).
//   - Only the end of the sign-in reloads a page that reads its session, and the reload reaches
//     the sign-in. The page's saved rows are wiped first (#/lib/saved-log-tail.ts). The platform
//     ends an open session with the close code 1008. With no session open it refuses the upgrade
//     with 401, which a browser shows as 1006: so when a session's dials have all failed, one
//     plain request to `/itx` asks, and a 401 is the end of the sign-in. Three reloads in a
//     minute stop them (`mayReload`).
//   - The proxy answers its session under `ITX_SESSION` (#/lib/itx-session.ts): the epoch, which
//     grows by one when a session's socket opens, and the state a page shows, which is `open` only
//     for a good session. The epoch grows at open, so what a page holds opens again at once after
//     a cut; a socket that is not good does not start the waits again, so the epoch grows at most
//     at the rate of the dials. A stub or a
//     subscription is of one session, so what holds one opens it again when the epoch changes
//     (`useHeldContext` of src/hooks/use-itx-session.ts), and a page draws `ReconnectingMark`
//     once.
//   - A page where nothing subscribes to the session cannot open its stubs again: an app that
//     has not drawn yet, whose first call was refused, or one that holds its stubs with the SDK's
//     hooks alone. That page is reloaded when the next session opens, and says so in `root`
//     meanwhile. The mark only watches: it does not make a page one that lives on.
//   - THE FIRST SOCKET CAN BE DIALLED BEFORE THIS MODULE HAS LOADED. A page's HTML dials it in one
//     inline line of its head, under the name `EARLY_ITX_SOCKET`, and `memberItx` takes it for
//     its first session while it is connecting or open:
//       <script>
//         try { window.__itxSocket = new WebSocket(new URL("/itx", location.href.replace(/^http/, "ws"))); } catch {}
//       </script>
//     A page with no such line, or whose early socket has closed, is dialled as above. The socket
//     is taken once: nothing else may read or write it.
import { newWebSocketRpcSession } from "capnweb";
import type { AuthenticatedApp } from "iterate/app";
import { ITX_SESSION, type ItxConnection, type ItxSession } from "#/lib/itx-session.ts";
import { wipeSavedLogTails } from "#/lib/saved-log-tail.ts";

type Itx = AuthenticatedApp["itx"];

/** The waits before each quick dial: the numbers of iterate's own client (`iterate/app`), whose
 *  first dial is at once too. */
const QUICK_WAITS_MS: readonly number[] = [0, 250, 500, 1_000, 2_000, 4_000, 8_000];
/** How long an open socket that the host sent nothing on stays before its session is good. */
const GOOD_AFTER_MS = 5_000;
/** The wait before each dial once the quick ones have all failed. */
const SLOW_WAIT_MS = 15_000;
/** How long one dial may take to open. A handshake that neither opens nor closes is a failed dial. */
const HANDSHAKE_TIMEOUT_MS = 10_000;
/** The heartbeat's numbers, as iterate's own client has them. */
const HEARTBEAT = { intervalMs: 30_000, deadAfterMs: 15_000 };
/** How long a page says nothing of a session that is gone: a deploy's cut is over before it. */
const QUIET_MS = 2_000;
/** The platform's close when the sign-in ended (core/itx/src/session.ts). */
const SIGN_IN_ENDED = 1008;

/** The property of `window` under which a page's HTML keeps the socket it dialled early, for
 *  `memberItx` to take. */
export const EARLY_ITX_SOCKET = "__itxSocket";

/** The member's itx. `root` is where the page says what a reload would mend: that the mind
 *  cannot be reached, for a page that does not read its session, and that the sign-in ended,
 *  when the reloads did not reach the sign-in. */
export function memberItx(root = document.getElementById("root")): Itx {
  // The page's own property, which no type declares: its HTML put a WebSocket there, or nothing.
  const page = window as { [EARLY_ITX_SOCKET]?: WebSocket };
  const early = page[EARLY_ITX_SOCKET];
  delete page[EARLY_ITX_SOCKET];
  return connectMemberItx({ root, early: early instanceof WebSocket ? early : undefined });
}

/** `memberItx` with its parts named, for a test: the socket's constructor and the reload. */
export function connectMemberItx({
  root,
  url = new URL("/itx", location.href.replace(/^http/, "ws")),
  WebSocket: Socket = WebSocket,
  early,
  fetch: ask = (input, init) => fetch(input, init),
  reload = () => location.reload(),
}: {
  root: Pick<HTMLElement, "textContent"> | null;
  url?: URL;
  WebSocket?: typeof WebSocket;
  /** A socket to `url` that the page dialled before this ran: the first session's first dial. */
  early?: WebSocket;
  fetch?: typeof fetch;
  reload?: () => void;
}): Itx {
  let connection: ItxConnection = { epoch: 0, state: "opening" };
  const readers = new Set<() => void>();
  const watchers = new Set<() => void>();
  const publish = (next: ItxConnection) => {
    connection = next;
    for (const changed of [...readers, ...watchers]) changed();
  };
  const session: ItxSession = {
    get: () => connection,
    subscribe(changed) {
      readers.add(changed);
      return () => readers.delete(changed);
    },
    watch(changed) {
      watchers.add(changed);
      return () => watchers.delete(changed);
    },
  };
  /** Nothing opens again what it holds of a session: the app has not drawn, or it holds its stubs
   *  with the SDK's hooks alone. What only shows the state (`watch`) is no such reader. */
  const unread = () => readers.size === 0;
  /** A reload, or the words in `root` when three in a minute did not mend it. */
  const reloadOrSay = (words: string) => {
    if (mayReload(sessionStorage, Date.now())) reload();
    else if (root) root.textContent = words;
  };
  type Session = { stub: Itx; dial: Dial; heartbeat?: ReturnType<typeof startHeartbeat> };
  let current: Session;
  /** A session of this page has ended: what was held or asked through it is lost. */
  let ended = false;
  /** The sign-in ended: nothing is dialled again, and a reload reaches the sign-in. */
  let signedOut = false;
  const signInEnded = () => {
    signedOut = true;
    clearTimeout(quiet);
    current.dial.socket.close();
    // the next member of this browser sees none of this one's saved rows
    void wipeSavedLogTails().then(() =>
      reloadOrSay("Your sign-in ended. Reload the page to sign in."),
    );
  };
  /** WHETHER THE SIGN-IN ENDED WHILE NO SESSION WAS OPEN, asked over HTTP. The platform ends an
   *  open session with 1008. With no session open it refuses the next upgrade with 401, and a
   *  browser reports a refused upgrade as a close with 1006, whatever its status was. A plain
   *  request to the same path gets that status: 401 for no sign-in, 426 for a member who asks
   *  without an upgrade. No answer, or any other, is no evidence. */
  const askWhetherSignedIn = async () => {
    const answer = await ask(new URL(url.href.replace(/^ws/, "http")), {
      cache: "no-store",
      signal: AbortSignal.timeout(HANDSHAKE_TIMEOUT_MS),
    }).catch(() => undefined);
    await answer?.body?.cancel();
    if (answer?.status === 401 && !signedOut) signInEnded();
  };
  let quiet: ReturnType<typeof setTimeout> | undefined;
  /** Without a session from now: the page says so only when the quiet time is over. */
  const gone = () => {
    publish({ epoch: connection.epoch, state: "opening" });
    quiet = setTimeout(() => publish({ epoch: connection.epoch, state: "reconnecting" }), QUIET_MS);
  };
  /** A new session, the current one from now: its calls wait until one of its dials opens. */
  const start = (waitsMs: readonly number[], dialled?: WebSocket) => {
    const dial = dialSocket(url, waitsMs, Socket, dialled);
    const stub: Itx = newWebSocketRpcSession(dial.socket);
    const mine: Session = { stub, dial };
    current = mine;
    let good = false;
    let proving: ReturnType<typeof setTimeout> | undefined;
    /** Its first `whoami()` resolved, or the socket stayed open: the page has a session again. */
    const proven = () => {
      if (good || dial.socket.readyState !== Socket.OPEN) return;
      good = true;
      clearTimeout(proving);
      clearTimeout(quiet);
      if (ended && unread()) return reloadOrSay("Disconnected. Reload the page to connect.");
      publish({ epoch: connection.epoch, state: "open" });
    };
    // the proof is the session's first call, so it is answered before any call of the page
    void Promise.resolve(stub.whoami()).then(proven, () => {});
    dial.socket.addEventListener("open", () => {
      proving = setTimeout(proven, GOOD_AFTER_MS);
      mine.heartbeat = startHeartbeat(
        () => stub.whoami(),
        () => dial.socket.close(),
      );
      // the state stays as it was until the session is good, so a socket that flaps moves no mark
      publish({ epoch: connection.epoch + 1, state: connection.state });
    });
    dial.socket.addEventListener("close", (event) => {
      mine.heartbeat?.stop();
      clearTimeout(proving);
      ended = true;
      if (signedOut) return;
      if (event.code === SIGN_IN_ENDED) return signInEnded();
      if (good) {
        gone();
        return start(QUICK_WAITS_MS);
      }
      // a socket that closed before it was good is a failed dial: the waits go on where they were
      const left = waitsMs.slice(dial.dials());
      if (left.length) return start(left);
      // every dial of the session failed: its calls are refused, and the slow dials go on, unless
      // the host says over HTTP that the sign-in ended
      void askWhetherSignedIn();
      clearTimeout(quiet);
      if (unread() && root) root.textContent = "Cannot reach the mind. Trying again…";
      if (connection.state !== "unreachable")
        publish({ epoch: connection.epoch, state: "unreachable" });
      start([SLOW_WAIT_MS]);
    });
  };
  // the epoch as it is by then: a first socket that opened and is not good yet has moved it already
  quiet = setTimeout(() => publish({ epoch: connection.epoch, state: "reconnecting" }), QUIET_MS);
  start(QUICK_WAITS_MS, early);
  // a network that came back, or a tab back in front: an open session is asked at once whether it
  // lives, and a dial that waits goes now
  const check = () => {
    current.heartbeat?.beatNow();
    current.dial.hurry();
  };
  addEventListener("online", check);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") check();
  });
  // Every property is read from the current session's stub: capnweb's own stub for that property,
  // returned as it is. The target is never read, so an empty object stands in for the stub's type.
  return new Proxy({} as Itx, {
    get: (_target, property) =>
      property === ITX_SESSION ? session : Reflect.get(current.stub, property),
  });
}

/** One session's socket, as capnweb's transport reads one: CONNECTING while it dials, after each
 *  wait of `waitsMs` in turn, then the socket of the dial that opened. It closes once: with the
 *  open socket's close, with 1006 when no dial opened, or when it is closed from here (a dead
 *  heartbeat), whatever the socket under it does after. `dialled` is a socket that was dialled
 *  before: while it is connecting or open it is the first dial, and one that opened already says
 *  so here once the session has its listeners on. */
type Dial = {
  socket: WebSocket;
  /** A dial that waits for its time goes now. */
  hurry(): void;
  /** How many dials it has made. */
  dials(): number;
};
function dialSocket(
  url: URL,
  waitsMs: readonly number[],
  Socket: typeof WebSocket,
  dialled?: WebSocket,
): Dial {
  const events = new EventTarget();
  let readyState: number = Socket.CONNECTING;
  let under: WebSocket | undefined;
  let dials = 0;
  let wait: ReturnType<typeof setTimeout> | undefined;
  let handshake: ReturnType<typeof setTimeout> | undefined;
  const closed = (code: number, reason = "") => {
    if (readyState === Socket.CLOSED) return;
    readyState = Socket.CLOSED;
    clearTimeout(wait);
    wait = undefined;
    clearTimeout(handshake);
    const left = under;
    under = undefined;
    left?.close();
    events.dispatchEvent(new CloseEvent("close", { code, reason }));
  };
  const dial = (socket = new Socket(url)) => {
    wait = undefined;
    socket.binaryType = "arraybuffer";
    under = socket;
    handshake = setTimeout(() => socket.close(), HANDSHAKE_TIMEOUT_MS);
    const opened = () => {
      if (under !== socket || readyState !== Socket.CONNECTING) return;
      clearTimeout(handshake);
      readyState = Socket.OPEN;
      events.dispatchEvent(new Event("open"));
    };
    socket.addEventListener("open", opened);
    if (socket.readyState === Socket.OPEN) queueMicrotask(opened);
    socket.addEventListener("message", (event) => {
      if (under === socket) events.dispatchEvent(new MessageEvent("message", { data: event.data }));
    });
    socket.addEventListener("close", (event) => {
      if (under !== socket) return;
      clearTimeout(handshake);
      if (readyState === Socket.OPEN || event.code === SIGN_IN_ENDED)
        return closed(event.code, event.reason);
      under = undefined;
      next();
    });
  };
  const next = () => {
    const waitMs = waitsMs[dials++];
    // a wait of 0 is a wait
    if (waitMs === undefined) return closed(1006);
    if (waitMs) wait = setTimeout(dial, waitMs);
    else dial();
  };
  if (dialled && (dialled.readyState === Socket.CONNECTING || dialled.readyState === Socket.OPEN)) {
    dials = 1;
    dial(dialled);
  } else next();
  // the state is read live: `Object.assign` would copy a getter's value once
  Object.defineProperty(events, "readyState", { get: () => readyState });
  const socket = Object.assign(events, {
    binaryType: "arraybuffer",
    // capnweb sends once this is open; what it sends after the close goes nowhere, as on a socket
    send: (data: Parameters<WebSocket["send"]>[0]) => under?.send(data),
    close: (code?: number, reason?: string) => closed(code ?? 1006, reason),
  });
  return {
    // The members that capnweb's WebSocket transport and this file use, and no more.
    socket: socket as unknown as WebSocket,
    hurry() {
      if (!wait) return;
      clearTimeout(wait);
      dial();
    },
    dials: () => dials,
  };
}

/** A call on the session every `HEARTBEAT.intervalMs`, and `dead()` when one is left unanswered
 *  for `HEARTBEAT.deadAfterMs`. A refused call is an answer: the socket carried it both ways. */
function startHeartbeat(beat: () => PromiseLike<unknown>, dead: () => void) {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const answered = () => {
    clearTimeout(deadline);
    deadline = undefined;
  };
  /** A beat now, unless one is in flight. */
  const beatNow = () => {
    if (deadline) return;
    deadline = setTimeout(dead, HEARTBEAT.deadAfterMs);
    void Promise.resolve(beat()).then(answered, answered);
  };
  const interval = setInterval(beatNow, HEARTBEAT.intervalMs);
  return {
    beatNow,
    stop() {
      clearInterval(interval);
      clearTimeout(deadline);
    },
  };
}

/** Whether the page may reload itself at `now`: yes unless it did so three times in the last
 *  minute, so a page that a reload does not mend says so and does not reload for ever. The
 *  reloads are kept in `storage`, which lasts across the reloads of one tab. */
export function mayReload(storage: Pick<Storage, "getItem" | "setItem">, now: number) {
  let reloads: number[] = [];
  try {
    const kept: unknown = JSON.parse(storage.getItem("itx-reloads") || "[]");
    reloads = (Array.isArray(kept) ? kept : []).filter(
      (at): at is number => typeof at === "number" && now - at < 60_000,
    );
    storage.setItem("itx-reloads", JSON.stringify([...reloads, now]));
  } catch {
    // no storage: one reload is still right
  }
  return reloads.length < 3;
}
