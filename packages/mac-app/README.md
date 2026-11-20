# @iterate-com/mac-app

A Mac's menu-bar app for an [iterate](https://iterate.com) mind. It makes this Mac an endpoint
device of the mind, which a person is often near. Its inputs are the screen, the camera, the
microphone and the window in front as text; its outputs, the speakers and banners on the screen
(a call's among them); its compute, commands (AppleScript, Swift, shell). You choose for each thing: **Off**, **Ask** (you
approve each use with Touch ID) or **Shared**. Everything starts at Off.

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
one of them, the active one. The panel's mind menu does the same as these commands:

```sh
npx @iterate-com/mac-app list                                      # the minds; * marks the active one
npx @iterate-com/mac-app add --mind example.org --name jane.mac    # a new key; a member allows it; then it is active
npx @iterate-com/mac-app use example.org                           # lend to that mind; the app switches at once
npx @iterate-com/mac-app remove example.org                        # forget it and delete its key
```

`add` offers the minds of the iterate CLI's profiles (`iterate login`). `remove` deletes the key on
this Mac only: it stays listed on the mind's /keys page until a member removes it there.

### The lend's state

The panel says what the lend does, with its reason and time: **Connecting**, **Live** since when,
**Reconnecting** (the attempt, the next try, the last failure in the CLI's words), **Stopped** (the
lend process ended; when it starts again) or **Not allowed** (no member allowed the key, or it was
removed: the link to allow it). **Reconnect Now** ends a wait or an attempt and starts at once; the
app does the same when the Mac wakes from sleep, and when the network comes back to a lend that is
not live. Every change of state is one line in the app's log.

Needs macOS 14 or later and Node 22.18 or later.

## In the mind

The panel's **Copy Prompt** copies a text for an agent: how to find this Mac in the mind and how to
use it. In short, with the name `jane.mac`:

```js
const mac = itx.jane.mac;
await mac.state(); // each display, camera and other thing, and its Off / Ask / Shared
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
in the mind's Dash, `https://dash.<zone>/agents<path>?call=join`, which joins the
call as it loads, muted: anyone can send such a link, so the page opens no microphone and sends
nothing until you press Unmute, and your camera and screen stay off. Any other page must be https, with no user or port, on the zone of the mind this Mac is
lent to or a subdomain of it: the app opens no other origin. The zone comes from the mind's
address as the lend's CLI says it (`iterate.example.com`), without the leading `iterate.` when
two labels are left (`iterate.com` stays `iterate.com`); a zone of one label is refused.

A call for a thing that is Off, or that macOS has not allowed yet, fails with the reason in words
an agent can pass on. Each use turns the 𝑖 red for 3 seconds.

## How it works

- **The app** (`Sources/`) holds macOS's permissions: Screen Recording, Accessibility, Camera and
  Microphone, each asked for by a guide in the panel when you first set a thing to Ask or Shared.
  It answers on a Unix socket in `~/Library/Application Support/voice-meet-mac/`, a folder only you
  can read.
- **The bridge** (`bridge/mac-endpoint.ts`) is the file that `iterate provide` lends to the mind.
  It turns each call into one request on that socket.
- **The installer** (`cli.mjs`) builds and updates. Its state is in
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
swift test                    # the state machines' tests (needs Xcode): microphone, camera, lend, banner
npx .                         # the installer from this folder
```

`.build/release/VoiceMeetMac --render-panel panel.png` draws the panel to a file without opening
anything. A third word draws the lend in one phase: `live`, `reconnecting`, `stopped` or
`not-allowed`; `ringing` draws a call's banner at the top. `--render-banner banner.png ring`
draws a banner (`ring`, `request` or `notice`; add `dark` for the dark appearance);
`--render-ring ring.png` is the ring's.
