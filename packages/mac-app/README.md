# @iterate-com/mac-app

**The primitive is the iterate CLI.** `iterate provide <file> --json` lends a file's functions to
a mind as `itx.<name>` and prints the lend's state on stdout, one JSON line at each change:
`connecting`, `live`, `reconnecting` (the attempt and the wait), `notAllowed` (with the link where
a member allows the key), `incompatible` and `stopped`, each with its reason. A program that keeps
a lend reads those lines; the lines for a person go to stderr. See
[`provide`](https://github.com/iterate/core/blob/main/core/lib/src/cli/README.md#provide) and
[its states](https://github.com/iterate/core/blob/main/core/lib/src/cli/provide-state.ts).

**This app is one thing built on it, and a starting point.** Copy it, change it, build it from
your copy: see [Two ways in](#two-ways-in) and [Make your own thing](#make-your-own-thing).

A Mac's menu-bar app for an [iterate](https://iterate.com) mind. It makes this Mac an endpoint
device of the mind, which a person is often near. Its inputs are the screen, the camera, the
microphone and the window in front as text; its outputs, the speakers and banners on the screen
(a call's among them); its compute, commands (AppleScript, Swift, shell). You choose for each thing: **Off**, **Ask** (you
approve each use with Touch ID) or **Shared**. Everything starts at Off.

## Two ways in

### Own it: copy the source

```sh
npx @iterate-com/mac-app init                 # into ~/src/iterate-mac-app
npx @iterate-com/mac-app init ~/src/my-mac    # or a folder you name (new or empty)
```

`init` copies the source (Swift sources, tests, the bridge, `run-on-mac.sh`, this README) into the
folder, makes it a git repository with one commit that names the upstream version, and records
that version in `.iterate-mac-app.json`. Then it builds, installs and lends from that folder, as
the plain install below does. Change anything there, then build and install it again:

```sh
./run-on-mac.sh                      # in the copy: build, install, start the app and its lend again
npx @iterate-com/mac-app diff        # in the copy: what upstream changed since your version
npx @iterate-com/mac-app diff --files                # only the files
npx @iterate-com/mac-app update      # in the copy: upstream's changes on top of yours
```

An app built from a copy runs what was built: **it does not update itself**, and the panel says
"Built from ~/src/iterate-mac-app". `update` takes the two versions from npm (the recorded one and
the newest; `--to <version>` names another) and applies upstream's changes on top of your commits
with a three-way merge, as one commit; the record moves with it. Where your change and upstream's
touch the same lines, the file keeps both between `<<<<<<<` and `>>>>>>>`: fix it, `git add` it,
and `git cherry-pick --continue` (or `--abort` to go back). Commit your own work first: `update`
refuses a work tree with changes. `--folder <copy>` runs `diff` or `update` from elsewhere.

### Just use it

```sh
npx @iterate-com/mac-app
```

It asks for your mind's address, the name to lend this Mac under (`itx.<name>`) and whether to
start at login. Then it:

1. installs Apple's Command Line Tools if they are missing (macOS's own window asks);
2. builds the app from the Swift source in this package and installs it as
   `/Applications/iterate.app` (once per version; a minute or two the first time);
3. installs the [iterate CLI](https://www.npmjs.com/package/iterate) at a pinned version in the
   app's own folder;
4. makes a key that may lend this Mac to your mind under that one name, and opens a link where a
   member of the mind allows it with their passkey;
5. opens the app. The 𝑖 in the menu bar is its panel.

From then on the app is the one thing that runs: it lends the Mac to the mind with that key, and
lends it again when the connection ends. It starts at login if you said so (System Settings ›
General › Login Items shows it). Once an hour it asks npm for a newer version and updates itself,
unless the microphone or a camera is in use.

```sh
npx @iterate-com/mac-app --mind example.com --name jane.mac --login   # no questions
npx @iterate-com/mac-app update                                       # update now, with the saved answers
npx @iterate-com/mac-app uninstall                                    # quit and remove the app, its keys and its state
```

### Several minds, one lent at a time

This Mac can know several minds, each with its own key (`keys/<mind>.key`). The app lends it to
one of them, the active one. The top of the panel is the mind switcher: the active mind's icon
(with the lend's dot), its name, its address and this Mac's name there. A click lists the minds,
with a check mark on the active one, then **Add a Mind…** and **Remove a Mind…**. It does the same
as these commands:

```sh
npx @iterate-com/mac-app list                                      # the minds; * marks the active one
npx @iterate-com/mac-app add --mind example.org --name jane.mac    # a new key; a member allows it; then it is active
npx @iterate-com/mac-app use example.org                           # lend to that mind; the app switches at once
npx @iterate-com/mac-app remove example.org                        # forget it and delete its key
```

`add` offers the minds of the iterate CLI's profiles (`iterate login`). `remove` deletes the key on
this Mac only: it stays listed on the mind's /keys page until a member removes it there.

A mind's name and icon are what its website answers to anyone at `/.well-known/iterate-profile`:
the app reads them with no key, at most once in five minutes while a view shows the mind, and keeps
them in `faces/` of its folder, so the panel draws them at once and with no network. A mind with no
icon is the first letter of its name on a colour that its address gives. The name is the owner's
own words, unsigned, so the address is always shown beside it.

### The lend's state

The panel says what the lend does, with its reason and time: **Connecting**, **Live** since when,
**Reconnecting** (the attempt, the next try, the last failure in the CLI's words), **Stopped** (the
lend process ended; when it starts again) or **Not allowed** (no member allowed the key, or it was
removed: the link to allow it). **Reconnect Now** ends a wait or an attempt and starts at once; the
app does the same when the Mac wakes from sleep, and when the network comes back to a lend that is
not live. Opening the panel does it too, for a lend that waits for its next start (stopped,
refused, or the CLI between its tries); one that is connecting or live is left alone. Every change
of state is one line in the app's log.

The 𝑖 in the menu bar shows the lend at a glance: plain while live, dimmed while it connects or
reconnects, and dimmed with a slash through it while it is not lent (no mind, stopped, not allowed,
incompatible). Green, red and orange (a banner, a use, a capture) show over it while they last.
`--render-icons <folder>` draws each mark on a light and a dark bar.

Needs macOS 14 or later and Node 22.18 or later.

## Make your own thing

Three parts are what a thing lent to a mind from a Mac needs; keep them:

- **The lend's state machine**: `Sources/VoiceMeetCore/LendState.swift` (pure, with its tests)
  reads the CLI's JSON lines and the process's end, and says what to do: start now, wait, or stop.
  `Sources/VoiceMeetMac/Lend.swift` runs `iterate provide` and does what it says.
- **The local socket and the bridge**: `LocalEndpoint.swift` answers one line of JSON per call on
  a Unix socket that only you can read; `AppModel.swift` routes each method. `bridge/mac-endpoint.ts`
  is the file that `iterate provide` lends: each of its methods is one request on that socket.
  **The bridge is the contract with the mind.** Its methods are what agents call, and its
  `description` is the line they read next to the name: keep it under 500 characters, or the mind
  refuses the lend and it never goes live.
- **The switches**: `Permissions.swift` (Off, Ask, Shared for each thing, and macOS's permissions)
  and `Approval.swift` (Touch ID for Ask). The panel (`Panel.swift`) shows them, under its mind
  switcher (`MindSwitcher.swift`). `MindFace.swift` is a mind's name and icon for any view
  (`MindAvatar`, `MindLabel`).

For a minimal app, delete the things it shares and their methods in `AppModel.swift` and the
bridge: `Camera.swift` and `CameraState.swift`, `AudioOwner.swift`, `AudioDevices.swift` and
`MicrophoneState.swift`, `Speaker.swift`, `Banner.swift` and `BannerState.swift`, `Powers.swift`
(screen, window text, commands), `Capture.swift` and `bridge/capture-upload.mjs`, `Presence.swift`, and their tests; `swift build` then names what
still refers to them, in the panel and the app's delegate. Then add your own method: a
case in `AppModel.swift`, a function in the bridge, a line in its description.

## In the mind

The panel's **Copy Prompt** copies a text for an agent: how to find this Mac in the mind and how to
use it. In short, with the name `jane.mac`:

```js
const mac = itx.jane.mac;
await mac.state(); // each display, camera and other thing, and its Off / Ask / Shared; presence
await mac.screen.snapshot({ display: 0 }); // { jpeg, pixelWidth, pixelHeight }
await mac.camera.snapshot(); // a still picture of a camera
await mac.microphone.listen({ seconds: 5 }); // { wav }
await mac.speaker.say("Lunch is ready");
await mac.accessibility.frontWindow(); // the window in front as text
await mac.appleScript('tell application "Music" to play');
await mac.swift('print("hello")');
await mac.run(["sw_vers"]); // { exitCode, stdout, stderr }
await mac.banner.show({
  title: "Design review is starting",
  body: "Misha asks you to join",
  buttons: [
    { label: "Join", style: "accept", open: "https://meet.example.com/contexts/agents/meet/x" },
    { label: "Not now" },
  ],
}); // { pressed: "Join" }, or { pressed: null, why: "no answer" | "dismissed" | "replaced" | "off", words }
await mac.call.ring({ agent: "/agents/lunch", from: "Lunch planner", reason: "Friday's table" });
// { accepted: true }, or { accepted: false, why: "declined" | "no answer" | "replaced" | "off", words }
```

### Presence

`mac.state()` also says whether a person is likely at the Mac, read when asked and kept nowhere:

```js
(await mac.state()).presence; // { idleSeconds: 42, screenLocked: false, displayAsleep: false }
```

- `idleSeconds`: the seconds since the last key press, mouse move, click or scroll, in any app.
- `screenLocked`: true while the screen is locked, or while another user's session is in front.
- `displayAsleep`: true while every display sleeps (or none is on).

Idle under a few minutes, not locked and a display awake is the sign that a person is likely
there; an agent reads it before it shows a banner or rings. It says nothing of who is there. It
has no switch of its own: it is part of `state()`, which any agent the Mac is lent to may read, and
macOS asks no permission for any of the three (`CGEventSource.secondsSinceLastEventType`,
`CGSessionCopyCurrentDictionary`, `CGDisplayIsAsleep`).

### Banners

A banner is an output of this Mac, beside the speakers. `mac.banner.show` puts one on the screen:
a title, a line or two of text, one to three buttons (one "OK" when none is given), a sound
(`chime` unless said, or `ring`, or `none`) and a time limit (30 s unless said, 5 to 120). It
answers the label of the button pressed: what happens next is the agent's. A button with `open`
also opens that page in the default browser after its press. `mac.call.ring` is a banner that
looks like a call: who calls, why, Decline and Accept as round red and green phone buttons, and a
ring for 30 s. Accept opens the call's page.

With Banners at **Off** in the panel, a banner is refused in words (`why: "off"`). At **Ask** and
at **Shared** it shows: no button is ever pressed but by you. The banner has the look of macOS's
own call banner and comes at the top right, where notifications come, over every window and on
the active space; the 𝑖 turns green, and the panel shows the banner too, with its buttons. It
does not take the keyboard when it comes, so a Return typed elsewhere presses nothing; click it,
and Return presses the default button (the first `accept`, else the first one) and Escape closes
it (or declines a call). One banner at a time: a newer one replaces it (`why: "replaced"`), but a
plain banner never replaces a call (it is refused). At most 6 begin in a minute.

A page to open is checked before anything shows. For a call with no `url`, it is the agent's page
in the mind's Dash, `https://dash.<zone>/agents<path>?call=join`, which opens the call's lobby:
there you see your camera and your microphone's level, choose the devices, see who is in the call,
and press Join now. Anyone can send such a link, so the lobby opens no microphone and no camera
by itself, and nothing is sent until you join. Any other page must be https, with no user or port, on the zone of the mind this Mac is
lent to or a subdomain of it: the app opens no other origin. The zone comes from the mind's
address as the lend's CLI says it (`iterate.example.com`), without the leading `iterate.` when
two labels are left (`iterate.com` stays `iterate.com`); a zone of one label is refused.

A call for a thing that is Off, or that macOS has not allowed yet, fails with the reason in words
an agent can pass on. Each use turns the 𝑖 red for 3 seconds.

## What a mind does with the Mac, as you see it

Each act of a mind with this Mac shows twice:

- **On the screen.** While the act runs, and for 4 seconds after, a pill at the top right names it
  with the mind's face: "Running a command" with the command's words, "Taking a picture of the
  display", "Listening to the microphone for 5 s". The 𝑖 in the menu bar is red for that time. The
  pill is in no picture or recording of the screen, so a mind's own screenshot does not show it.
- **In the panel.** "Activity" opens a list of the last acts with their times, how long each took,
  and the reason when one failed. The list is in memory alone and starts empty with the app.

The pill's × hides it until the next act begins, also while a long act runs on. "Show each act
on the screen", in the open Activity list, turns the pill off; the list and the red 𝑖 stay.
An act that was refused (the thing is off, or you said no) is no act and shows in neither.
`--render-activity <folder>` draws the pill and the list to PNG files, with sample acts.

## What the Mac tells its mind: `/devices/<name>`

A lent Mac has a context of its own in the mind, `/devices/<name>`, with the name of its lend
(`itx.<name>`). The app adds events there, through `bridge/device-events.mjs`, as you (the iterate
CLI's own sign-in; the Mac's key lends and does nothing else):

| Event                     | When                                                                                                                                                                    | Payload                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `device/presence-changed` | Always while the Mac is lent: it goes idle (120 s with no input), active, locked or asleep                                                                              | `state`, `idleSeconds`, `was`                                 |
| `device/key-pressed`      | While **Keyboard and mouse** is on in the panel                                                                                                                         | `key`, `text`, `keyCode`, `modifiers`, `app`, `isRepeat`      |
| `device/mouse-pressed`    | The same                                                                                                                                                                | `x`, `y`, `button`, `clicks`, `app`                           |
| `device/mouse-moved`      | The same, at most 10 a second                                                                                                                                           | `x`, `y`                                                      |
| `device/scrolled`         | The same, at most 10 a second                                                                                                                                           | `x`, `y`, `dx`, `dy`                                          |
| `device/app-focused`      | Always while the Mac is lent: the front app or its window's title changed                                                                                               | `app`, `bundle`, `title`                                      |
| `device/window-read`      | While **Window text** is ticked under Record: on a new app or window, a click, a pause after typing, the end of a scroll; at most every 2 s, only when the text changed | `app`, `title`, `text` (at most 20,000 characters), `trigger` |
| `record/slot-stored`      | While a switch under **Record** is on: once for each 30 seconds, after its files are in the mind                                                                        | `t`, `tracks` (below)                                         |

A key event holds the key itself, so what you type goes to the mind, a password too. Keyboard and
mouse is off until you turn it on. Its events are ephemeral: they reach whoever listens at that
moment and are in no log, unless you tick **Keep these events in the mind's log**. Keys need the
Accessibility permission of macOS. A presence event is always kept.

A password manager in front (1Password, Keychain Access, Passwords) is told as `app` and `bundle`
with no title, so that the app before it is seen to end; its window's title and text are never
read. A window's title and text need the Accessibility permission of macOS, and the app asks for
them away from its main thread, so an app that does not answer holds nothing up.

## The record: what the Mac saw and heard, in the mind

The panel's **Record** group has a switch for each of **Screens**, **Camera**, **Microphone** and
**Speakers**: all off until you turn one on, and remembered. The Mac records only while it is lent
to a mind, into that mind, and starts again by itself when the app starts. A source whose
permission macOS has not given says so in its row and stays off. Screens and cameras pause as
soon as the Mac is locked or its displays sleep, and start again by themselves: a paused camera is
off, its light too. Microphones and speakers go on. The line under the
switches says what happens ("Recording 4 tracks · 2 slots waiting"), and the 𝑖 in the menu bar is
orange while the Mac records.

Time is cut into **slots** of 30 seconds on the UTC clock. For each slot each **track**
(`screen-<display>`, `camera-0`, `mic-0`, `speaker-0`) is one file in the mind's files, named by
the clock, that plays by itself, and a video track has a small picture of the slot's start:

```
/devices/<name>/record/<track>/<YYYY-MM-DD>/<HH>/<MM>-<SS>.mp4   HEVC or AAC, fragmented MP4, time zero at the slot's start
/devices/<name>/record/<track>/<YYYY-MM-DD>/<HH>/<MM>-<SS>.jpg   640 px wide
```

Screens are 10 frames a second at the display's own pixels (only frames that changed), cameras
720p at 15, both HEVC at quality 0.45 with a keyframe at the slot's start and every 10 s. Sound is
AAC at 48 kHz, on the same clock as the picture. Windows of password managers are left out of
the screens.

The recorder (`Sources/Record`) writes each slot's files into a spool on this Mac first
(`~/Library/Application Support/iterate-mac-app/record/<mind>/`, a file's path there is its path
in the mind), and `slots/<t>.json` once every track of the slot has closed. `bridge/record-upload.mjs`
takes the slots oldest first: it puts each file into the mind by a signed upload link
(`itx.r2.presign`, the links of a slot asked for in one go; the file streams from disk, so no
byte of it passes through the connection), then appends `record/slot-stored`
to `/devices/<name>` with the idempotency key `record/slot-stored/<t>`, then deletes the slot from
the spool. So an event never names a file that is not there. With no network the spool waits (up
to 5 GB; then the oldest slots go). The event's payload is `{ t, tracks: { <track>: { kind, file,
bytes, codec, … } } }`: a video track also has `width`, `height`, `frames`, `parts` (`[[byte
offset, ms from the slot's start], …]`, one per fragment), `picture`, and a screen's `x`, `y`,
`scale`; an audio track has `rate`, `channels`, `rms`, `peak` and `levels` (60 half seconds, in
dBFS).

## Capture: show an agent what you mean

Press **⌥⇧S** in any app, then talk, click, and hold **⇧** and move the mouse to draw on the
screen in red (no button). Press ⌥⇧S again (or Send on the pill at the top of the display). A short
text is on the clipboard at once: paste it to an agent. The capture also goes into the mind this
Mac is lent to. The gesture and the shape of the text are
[Scrawl](https://github.com/kitlangton/scrawl)'s, by Kit Langton. A capture is your own act, so it
has no switch in the panel; it needs macOS 15, Screen Recording, and the microphone for your
voice. It ends by itself after 10 minutes. Discard on the pill throws it away.

The text is a line for each **numbered picture** with the words you said at it, and the two ways
to the pictures:

```
[capture 0:15 · Ghostty “my project” · jonas.mac → example.com]
The words point at red marks on the screen: look at the pictures before you answer. Each # is a numbered picture.
On jonas.mac: read sheet.jpg and 1.jpg, 2.jpg together, in /Users/…/iterate-mac-app/captures/<id>. Those files are the whole capture: answer from them, and open nothing else in that folder
If you cannot read that folder (you are an agent of the mind example.com, or you have its MCP tool and no file tool), run this as your first step. It answers the words and the marks, and it shows you the pictures as images: async (itx) => { … one script, about 600 characters: it waits for capture/ready, reads context.json, and shows the pictures … }
- #1 (0:06) drew “what is this here?”
- #2 (0:12) clicked “Save” “and this is slow”
```

Each mark and each click gets a numbered picture: the part of the display around it, cut out
while you talk. `sheet.jpg` is all of them on one. While you talk the pictures go up and the mind
puts your voice into words at each pause (the pill shows the last words: the sign that the
microphone hears you). So at the end only your last words can be missing: the first text says so,
and the same text with all the words takes its place on the clipboard a moment later, unless you
copied something else.

**Who reads the text, and what they get** (tested with real agents on 21 November 2026):

| The agent                                         | What it does                                | Does its model see the pictures?                                                                                                               |
| ------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| On this Mac (Claude Code, Codex)                  | Reads the numbered pictures from the folder | Yes                                                                                                                                            |
| In the mind (the Dash, Slack)                     | Runs the text's script                      | Yes: the script sends them to that agent as the files of a message                                                                             |
| Elsewhere, with the mind's MCP tool and a shell   | Runs the text's script                      | Yes                                                                                                                                            |
| With the mind's MCP tool alone (no shell, no web) | Runs the text's script                      | Yes: the tool answers the pictures as images. A mind that does not have that yet answers text, with `seen`: what a model read off each picture |

Each of them answers in one turn: one reply to the one message with the text.

The script waits for the event `capture/ready`, so a text that is pasted before the capture is
whole still gives the whole capture. The folder stays on this Mac for 7 days.

A capture is a set of **observations**, each with its time in milliseconds from the start. They
are files of the mind under `/captures/<id>/`, and the capture is a context of its own at that
path, with two events: `capture/ready` (the words, the marks and the pictures are there) and
`capture/received` (the movie too):

| File                   | What it holds                                                                                                                                                                                                                                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `summary.md`           | The text on the clipboard, with all the words                                                                                                                                                                                                                                                                                 |
| `1.jpg` …, `sheet.jpg` | The numbered pictures, at most 12, and all of them on one. A capture with no mark and no click has one: the display at the end                                                                                                                                                                                                |
| `context.json`         | What the text's script answers: the words, the marks, and the pictures under `"itx/images"`                                                                                                                                                                                                                                   |
| `seen.json`            | What a model read under each mark, for a reader that gets no picture: a model's claim                                                                                                                                                                                                                                         |
| `transcript.json`      | The words with their times. The mind's Whisper hears the voice piece by piece: a model's claim, not an observation                                                                                                                                                                                                            |
| `capture.json`         | The observations: `screen` and `voice` (the two files below), `window` (the app in front, its window's title, a browser's page URL, its accessibility tree: a new one at each change), `click` and `ink` (the points, and the accessibility element under them), `picture`; the numbered pictures (`panels`); and the display |
| `pictures/01.jpg` …    | At most 12 sharp stills of the whole display: at each mark, at the start and the end, at a change of window, at a click                                                                                                                                                                                                       |
| `screen.mp4`           | The display under the pointer, with the ink on it and your voice: small (1600 pixels wide, 10 pictures a second)                                                                                                                                                                                                              |
| `voice.m4a`            | The voice alone                                                                                                                                                                                                                                                                                                               |
| `accessibility/0.json` | The window in front as text, for the first six windows                                                                                                                                                                                                                                                                        |

**A word list for the transcript.** When the mind has `/dictation/words.txt` (the terms to know,
one on a line) and `/dictation/replacements.csv` (`wrong,right` on each line), the capture uses
them: the terms go to Whisper as its prompt (Whisper reads the last 224 tokens of a prompt only),
and each wrong form in the heard text is replaced, as a whole word, whatever its case.

The Mac's key only lends, so the capture goes up as you: `bridge/capture-upload.mjs` uses the
iterate CLI's own sign-in to that mind (`iterate login <mind>`, once). With no sign-in, or no
network, the capture stays in `~/Library/Application Support/iterate-mac-app/captures/<id>/`, the
text on the clipboard names the files there, and the panel says why; send it later with
`node bridge/capture-upload.mjs <folder> --finish --iterate <iterate.js> --mind <mind>`.

## How it works

- **The app** (`Sources/`) holds macOS's permissions: Screen Recording, Accessibility, Camera and
  Microphone, each asked for by a guide in the panel when you first set a thing to Ask or Shared.
  It answers on a Unix socket in `~/Library/Application Support/voice-meet-mac/`, a folder only you
  can read.
- **The bridge** (`bridge/mac-endpoint.ts`) is the file that `iterate provide` lends to the mind.
  It turns each call into one request on that socket.
- **The installer** (`cli.mjs`) builds and updates, and makes and updates a copy. Its state is in
  `~/Library/Application Support/iterate-mac-app/`; the app's log is in
  `~/Library/Logs/voice-meet-mac/app.log`.
- **The signature is local.** The build signs the app with a self-signed certificate that it makes
  once, in a keychain of its own, so that macOS keeps the permissions through each update. No Apple
  account is involved.
- A command that the mind runs is a child of the app, so it has the app's permissions. Set
  Commands to Shared only for a mind you trust with all of it.

Notes from the first runs (macOS 15.7.4, a MacBook Pro):

- The first start of an audio engine with Apple's voice processing changes the audio
  configuration itself (the microphone's format grows from 3 to 9 channels), so the engine starts
  twice; the app starts the same engine again and waits for it to settle.
- Apple's voice processing removed speech that another program played through the speakers from
  the microphone about as well as speech that its own engine played (about 21 dB in a short test).

## Developing

```sh
./run-on-mac.sh               # build, install in /Applications, open, follow the logs
./run-on-mac.sh --build-only  # build and sign .build/iterate.app only
./run-on-mac.sh --logs        # follow the app's log
swift test                    # the state machines' tests (needs Xcode): microphone, camera, lend, banner, the record
npx .                         # the installer from this folder
npx . init /tmp/mac --no-install   # a copy, without building or installing it
```

`printf '{"method":"capture.toggle"}\n' | nc -U ~/Library/Application\ Support/voice-meet-mac/endpoint.sock`
does what ⌥⇧S does, from a script on this Mac; the bridge lends no such call to a mind.

A script can also draw a mark in the capture that runs, for a test with no hand:
`{"method":"capture.mark","points":[[x,y],…]}` (points of the display from its top left).

`swift build --product record-run`, then `.build/debug/record-run --spool /tmp/spool --device test.mac
--synthetic --seconds 70` records a test picture and a beep each second into a spool, with no
permission; `--screens --cameras --mics --speakers` record the real sources, which need the app's
permissions (run it through the app's `run` method). `node bridge/record-upload.mjs /tmp/spool
--name test.mac --iterate <iterate.js> --mind <address>` sends a spool to a mind.

`.build/release/VoiceMeetMac --render-panel panel.png` draws the panel to a file without opening
anything. A third word draws the lend in one phase: `live`, `reconnecting`, `stopped` or
`not-allowed`; `ringing` draws a call's banner at the top. `--render-banner banner.png ring`
draws a banner (`ring`, `request` or `notice`; add `dark` for the dark appearance);
`--render-ring ring.png` is the ring's. `--render-switcher <folder>` draws the mind switcher,
closed and open, light and dark, four files.
