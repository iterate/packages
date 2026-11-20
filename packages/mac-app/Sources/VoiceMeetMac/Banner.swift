import AVFoundation
import AppKit
import SwiftUI
import VoiceMeetCore

/// BANNERS: an output of this Mac, beside its speakers. A mind shows a banner on the screen
/// (`banner.show`): a title, a line or two of text, one to three buttons, a sound, and a time limit.
/// It answers the label of the button the person pressed. A button may open a page of the mind in
/// the default browser after its press. `call.ring` is a preset: a banner that looks like a call.
///
/// The owner chooses Banners in the panel: Off refuses in words; Ask and Shared both show, and no
/// button is ever pressed but by the person. The rules are `BannerState`.
@MainActor
final class Banners {
    /// The address of the mind this Mac is lent to, as the lend's CLI says it, for the page check.
    var activeMind: () -> String? = { nil }
    var onChange: (() -> Void)?

    private(set) var state = BannerState()
    private let log = AppLog("banner")
    private var nextID = 1
    private var callers: [Int: CheckedContinuation<BannerOutcome, Never>] = [:]
    private let window = BannerWindow()
    private var ringing: AVAudioPlayer?

    init() {
        window.press = { [weak self] index in self?.press(index) }
        window.dismiss = { [weak self] in self?.dismiss() }
    }

    private static let offWords = "The Mac's owner has Banners off in the iterate panel: nothing shows on this Mac's screen. Say it in the chat instead."

    /// The bridge's `banner.show`: answers `{ pressed: label }` or `{ pressed: null, why, words }`.
    /// A banner that may not show (bad buttons, a page of another origin, too many) is refused in
    /// words before anything shows.
    func show(_ parameters: [String: Any]) async throws -> [String: Any] {
        guard Shareable.banners.sharing != .off else {
            log.info("a banner refused: Banners is off")
            return ["pressed": NSNull(), "why": "off", "words": Self.offWords]
        }
        let made = Banner.make(
            id: nextID, title: parameters["title"] as? String, body: parameters["body"] as? String,
            buttons: parameters["buttons"] as? [[String: Any]], sound: parameters["sound"] as? String,
            seconds: parameters["seconds"] as? Double, mind: activeMind() ?? ""
        )
        let banner: Banner
        switch made {
        case .success(let ready): banner = ready
        case .failure(let refusal): throw EndpointRefusal(refusal.words)
        }
        if let words = state.admit(now: Date()) { throw EndpointRefusal(words) }
        nextID += 1
        let outcome = await run(banner)
        switch outcome {
        case .pressed(let label): return ["pressed": label]
        case .busy: throw EndpointRefusal("A call rings on this Mac now: a banner does not replace it. Show it again after.")
        case .noAnswer: return ["pressed": NSNull(), "why": "no answer", "words": "No one pressed a button in \(Int(banner.seconds)) seconds."]
        case .dismissed: return ["pressed": NSNull(), "why": "dismissed", "words": "The Mac's owner closed the banner with no button."]
        case .replaced: return ["pressed": NSNull(), "why": "replaced", "words": "A newer banner replaced this one before a press."]
        }
    }

