#!/usr/bin/env node
// record-upload.mjs: the recorder's spool (Sources/Record) into the mind, slot by slot.
//
//   node record-upload.mjs <spool> --name <name> --iterate <iterate.js> --mind <address> [--max-bytes N]
//
// The spool holds, for each slot of 30 seconds, `slots/<t>.json` (the payload of the event
// `record/slot-stored`) and the files it names, each at its path in the mind's files. Oldest slot
// first, this puts every file of the slot into the mind's files, THEN appends the event to
// /devices/<name> with the idempotency key `record/slot-stored/<t>`, then deletes the slot from the
// spool. So an event never names a file that is not there, and a restart goes on where it stopped:
// a file that is gone from the spool went up before (it is deleted only after the append), and the
// append again is the same event. Failures wait 1 s, then twice as long each time, at most 60 s.
// Over `--max-bytes` (5 GB) the oldest slots are dropped.
//
// Each file goes by a signed PUT (`itx.r2.presign`, the links of one slot asked for in one go)
// that streams it from disk: no byte of a file passes through the connection or a Durable Object.
//
// It connects to the mind once, as the person (the iterate CLI's own sign-in: the Mac's key lends
// and does nothing else), on its own connection, so it holds back nothing of the device's events.
// The app (Sources/VoiceMeetMac/DeviceRecord.swift) starts it and closes stdin to end it; it then ends
// the slot it is on. stdout is JSON lines: { uploaded, waiting }, { failed, waiting }, { dropped, why }.
import {
  createReadStream,
  existsSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: "string" },
    iterate: { type: "string" },
    mind: { type: "string" },
    "max-bytes": { type: "string", default: String(5e9) },
  },
});
const spool = positionals[0];
const { name, iterate, mind } = values;
if (!spool || !name || !iterate || !mind)
  throw new Error(
    "node record-upload.mjs <spool> --name <name> --iterate <iterate.js> --mind <address>",
  );
const maxBytes = Number(values["max-bytes"]);
const say = (line) => process.stdout.write(`${JSON.stringify(line)}\n`);
const { addressOf, connectMind } = await import(
  pathToFileURL(join(dirname(dirname(iterate)), "dist/node.mjs")).href
);

/** The mind, connected once; a failure connects again at the next try. */
let connection;
function connect() {
  connection ??= (async () => {
    const { itx } = await connectMind({ address: addressOf(mind), signIn: false });
    return { device: itx.cd(`/devices/${name}`), files: itx.r2 };
  })();
  connection.catch(() => (connection = undefined));
  return connection;
}

const local = (path) => join(spool, path.slice(1));
const slotFile = (t) => join(spool, "slots", `${t}.json`);
/** The waiting slots, oldest first. */
function waitingSlots() {
  const folder = join(spool, "slots");
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((file) => /^\d+\.json$/.test(file))
    .map((file) => Number(file.slice(0, -5)))
    .sort((a, b) => a - b);
}

/** Every file a slot's event names, with its content type. */
function filesOf(payload) {
  return Object.values(payload.tracks).flatMap((track) => [
    [track.file, track.kind === "audio" ? "audio/mp4" : "video/mp4"],
    ...(track.picture ? [[track.picture, "image/jpeg"]] : []),
  ]);
}

/** The event first (a slot with no event is no slot to the uploader), then its files. */
function remove(t, payload) {
  rmSync(slotFile(t), { force: true });
  for (const [path] of filesOf(payload)) {
    rmSync(local(path), { force: true });
    // the empty folders of an hour, a day and a track
    for (let folder = dirname(local(path)); folder.startsWith(join(spool, "devices") + "/");) {
      try {
        rmdirSync(folder);
      } catch {
        break;
      }
      folder = dirname(folder);
    }
  }
}

