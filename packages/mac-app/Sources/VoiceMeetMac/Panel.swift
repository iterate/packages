import AppKit
import SwiftUI
import VoiceMeetCore

/// What the panel shows that is not in the settings: which things exist now, and the newest small
/// picture of each display. `revision` goes up whenever a choice, a permission or a use changed.
@MainActor
final class PanelState: ObservableObject {
    @Published var things: [Shareable] = []
    @Published var revision = 0
    @Published var displayPictures: [String: CGImage] = [:]
    @Published var didCopy = false
    /// The lend (AppDelegate `showLend`): the minds, the active one, the state in words.
    @Published var lend = LendView()
    /// The banner on the screen, while one shows (`Banners`).
    @Published var banner: Banner?
    /// How the person's last capture (⌥⇧S) ended.
    @Published var captureLine: String?
}

/// What the panel shows of the lend.
struct LendView: Equatable {
    struct Mind: Equatable, Identifiable {
        let mind: String
        let name: String
        var id: String { mind }
    }

    var minds: [Mind] = []
    var active: String?
    var isSetUp = false
    /// The phase in words: `LendState.statusLine`.
    var status = ""
    var phase = "idle"
    /// Where a member allows the key, when the CLI printed one.
    var link: String?
    /// The last words of a command the panel ran (add, use, remove).
    var commandLine: String?
    var isCommandRunning = false
    /// Where the app came from: its version and whether it updates itself, or the owner's copy it
    /// was built from (`UpdateSource.line`).
    var source: String?
}

/// What the panel's lend section does.
struct LendActions {
    var reconnect: () -> Void = {}
    var use: (String) -> Void = { _ in }
    var add: () -> Void = {}
    var remove: (String) -> Void = { _ in }
    var open: (String) -> Void = { _ in }
}

