#!/usr/bin/env node
// cli.mjs — `npx @iterate-com/mac-app`: sets up this Mac's menu-bar app for an iterate mind, and
// updates it. It is a one-shot installer: the app is the one thing that keeps running.
//
//   npx @iterate-com/mac-app                     set up, or update what is set up (asks what it needs)
//   npx @iterate-com/mac-app --mind iterate.com --name jonas.mac --login
//   npx @iterate-com/mac-app update              the same with the saved answers, asking nothing
//   npx @iterate-com/mac-app uninstall           quit the app and remove it, its key and its state
//
// What setup does: builds the Swift app from the source in this package (Apple's Command Line
// Tools; once per version), installs it as /Applications/iterate.app, installs the iterate CLI at a
// pinned version, and makes a key that may lend this Mac to the mind under one name. A member allows
// that key once in the browser, with their passkey. Then the app starts the lend itself, at each
// start, and starts at login if you said so. Once an hour the app asks npm for a newer version of
// this package and runs `update` from it. It imports nothing but Node.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, userInfo } from "node:os";
import { join, relative } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";

const PACKAGE = "@iterate-com/mac-app";
const here = import.meta.dirname;
const { version } = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));
/** The one folder of the app's state; the app reads the same paths (Lend.swift). */
const home = join(homedir(), "Library/Application Support/iterate-mac-app");
const paths = {
  config: join(home, "config.json"),
  source: join(home, "source"),
  built: join(home, "built-from"),
  runtime: join(home, "runtime"),
  key: join(home, "mind.key"),
  app: "/Applications/iterate.app",
};
const appExecutable = join(paths.app, "Contents/MacOS/iterate");
/** The files of this package that build and run the app. */
const PARTS = ["Package.swift", "Sources", "Tests", "Support", "bridge", "run-on-mac.sh"];
/** The rule of `iterate provide` for a name: letters and digits, dotted segments. */
const NAME = /^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)*$/;

const say = (line) => console.error(line);

/** What this run was started from: npm's registry (`@latest`), a pkg.pr.new link, or a folder.
 *  The app runs `update` from the same place, so a trial build stays a trial build. */
function specOfThisRun() {
  const fromNpm = here.includes("/_npx/") || here.includes("/node_modules/");
  if (!fromNpm) return here;
  return process.env.npm_config_package?.includes("pkg.pr.new")
    ? process.env.npm_config_package
    : `${PACKAGE}@latest`;
}

async function ask(question, fallback) {
  if (!process.stdin.isTTY) return fallback;
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  const answer = (await prompt.question(`${question}${fallback ? ` [${fallback}]` : ""} `)).trim();
  prompt.close();
  return answer || fallback;
}

/** Apple's Command Line Tools build the app. When they are missing, macOS's own installer opens. */
async function commandLineTools() {
  if (spawnSync("/usr/bin/xcode-select", ["-p"]).status === 0) return;
  say("Installing Apple's Command Line Tools: a window of macOS opens; choose Install.");
  spawnSync("/usr/bin/xcode-select", ["--install"]);
  for (let waited = 0; waited < 3600; waited += 10) {
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    if (spawnSync("/usr/bin/xcode-select", ["-p"]).status === 0) return;
  }
  throw new Error("The Command Line Tools are not installed yet. Run this again when they are.");
}

/** A hash of the parts: a new version, or a local copy that changed, is built again. */
function sourceHash() {
  const hash = createHash("sha256");
  const walk = (path) => {
    if (statSync(path).isDirectory()) {
      for (const name of readdirSync(path).sort()) if (name !== ".build") walk(join(path, name));
    } else hash.update(relative(here, path)).update(readFileSync(path));
  };
  for (const part of PARTS) if (existsSync(join(here, part))) walk(join(here, part));
  return hash.digest("hex").slice(0, 16);
}

/** The app's own processes: its executable, and not a short copy that only answers a question
 *  (`--check-screen-recording`, Permissions.swift). */
const appProcesses = () =>
  (spawnSync("/usr/bin/pgrep", ["-x", "iterate"], { encoding: "utf8" }).stdout || "")
    .split("\n")
    .filter((pid) => {
      const args = pid
        ? spawnSync("/bin/ps", ["-p", pid, "-o", "args="], { encoding: "utf8" }).stdout.trim()
        : "";
      return args === appExecutable || args.startsWith(`${appExecutable} -psn`);
    });

