import AppKit
import SwiftUI
import VoiceMeetCore

/// WHAT THIS MAC TELLS ITS MIND ABOUT ITSELF, as events on the context `/devices/<name>` of the
/// mind it is lent to: the same name as the lend, `itx.<name>`.
///
/// - `device/presence-changed`, always while the Mac is lent: the Mac goes idle, becomes active,
///   is locked, or its displays sleep. Kept in the log.
/// - `device/key-pressed`, `device/mouse-pressed`, `device/mouse-moved` and `device/scrolled`,
///   only while the person has "Keyboard and mouse" on in the panel. A key event holds the key
///   itself. They are ephemeral (to whoever listens now, in no log) unless the person ticks
///   "Keep these events".
///
/// The events go through `bridge/device-events.mjs`, which connects to the mind as the person:
/// the Mac's own key lends and does nothing else.
@MainActor
final class DeviceEvents: ObservableObject {
    struct Destination: Equatable {
        let node: String
        let iterateBin: String
        let publisher: String
        let mind: String
        let name: String
    }

    /// A person is taken as away after this long with no key, click or move.
    static let idleAfterSeconds = 120

    /// The person's choice: keyboard and mouse events go to the mind.
    @Published var sharesInput = UserDefaults.standard.bool(forKey: "device.input") {
        didSet {
            UserDefaults.standard.set(sharesInput, forKey: "device.input")
            watchInput()
        }
    }
    /// The person's choice: those events are kept in the mind's log. Off: they are ephemeral.
    @Published var keepsInput = UserDefaults.standard.bool(forKey: "device.keep") {
        didSet { UserDefaults.standard.set(keepsInput, forKey: "device.keep") }
    }
    /// How many events went to the mind in this run, and the last failure, for the panel.
    @Published private(set) var sent = 0
    @Published private(set) var failure: String?
    /// "active", "idle", "locked" or "asleep": what the last presence event said.
    @Published private(set) var presence: String?

    var destination: () -> Destination? = { nil }
    var readPresence: () -> Presence = { Presence(idleSeconds: 0, screenLocked: false, displayAsleep: false) }

    private let log = AppLog("device")
    private var publisher: Process?
    private var input: FileHandle?
    private var publishesTo: Destination?
    private var pending = ""
    private var timer: Timer?
    private var monitors: [Any] = []
    private var lastMoveAt = Date.distantPast
    private var observers: [(NotificationCenter, NSObjectProtocol)] = []