    /// The bridge's `call.ring`, a banner that looks like a call: answers `{ accepted: true }` or
    /// `{ accepted: false, why, words }`.
    func ring(_ parameters: [String: Any]) async throws -> [String: Any] {
        guard Shareable.banners.sharing != .off else {
            log.info("a ring refused: Banners is off")
            return ["accepted": false, "why": "off", "words": Self.offWords]
        }
        let agent = (parameters["agent"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let page: URL
        switch BannerState.callPage(parameters["url"] as? String, agent: agent, mind: activeMind() ?? "") {
        case .success(let ready): page = ready
        case .failure(let refusal): throw EndpointRefusal(refusal.words)
        }
        if let words = state.admit(now: Date()) { throw EndpointRefusal(words) }
        let from = (parameters["from"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? agent
        let banner = Banner.call(id: nextID, from: from, reason: parameters["reason"] as? String ?? "", page: page)
        nextID += 1
        switch await run(banner) {
        case .pressed("Accept"): return ["accepted": true]
        case .pressed, .dismissed: return ["accepted": false, "why": "declined", "words": "The Mac's owner declined the call."]
        case .noAnswer: return ["accepted": false, "why": "no answer", "words": "No one answered on the Mac in \(Int(banner.seconds)) seconds."]
        case .replaced, .busy: return ["accepted": false, "why": "replaced", "words": "A newer ring replaced this one before the owner answered."]
        }
    }

    /// The person pressed button `index` of the banner showing: on it, or in the panel.
    func press(_ index: Int) {
        guard let banner = state.showing else { return }
        send(.pressed(id: banner.id, index: index))
    }

    /// Escape, or the panel's close.
    func dismiss() {
        guard let banner = state.showing else { return }
        send(.dismissed(id: banner.id))
    }

    /// The app quits: the banner ends as no answer.
    func stop() {
        if let banner = state.showing { send(.timedOut(id: banner.id)) }
    }

    private func run(_ banner: Banner) async -> BannerOutcome {
        log.info(
            "banner \(banner.id)\(banner.isCall ? " (a call)" : ""): \"\(banner.title)\", buttons \(banner.buttons.map(\.label)), \(banner.buttons.compactMap(\.open?.absoluteString))"
        )
        let outcome = await withCheckedContinuation { continuation in
            callers[banner.id] = continuation
            send(.requested(banner))
        }
        log.info("banner \(banner.id): \(outcome)")
        return outcome
    }

    private func send(_ event: BannerEvent) {
        for effect in state.handle(event) {
            switch effect {
            case .show(let banner):
                stopSound()
                window.show(banner)
                play(banner.sound)
            case .hide:
                window.hide()
                stopSound()
            case .startTimer(let id, let seconds):
                DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { [weak self] in self?.send(.timedOut(id: id)) }
            case .open(let url):
                NSWorkspace.shared.open(url)
            case .answer(let id, let outcome):
                callers.removeValue(forKey: id)?.resume(returning: outcome)
            }
        }
        onChange?()
    }

    private func play(_ sound: BannerSound) {
        switch sound {
        case .ring:
            if ringing == nil { ringing = try? AVAudioPlayer(data: Self.ringTone) }
            ringing?.numberOfLoops = -1
            ringing?.volume = 0.7
            ringing?.currentTime = 0
            ringing?.play()
        case .chime:
            NSSound(named: "Glass")?.play()
        case .none:
            break
        }
    }

    private func stopSound() {
        ringing?.stop()
    }

    /// Two soft notes and a rest, 2 s, as a WAV in memory: the ring loops it. No file ships.
    static let ringTone: Data = {
        let rate = 44_100
        var samples = [Int16](repeating: 0, count: rate * 2)
        for (start, frequency) in [(0.0, 880.0), (0.18, 1_175.0), (0.5, 880.0), (0.68, 1_175.0)] {
            let first = Int(start * Double(rate)), count = Int(0.16 * Double(rate))
            for index in 0..<count {
                let t = Double(index) / Double(rate)
                let envelope = min(1, t / 0.01) * exp(-t * 12)
                let value = sin(2 * .pi * frequency * t) * envelope * 0.5
                samples[first + index] = Int16(max(-1, min(1, value)) * Double(Int16.max))
            }
        }
        var data = Data()
        func append<Value>(_ value: Value) { withUnsafeBytes(of: value) { data.append(contentsOf: $0) } }
        let bytes = UInt32(samples.count * 2)
        data.append(contentsOf: Array("RIFF".utf8)); append(UInt32(36 + bytes)); data.append(contentsOf: Array("WAVEfmt ".utf8))
        append(UInt32(16)); append(UInt16(1)); append(UInt16(1)); append(UInt32(rate)); append(UInt32(rate * 2)); append(UInt16(2)); append(UInt16(16))
        data.append(contentsOf: Array("data".utf8)); append(bytes)
        samples.withUnsafeBytes { data.append(contentsOf: $0) }
        return data
    }()
}

/// The banner's window, in the look of macOS's own incoming-call banner. It comes at the top right
/// of the screen with the pointer, where notifications come, 16 pt from the edge and below the menu
/// bar, and slides in from the right. It floats over every window, on whichever space is active.
/// It does not take the keyboard when it comes, so a Return typed into another app presses
/// nothing; once clicked, Return presses the default button and Escape dismisses (or declines a
/// call). Its size is its content's: a fixed width, and the height the content needs at it.
@MainActor
final class BannerWindow {
    static let width: CGFloat = 360
    private static let margin: CGFloat = 16
    /// The clear room around the banner, in the window, for its shadow.
    private static let inset: CGFloat = 24
    static let radius: CGFloat = 18

    var press: (Int) -> Void = { _ in }
    var dismiss: () -> Void = {}
    private var panel: NSPanel?
    private let log = AppLog("banner")

    /// The banner's rounded shape, as the material's mask: it stretches to any size.
    private static let roundedMask: NSImage = {
        let side = radius * 2 + 2
        let image = NSImage(size: NSSize(width: side, height: side), flipped: false) { rect in
            NSColor.black.setFill()
            NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius).fill()
            return true
        }
        image.capInsets = NSEdgeInsets(top: radius, left: radius, bottom: radius, right: radius)
        image.resizingMode = .stretch
        return image
    }()

    /// The size the banner's content needs at the fixed width.
    static func size(of view: BannerView) -> NSSize {
        let fits = NSHostingController(rootView: view).sizeThatFits(in: CGSize(width: width, height: 10_000))
        return NSSize(width: width, height: ceil(fits.height))
    }

    func show(_ banner: Banner) {
        let panel = self.panel ?? Self.makePanel()
        self.panel = panel
        let view = BannerView(banner: banner, press: { [weak self] in self?.press($0) }, dismiss: { [weak self] in self?.dismiss() })
        let size = Self.size(of: view)
        let host = NSHostingView(rootView: view)
        // the window keeps that size: the view never resizes it
        host.sizingOptions = []
        // The window is larger than the banner by `inset` on each side and draws nothing of its
        // own: no frame and no window shadow. The banner's shadow is a layer with a rounded path,
        // and the material is masked to the rounded shape, both of the banner's size, so nothing
        // square is ever drawn.
        let inset = Self.inset
        let windowSize = NSSize(width: size.width + 2 * inset, height: size.height + 2 * inset)
        let frame = NSRect(x: inset, y: inset, width: size.width, height: size.height)
        let container = NSView(frame: NSRect(origin: .zero, size: windowSize))
        container.wantsLayer = true
        let shadow = NSView(frame: frame)
        shadow.wantsLayer = true
        shadow.layer?.shadowPath = CGPath(
            roundedRect: CGRect(origin: .zero, size: size), cornerWidth: Self.radius, cornerHeight: Self.radius, transform: nil)
        shadow.layer?.shadowColor = NSColor.black.cgColor
        shadow.layer?.shadowOpacity = 0.3
        shadow.layer?.shadowRadius = 12
        shadow.layer?.shadowOffset = CGSize(width: 0, height: -5)
        let blur = NSVisualEffectView(frame: frame)
        // follows the appearance, light or dark (.hudWindow is always dark)
        blur.material = .popover
        blur.blendingMode = .behindWindow
        blur.state = .active
        blur.maskImage = Self.roundedMask
        host.frame = blur.bounds
        host.autoresizingMask = [.width, .height]
        blur.addSubview(host)
        container.addSubview(shadow)
        container.addSubview(blur)
        panel.contentView = container

        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { $0.frame.contains(mouse) } ?? NSScreen.main ?? NSScreen.screens[0]
        // visibleFrame ends below the menu bar; the banner itself stands `margin` from the edge and
        // below it, and the window around it is `inset` larger on each side
        let area = screen.visibleFrame
        let target = NSRect(
            x: area.maxX - size.width - Self.margin - inset,
            y: area.maxY - size.height - Self.margin - inset,
            width: windowSize.width, height: windowSize.height
        )
        var start = target
        start.origin.x = screen.frame.maxX + 8
        panel.setFrame(start, display: false)
        panel.alphaValue = 1
        panel.orderFrontRegardless()
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.28
            context.timingFunction = CAMediaTimingFunction(name: .easeOut)
            panel.animator().setFrame(target, display: true)
        } completionHandler: { [weak panel, log] in
            MainActor.assumeIsolated {
                log.info(
                    "the banner is \(Int(size.width)) × \(Int(size.height)) pt; its window stands at \(NSStringFromRect(panel?.frame ?? .zero)) on a screen of \(NSStringFromRect(screen.frame))"
                )
            }
        }
    }

    func hide() {
        guard let panel, panel.isVisible else { return }
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.18
            panel.animator().alphaValue = 0
        } completionHandler: { [weak panel] in
            MainActor.assumeIsolated { panel?.orderOut(nil) }
        }
    }

    private static func makePanel() -> NSPanel {
        let panel = KeyablePanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        // the window's own shadow would be its rectangle's: the banner draws its own
        panel.hasShadow = false
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        return panel
    }

    // MARK: - drawings to a file

    /// The banners that the drawings to a file show: `ring`, `request` (two buttons, a body of two
    /// lines), `short` (two buttons, a body of one line), `three` (three buttons) or `notice`.
    static func sample(_ kind: String) -> Banner {
        let mind = "example.com"
        let meet = "https://meet.example.com/contexts/agents/meet/2026-11-20-1100-design"
        func make(_ title: String, _ body: String?, _ buttons: [[String: Any]]?) -> Banner {
            try! Banner.make(id: 1, title: title, body: body, buttons: buttons, sound: "chime", seconds: nil, mind: mind).get()
        }
        switch kind {
        case "request":
            return make(
                "Design review is starting", "Misha and two guests are in. The agent asks you to join for the decision on the banner.",
                [["label": "Join", "style": "accept", "open": meet], ["label": "Not now"]])
        case "short":
            return make("Design review is starting", "Misha asks you to join.", [["label": "Join", "style": "accept", "open": meet], ["label": "Not now"]])
        case "three":
            return make(
                "Lunch on Friday?", "The table for six is held until noon.",
                [["label": "Book it", "style": "accept"], ["label": "Ask me later"], ["label": "Skip this week"]])
        case "notice":
            return make("The deploy finished", "iterate.example.com runs the new build.", nil)
        default:
            return Banner.call(
                id: 1, from: "Lunch planner", reason: "The table for Friday needs your yes before noon, or it goes to the next group.",
                page: URL(string: "https://dash.example.com/agents?contextPath=/agents/meet/2026-11-20-1030-lunch&call=join")!
            )
        }
    }

    /// Draws a sample banner to a PNG file, in the light or the dark appearance, on a plain ground,
    /// at the size the window would take: a file has no window behind it for the material to blur,
    /// so a fill of the material's tone and a soft shadow stand in.
    static func render(_ kind: String, to file: URL, dark: Bool) -> Bool {
        _ = NSApplication.shared
        let appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        let banner = sample(kind)
        let size = size(of: BannerView(banner: banner, press: { _ in }, dismiss: {}))
        let view = NSHostingView(
            rootView: BannerView(banner: banner, press: { _ in }, dismiss: {}, renderTone: dark ? Color(white: 0.2) : Color(white: 0.97))
                .frame(width: size.width, height: size.height)
                .shadow(color: .black.opacity(0.28), radius: 14, y: 6)
                .padding(28)
                .background(dark ? Color(white: 0.08) : Color(white: 0.78))
        )
        view.appearance = appearance
        // the banner's own kind of window, which draws its default button as a key window does
        let window = KeyablePanel(contentRect: NSRect(origin: .zero, size: view.fittingSize), styleMask: [.borderless], backing: .buffered, defer: false)
        window.appearance = appearance
        window.contentView = view
        view.layoutSubtreeIfNeeded()
        guard let picture = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return false }
        view.cacheDisplay(in: view.bounds, to: picture)
        guard let png = picture.representation(using: .png, properties: [:]) else { return false }
        return (try? png.write(to: file)) != nil
    }

