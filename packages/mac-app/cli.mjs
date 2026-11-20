#!/usr/bin/env node
// cli.mjs — `npx @iterate-com/mac-app`: sets up this Mac's menu-bar app for an iterate mind, and
// updates it. It is a one-shot installer: the app is the one thing that keeps running.
//
//   npx @iterate-com/mac-app                     set up, or update what is set up (asks what it needs)
//   npx @iterate-com/mac-app --mind iterate.com --name jonas.mac --login
//   npx @iterate-com/mac-app update              the same with the saved answers, asking nothing
//   npx @iterate-com/mac-app list                the minds this Mac knows, the one it lends to marked
//   npx @iterate-com/mac-app add --mind example.com --name jane.mac   a new key for one more mind
//   npx @iterate-com/mac-app use example.com     lend to that mind (one at a time); the app switches
//   npx @iterate-com/mac-app remove example.com  forget that mind and delete its key
//   npx @iterate-com/mac-app uninstall           quit the app and remove it, its keys and its state
//
// Or own the source: copy it, change it, build it from there (an app built from a copy does not
// update itself; it runs what was built).
//   npx @iterate-com/mac-app init [folder]       copy the source to a folder (~/src/iterate-mac-app),
//                                                make it a git repository, build, install and lend
//   npx @iterate-com/mac-app diff [--files]      in a copy: what upstream changed since its version
//   npx @iterate-com/mac-app update              in a copy: apply upstream's changes on top of yours
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
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { join, relative, resolve } from "node:path";
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
  /** one key per mind: `keys/<mind>.key` */
  keys: join(home, "keys"),
  app: "/Applications/iterate.app",
};
const appExecutable = join(paths.app, "Contents/MacOS/iterate");
/** The files of this package that build and run the app. */
const PARTS = [
  "Package.swift",
  "Sources",
  "Tests",
  "Support",
  "bridge",
  "run-on-mac.sh",
  // the app runs this file's commands (list, add, use, remove) from its installed copy
  "cli.mjs",
  "package.json",
];
/** What `init` copies: the parts and the README, as npm's tarball has them. */
const COPIED = [...PARTS, "README.md"];
/** In a copy: the upstream version it holds (`init`, `update`). Its presence makes a folder a copy. */
const RECORD = ".iterate-mac-app.json";
const GITIGNORE = ".build/\n";
/** The rule of `iterate provide` for a name: letters and digits, dotted segments. */
const NAME = /^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)*$/;
/** A mind's address, as a host name: it is also the name of its key file. */
const MIND = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

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

/** The app's state: what setup wrote (node, the iterate CLI, the bridge, `login`, …), the minds
 *  this Mac knows (`{ mind, name, keyFile }` each) and `active`, the one it lends to. A config of
 *  the versions before several minds (`mind`, `name`, `keyFile` and `mind.key`) becomes one entry,
 *  active, at its first read. */
function readState() {
  if (!existsSync(paths.config)) return { minds: [], active: null };
  const { mind, name, keyFile, ...state } = JSON.parse(readFileSync(paths.config, "utf8"));
  if (state.minds) return state;
  if (!mind) return { ...state, minds: [], active: null };
  mkdirSync(paths.keys, { recursive: true });
  const moved = keyFileOf(mind);
  if (keyFile && existsSync(keyFile)) renameSync(keyFile, moved);
  const migrated = { ...state, minds: [{ mind, name, keyFile: moved }], active: mind };
  writeState(migrated);
  say(`Moved this Mac's one mind, ${mind}, into the list of minds; its key is now ${moved}.`);
  return migrated;
}