async function quitApp() {
  for (const pid of appProcesses()) {
    try {
      process.kill(Number(pid), "SIGTERM");
    } catch {
      // it ended between the list and the signal
    }
  }
  for (let tries = 0; tries < 50 && appProcesses().length; tries++)
    await new Promise((resolve) => setTimeout(resolve, 200));
  if (appProcesses().length)
    throw new Error("The app did not quit in 10 s. Quit it from its panel and run this again.");
}

/** Builds and installs the app when this source is not the one installed. The parts are copied
 *  out of npm's cache first, so that the build never writes into the package. */
function buildApp() {
  const wanted = sourceHash();
  const built = existsSync(paths.built) ? readFileSync(paths.built, "utf8").trim() : "";
  if (wanted === built && existsSync(appExecutable)) return false;
  say(`Building the app (version ${version})… the first build takes a minute or two.`);
  mkdirSync(paths.source, { recursive: true });
  for (const part of PARTS) {
    rmSync(join(paths.source, part), { recursive: true, force: true });
    if (existsSync(join(here, part)))
      cpSync(join(here, part), join(paths.source, part), {
        recursive: true,
        filter: (path) => !path.includes("/.build"),
      });
  }
  const log = join(home, "build.log");
  const result = spawnSync("/bin/sh", [join(paths.source, "run-on-mac.sh"), "--install"], {
    cwd: paths.source,
    encoding: "utf8",
    env: { ...process.env, ITERATE_MAC_APP_INSTALL: paths.app, ITERATE_MAC_APP_VERSION: version },
  });
  writeFileSync(log, `${result.stdout}\n${result.stderr}`);
  if (result.status !== 0) {
    say(result.stderr.split("\n").slice(-25).join("\n"));
    throw new Error(`The build failed; its whole log: ${log}`);
  }
  writeFileSync(paths.built, `${wanted}\n`);
  return true;
}

/** The iterate CLI at one pinned version, in the app's own folder: npm's cache may be cleared, and
 *  `latest` moves with every release. A new version of this package pins the newest again. */
function installIterateCli(config) {
  const wanted =
    config.iterateVersion && config.version === version
      ? config.iterateVersion
      : execFileSync("npm", ["view", "iterate", "version"], { encoding: "utf8" }).trim();
  const bin = join(paths.runtime, "node_modules/iterate/bin/iterate.js");
  const installed = existsSync(join(paths.runtime, "node_modules/iterate/package.json"))
    ? JSON.parse(readFileSync(join(paths.runtime, "node_modules/iterate/package.json"), "utf8"))
        .version
    : "";
  if (installed !== wanted) {
    say(`Installing the iterate CLI ${wanted}…`);
    mkdirSync(paths.runtime, { recursive: true });
    if (!existsSync(join(paths.runtime, "package.json")))
      writeFileSync(join(paths.runtime, "package.json"), '{ "private": true }\n');
    execFileSync(
      "npm",
      [
        "install",
        "--no-audit",
        "--no-fund",
        "--loglevel=error",
        "--prefix",
        paths.runtime,
        `iterate@${wanted}`,
      ],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
  }
  return { iterateVersion: wanted, iterateBin: bin };
}

/** The key of this Mac, allowed by a member once: the CLI prints a link, the browser opens it, the
 *  member presses Allow with their passkey. A key that is allowed already connects at once. */
async function allowKey(config) {
  say(`Connecting this Mac to ${config.mind} as itx.${config.name}…`);
  const lend = spawn(
    config.node,
    [
      config.iterateBin,
      "provide",
      config.bridge,
      "--key",
      paths.key,
      "--name",
      config.name,
      "--mind",
      config.mind,
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ITERATE_MAC_APP_SUPERVISED: "1" },
    },
  );
  let opened = false;
  const live = await new Promise((resolve) => {
    const read = (chunk) => {
      const text = String(chunk);
      const link = /https:\/\/\S+\/keys\/enrol\S*/.exec(text)?.[0];
      if (link && !opened) {
        opened = true;
        say(`Allow this Mac in your browser (a passkey asks): ${link}`);
        spawnSync("/usr/bin/open", [link]);
        say("Waiting for Allow…");
      }
      if (/is live for/.test(text)) resolve(true);
    };
    lend.stdout.on("data", read);
    lend.stderr.on("data", read);
    lend.on("exit", () => resolve(false));
    setTimeout(() => resolve(false), 16 * 60_000);
  });
  lend.kill("SIGTERM");
  if (!live) throw new Error(`The key was not allowed. Run this again to get a new link.`);
  say(`Allowed. The key is ${paths.key}; remove it on iterate.${config.mind}/keys to end it.`);
}