    /// The app's own icon: the bundle's, or, for a bare build that draws to a file, the package's.
    static let icon: NSImage = {
        if Bundle.main.url(forResource: "AppIcon", withExtension: "icns") != nil { return NSApp.applicationIconImage }
        let package = Bundle.main.executableURL?.resolvingSymlinksInPath().deletingLastPathComponent()
            .appendingPathComponent("../../../Support/AppIcon.icns").standardized
        return package.flatMap { NSImage(contentsOf: $0) } ?? NSApp.applicationIconImage
    }()
}

/// A borderless panel takes the keyboard only after a click, so the default button works then.
/// It says it is the key window all the time, so that AppKit draws its default button in the
/// accent colour, as in a key window: a banner never takes the keyboard when it comes.
private final class KeyablePanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var isKeyWindow: Bool { true }
}

/// The banner's content, one view with 14 pt of padding on every side: the app's icon, the title
/// and the text, and the buttons. A call is one row, with its two round phone buttons centred at
/// the right. Any other banner has its buttons in a row under the text, the default one (in the
/// accent colour) at the right. The window takes this view's height: nothing has a fixed one.
struct BannerView: View {
    let banner: Banner
    let press: (Int) -> Void
    let dismiss: () -> Void
    /// Drawn to a file: this fill stands in for the material, which needs a window behind it.
    var renderTone: Color?

