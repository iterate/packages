#!/usr/bin/env node
// device-events.mjs: what this Mac tells its mind about itself, as events on the context
// /devices/<name> (the same name as the lend, `itx.<name>`).
//
//   node device-events.mjs <name> --iterate <iterate.js> --mind <address>
//
// The app (Sources/VoiceMeetMac/DeviceEvents.swift) starts it and writes one JSON line for each
// event on stdin: { type, payload, ephemeral? }. An ephemeral event reaches whoever listens now and
// is in no log. It connects to the mind once, as the person (the iterate CLI's own sign-in: the
// Mac's key lends and does nothing else), and appends what came in every fifth of a second, in one
// call. stdout is JSON lines for the app's log: { sent } and { failed }.
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { iterate: { type: "string" }, mind: { type: "string" } },
});
const name = positionals[0];
if (!name || !values.iterate || !values.mind)
  throw new Error("node device-events.mjs <name> --iterate <iterate.js> --mind <address>");
const say = (line) => process.stdout.write(`${JSON.stringify(line)}\n`);

const { addressOf, connectMind } = await import(
  pathToFileURL(join(dirname(dirname(values.iterate)), "dist/node.mjs")).href
);
const device = connectMind({ address: addressOf(values.mind), signIn: false }).then(({ itx }) =>
  itx.cd(`/devices/${name}`),
);
// a failure is told with the first batch
device.catch(() => {});

// At most this many wait: a Mac with no network drops the oldest moves and keys, it does not grow.
const mostWaiting = 2_000;
let waiting = [];
let sent = 0;
let isSending = false;

async function send() {
  if (isSending || waiting.length === 0) return;
  isSending = true;
  const batch = waiting;
  waiting = [];
  try {
    await (await device).append(...batch);
    sent += batch.length;
    say({ sent });
  } catch (error) {
    say({ failed: String(error?.message ?? error).slice(0, 300), dropped: batch.length });
  }
  isSending = false;
}
setInterval(send, 200);

for await (const line of createInterface({ input: process.stdin })) {
  if (!line) continue;
  waiting.push(JSON.parse(line));
  if (waiting.length > mostWaiting) waiting.splice(0, waiting.length - mostWaiting);
}
// stdin closed: the app is gone, or it turned the events off
await send();
process.exit(0);
