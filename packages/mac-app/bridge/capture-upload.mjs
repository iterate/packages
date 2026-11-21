#!/usr/bin/env node
// capture-upload.mjs: one capture's folder (Sources/VoiceMeetMac/Capture.swift) into a mind, as
// files under /captures/<id>/, and the short text that a person pastes to an agent.
//
//   node capture-upload.mjs <folder> --iterate <iterate.js> --mind <address>
//
// The app starts it when a capture starts, so that the slow parts are done before the capture
// ends: it connects to the mind once, as the person (the iterate CLI's own sign-in: `iterate login`;
// the Mac's key lends and does nothing else), and asks for a signed upload link for every file a
// capture can have. Then it reads lines on stdin:
//   put <file>   a file of the folder is whole: PUT it now (a picture, while the capture runs)
//   audio <b64>  the next piece of the voice: 16 000 samples a second, one channel, 16 bits. At
//                each pause the mind puts the piece so far into words (Whisper), so that at the
//                end only the last words are missing
//   copy         the person ended the capture: capture.json has every mark and numbered picture.
//                The text goes out AT ONCE ({ copy }), before the movie is whole. Then the last
//                words come, a model says what is under each mark (seen.json), summary.md goes up,
//                and `capture/ready` is added to the context /captures/<id>
//   finish       the movie and the voice are whole: PUT the rest; `capture/received` is added
//   discard      remove what went up
// With `--finish` it reads no line and does `copy` and `finish` at once: a capture that stayed on
// this Mac.
//
// stdout is JSON lines: { words } (what was just heard); { progress } (0 to 1, of the bytes);
// { copy }, the text for the clipboard, at `copy` and again when the last words are in it; then
// { done: true } or { failed, copy } (the reason; `copy` then names this Mac's folder alone).
//
// WHO READS THE TEXT, AND HOW:
//   - an agent on this Mac reads the numbered pictures from the folder;
//   - any other agent runs the text's one script. It waits for `capture/ready` and answers
//     context.json: the words, the marks, and the pictures under "itx/images", which the mind's
//     MCP tool `run` answers as images. To an agent of the mind it also sends the pictures as the
//     files of a message, the way such an agent is shown an image;
//   - a mind whose MCP tool answers no image gives text alone. For that reader a model reads each
//     picture once (seen.json): a claim, not an observation.
// It imports Node and the iterate package's own client (`iterate/node`).
import {
  createReadStream,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { request } from "node:https";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { iterate: { type: "string" }, mind: { type: "string" }, finish: { type: "boolean" } },
});
const folder = positionals[0];
if (!folder) throw new Error("Which folder? node capture-upload.mjs <folder> --iterate … --mind …");
const capture = folder.split("/").findLast(Boolean);
const directory = `/captures/${capture}`;
const say = (line) => process.stdout.write(`${JSON.stringify(line)}\n`);

// Every file a capture can have (Capture.swift): the links are asked for before the files exist.
const names = [
  "capture.json",
  "screen.mp4",
  "voice.m4a",
  "summary.md",
  "transcript.json",
  ...Array.from({ length: 12 }, (_, index) => `pictures/${String(index + 1).padStart(2, "0")}.jpg`),
  // the numbered pictures: one for each mark and click, and all of them on one sheet
  ...Array.from({ length: 12 }, (_, index) => `${index + 1}.jpg`),
  "sheet.jpg",
  "seen.json",
  "context.json",
  ...Array.from({ length: 6 }, (_, index) => `accessibility/${index}.json`),
];