    private var isRound: Bool { banner.buttons.allSatisfy(\.isRound) }

    var body: some View {
        Group {
            if isRound {
                HStack(alignment: .center, spacing: 12) {
                    icon
                    text.frame(maxWidth: .infinity, alignment: .leading)
                    HStack(spacing: 10) {
                        ForEach(Array(banner.buttons.enumerated()), id: \.offset) { index, button in round(button, index) }
                    }
                }
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .top, spacing: 12) {
                        icon
                        text.frame(maxWidth: .infinity, alignment: .leading)
                    }
                    HStack(spacing: 8) {
                        Spacer(minLength: 0)
                        ForEach(order, id: \.self) { index in capsule(banner.buttons[index], index) }
                    }
                }
            }
        }
        .padding(14)
        .frame(width: BannerWindow.width)
        .background {
            if let renderTone {
                RoundedRectangle(cornerRadius: BannerWindow.radius, style: .continuous).fill(renderTone)
            }
        }
        // Escape: a decline button takes it, else the banner is dismissed
        .background {
            if !banner.buttons.contains(where: { $0.style == .decline }) {
                Button("", action: dismiss).keyboardShortcut(.cancelAction).opacity(0).accessibilityHidden(true)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(banner.body.isEmpty ? banner.title : "\(banner.title): \(banner.body)")
    }

    /// The buttons from left to right: the others in the order given, the default one last.
    private var order: [Int] {
        banner.buttons.indices.filter { $0 != banner.defaultButton } + [banner.defaultButton]
    }

    private var icon: some View {
        Image(nsImage: BannerWindow.icon)
            .resizable()
            .interpolation(.high)
            .frame(width: 36, height: 36)
            .accessibilityHidden(true)
    }

    private var text: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(banner.title)
                .font(.system(size: 13, weight: .semibold))
                .lineLimit(1)
            if !banner.body.isEmpty {
                Text(banner.body)
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .lineLimit(banner.isCall ? 1 : 2)
                    .truncationMode(.tail)
                    .fixedSize(horizontal: false, vertical: true)
                    .help(banner.body)
            }
        }
    }

    private func round(_ button: BannerButton, _ index: Int) -> some View {
        Button { press(index) } label: {
            Image(systemName: button.symbol ?? "circle")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 32, height: 32)
                .background(Circle().fill(button.style == .decline ? Color.red : Color.green))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(button.label)
        .help(help(button, index))
        .modifier(Shortcut(isDefault: index == banner.defaultButton, isDecline: button.style == .decline))
    }

    /// A button in the system's regular size and shape: bordered, and the default one filled with
    /// the system's accent colour. Drawn here, not by AppKit: AppKit draws the default button grey
    /// while its app is not active, and this app is never active while a banner shows over
    /// another app (activating it would take the keyboard from the person).
    private func capsule(_ button: BannerButton, _ index: Int) -> some View {
        let isDefault = index == banner.defaultButton
        return Button { press(index) } label: {
            if let symbol = button.symbol { Label(button.label, systemImage: symbol) } else { Text(button.label) }
        }
        .buttonStyle(SystemLikeButton(isDefault: isDefault))
        .help(help(button, index))
        .modifier(Shortcut(isDefault: isDefault, isDecline: button.style == .decline))
    }

    private func help(_ button: BannerButton, _ index: Int) -> String {
        let key = index == banner.defaultButton ? " (Return)" : button.style == .decline ? " (Escape)" : ""
        return button.open.map { "\(button.label): opens \($0.host ?? "a page") in the browser\(key)" } ?? "\(button.label)\(key)"
    }
}

/// Return presses the default button; Escape a decline button.
private struct Shortcut: ViewModifier {
    let isDefault: Bool
    let isDecline: Bool

    func body(content: Content) -> some View {
        if isDefault {
            content.keyboardShortcut(.defaultAction)
        } else if isDecline {
            content.keyboardShortcut(.cancelAction)
        } else {
            content
        }
    }
}

/// The system's regular push button, as `.bordered` and `.borderedProminent` draw it in an active
/// window: 13 pt text, 24 pt high, a corner of 6 pt.
private struct SystemLikeButton: ButtonStyle {
    let isDefault: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13))
            .lineLimit(1)
            .foregroundStyle(isDefault ? Color.white : Color.primary)
            .padding(.horizontal, 12)
            .frame(minWidth: 64, minHeight: 24)
            .background {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(isDefault ? Color(nsColor: .controlAccentColor) : Color.primary.opacity(0.12))
            }
            .overlay {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(Color.black.opacity(configuration.isPressed ? 0.15 : 0))
            }
            .contentShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
    }
}
