import AppKit
import SwiftUI

/// What the panel shows that is not in the settings: which things exist now, and the newest small
/// picture of each display. `revision` goes up whenever a choice, a permission or a use changed.
@MainActor
final class PanelState: ObservableObject {
    @Published var things: [Shareable] = []
    @Published var revision = 0
    @Published var displayPictures: [String: CGImage] = [:]
    @Published var didCopy = false
    /// The lend's state, as one line (AppDelegate `lendLine`).
    @Published var lendLine = ""
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

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 16) {
                section("Displays", of: .screen)
                section("Cameras", of: .camera)
                section("This Mac", of: .microphone, .speaker, .accessibility, .commands)
            }
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 12)
            Divider()
            HStack(spacing: 12) {
                Button(state.didCopy ? "Copied" : "Copy Prompt", action: copyPrompt)
                    .controlSize(.large)
                    .help("Copies how an agent uses this Mac, to paste into a chat with it")
                VStack(alignment: .leading, spacing: 2) {
                    Text(state.lendLine).font(.caption).lineLimit(1)
                    if let lastUse = model.lastUse {
                        Text("Last use: \(lastUse.thing.title), \(lastUse.at.formatted(date: .omitted, time: .standard))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
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
        "\(mac)" is lent to this iterate mind through its menu-bar app "iterate". In the mind it is one capability, lent with `iterate provide` under a name such as `itx.jonas.mac`. Find the name:

            (await itx.rewriteRules.list()).filter((rule) => rule.description?.includes("iterate menu-bar app")).map((rule) => rule.match)

        Below, `mac` stands for that capability (for example `const mac = itx.jonas.mac`).

        First read what the owner shares: `await mac.state()`. It lists every thing of the Mac (each display, each camera, the microphone, the speakers, the window text, commands) with its `sharing`: "shared" (use it), "ask" (the owner approves each use on the Mac, which can take up to a minute) or "off" (the call fails with the reason: say so to the person, do not try again).

        The calls:

        - `await mac.screen.snapshot({ display?, maxWidth? })`: one still picture of a display as JPEG bytes (`jpeg`). `display` is the number from `state()`.
        - `await mac.camera.snapshot({ camera?, maxWidth? })`: one still picture of a camera. `camera` is its name.
        - `await mac.microphone.listen({ seconds })`: up to 60 seconds of the microphone as the bytes of a WAV file (`wav`).
        - `await mac.speaker.say("words")` and `await mac.speaker.play(soundBytes)`: sound through the Mac's speakers.
        - `await mac.accessibility.frontWindow()`: the window in front as text (roles, titles, values), not as a picture.
        - `await mac.appleScript("…")`: run an AppleScript. This is the plainest way to use the Mac's apps.
        - `await mac.swift("…")`: run a Swift program given as source. Use it for anything the other calls cannot do, such as a dialog that asks the person something.
        - `await mac.run(["command", "argument"], { stdin?, timeoutSeconds? })`: run a command; it has the app's permissions for the screen, the camera, the microphone and Accessibility.

        The owner sees each use in the menu bar. Say what you looked at or did, and why.
        """
    }
}

extension Panel {
    /// Draws the panel, with the choices as they are stored, to a PNG file. It opens nothing on
    /// screen and starts no capture: a way to look at the interface from a script.
    @MainActor
    static func render(to file: URL) -> Bool {
        _ = NSApplication.shared
        let state = PanelState()
        state.things = Shareable.all
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