/** Drops the oldest slots while the spool holds more than `maxBytes`. */
function cap(slots) {
  const sizes = slots.map((t) => {
    try {
      const payload = JSON.parse(readFileSync(slotFile(t), "utf8"));
      return filesOf(payload).reduce(
        (sum, [path]) => sum + (existsSync(local(path)) ? statSync(local(path)).size : 0),
        0,
      );
    } catch {
      return 0;
    }
  });
  let total = sizes.reduce((a, b) => a + b, 0);
  while (total > maxBytes && slots.length > 1) {
    const t = slots.shift();
    total -= sizes.shift();
    remove(t, JSON.parse(readFileSync(slotFile(t), "utf8")));
    say({ dropped: t, why: `the spool holds more than ${maxBytes} bytes` });
  }
}

/** One file to its signed link, streamed from disk; the answer is `{ path, contentType, size }`. */
function put(url, path, contentType) {
  const size = statSync(path).size;
  return new Promise((resolve, reject) => {
    const sending = (url.startsWith("https:") ? httpsRequest : httpRequest)(
      url,
      { method: "PUT", headers: { "content-type": contentType, "content-length": size } },
      (answer) => {
        let text = "";
        answer.setEncoding("utf8").on("data", (chunk) => (text += chunk));
        answer.on("end", () => {
          if (answer.statusCode >= 300)
            return reject(
              new Error(`PUT ${path}: HTTP ${answer.statusCode} ${text.slice(0, 200)}`),
            );
          const stored = JSON.parse(text).size;
          if (stored !== size)
            return reject(new Error(`${path}: the mind has ${stored} bytes, not ${size}`));
          resolve();
        });
      },
    );
    sending.on("error", reject);
    sending.setTimeout(110_000, () => sending.destroy(new Error(`PUT ${path} timed out`)));
    createReadStream(path).on("error", reject).pipe(sending);
  });
}

async function upload(t) {
  const { device, files } = await connect();
  const payload = JSON.parse(readFileSync(slotFile(t), "utf8"));
  const present = filesOf(payload).filter(([path]) => existsSync(local(path)));
  const gone = filesOf(payload).filter(([path]) => !existsSync(local(path)));
  // the links of the slot in one go; and for a file gone from the spool (it went up before, or
  // the spool's cap dropped it) the mind says which
  const [links, heads] = await Promise.all([
    Promise.all(
      present.map(([path]) =>
        files.presign({ key: path.slice(1), method: "PUT", expiresInSeconds: 600 }),
      ),
    ),
    Promise.all(gone.map(([path]) => files.head(path.slice(1)))),
  ]);
  await Promise.all(
    present.map(([path, contentType], index) => put(links[index].url, local(path), contentType)),
  );
  const missing = gone.filter((_, index) => !heads[index]).map(([path]) => path);
  if (missing.length) {
    remove(t, payload);
    say({ dropped: t, why: `not in the spool nor in the mind: ${missing.join(", ")}` });
    return false;
  }
  try {
    await device.append({
      type: "record/slot-stored",
      payload,
      idempotencyKey: `record/slot-stored/${t}`,
    });
  } catch (error) {
    // the mind has another event for this slot: it keeps it, and the files are the newer ones
    if (error?.code !== "IDEMPOTENCY_CONFLICT") throw error;
    say({ failed: `slot ${t}: ${error.message}`, kept: "the mind's event" });
  }
  remove(t, payload);
  return true;
}

let isEnding = false;
process.stdin.on("end", () => (isEnding = true)).resume();
let backoff = 0;
while (!isEnding) {
  const slots = waitingSlots();
  if (slots.length > 1) cap(slots);
  if (slots.length === 0) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    continue;
  }
  try {
    // a connection that hangs (no network) is given up and made again
    const isUploaded = await Promise.race([
      upload(slots[0]),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("no answer in 120 s")), 120_000),
      ),
    ]);
    backoff = 0;
    if (isUploaded) say({ uploaded: slots[0], waiting: slots.length - 1 });
  } catch (error) {
    connection = undefined;
    backoff = Math.min(60, Math.max(1, backoff * 2));
    say({
      failed: String(error?.message ?? error).slice(0, 300),
      waiting: slots.length,
      retryInSeconds: backoff,
    });
    await new Promise((resolve) => setTimeout(resolve, backoff * 1000));
  }
}
process.exit(0);