async function setup({ values }, { interactive }) {
  if (process.platform !== "darwin") throw new Error("This app runs on a Mac only.");
  const saved = existsSync(paths.config) ? JSON.parse(readFileSync(paths.config, "utf8")) : {};
  const mind =
    values.mind ||
    saved.mind ||
    (interactive ? await ask("Your mind's address (for example iterate.com):") : undefined);
  if (!mind) throw new Error("Which mind? Pass --mind <address>.");
  const suggested = `${userInfo().username.replace(/[^a-zA-Z0-9]/g, "")}.mac`;
  const name =
    values.name ||
    saved.name ||
    (interactive
      ? await ask(`The name to lend this Mac under, as itx.<name>:`, suggested)
      : suggested);
  if (!NAME.test(name))
    throw new Error(`"${name}" is not a name: letters and digits, dotted segments (jonas.mac).`);
  const loginAnswer =
    values.login ??
    saved.login ??
    (interactive ? !/^n/i.test(await ask("Start iterate at login? (Y/n)", "Y")) : false);

  await commandLineTools();
  mkdirSync(home, { recursive: true });
  const rebuilt = buildApp();
  const config = {
    ...saved,
    mind,
    name,
    login: loginAnswer,
    spec: saved.spec && !interactive ? saved.spec : specOfThisRun(),
    node: process.execPath,
    bridge: join(paths.source, "bridge/mac-endpoint.ts"),
    keyFile: paths.key,
    ...installIterateCli(saved),
    version,
  };
  // The app must run for the key's first connection: the bridge asks it on its socket.
  if (appProcesses().length === 0) spawnSync("/usr/bin/open", [paths.app]);
  const keyIsNew = !existsSync(paths.key) || saved.mind !== mind || saved.name !== name;
  if (keyIsNew) {
    if (!interactive)
      throw new Error(
        "This Mac has no allowed key yet: run `npx @iterate-com/mac-app` in a terminal.",
      );
    if (existsSync(paths.key)) rmSync(paths.key);
    await allowKey(config);
  }
  // Written last and atomically: the app reads it at its start.
  writeFileSync(`${paths.config}.new`, `${JSON.stringify(config, null, 2)}\n`);
  renameSync(`${paths.config}.new`, paths.config);
  // The app starts again with the new config (and the new build): it starts the lend itself.
  await quitApp();
  spawnSync("/usr/bin/open", [paths.app]);
  say(
    `Done${rebuilt ? ` (built ${version})` : ""}. Look for 𝑖 in the menu bar: everything there is Off until you choose.` +
      `\nLent to ${mind} as itx.${name}; ${loginAnswer ? "starts at login" : "does not start at login"}. Updates come by themselves.` +
      `\nRemove it all: npx ${PACKAGE} uninstall`,
  );
}

async function uninstall() {
  await quitApp();
  rmSync(paths.app, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
  say(
    `Removed ${paths.app} and ${home}. The key stays listed on your mind's /keys page until you remove it there; it can do nothing now.`,
  );
}

const parsed = parseArgs({
  allowPositionals: true,
  options: {
    mind: { type: "string" },
    name: { type: "string" },
    login: { type: "boolean" },
    "no-login": { type: "boolean" },
  },
});
if (parsed.values["no-login"]) parsed.values.login = false;
const command = parsed.positionals[0] || "setup";
try {
  if (command === "setup") await setup(parsed, { interactive: process.stdin.isTTY });
  else if (command === "update") await setup(parsed, { interactive: false });
  else if (command === "uninstall") await uninstall();
  else
    throw new Error(
      `No command "${command}". The commands are: setup (the default), update, uninstall.`,
    );
} catch (error) {
  say(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
