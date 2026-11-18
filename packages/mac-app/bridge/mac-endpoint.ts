// mac-endpoint.ts: this Mac's iterate menu-bar app, lent to a mind.
//
//   iterate provide <this package>/bridge/mac-endpoint.ts --name jonas.mac --mind <address>
//
// The mind then has `itx.jonas.mac`: the screen, the camera, the microphone, the speakers, the accessibility tree
// of the window in front, and commands that run with the app's permissions. This file holds no
// capture code and no permission: it asks the app on its local socket (LocalEndpoint.swift), one
// line of JSON for each call. The app holds the permissions of macOS, shows each use in the menu
// bar, and its owner chooses for each thing: off, ask or shared. It imports nothing but Node.
//
// When the app does not run, this file builds and opens it first (run-on-mac.sh beside it; that
// needs the Command Line Tools). So the one command above is the whole start on a Mac.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

/** What agents read next to the name. */
export const description =
  "A person's Mac, through its iterate menu-bar app: see the screen and the camera, hear the microphone, play sound through the speakers, read the window in front as text (accessibility), and run commands with the app's permissions. The owner chooses for each thing: off, ask (they approve each use) or shared; they see each use in the menu bar.";

const socketPath = join(homedir(), "Library/Application Support/voice-meet-mac/endpoint.sock");

type Answer = Record<string, unknown>;