    func start() {
        let timer = Timer(timeInterval: 2, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.tick() } }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
        // A lock, an unlock, and displays that sleep or wake count at once, not at the next tick:
        // the recorder pauses the screens on this value. Again after half a second, in case the
        // session's dictionary says it a little later than the notification.
        let workspace = NSWorkspace.shared.notificationCenter, distributed = DistributedNotificationCenter.default()
        for (center, name) in [
            (distributed as NotificationCenter, Notification.Name("com.apple.screenIsLocked")),
            (distributed, Notification.Name("com.apple.screenIsUnlocked")),
            (workspace, NSWorkspace.screensDidSleepNotification), (workspace, NSWorkspace.screensDidWakeNotification),
        ] {
            observers.append((center, center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.tick() }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { MainActor.assumeIsolated { self?.tick() } }
            }))
        }
        watchInput()
        tick()
    }

    func stop() {
        timer?.invalidate()
        for (center, observer) in observers { center.removeObserver(observer) }
        monitors.forEach(NSEvent.removeMonitor)
        monitors = []
        endPublisher()
    }

    /// The path of the device's context in the mind, for the panel.
    var path: String? { destination().map { "/devices/\($0.name)" } }

    // MARK: - Presence

    private func tick() {
        // another mind, or none: the publisher follows the lend
        if destination() != publishesTo { endPublisher() }
        guard destination() != nil else { return presence = nil }
        let now = readPresence()
        let state = now.screenLocked ? "locked" : now.displayAsleep ? "asleep" : now.idleSeconds >= Self.idleAfterSeconds ? "idle" : "active"
        guard state != presence else { return }
        var payload: [String: Any] = ["state": state, "idleSeconds": now.idleSeconds]
        if let presence { payload["was"] = presence }
        presence = state
        publish("device/presence-changed", payload, ephemeral: false)
        log.info("presence: \(state)")
    }

    // MARK: - Keyboard and mouse

    /// Global monitors see the keys and the mouse in every other app. Keys need the Accessibility
    /// permission of macOS; the mouse needs none.
    private func watchInput() {
        monitors.forEach(NSEvent.removeMonitor)
        monitors = []
        guard sharesInput else { return }
        let kinds: NSEvent.EventTypeMask = [.keyDown, .leftMouseDown, .rightMouseDown, .otherMouseDown, .scrollWheel, .mouseMoved, .leftMouseDragged]
        if let monitor = NSEvent.addGlobalMonitorForEvents(matching: kinds, handler: { [weak self] event in
            MainActor.assumeIsolated { self?.saw(event) }
        }) {
            monitors.append(monitor)
        }
        log.info("keyboard and mouse: shared\(Permission.accessibility.isGranted ? "" : ", but macOS has not given Accessibility, so no key arrives")")
    }

    private func saw(_ event: NSEvent) {
        let ephemeral = !keepsInput
        let point = NSEvent.mouseLocation
        let primary = NSScreen.screens.first?.frame.maxY ?? 0
        // points of the desktop from the top left of the first display, as Accessibility counts
        let place: [String: Any] = ["x": Int(point.x), "y": Int(primary - point.y)]
        switch event.type {
        case .keyDown:
            var payload: [String: Any] = ["keyCode": Int(event.keyCode), "isRepeat": event.isARepeat]
            if let key = event.charactersIgnoringModifiers, !key.isEmpty { payload["key"] = key }
            if let text = event.characters, !text.isEmpty { payload["text"] = text }
            let flags = event.modifierFlags
            let modifiers = [(NSEvent.ModifierFlags.command, "command"), (.option, "option"), (.control, "control"), (.shift, "shift")]
                .filter { flags.contains($0.0) }.map(\.1)
            if !modifiers.isEmpty { payload["modifiers"] = modifiers }
            if let app = NSWorkspace.shared.frontmostApplication?.localizedName { payload["app"] = app }
            publish("device/key-pressed", payload, ephemeral: ephemeral)
        case .leftMouseDown, .rightMouseDown, .otherMouseDown:
            var payload = place
            payload["button"] = event.type == .leftMouseDown ? "left" : event.type == .rightMouseDown ? "right" : "other"
            payload["clicks"] = event.clickCount
            if let app = NSWorkspace.shared.frontmostApplication?.localizedName { payload["app"] = app }
            publish("device/mouse-pressed", payload, ephemeral: ephemeral)
        case .scrollWheel:
            guard Date().timeIntervalSince(lastMoveAt) > 0.1 else { return }
            lastMoveAt = Date()
            var payload = place
            payload["dx"] = Int(event.scrollingDeltaX)
            payload["dy"] = Int(event.scrollingDeltaY)
            publish("device/scrolled", payload, ephemeral: ephemeral)
        case .mouseMoved, .leftMouseDragged:
            // at most ten a second: a mouse reports hundreds
            guard Date().timeIntervalSince(lastMoveAt) > 0.1 else { return }
            lastMoveAt = Date()
            publish("device/mouse-moved", place, ephemeral: ephemeral)
        default:
            break
        }
    }

    // MARK: - The publisher

    /// One event on the device's context. Other parts of the app that tell the mind about the
    /// device publish through here, so that there is one connection and one path.
    func publish(_ type: String, _ payload: [String: Any], ephemeral: Bool) {
        guard let input = input ?? startPublisher() else { return }
        var event: [String: Any] = ["type": type, "payload": payload]
        if ephemeral { event["ephemeral"] = true }
        guard let line = try? JSONSerialization.data(withJSONObject: event) else { return }
        try? input.write(contentsOf: line + Data("\n".utf8))
    }

    private func startPublisher() -> FileHandle? {
        guard let destination = destination() else { return nil }
        let process = Process()
        let stdin = Pipe()
        let stdout = Pipe()
        process.executableURL = URL(fileURLWithPath: destination.node)
        process.arguments = [destination.publisher, destination.name, "--iterate", destination.iterateBin, "--mind", destination.mind]
        process.standardInput = stdin
        process.standardOutput = stdout
        process.standardError = FileHandle.nullDevice
        stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let text = String(decoding: handle.availableData, as: UTF8.self)
            DispatchQueue.main.async { MainActor.assumeIsolated { self?.publisherSaid(text) } }
        }
        process.terminationHandler = { [weak self] ended in
            stdout.fileHandleForReading.readabilityHandler = nil
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    guard let self, self.publisher === ended else { return }
                    self.publisher = nil
                    self.input = nil
                    // the next presence event starts it again
                    self.presence = nil
                }
            }
        }
        guard (try? process.run()) != nil else {
            failure = "The publisher did not start."
            return nil
        }
        publisher = process
        publishesTo = destination
        input = stdin.fileHandleForWriting
        log.info("publishes to \(destination.mind) at /devices/\(destination.name)")
        return input
    }

    private func publisherSaid(_ text: String) {
        var lines = (pending + text).components(separatedBy: "\n")
        pending = lines.removeLast()
        for line in lines {
            guard let said = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any] else { continue }
            if let count = said["sent"] as? Int {
                sent = count
                failure = nil
            }
            if let why = said["failed"] as? String {
                if failure != why { log.error("not published: \(why)") }
                failure = why
            }
        }
    }

    private func endPublisher() {
        try? input?.close()
        input = nil
        publisher = nil
        publishesTo = nil
        presence = nil
    }
}