/** The mind, and the links: asked for at once, awaited when first needed. */
const mind = (async () => {
  if (!values.iterate || !values.mind) throw new Error("No mind was named (--iterate, --mind).");
  const { addressOf, connectMind } = await import(
    pathToFileURL(join(dirname(dirname(values.iterate)), "dist/node.mjs")).href
  );
  const connection = await connectMind({ address: addressOf(values.mind), signIn: false });
  const { itx } = connection;
  const urls = await Promise.all(
    names.map((name) =>
      itx.r2.presign({
        key: `${directory.slice(1)}/${name}`,
        method: "PUT",
        expiresInSeconds: 3600,
      }),
    ),
  );
  // The mind's word list, when it has one: /dictation/words.txt is the terms to know, one on a
  // line, and /dictation/replacements.csv is `wrong,right` on each line.
  const text = (path) =>
    itx.files
      .get(path)
      .bytes()
      .then(
        (bytes) => new TextDecoder().decode(bytes),
        () => "",
      );
  const [words, replacements] = await Promise.all([
    text("/dictation/words.txt"),
    text("/dictation/replacements.csv"),
  ]);
  return {
    itx,
    links: Object.fromEntries(names.map((name, index) => [name, urls[index].url])),
    // Whisper reads a prompt's last 224 tokens only: a long list helps for its end alone
    prompt: words.split("\n").filter(Boolean).join(", "),
    // the longest wrong form first, each as a whole word, whatever its case
    replacements: replacements
      .split("\n")
      .map((line) => line.split(","))
      .filter(([wrong, right]) => wrong && right)
      .sort((a, b) => b[0].length - a[0].length)
      .map(([wrong, right]) => [
        new RegExp(`(?<![\\w-])${wrong.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "gi"),
        right,
      ]),
  };
})();
// a failure is told at `finish`
mind.catch(() => {});

let bytesToSend = 0;
let bytesSent = 0;
let saidAt = 0;
/** One file to its link, once: the same promise for a second ask. */
const uploads = new Map();
function put(file) {
  if (uploads.has(file)) return uploads.get(file);
  const path = join(folder, file);
  const size = statSync(path).size;
  bytesToSend += size;
  const upload = mind.then(
    ({ links }) =>
      new Promise((resolve, reject) => {
        const type =
          {
            json: "application/json",
            mp4: "video/mp4",
            m4a: "audio/mp4",
            jpg: "image/jpeg",
            md: "text/markdown; charset=utf-8",
            js: "text/javascript; charset=utf-8",
          }[file.split(".").pop()] ?? "application/octet-stream";
        const sending = request(
          links[file],
          { method: "PUT", headers: { "content-type": type, "content-length": size } },
          (answer) => {
            answer.resume();
            answer.on("end", () =>
              answer.statusCode < 300
                ? resolve()
                : reject(new Error(`The upload of ${file} failed: HTTP ${answer.statusCode}`)),
            );
          },
        );
        sending.on("error", reject);
        sending.setTimeout(300_000, () =>
          sending.destroy(new Error(`The upload of ${file} timed out`)),
        );
        createReadStream(path)
          .on("data", (chunk) => {
            bytesSent += chunk.length;
            if (Date.now() - saidAt < 100) return;
            saidAt = Date.now();
            say({ progress: bytesSent / bytesToSend });
          })
          .pipe(sending);
      }),
  );
  // a failure is told at `finish`, which awaits every upload
  upload.catch(() => {});
  uploads.set(file, upload);
  return upload;
}

// THE VOICE, WHILE THE PERSON TALKS. A piece ends at a pause (half a second of quiet after two
// seconds or more) or after 12 seconds, and goes to the mind's Whisper at once.
const model = "@cf/openai/whisper-large-v3-turbo";
const rate = 16_000;
let piece = [];
let pieceStart = 0;
let samplesSeen = 0;
let quietSamples = 0;
let pieceHasSound = false;
/** One promise for each piece sent, and the segments that are back, in the order of time. */
const pieces = [];
const segmentsHeard = [];
let hearingError;

function hear(base64) {
  const bytes = Buffer.from(base64, "base64");
  const count = bytes.length >> 1;
  let squares = 0;
  for (let at = 0; at < count; at++) squares += bytes.readInt16LE(at * 2) ** 2;
  // about -40 dB of full scale: a room with nobody talking is under it
  const isQuiet = Math.sqrt(squares / Math.max(count, 1)) < 300;
  quietSamples = isQuiet ? quietSamples + count : 0;
  pieceHasSound ||= !isQuiet;
  piece.push(bytes);
  samplesSeen += count;
  const length = samplesSeen - pieceStart;
  if ((length > 2 * rate && quietSamples > rate / 2) || length > 12 * rate) endPiece();
}

function endPiece() {
  const sound = Buffer.concat(piece);
  const startMs = (pieceStart / rate) * 1000;
  const hadSound = pieceHasSound;
  piece = [];
  pieceStart = samplesSeen;
  pieceHasSound = false;
  quietSamples = 0;
  // Whisper makes words up for silence
  if (!hadSound) return;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + sound.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(sound.length, 40);
  const ms = (seconds) => Math.round(startMs + seconds * 1000);
  pieces.push(
    mind
      .then(async ({ itx, prompt, replacements }) => ({
        replacements,
        heard: await itx.ai.run(model, {
          audio: Buffer.concat([header, sound]).toString("base64"),
          vad_filter: true,
          initial_prompt: prompt,
        }),
      }))
      .then(
        ({ heard, replacements }) => {
          const segments = (heard.segments || []).map((segment) => ({
            t: ms(segment.start),
            to: ms(segment.end),
            // `words` below stay as the model heard them
            text: replacements.reduce(
              (text, [wrong, right]) => text.replace(wrong, right),
              segment.text.trim(),
            ),
            words: (segment.words || []).map((word) => ({
              t: ms(word.start),
              to: ms(word.end),
              text: word.word,
            })),
          }));
          segmentsHeard.push(...segments);
          segmentsHeard.sort((a, b) => a.t - b.t);
          say({ words: segments.map((segment) => segment.text).join(" ") });
        },
        (error) => {
          hearingError = String(error?.message ?? error).slice(0, 300);
        },
      ),
  );
}

/** The words so far: a model's claim about the voice, not an observation. */
const transcriptSoFar = () => ({
  by: { kind: "model", id: model },
  basis: ["voice.m4a"],
  segments: segmentsHeard,
});

const clock = (ms) =>
  `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

/** The text a person pastes to an agent. It is short on purpose: a line for each numbered picture
 *  with the words said at it, and the two ways to the pictures. `inTheMind` is false for a
 *  capture that stayed on this Mac. */
function paste({ manifest, transcript, transcriptError, wordsPending, inTheMind = true }) {
  const { panels, observations } = manifest;
  const windows = observations.filter((observation) => observation.kind === "window");
  const front = (window) =>
    `${window.application ?? ""}${window.title ? ` “${window.title}”` : ""}${window.url?.startsWith("http") ? ` ${window.url}` : ""}`;
  // As a person talks and then points: words go to the first picture that ends after they start.
  const said = panels.map(() => []);
  for (const segment of transcript?.segments ?? []) {
    const at = panels.findIndex((panel) => panel.t >= segment.t);
    if (segment.text) said.at(at)?.push(segment.text);
  }
  const lines = panels.map((panel, index) => [
    panel.t,
    `- #${panel.n} (${clock(panel.t)}) ${panel.did}${panel.on ? ` ${panel.on}` : ""}${said[index].length ? ` “${said[index].join(" ")}”` : ""}`,
  ]);
  // another app or another page in front, not a title that changed
  windows.forEach((window, index) => {
    const before = windows[index - 1];
    if (before && (before.application !== window.application || before.url !== window.url))
      lines.push([window.t, `- (${clock(window.t)}) in front now: ${front(window)}`]);
  });
  lines.sort((a, b) => a[0] - b[0]);
  const files = panels.map((panel) => panel.file);
  const pictures =
    files.length < 2
      ? files[0] || "the pictures in pictures/"
      : `${existsSync(join(folder, "sheet.jpg")) ? "sheet.jpg and " : ""}${files.length > 4 ? `${files[0]} to ${files.at(-1)}` : files.join(", ")} together`;
  return [
    `[capture ${clock(manifest.durationMs)}${windows[0] ? ` · ${front(windows[0])}` : ""} · ${manifest.by.device}${inTheMind ? ` → ${values.mind}` : ""}]`,
    panels.some((panel) => panel.did !== "the screen at the end")
      ? `The words point at red marks on the screen: look at the pictures before you answer. Each # is a numbered picture.`
      : `The words are about what is on the screen: look at the picture before you answer.`,
    `On ${manifest.by.device}: read ${pictures}, in ${folder}. Those files are the whole capture: answer from them, and open nothing else in that folder`,
    ...(inTheMind
      ? [
          // One script, whole in the text: an agent that is pointed at a file of code reads the code
          // before it runs it, which is one more call. It answers context.json, whose
          // "itx/images" the MCP tool answers as images; an agent of the mind is shown the same
          // pictures as the files of a message to itself.
          `If you cannot read that folder (you are an agent of the mind ${values.mind}, or you have its MCP tool and no file tool), run this as your first step. It answers the words and the marks, and it shows you the pictures as images: async (itx) => { const d = "${directory}/"; await itx.cd(d).waitForEvent({ type: "capture/ready", afterOffset: 0, timeoutMs: 60000 }).catch(() => {}); const c = JSON.parse(new TextDecoder().decode(await itx.files.get(d + "context.json").bytes())); const files = await Promise.all(c.pictures.map(async (name) => ({ contentType: "image/jpeg", filename: name, data: await itx.files.get(d + name).bytes() }))); await itx.agents.get((await itx.whoami()).path).message({ message: "The capture's pictures", files }, { trigger: false }).catch(() => {}); return c; }`,
        ]
      : []),
    ...(wordsPending
      ? [
          `The last words are not in this text yet: ${inTheMind ? "the script above waits for them, and " : ""}summary.md in that folder has them a moment after the capture.`,
        ]
      : []),
    ...lines.map(([, text]) => text),
    ...(transcriptError ? [`The voice was not put into words: ${transcriptError}`] : []),
    "",
  ].join("\n");
}

// The model of the mind that reads a picture: Workers AI's own vision models make things up on
// screenshots of text.
const sight = "openai/gpt-6.2-sol";

/** What is under each mark, as a model reads it: for a reader that gets no picture. At most 20
 *  seconds, and a picture that fails is left out. */
async function see(itx, panels) {
  const seen = {};
  await Promise.race([
    Promise.all(
      panels.map(async (panel) => {
        const answer = await itx.ai
          .run(sight, {
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text:
                      panel.did === "the screen at the end"
                        ? "This is a screenshot. Say in at most three sentences what it shows: the app, the window in front and its main content."
                        : "This is a part of a screenshot. A person marked it in red (ink, or a small red ring where they clicked). Say in at most two sentences what exactly the red marks circle, cover or point at. Quote the visible text under or inside every mark.",
                  },
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:image/jpeg;base64,${readFileSync(join(folder, panel.file)).toString("base64")}`,
                    },
                  },
                ],
              },
            ],
            max_completion_tokens: 400,
            reasoning_effort: "low",
          })
          .catch(() => undefined);
        const text = answer?.choices?.[0]?.message?.content;
        if (text) seen[panel.n] = text;
      }),
    ),
    new Promise((resolve) => setTimeout(resolve, 20_000)),
  ]);
  return Object.keys(seen).length ? { by: { kind: "model", id: sight }, panels: seen } : undefined;
}

/** Every file of the folder that no step below puts by its name, as paths relative to it. */
function filesIn(relative = "") {
  return readdirSync(join(folder, relative), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesIn(join(relative, entry.name))
      : ["summary.md", "transcript.json", "seen.json", "context.json", "capture.json"].includes(
            entry.name,
          )
        ? []
        : [join(relative, entry.name)],
  );
}

const manifestNow = () => JSON.parse(readFileSync(join(folder, "capture.json"), "utf8"));
/** The words of a capture whose voice did not come as pieces: `finish` settles them. */
let wordsFromTheFile;
const wordsLater = new Promise((resolve) => {
  wordsFromTheFile = resolve;
});
/** Everything `copy` started: the capture is ready when it settles. */
let readying;

function copy() {
  const manifest = manifestNow();
  endPiece();
  const isStreamed = pieces.length > 0;
  let isHeard = false;
  const heard = isStreamed
    ? Promise.all(pieces).then(() => {
        isHeard = true;
        writeFileSync(join(folder, "transcript.json"), JSON.stringify(transcriptSoFar()));
        return put("transcript.json").then(() => ({
          transcript: transcriptSoFar(),
          transcriptError: hearingError,
        }));
      })
    : wordsLater;
  // At once: everything this Mac knows now. The pictures went up while the person talked. One
  // turn of the loop later, so that pieces that are back already count as heard.
  setImmediate(() =>
    say({
      copy: paste({
        manifest,
        transcript: transcriptSoFar(),
        wordsPending: !isHeard && (isStreamed || manifest.microphone),
      }),
    }),
  );
  const early = Promise.all(
    ["capture.json", ...filesIn().filter((file) => file.endsWith(".jpg"))].map(put),
  );
  readying = (async () => {
    const { itx } = await mind;
    const [words, seen] = await Promise.all([heard, see(itx, manifest.panels)]);
    if (seen) {
      writeFileSync(join(folder, "seen.json"), JSON.stringify(seen));
      await put("seen.json");
    }
    // What the text's one script answers: the words, the marks and the pictures' names.
    const pictures = [
      ...(manifest.panels.length > 1 && existsSync(join(folder, "sheet.jpg")) ? ["sheet.jpg"] : []),
      ...manifest.panels.map((panel) => panel.file),
    ].slice(0, 8);
    writeFileSync(
      join(folder, "context.json"),
      JSON.stringify({
        said: (words.transcript?.segments ?? []).map(
          (segment) => `${clock(segment.t)} ${segment.text}`,
        ),
        marks: manifest.panels.map((panel) => ({
          "#": panel.n,
          at: clock(panel.t),
          did: `${panel.did}${panel.on ? ` ${panel.on}` : ""}`,
          ...(seen?.panels[panel.n] && { seen: seen.panels[panel.n] }),
          picture: panel.file,
        })),
        ...(seen && {
          note: `\`seen\` is what a model (${seen.by.id}) read off each picture: it may be wrong. Trust the pictures.`,
        }),
        pictures,
        "itx/images": pictures.map((name) => `${directory}/${name}`),
        more: `capture.json (every observation), screen.mp4 and voice.m4a (they come last) are files under ${directory}/.`,
      }),
    );
    await put("context.json");
    const text = paste({ manifest, ...words });
    writeFileSync(join(folder, "summary.md"), text);
    await Promise.all([put("summary.md"), early]);
    // the same text with the last words: it takes the first one's place on the clipboard
    say({ copy: text });
    await itx.cd(directory).append({
      type: "capture/ready",
      payload: { capture, summary: `${directory}/summary.md`, pictures: manifest.panels.length },
    });
  })();
  // a failure is told at `finish`, which awaits it
  readying.catch(() => {});
}

async function finish() {
  try {
    if (!readying) copy();
    const manifest = manifestNow();
    const files = filesIn();
    const { itx } = await mind;
    // the movie's times are in the manifest now: it goes up again
    uploads.delete("capture.json");
    const rest = Promise.all(
      ["capture.json", ...files]
        .sort((a, b) => statSync(join(folder, a)).size - statSync(join(folder, b)).size)
        .map(put),
    );
    // a failure is told below, where `rest` is awaited
    rest.catch(() => {});
    // No piece of the voice came while the person talked: the mind hears the whole file. A
    // model's claim, not an observation.
    wordsFromTheFile(
      pieces.length || !files.includes("voice.m4a")
        ? {}
        : put("voice.m4a")
            .then(() =>
              itx.run(`async (itx) => {
  const bytes = await itx.files.get(${JSON.stringify(`${directory}/voice.m4a`)}).bytes();
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  const model = ${JSON.stringify(model)};
  const heard = await itx.ai.run(model, { audio: btoa(binary), vad_filter: true });
  const ms = (seconds) => Math.round(seconds * 1000);
  const transcript = {
    by: { kind: "model", id: model },
    basis: ["voice.m4a"],
    segments: (heard.segments || []).map((segment) => ({
      t: ms(segment.start),
      to: ms(segment.end),
      text: segment.text.trim(),
      words: (segment.words || []).map((word) => ({ t: ms(word.start), to: ms(word.end), text: word.word })),
    })),
  };
  await itx.files.get(${JSON.stringify(`${directory}/transcript.json`)}).put({ contentType: "application/json", data: new TextEncoder().encode(JSON.stringify(transcript)) });
  return transcript;
}`),
            )
            .then(
              (transcript) => ({ transcript }),
              (error) => ({ transcriptError: String(error?.message ?? error).slice(0, 300) }),
            ),
    );
    await readying;
    await rest;
    const window = manifest.observations.find((observation) => observation.kind === "window");
    const context = itx.cd(directory);
    await context.append({
      type: "events.iterate.com/itx/described",
      payload: {
        description: `A capture from ${manifest.by.device}, ${clock(manifest.durationMs)} long${window ? `, of ${window.application}` : ""}: a person talked, clicked and drew on the screen. Its files are under ${directory}/; start with summary.md.`,
        metadata: { capture },
      },
    });
    await context.append({
      type: "capture/received",
      payload: {
        capture,
        manifest: `${directory}/capture.json`,
        summary: `${directory}/summary.md`,
        files: [...uploads.keys()],
      },
    });
    say({ progress: 1 });
    say({ done: true });
    process.exit(0);
  } catch (error) {
    say({
      failed: String(error?.message ?? error).slice(0, 300),
      copy: paste({ manifest: manifestNow(), transcript: transcriptSoFar(), inTheMind: false }),
    });
    process.exit(1);
  }
}

if (values.finish) await finish();
else
  for await (const line of createInterface({ input: process.stdin })) {
    if (line.startsWith("audio ")) hear(line.slice(6));
    else if (line.startsWith("put ")) put(line.slice(4));
    else if (line === "copy") copy();
    else if (line === "finish") await finish();
    else if (line === "discard") {
      await Promise.allSettled(uploads.values());
      const { itx } = await mind;
      if (uploads.size)
        await itx.r2.delete([...uploads.keys()].map((file) => `${directory.slice(1)}/${file}`));
      process.exit(0);
    }
  }
// stdin closed with no word: the app is gone, and the folder stays for a later `--finish`
process.exit(0);