/** One question to the app: one connection, one line out, one line back. */
function ask(method: string, parameters: Record<string, unknown> = {}): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    let received = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${JSON.stringify({ ...parameters, method })}\n`));
    socket.on("data", (chunk: string) => (received += chunk));
    socket.on("error", (error: NodeJS.ErrnoException) =>
      reject(
        error.code === "ENOENT" || error.code === "ECONNREFUSED"
          ? new Error(APP_NOT_RUNNING)
          : error,
      ),
    );
    socket.on("end", () => {
      const answer = appAnswerOf(received);
      if ("ok" in answer) resolve(answer.ok);
      else reject(new Error(answer.error));
    });
  });
}

/** The app's one line of answer (LocalEndpoint.swift): `{ ok: {...} }` or `{ error: "..." }`. */
function appAnswerOf(text: string): { ok: Answer } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "The iterate menu-bar app gave an answer that is no JSON." };
  }
  if (!(parsed instanceof Object)) return { error: "The iterate menu-bar app gave no answer." };
  if ("ok" in parsed && parsed.ok instanceof Object) return { ok: { ...parsed.ok } };
  if ("error" in parsed && parsed.error) return { error: String(parsed.error) };
  return { error: "The iterate menu-bar app gave no answer." };
}

const APP_NOT_RUNNING = "The iterate menu-bar app is not running on this Mac: its owner starts it.";

/** The app answers, or it is built, opened and then answers. `iterate provide` calls this through
 *  the default export on each connection, on the person's own command. */
async function ensureTheAppRuns(): Promise<void> {
  const answers = () =>
    ask("state").then(
      () => true,
      (error: Error) => {
        if (error.message === APP_NOT_RUNNING) return false;
        throw error;
      },
    );
  if (await answers()) return;
  // Run by the app itself (Lend.swift) or by the installer: the app is not this file's to start; it
  // may have been quit on purpose.
  if (process.env.ITERATE_MAC_APP_SUPERVISED) throw new Error(APP_NOT_RUNNING);
  // Installed: open it. Else build, install and open it (run-on-mac.sh beside this file).
  const installed = existsSync("/Applications/iterate.app");
  console.error(
    `The iterate menu-bar app is not running. ${installed ? "Opening" : "Building, installing and opening"} it...`,
  );
  const [command, args] = installed
    ? ["/usr/bin/open", ["/Applications/iterate.app"]]
    : ["/bin/sh", [join(import.meta.dirname, "..", "run-on-mac.sh")]];
  const exitCode = await new Promise<number>((resolve, reject) => {
    // The script's own words go to stderr: stdout is `iterate provide`'s, for the lent name.
    const child = spawn(command, args, { stdio: ["ignore", process.stderr, process.stderr] });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) throw new Error(`${command} ended with ${exitCode}: the app did not open.`);
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await answers()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("The iterate menu-bar app was opened and does not answer on its socket.");
}

const bytes = (base64: unknown) => new Uint8Array(Buffer.from(String(base64 || ""), "base64"));

async function run(
  argv: string[],
  options: { stdin?: string | Uint8Array; timeoutSeconds?: number } = {},
) {
  const { stdoutBase64, stderrBase64, ...rest } = await ask("run", {
    argv,
    stdinBase64: Buffer.from(options.stdin || "").toString("base64"),
    timeoutSeconds: options.timeoutSeconds,
  });
  return { ...rest, stdout: bytes(stdoutBase64), stderr: bytes(stderrBase64) };
}

/** A script's output as text: what an agent reads. */
function asText({ stdout, stderr, ...rest }: Awaited<ReturnType<typeof run>>) {
  return {
    ...rest,
    stdout: Buffer.from(stdout).toString(),
    stderr: Buffer.from(stderr).toString(),
  };
}

/** The app's answer to a snapshot, with the JPEG as bytes. */
function picture({ jpegBase64, ...size }: Answer) {
  return { ...size, jpeg: bytes(jpegBase64) };
}

/** THE PROVIDED OBJECT: what `iterate provide` lends. Each call fails with the app's own words
 *  when the owner has the thing off, does not approve the use, or macOS has not given the app the
 *  permission. */
export default async function macEndpoint() {
  await ensureTheAppRuns();
  return {
    /** Every thing of the Mac (each display, each camera, the microphone, the speakers, the window
     *  text, commands) with its `sharing`: "shared", "ask" (the owner approves each use) or "off". */
    state: () => ask("state"),
    screen: {
      /** One still picture of a whole display, as JPEG bytes. `display` is the number
       *  in `state().things`; with none it is the first display that is not off. */
      snapshot: (input: { display?: number; maxWidth?: number } = {}) =>
        ask("screen.snapshot", input).then(picture),
    },
    camera: {
      /** One still picture of a camera, as JPEG bytes. `camera` is a name from `state().things`;
       *  with none it is the first camera that is not off. The camera runs only for the call. */
      snapshot: (input: { camera?: string; maxWidth?: number } = {}) =>
        ask("camera.snapshot", input).then(picture),
    },
    microphone: {
      /** Some seconds (5 unless said, at most 60) of the microphone, as a WAV file's bytes: one
       *  channel, 16 bits, about 16 000 samples a second. */
      async listen(input: { seconds?: number } = {}) {
        const { wavBase64, ...rest } = await ask("microphone.listen", input);
        return { ...rest, wav: bytes(wavBase64) };
      },
    },
    speaker: {
      /** Play a sound through the Mac's speakers: the bytes of a WAV, AIFF, MP3 or AAC file, at
       *  most 300 s long. The call returns when the sound has ended. */
      play: (sound: Uint8Array) =>
        ask("speaker.play", { soundBase64: Buffer.from(sound).toString("base64") }),
      /** Say words through the Mac's speakers in the system's voice. */
      say: (words: string) => ask("speaker.say", { words }),
    },
    accessibility: {
      /** The window in front as a tree of roles, titles and values: text, not a picture. */
      frontWindow: (input: { maxDepth?: number; maxNodes?: number } = {}) =>
        ask("accessibility.frontWindow", input),
    },
    /** Run `argv` (never a shell line) as a child of the app, so with the app's permissions for
     *  the screen, the camera, the microphone and Accessibility. */
    run,
    /** Run an AppleScript on the Mac: the plainest way to use its apps. The first script that
     *  controls another app makes macOS ask the owner once for that app. */
    appleScript: (source: string, options: { timeoutSeconds?: number } = {}) =>
      run(["/usr/bin/osascript", "-e", source], options).then(asText),
    /** Run a Swift program on the Mac, given as source. It needs the Command Line Tools there. */
    swift: (source: string, options: { timeoutSeconds?: number } = {}) =>
      run(["/usr/bin/swift", "-"], { ...options, stdin: source }).then(asText),
    __describe() {
      return {
        instructions: `${description} Say what you looked at or did, and why.`,
        types:
          "state(): Promise<{ things: { thing: string; kind: 'screen' | 'camera' | 'microphone' | 'speaker' | 'accessibility' | 'commands'; name: string; sharing: 'off' | 'ask' | 'shared'; permitted: boolean; uses: number; display?: number }[]; microphone: string }>; uses: Record<string, number>; microphone: string; displays: { display: number; name: string; checked: boolean }[]; cameras: { camera: string; checked: boolean; status: string }[] }>; screen.snapshot(input?: { display?: number; maxWidth?: number }): Promise<{ jpeg: Uint8Array; pixelWidth: number; pixelHeight: number }>; camera.snapshot(input?: { camera?: string; maxWidth?: number }): Promise<{ jpeg: Uint8Array; pixelWidth: number; pixelHeight: number }>; microphone.listen(input?: { seconds?: number }): Promise<{ wav: Uint8Array; seconds: number }>; speaker.play(sound: Uint8Array): Promise<{ seconds: number }>; speaker.say(words: string): Promise<{ characters: number }>; accessibility.frontWindow(input?: { maxDepth?: number; maxNodes?: number }): Promise<{ application: string; bundleIdentifier: string; window?: object; truncated: boolean }>; run(argv: string[], options?: { stdin?: string | Uint8Array; timeoutSeconds?: number }): Promise<{ exitCode: number; timedOut: boolean; stdout: Uint8Array; stderr: Uint8Array }>; appleScript(source: string, options?: { timeoutSeconds?: number }): Promise<{ exitCode: number; timedOut: boolean; stdout: string; stderr: string }>; swift(source: string, options?: { timeoutSeconds?: number }): Promise<{ exitCode: number; timedOut: boolean; stdout: string; stderr: string }>;",
      };
    },
  };
}