/// The app's one piece of interface: a panel under the mark in the menu bar. Each thing on this
/// Mac that a mind can use has one control with three choices: Off, Ask, Shared.
struct Panel: View {
    @ObservedObject var state: PanelState
    let model: AppModel
    /// The person changed a choice.
    let changed: () -> Void
    /// The person wants to give a permission of macOS: the guide starts.
    let allow: (Permission) -> Void
    let copyPrompt: () -> Void
    /// The person presses a button of the banner (its index), or closes it (nil).
    var pressBanner: (Int?) -> Void = { _ in }
    var lendActions = LendActions()

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let banner = state.banner {
                bannerSection(banner)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                Divider()
            }
            lendSection
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            Divider()
            VStack(alignment: .leading, spacing: 16) {
                section("Displays", of: .screen)
                section("Cameras", of: .camera)
                section("This Mac", of: .microphone, .speaker, .banners, .accessibility, .commands)
            }
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 12)
            Divider()
            VStack(alignment: .leading, spacing: 2) {
                Text("⌥⇧S captures: talk, click, hold ⇧ and move the pointer to draw. ⌥⇧S again sends it to the mind and copies its text for an agent.")
                if let line = state.captureLine { Text("Last capture: \(line)").textSelection(.enabled) }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            Divider()
            HStack(spacing: 12) {
                Button(state.didCopy ? "Copied" : "Copy Prompt", action: copyPrompt)
                    .controlSize(.large)
                    .help("Copies how an agent uses this Mac, to paste into a chat with it")
                VStack(alignment: .leading, spacing: 2) {
                    if let lastUse = model.lastUse {
                        Text("Last use: \(lastUse.thing.title), \(lastUse.at.formatted(date: .omitted, time: .standard))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    if let source = state.lend.source {
                        Text(source)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }
                Spacer()
                Button("Quit") { NSApp.terminate(nil) }
                    .buttonStyle(.borderedProminent)
                    .tint(.red)
                    .controlSize(.large)
                    .keyboardShortcut("q")
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .frame(width: 430)
    }

    /// The mind this Mac is lent to, a menu of the others, and the lend's state in words.
    private var lendSection: some View {
        let lend = state.lend
        let active = lend.minds.first { $0.mind == lend.active }
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                // a spinner while it connects or reconnects, a dot otherwise
                if lend.phase == "connecting" || lend.phase == "reconnecting" {
                    ProgressView().controlSize(.mini).frame(width: 9, height: 9)
                } else {
                    Circle()
                        .fill(Self.color(of: lend.phase))
                        .frame(width: 9, height: 9)
                }
                Menu {
                    ForEach(lend.minds) { mind in
                        Button {
                            lendActions.use(mind.mind)
                        } label: {
                            if mind.mind == lend.active {
                                Label("\(mind.mind) · itx.\(mind.name)", systemImage: "checkmark")
                            } else {
                                Text("\(mind.mind) · itx.\(mind.name)")
                            }
                        }
                        .disabled(mind.mind == lend.active)
                    }
                    if !lend.minds.isEmpty { Divider() }
                    Button("Add a Mind…", action: lendActions.add).disabled(!lend.isSetUp || lend.isCommandRunning)
                    if !lend.minds.isEmpty {
                        Menu("Remove") {
                            ForEach(lend.minds) { mind in Button("\(mind.mind)…") { lendActions.remove(mind.mind) } }
                        }
                    }
                } label: {
                    Text(active.map { "\($0.mind) · itx.\($0.name)" } ?? (lend.minds.isEmpty ? "No mind yet" : "Lent to no mind"))
                        .lineLimit(1)
                }
                .menuStyle(.borderlessButton)
                .fixedSize()
                .help("The mind this Mac is lent to: one at a time")
                Spacer(minLength: 8)
                Button("Reconnect Now", action: lendActions.reconnect)
                    .controlSize(.small)
                    .disabled(active == nil)
                    .help("Ends the wait or the attempt, and starts the lend at once")
            }
            Text(lend.isSetUp ? lend.status : "Not set up: run npx @iterate-com/mac-app in a terminal")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            if let link = lend.link {
                Button("Open the Link to Allow This Mac") { lendActions.open(link) }.controlSize(.small)
            }
            if let line = lend.commandLine {
                HStack(spacing: 6) {
                    if lend.isCommandRunning { ProgressView().controlSize(.mini) }
                    Text(line).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    /// The banner on the screen, again: its title, its text and its buttons, and a close.
    private func bannerSection(_ banner: Banner) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                Image(systemName: banner.isCall ? "phone.fill" : "bell.badge").foregroundStyle(.green).frame(width: 20)
                VStack(alignment: .leading, spacing: 1) {
                    Text(banner.isCall ? "\(banner.title) calls" : banner.title).lineLimit(1)
                    if !banner.body.isEmpty {
                        Text(banner.body).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                    }
                }
                Spacer(minLength: 8)
                Button { pressBanner(nil) } label: { Image(systemName: "xmark") }
                    .buttonStyle(.borderless)
                    .help(banner.isCall ? "Decline" : "Close the banner with no button")
            }
            HStack(spacing: 6) {
                Spacer()
                ForEach(Array(banner.buttons.enumerated()), id: \.offset) { index, button in
                    if index == banner.defaultButton {
                        Button(button.label) { pressBanner(index) }.controlSize(.small).buttonStyle(.borderedProminent)
                    } else {
                        Button(button.label) { pressBanner(index) }.controlSize(.small)
                    }
                }
            }
        }
    }

    private static func color(of phase: String) -> Color {
        switch phase {
        case "live": return .green
        case "connecting", "reconnecting": return .orange
        case "idle": return .secondary
        default: return .red
        }
    }

    /// One group of rows under a small title. No background: the popover's own is enough.
    @ViewBuilder
    private func section(_ title: String, of powers: Power...) -> some View {
        let things = state.things.filter { powers.contains($0.power) }
        if !things.isEmpty {
            VStack(alignment: .leading, spacing: 9) {
                Text(title.uppercased())
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                ForEach(things) { row($0) }
            }
        }
    }

    private func row(_ thing: Shareable) -> some View {
        // Reading the revision makes the row draw again when a choice, a permission or a use changes.
        let sharing = state.revision >= 0 ? thing.sharing : .off
        return VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 10) {
                Image(systemName: thing.symbol)
                    .font(.system(size: 14))
                    .frame(width: 20)
                    .foregroundStyle(sharing == .off ? Color.secondary : Color.accentColor)
                VStack(alignment: .leading, spacing: 1) {
                    Text(thing.title).lineLimit(1)
                    if let note = note(for: thing) {
                        Text(note).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                Picker("", selection: Binding(get: { sharing }, set: { thing.sharing = $0; changed() })) {
                    ForEach(Sharing.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
                .controlSize(.small)
                .labelsHidden()
                .frame(width: 168)
            }
            if sharing != .off {
                if let permission = thing.power.permission, !thing.isPermitted {
                    HStack(spacing: 8) {
                        Label("macOS has not allowed \(permission.title) yet", systemImage: "exclamationmark.triangle.fill")
                            .font(.caption)
                            .foregroundStyle(.orange)
                        Spacer()
                        Button("Allow…") { allow(permission) }.controlSize(.small)
                    }
                    .padding(.leading, 30)
                } else {
                    preview(of: thing).padding(.leading, 30)
                }
            }
        }
    }

    /// The small picture of what a mind would get: a display's, or a camera's live one.
    @ViewBuilder
    private func preview(of thing: Shareable) -> some View {
        if thing.power == .screen, let picture = state.displayPictures[thing.id] {
            Image(decorative: picture, scale: 1)
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(height: 96)
                .clipShape(RoundedRectangle(cornerRadius: 6))
        } else if thing.power == .camera {
            LayerView(layer: model.cameraPreviewLayer(for: String(thing.id.dropFirst("camera.".count))))
                .frame(width: 170, height: 96)
                .clipShape(RoundedRectangle(cornerRadius: 6))
        }
    }

    private func note(for thing: Shareable) -> String? {
        if let until = model.approval.isApproved(thing) {
            return "Approved until \(until.formatted(date: .omitted, time: .shortened))"
        }
        let uses = model.uses[thing.id] ?? 0
        return uses > 0 ? "Used \(uses)× since the app started" : nil
    }

    /// What "Copy Prompt" copies: how an agent of the mind uses this Mac. It names no secret.
    static var prompt: String {
        let mac = Host.current().localizedName ?? "This Mac"
        return """
        "\(mac)" is lent to this iterate mind through its menu-bar app "iterate". Think of it as an endpoint device that a person is often near: inputs (the screen, the camera, the microphone, the window in front as text), outputs (the speakers, banners on the screen) and compute (commands). In the mind it is one capability, lent with `iterate provide` under a name such as `itx.jonas.mac`. Find the name:

            (await itx.rewriteRules.list()).filter((rule) => rule.description?.includes("iterate menu-bar app")).map((rule) => rule.match)

        Below, `mac` stands for that capability (for example `const mac = itx.jonas.mac`).

        First read what the owner shares: `await mac.state()`. It lists every thing of the Mac (each display, each camera, the microphone, the speakers, banners, the window text, commands) with its `sharing`: "shared" (use it), "ask" (the owner approves each use on the Mac, which can take up to a minute) or "off" (the call fails with the reason: say so to the person, do not try again).

        `state()` also says whether a person is likely at the Mac: `presence: { idleSeconds, screenLocked, displayAsleep }`. `idleSeconds` is the time since the last key press, mouse move or click in any app; `screenLocked` is true while the screen is locked (or another user's session is in front); `displayAsleep` is true while every display sleeps. Idle under a few minutes, not locked and a display awake is the sign that a person is likely there: read it before you show a banner or ring. It says nothing of who is there.

        The calls:

        - `await mac.screen.snapshot({ display?, maxWidth? })`: one still picture of a display as JPEG bytes (`jpeg`). `display` is the number from `state()`.
        - `await mac.camera.snapshot({ camera?, maxWidth? })`: one still picture of a camera. `camera` is its name.
        - `await mac.microphone.listen({ seconds })`: up to 60 seconds of the microphone as the bytes of a WAV file (`wav`).
        - `await mac.speaker.say("words")` and `await mac.speaker.play(soundBytes)`: sound through the Mac's speakers.
        - `await mac.accessibility.frontWindow()`: the window in front as text (roles, titles, values), not as a picture.
        - `await mac.appleScript("…")`: run an AppleScript. This is the plainest way to use the Mac's apps.
        - `await mac.swift("…")`: run a Swift program given as source. Use it for anything the other calls cannot do, such as a dialog that asks the person something.
        - `await mac.run(["command", "argument"], { stdin?, timeoutSeconds? })`: run a command; it has the app's permissions for the screen, the camera, the microphone and Accessibility.
        - `await mac.banner.show({ title, body?, buttons?, sound?, seconds? })`: a banner on the Mac's screen, at the top right. `buttons` is one to three `{ label, style?: "accept" | "decline" | "plain", symbol?, open? }` (default one "OK"); a button with `open` opens that page in the browser after its press, and the page must be on this mind's domain. `sound` is "chime" (default), "ring" or "none"; `seconds` is 30 unless said (5 to 120). It answers `{ pressed: "<label>" }`, or `{ pressed: null, why: "no answer" | "dismissed" | "replaced" | "off", words }`. What happens next is yours. For example, to ask the person into meeting X: `await mac.banner.show({ title: "Design review is starting", body: "Misha asks you to join", buttons: [{ label: "Join", style: "accept", open: "<the meeting's page>" }, { label: "Not now" }] })`.
        - `await mac.call.ring({ agent, from?, reason?, url? })`: a banner that looks like a call, for a call on the agent `agent` (its path, such as your own): who calls, why, Decline and Accept, and a ring. Accept opens the call's page; with no `url` it is the agent's page in the Dash, which opens the call's lobby, where the person checks their camera and sound and presses Join now. It answers `{ accepted: true }` or `{ accepted: false, why: "declined" | "no answer" | "replaced" | "off", words }` after at most 30 seconds.
        - One banner at a time; a newer one replaces it, but a plain banner never replaces a call. At most 6 a minute. Show one only when the person asked for it, or for something they said may interrupt them.

        The owner sees each use in the menu bar. Say what you looked at or did, and why.
        """
    }
}

extension Panel {
    /// Draws the panel, with the choices as they are stored, to a PNG file. It opens nothing on
    /// screen and starts no capture: a way to look at the interface from a script.
    @MainActor
    static func render(to file: URL, phase: String? = nil) -> Bool {
        _ = NSApplication.shared
        let state = PanelState()
        state.things = Shareable.all
        state.lend = sampleLend(phase)
        if phase == "ringing" { state.banner = BannerWindow.sample("ring") }
        let panel = Panel(state: state, model: AppModel(), changed: {}, allow: { _ in }, copyPrompt: {})
        // The panel has no background of its own (a popover gives it one); the file needs one.
        let view = NSHostingView(rootView: panel.background(Color(nsColor: .windowBackgroundColor)))
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: view.fittingSize), styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = view
        view.layoutSubtreeIfNeeded()
        guard let picture = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return false }
        view.cacheDisplay(in: view.bounds, to: picture)
        guard let png = picture.representation(using: .png, properties: [:]) else { return false }
        return (try? png.write(to: file)) != nil
    }
}

extension Panel {
    /// The minds as config.json lists them, with a phase of the lend made from the CLI's own states:
    /// a copy that only draws the panel starts no lend. `phase` is live, reconnecting, stopped,
    /// not-allowed, incompatible or connecting (the default); `ringing` also shows a ring.
    @MainActor
    static func sampleLend(_ phase: String?) -> LendView {
        let file = Lend.folder.appendingPathComponent("config.json")
        let config = try? JSONDecoder().decode(Lend.Config.self, from: Data(contentsOf: file))
        let name = config?.activeMind?.name ?? "jane.mac"
        let mind = config?.activeMind?.mind ?? "example.com"
        var lend = LendState()
        let start = Date().addingTimeInterval(-40)
        _ = lend.handle(.started, now: start)
        let live = #"{"state":"live","mind":"\#(mind)","name":"itx.\#(name)","again":false}"#
        let lines: [String] =
            switch phase {
            case "live", "ringing": [live]
            case "reconnecting": [live, #"{"state":"reconnecting","attempt":2,"of":14,"inMs":60000,"lastFailure":"fetch failed"}"#]
            case "not-allowed": [#"{"state":"notAllowed","why":"No member has allowed this key yet.","link":"https://\#(mind)/keys/enrol?provide=\#(name)","waiting":true}"#]
            case "incompatible": [#"{"state":"incompatible","why":"the statement is for another mind: this iterate CLI and the mind do not agree on the protocol"}"#]
            case "stopped": [#"{"state":"stopped","why":"\#(mind) could not be reached. Check the address."}"#]
            default: []
            }
        for line in lines { _ = lend.handle(.stateLine(line), now: start.addingTimeInterval(10)) }
        if phase == "stopped" { _ = lend.handle(.processEnded(status: 1, ranFor: 3), now: Date().addingTimeInterval(-1)) }
        var view = LendView()
        view.isSetUp = config != nil || phase != nil
        view.minds = config?.minds.map { LendView.Mind(mind: $0.mind, name: $0.name) } ?? [.init(mind: mind, name: name)]
        view.active = config?.active ?? mind
        view.status = lend.statusLine(now: Date(), clock: Lend.clock)
        view.phase = lend.phase.name
        view.link = lend.phase.link
        view.source = config.map { $0.source.line(home: NSHomeDirectory()) }
        return view
    }
}

/// Shows a Core Animation layer: a camera's live picture.
private struct LayerView: NSViewRepresentable {
    let layer: CALayer

    func makeNSView(context: Context) -> NSView {
        let view = NSView(frame: .zero)
        // A layer-hosting view: set the layer first, then `wantsLayer`.
        view.layer = layer
        view.wantsLayer = true
        layer.backgroundColor = CGColor(gray: 0, alpha: 1)
        return view
    }

    func updateNSView(_ view: NSView, context: Context) {}
}