/// The panel's rows for the device's events.
struct DeviceEventsSection: View {
    @ObservedObject var events: DeviceEvents

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text("EVENTS TO THE MIND").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
            HStack(spacing: 10) {
                Image(systemName: "person.wave.2").font(.system(size: 14)).frame(width: 20).foregroundStyle(Color.accentColor)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Presence")
                    Text(events.presence.map { "Now: \($0). Each change is an event." } ?? "Idle, active, locked, asleep: when the Mac is lent")
                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 8)
                Text("Always").font(.caption).foregroundStyle(.secondary)
            }
            HStack(spacing: 10) {
                Image(systemName: "keyboard").font(.system(size: 14)).frame(width: 20).foregroundStyle(events.sharesInput ? Color.accentColor : Color.secondary)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Keyboard and mouse")
                    Text("Every key you type, click, move and scroll").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 8)
                Toggle("", isOn: $events.sharesInput).toggleStyle(.switch).controlSize(.small).labelsHidden()
            }
            if events.sharesInput {
                Toggle("Keep these events in the mind's log", isOn: $events.keepsInput)
                    .toggleStyle(.checkbox)
                    .font(.caption)
                    .padding(.leading, 30)
                    .help("Off: an event reaches whoever listens at that moment, and is in no log")
                if !Permission.accessibility.isGranted {
                    Label("macOS has not allowed Accessibility yet: no key arrives", systemImage: "exclamationmark.triangle.fill")
                        .font(.caption).foregroundStyle(.orange).padding(.leading, 30)
                }
            }
            if let path = events.path {
                Text(events.failure.map { "Not published: \($0)" } ?? "\(path) · \(events.sent) sent")
                    .font(.caption)
                    .foregroundStyle(events.failure == nil ? Color.secondary : Color.orange)
                    .lineLimit(2)
                    .textSelection(.enabled)
            }
        }
    }
}