/** Written atomically: the app watches the folder and reads the file again at each change. */
function writeState(state) {
  mkdirSync(home, { recursive: true });
  writeFileSync(`${paths.config}.new`, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(`${paths.config}.new`, paths.config);
}

const keyFileOf = (mind) => join(paths.keys, `${mind}.key`);

/** The minds of the iterate CLI's profiles (`iterate login`), offered when a mind is added. */
function profileMinds() {
  const folder = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  try {
    const { configs = {} } = JSON.parse(readFileSync(join(folder, "iterate/minds.json"), "utf8"));
    return [...new Set(Object.values(configs).flatMap((profile) => profile.mind || []))];
  } catch {
    return [];
  }
}

/** Asks for a mind, offering the CLI's profiles that this Mac does not have yet by number. */
async function askMind(state) {
  const offered = profileMinds().filter((mind) => !state.minds.some((m) => m.mind === mind));
  if (offered.length)
    say(
      `The iterate CLI knows these minds:\n${offered.map((mind, i) => `  ${i + 1}. ${mind}`).join("\n")}`,
    );
  const answer = await ask(
    offered.length
      ? "The mind's address, or a number above:"
      : "Your mind's address (for example iterate.com):",
  );
  return offered[Number(answer) - 1] || answer;
}

/** A mind's address in lower case, as the panel sends it: host names ignore case, and the address
 *  names the key file. */
function checkMind(text) {
  const mind = (text || "").trim().toLowerCase();
  if (!MIND.test(mind))
    throw new Error(`"${text}" is not a mind's address: a host name such as example.com.`);
  return mind;
}

function checkName(name) {
  if (!NAME.test(name))
    throw new Error(`"${name}" is not a name: letters and digits, dotted segments (jonas.mac).`);
}

const suggestedName = () => `${userInfo().username.replace(/[^a-zA-Z0-9]/g, "")}.mac`;

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
  // run from the installed copy itself (`node source/cli.mjs setup`): its parts are in place
  if (here !== paths.source)
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
 *  `latest` moves with every release. A new version of this package pins the newest again: the one
 *  `main` names. Main's publish (scripts/ci/npm-publish.ts) publishes every package under `main`
 *  before it moves any `latest`, so when this package's `latest` is new, `iterate@main` is the CLI
 *  from the same commit or a newer one. `iterate@latest` may still be the one before: the app reads
 *  `iterate provide --json`, which that one may not have. */
function installIterateCli(config) {
  const wanted =
    config.iterateVersion && config.version === version
      ? config.iterateVersion
      : execFileSync("npm", ["view", "iterate@main", "version"], { encoding: "utf8" }).trim();
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

/** The key of this Mac for one mind, allowed by a member once: the CLI prints a link, the browser
 *  opens it, the member presses Allow with their passkey. A key that is allowed already connects
 *  at once. A key is allowed for one name: a new name gets a new key. */
async function allowKey(config, entry) {
  mkdirSync(paths.keys, { recursive: true });
  say(`Connecting this Mac to ${entry.mind} as itx.${entry.name}…`);
  const lend = spawn(
    config.node,
    [
      config.iterateBin,
      "provide",
      config.bridge,
      "--key",
      entry.keyFile,
      "--name",
      entry.name,
      "--mind",
      entry.mind,
      "--json",
    ],
    {
      // stdout: one state per line (iterate's core/lib/src/cli/provide-state.ts); stderr: the
      // lines for a person, whose last is the reason when no state says one
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ITERATE_MAC_APP_SUPERVISED: "1" },
    },
  );
  /** why it did not go live: the last state that ended it */
  let why = "";
  /** the message of the last error line on stderr ("Error: …", "Error [ERR_…]: …",
   *  "ProvideRefusal [Error]: …"): not the stack's frames or the error's fields that Node prints
   *  after it */
  let lastError = "";
  createInterface({ input: lend.stderr }).on("line", (line) => {
    const error = /^(?:\w+ \[\w*Error\]|\w*Error(?: \[[\w.-]+\])?): (.+)$/.exec(line.trim());
    if (error) lastError = error[1];
  });
  let timer;
  const live = await new Promise((resolve) => {
    createInterface({ input: lend.stdout }).on("line", (line) => {
      let state;
      try {
        state = JSON.parse(line);
      } catch {
        return;
      }
      if (state.state === "live") resolve(true);
      else if (state.state === "notAllowed" && state.waiting) {
        say(`Allow this Mac in your browser (a passkey asks): ${state.link}`);
        spawnSync("/usr/bin/open", [state.link]);
        say("Waiting for Allow…");
      } else if (state.state === "incompatible")
        why = `${state.why}. Update the iterate CLI: run \`npx ${PACKAGE} update\`.`;
      else if (state.state === "notAllowed" || state.state === "stopped") why = state.why;
    });
    // `close`, not `exit`: both pipes have ended, so the last state is read
    lend.on("close", () => resolve(false));
    timer = setTimeout(() => resolve(false), 16 * 60_000);
  });
  clearTimeout(timer);
  lend.kill("SIGTERM");
  why ||= lastError;
  if (!live)
    throw new Error(
      `The key was not allowed${why ? `: ${why}` : ""}. Run this again to get a new link.`,
    );
  say(`Allowed. The key is ${entry.keyFile}; remove it on the mind's /keys page to end it.`);
}

/** Makes or checks the key of one mind, then saves the mind and makes it the active one. */
async function addMind(state, entry) {
  checkMind(entry.mind);
  checkName(entry.name);
  const known = state.minds.find((m) => m.mind === entry.mind);
  // a key is allowed for one name only
  if (known && known.name !== entry.name && existsSync(entry.keyFile)) rmSync(entry.keyFile);
  await allowKey(state, entry);
  return {
    ...state,
    minds: [...state.minds.filter((m) => m.mind !== entry.mind), entry],
    active: entry.mind,
  };
}

/** The setup must have run: `add` needs its node, its iterate CLI and its bridge. */
function setUpState() {
  const state = readState();
  if (!state.iterateBin)
    throw new Error(`This Mac is not set up yet: run \`npx ${PACKAGE}\` in a terminal.`);
  return state;
}

function list({ values }) {
  const state = readState();
  if (values.json) {
    console.log(JSON.stringify({ ...state, profiles: profileMinds() }, null, 2));
    return;
  }
  if (!state.minds.length) return say(`No mind yet: npx ${PACKAGE} add --mind <address>`);
  for (const { mind, name } of state.minds)
    console.log(`${mind === state.active ? "*" : " "} ${mind}  itx.${name}`);
  if (!state.active) say(`None is lent to now: npx ${PACKAGE} use <mind>`);
}

async function add({ values }, { interactive }) {
  const state = setUpState();
  const asked = values.mind || (interactive ? await askMind(state) : undefined);
  if (!asked) throw new Error("Which mind? Pass --mind <address>.");
  const mind = checkMind(asked);
  const known = state.minds.find((m) => m.mind === mind);
  const name =
    values.name ||
    known?.name ||
    (interactive
      ? await ask("The name to lend this Mac under, as itx.<name>:", suggestedName())
      : undefined);
  if (!name) throw new Error("Which name? Pass --name <x.mac>.");
  writeState(await addMind(state, { mind, name, keyFile: keyFileOf(mind) }));
  say(`Added ${mind}; the app lends this Mac to it now, as itx.${name}.`);
}

function use({ positionals }) {
  const state = readState();
  const mind = positionals[1]?.toLowerCase();
  if (!state.minds.some((m) => m.mind === mind))
    throw new Error(
      `No mind "${mind ?? ""}" on this Mac. Its minds: ${state.minds.map((m) => m.mind).join(", ") || "none"}.`,
    );
  writeState({ ...state, active: mind });
  say(`The app lends this Mac to ${mind} now.`);
}

function remove({ positionals }) {
  const state = readState();
  const mind = positionals[1]?.toLowerCase();
  const entry = state.minds.find((m) => m.mind === mind);
  if (!entry) throw new Error(`No mind "${mind ?? ""}" on this Mac.`);
  rmSync(entry.keyFile, { force: true });
  const minds = state.minds.filter((m) => m !== entry);
  const active = state.active === mind ? null : state.active;
  writeState({ ...state, minds, active });
  say(
    `Removed ${mind} and deleted its key. The key stays listed on the mind's /keys page until you remove it there; it can do nothing now.` +
      (active ? "" : `\nNo mind is lent to now: npx ${PACKAGE} use <mind>`),
  );
}

async function setup({ values }, { interactive }) {
  if (process.platform !== "darwin") throw new Error("This app runs on a Mac only.");
  const saved = readState();
  const active = saved.minds.find((m) => m.mind === saved.active);
  // `update` asks nothing and keeps the minds; setup adds or updates the mind it is given
  const asked =
    values.mind ||
    (interactive ? (active?.mind ?? (await askMind(saved))) : undefined) ||
    active?.mind;
  if (!asked && !saved.minds.length) throw new Error("Which mind? Pass --mind <address>.");
  const mind = asked && checkMind(asked);
  const known = saved.minds.find((m) => m.mind === mind);
  const name =
    values.name ||
    known?.name ||
    (interactive
      ? await ask(`The name to lend this Mac under, as itx.<name>:`, suggestedName())
      : suggestedName());
  checkName(name);
  const loginAnswer =
    values.login ??
    saved.login ??
    (interactive ? !/^n/i.test(await ask("Start iterate at login? (Y/n)", "Y")) : false);

  await commandLineTools();
  mkdirSync(home, { recursive: true });
  const rebuilt = buildApp();
  // run from an owner's copy: the app runs what was built and does not update itself (Lend.swift)
  const copy = readRecord(here) ? here : undefined;
  let state = {
    ...saved,
    login: loginAnswer,
    spec: copy ?? (saved.spec && !interactive && !saved.copy ? saved.spec : specOfThisRun()),
    copy,
    node: process.execPath,
    bridge: join(paths.source, "bridge/mac-endpoint.ts"),
    cli: join(paths.source, "cli.mjs"),
    ...installIterateCli(saved),
    version,
  };
  // The app must run for the key's first connection: the bridge asks it on its socket.
  if (appProcesses().length === 0) spawnSync("/usr/bin/open", [paths.app]);
  const entry = mind && { mind, name, keyFile: keyFileOf(mind) };
  if (entry && (!known || known.name !== name || !existsSync(entry.keyFile))) {
    if (!interactive)
      throw new Error(
        `This Mac has no allowed key for ${mind} yet: run \`npx ${PACKAGE}\` in a terminal.`,
      );
    state = await addMind(state, entry);
  } else if (entry) state = { ...state, active: mind };
  // Written last: the app reads it at its start.
  writeState(state);
  // The app starts again with the new config (and the new build): it starts the lend itself.
  await quitApp();
  spawnSync("/usr/bin/open", [paths.app]);
  say(
    `Done${rebuilt ? ` (built ${version})` : ""}. Look for 𝑖 in the menu bar: everything there is Off until you choose.` +
      (state.active
        ? `\nLent to ${state.active} as itx.${state.minds.find((m) => m.mind === state.active)?.name}`
        : "\nLent to no mind") +
      `; ${loginAnswer ? "starts at login" : "does not start at login"}.` +
      (copy
        ? ` Built from ${copy}: it changes when you run ./run-on-mac.sh there.`
        : " Updates come by themselves.") +
      `\nMore minds: npx ${PACKAGE} add · list · use <mind> · remove <mind>` +
      `\nRemove it all: npx ${PACKAGE} uninstall`,
  );
}

/** The record of a copy (`RECORD`), or null when the folder is not one. */
function readRecord(folder) {
  try {
    return JSON.parse(readFileSync(join(folder, RECORD), "utf8"));
  } catch {
    return null;
  }
}

const recordText = (upstream) =>
  `${JSON.stringify({ package: PACKAGE, version: upstream, date: new Date().toISOString().slice(0, 10) }, null, 2)}\n`;

/** The copy a command acts on: `--folder`, else this cli.mjs's own folder or the current one when
 *  it is a copy. */
function copyFolder({ values }) {
  if (values.folder) {
    const folder = resolve(values.folder);
    if (!readRecord(folder)) throw new Error(`${folder} is not a copy: it has no ${RECORD}.`);
    return folder;
  }
  return [here, process.cwd()].find((folder) => readRecord(folder)) ?? null;
}

/** git in a folder. A commit needs a name: when git has none, the account's name stands in. */
function git(folder, args, { env = {}, cwd = folder } = {}) {
  const named = spawnSync("git", ["config", "user.email"], { cwd: folder }).status === 0;
  const who = userInfo().username;
  const identity = named
    ? {}
    : {
        GIT_AUTHOR_NAME: who,
        GIT_AUTHOR_EMAIL: `${who}@localhost`,
        GIT_COMMITTER_NAME: who,
        GIT_COMMITTER_EMAIL: `${who}@localhost`,
      };
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...identity, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** `init`: copies this package's source to a folder of the owner's, makes it a git repository with
 *  one first commit that names the upstream version, then builds, installs and lends from there
 *  (`setup` of the copy's own cli.mjs). `--no-install` stops after the commit. */
async function init({ values, positionals }) {
  const folder = resolve(positionals[1] || join(homedir(), "src/iterate-mac-app"));
  if (existsSync(folder) && readdirSync(folder).length)
    throw new Error(
      `${folder} exists and is not empty. Name a new folder: npx ${PACKAGE} init <folder>`,
    );
  await commandLineTools();
  mkdirSync(folder, { recursive: true });
  for (const part of COPIED)
    if (existsSync(join(here, part)))
      cpSync(join(here, part), join(folder, part), {
        recursive: true,
        filter: (path) => !path.includes("/.build"),
      });
  writeFileSync(join(folder, RECORD), recordText(version));
  writeFileSync(join(folder, ".gitignore"), GITIGNORE);
  git(folder, ["init", "-q", "-b", "main"]);
  git(folder, ["add", "-A"]);
  git(folder, [
    "commit",
    "-q",
    "-m",
    `Copy ${PACKAGE}@${version}`,
    "-m",
    `The source of iterate's Mac app at upstream version ${version}, to change as you like. ${RECORD} records the version; \`npx ${PACKAGE} update\` here applies upstream's later changes on top of yours.`,
  ]);
  say(`Copied ${PACKAGE}@${version} to ${folder}, a git repository with one commit.`);
  if (values["no-install"])
    return say(
      `Not installed (--no-install). Build and install it: cd ${folder} && ./run-on-mac.sh`,
    );
  const passed = [
    ...(values.mind ? ["--mind", values.mind] : []),
    ...(values.name ? ["--name", values.name] : []),
    ...(values.login === undefined ? [] : [values.login ? "--login" : "--no-login"]),
  ];
  const result = spawnSync(process.execPath, [join(folder, "cli.mjs"), "setup", ...passed], {
    stdio: "inherit",
  });
  if (result.status !== 0)
    throw new Error(
      `The copy is in ${folder}, but its setup failed. Run ./run-on-mac.sh there again.`,
    );
  say(
    `Change the source in ${folder}, then run ./run-on-mac.sh there: it builds and installs it again.`,
  );
}

/** One version of the package from npm, unpacked in `into/<version>`, with the files a copy has
 *  beside it: the record and the .gitignore. The tarballs are what upstream changed, not a guess. */
function upstreamSource(spec, into, record) {
  const [{ filename, version: upstream }] = JSON.parse(
    execFileSync("npm", ["pack", spec, "--pack-destination", into, "--json", "--loglevel=error"], {
      cwd: into,
      encoding: "utf8",
    }),
  );
  const folder = join(into, upstream);
  mkdirSync(folder);
  execFileSync("tar", ["-xzf", join(into, filename), "-C", folder, "--strip-components=1"]);
  writeFileSync(join(folder, RECORD), record ?? recordText(upstream));
  writeFileSync(join(folder, ".gitignore"), GITIGNORE);
  return { folder, upstream };
}

/** The two versions as commits in the copy's repository, not on any branch: the recorded version
 *  (with the record as the copy committed it) and the new one, whose parent it is. */
function upstreamCommits(folder, to) {
  // the committed record: in the middle of an update the file on disk already names the next
  const recorded = git(folder, ["show", `HEAD:${RECORD}`]);
  const record = JSON.parse(recorded);
  const work = mkdtempSync(join(tmpdir(), "iterate-mac-app-"));
  try {
    const next = upstreamSource(`${PACKAGE}@${to}`, work);
    if (next.upstream === record.version) return { record, next: next.upstream };
    const base = upstreamSource(`${PACKAGE}@${record.version}`, work, recorded);
    const tree = (source, name) => {
      const env = { GIT_INDEX_FILE: join(work, `index-${name}`) };
      git(
        folder,
        ["--git-dir", join(folder, ".git"), "--work-tree", source, "add", "-A", "-f", "."],
        {
          env,
          cwd: source,
        },
      );
      return git(folder, ["write-tree"], { env }).trim();
    };
    const baseCommit = git(folder, [
      "commit-tree",
      tree(base.folder, "base"),
      "-m",
      `Upstream ${PACKAGE}@${record.version}`,
    ]).trim();
    const nextCommit = git(folder, [
      "commit-tree",
      tree(next.folder, "next"),
      "-p",
      baseCommit,
      "-m",
      `Upstream ${PACKAGE} ${record.version} → ${next.upstream}`,
      "-m",
      `Applied by \`npx ${PACKAGE} update\`: upstream's changes since ${record.version}, on top of this copy's.`,
    ]).trim();
    return { record, next: next.upstream, baseCommit, nextCommit };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function needCopy(parsed) {
  const folder = copyFolder(parsed);
  if (!folder)
    throw new Error(
      `Not in a copy (no ${RECORD} here). Run this in a copy that \`npx ${PACKAGE} init\` made, or pass --folder <copy>.`,
    );
  return folder;
}

/** `diff`: what upstream changed since the copy's recorded version, up to `--to` (npm's latest by
 *  default): the files and the changes, or only the files with `--files`. */
function diff(parsed) {
  const folder = needCopy(parsed);
  const { record, next, baseCommit, nextCommit } = upstreamCommits(
    folder,
    parsed.values.to || "latest",
  );
  if (!nextCommit) return say(`This copy is at ${next} already: upstream changed nothing since.`);
  say(`Upstream's changes from ${record.version} (this copy's) to ${next}:`);
  const result = spawnSync(
    "git",
    [
      "diff",
      parsed.values.files ? "--name-status" : "--stat",
      ...(parsed.values.files ? [] : ["--patch"]),
      baseCommit,
      nextCommit,
      "--",
      ".",
      `:(exclude)${RECORD}`,
    ],
    { cwd: folder, stdio: "inherit" },
  );
  if (result.status !== 0) throw new Error("git diff failed.");
  say(`Apply them on top of your changes: npx ${PACKAGE} update`);
}

/** `update` in a copy: upstream's changes since the recorded version, applied on top of the owner's
 *  with a three-way merge (a cherry-pick of the upstream commit whose parent is the recorded
 *  version). The record moves with it. Conflicts stay in the files for the owner. */
function updateCopy(parsed) {
  const folder = needCopy(parsed);
  if (git(folder, ["status", "--porcelain"]).trim())
    throw new Error(
      `${folder} has changes that are not committed. Commit them (or put them aside), then run this again.`,
    );
  const { record, next, nextCommit } = upstreamCommits(folder, parsed.values.to || "latest");
  if (!nextCommit) return say(`This copy is at ${next} already: nothing to apply.`);
  const pick = spawnSync("git", ["cherry-pick", nextCommit], { cwd: folder, encoding: "utf8" });
  if (pick.status === 0) {
    say(
      `Applied upstream's changes from ${record.version} to ${next} on top of yours, as one commit. The copy records ${next} now.` +
        `\nBuild and install it: ./run-on-mac.sh`,
    );
    return;
  }
  const conflicts = git(folder, ["diff", "--name-only", "--diff-filter=U"]).trim();
  if (!conflicts) throw new Error(`git cherry-pick failed:\n${pick.stderr}`);
  say(
    `Upstream's changes from ${record.version} to ${next} conflict with yours in these files:\n` +
      conflicts
        .split("\n")
        .map((file) => `  ${file}`)
        .join("\n") +
      `\nEach has both versions between <<<<<<< and >>>>>>> lines (or one side deleted it). The other files are applied.` +
      `\nFix each file and \`git add\` it, then \`git cherry-pick --continue\`: the copy then records ${next}.` +
      `\nTo go back to how it was: \`git cherry-pick --abort\`.`,
  );
  process.exitCode = 1;
}

async function uninstall() {
  await quitApp();
  rmSync(paths.app, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
  say(
    `Removed ${paths.app} and ${home}. Each key stays listed on its mind's /keys page until you remove it there; it can do nothing now.`,
  );
}

const parsed = parseArgs({
  allowPositionals: true,
  options: {
    mind: { type: "string" },
    name: { type: "string" },
    login: { type: "boolean" },
    "no-login": { type: "boolean" },
    json: { type: "boolean" },
    folder: { type: "string" },
    to: { type: "string" },
    files: { type: "boolean" },
    "no-install": { type: "boolean" },
  },
});
if (parsed.values["no-login"]) parsed.values.login = false;
const command = parsed.positionals[0] || "setup";
try {
  if (command === "setup") await setup(parsed, { interactive: process.stdin.isTTY });
  else if (command === "update" && copyFolder(parsed)) updateCopy(parsed);
  else if (command === "update") await setup(parsed, { interactive: false });
  else if (command === "init") await init(parsed);
  else if (command === "diff") diff(parsed);
  else if (command === "list") list(parsed);
  else if (command === "add") await add(parsed, { interactive: process.stdin.isTTY });
  else if (command === "use") use(parsed);
  else if (command === "remove") remove(parsed);
  else if (command === "uninstall") await uninstall();
  else
    throw new Error(
      `No command "${command}". The commands are: setup (the default), update, list, add, use, remove, uninstall; for a copy of your own: init, diff, update.`,
    );
} catch (error) {
  say(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
