import AppKit
import ApplicationServices
import Record

/// THE WINDOW IN FRONT, told to the mind as two events on `/devices/<name>` (`DeviceEvents`):
///
/// - `device/app-focused { app, bundle, title }`: the front app or its window's title changed.
///   Always while the Mac is lent, and kept, like presence. The title needs Accessibility; without
///   it the title is empty.
/// - `device/window-read { app, title, text, trigger }`: the front window's text, when the person
///   ticked "Window text" (off by default). On a new app or window, a click, a pause after typing
///   and the end of a scroll; at most once every 2 s, only when the text changed, cut to 20,000
///   characters.
///
/// An excluded app in front (a password manager: `ExcludeList`) is told as `{ app, bundle }` with
/// no title, so that the run of the app before it ends; its window is never read. Every
/// Accessibility call runs on a queue of its own: an app that does not answer holds no other work.
@MainActor
final class DeviceWindow: ObservableObject {
    nonisolated static let maxCharacters = 20_000

    @Published var readsWindowText = UserDefaults.standard.bool(forKey: "device.windowText") {
        didSet {
            UserDefaults.standard.set(readsWindowText, forKey: "device.windowText")
            watchInput()
            if readsWindowText { trigger("window") }
        }
    }

    /// One event on the device's context (`DeviceEvents.publish`).
    var publish: (_ type: String, _ payload: [String: Any]) -> Void = { _, _ in }
    /// Whether the Mac is lent to a mind now.
    var isLent: () -> Bool = { false }

    private let exclude = ExcludeList()
    private struct Front: Equatable {
        let app, bundle: String
        /// nil for an excluded app
        let title: String?
    }
    private var front: Front?
    private var isChecking = false
    private var observer: NSObjectProtocol?
    private var timer: Timer?
    private var monitors: [Any] = []
    private var lastKey: Date?
    private var lastScroll: Date?
    /// Every Accessibility call runs here, the title's and the text's.
    private let reader = DispatchQueue(label: "device.window-read")
    private var lastRead = Date.distantPast
    private var waitingTrigger: String?
    private var lastText: String?

    func start() {
        observer = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
        ) { [weak self] _ in MainActor.assumeIsolated { self?.check() } }
        let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.tick() } }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
        watchInput()
    }

    func stop() {
        timer?.invalidate()
        if let observer { NSWorkspace.shared.notificationCenter.removeObserver(observer) }
        monitors.forEach(NSEvent.removeMonitor)
        monitors = []
    }

    private func tick() {
        check()
        let now = Date()
        if let key = lastKey, now.timeIntervalSince(key) >= 1 {
            lastKey = nil
            trigger("typing-pause")
        }
        if let scroll = lastScroll, now.timeIntervalSince(scroll) >= 0.3 {
            lastScroll = nil
            trigger("scroll-end")
        }
    }

    /// The front app and its window's title; an event when either changed.
    private func check() {
        guard isLent(), let app = NSWorkspace.shared.frontmostApplication else { return front = nil }
        guard !isChecking else { return }
        isChecking = true
        let bundle = app.bundleIdentifier ?? "", pid = app.processIdentifier
        let name = app.localizedName ?? bundle, isExcluded = exclude.excludes(bundle)
        reader.async { [weak self] in
            // a password manager's title is never read
            let title = isExcluded ? nil : Self.title(of: pid) ?? ""
            DispatchQueue.main.async {
                MainActor.assumeIsolated { self?.checked(Front(app: name, bundle: bundle, title: title)) }
            }
        }
    }

    private func checked(_ now: Front) {
        isChecking = false
        guard isLent(), now != front else { return }
        let trigger = now.bundle == front?.bundle ? "window" : "app"
        front = now
        var payload: [String: Any] = ["app": now.app, "bundle": now.bundle]
        if let title = now.title { payload["title"] = title }
        publish("device/app-focused", payload)
        if now.title != nil { self.trigger(trigger) }
    }

    nonisolated private static func title(of pid: pid_t) -> String? {
        guard Permission.accessibility.isGranted else { return nil }
        let element = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(element, 0.3)
        guard let window = Accessibility.attribute(element, kAXFocusedWindowAttribute), CFGetTypeID(window) == AXUIElementGetTypeID() else { return nil }
        return Accessibility.attribute(window as! AXUIElement, kAXTitleAttribute) as? String
    }

    /// Clicks, keys and scrolls only start a read: what they are is not kept here.
    private func watchInput() {
        monitors.forEach(NSEvent.removeMonitor)
        monitors = []
        guard readsWindowText else { return }
        let kinds: NSEvent.EventTypeMask = [.leftMouseDown, .rightMouseDown, .keyDown, .scrollWheel]
        if let monitor = NSEvent.addGlobalMonitorForEvents(matching: kinds, handler: { [weak self] event in
            MainActor.assumeIsolated {
                switch event.type {
                case .keyDown: self?.lastKey = Date()
                case .scrollWheel: self?.lastScroll = Date()
                default: self?.trigger("click")
                }
            }
        }) {
            monitors.append(monitor)
        }
    }

    // MARK: - The window's text

    /// At most one read every 2 s: a trigger inside that time waits for its end, and the newest
    /// trigger's name goes with the read.
    private func trigger(_ name: String) {
        guard readsWindowText, isLent(), Permission.accessibility.isGranted else { return }
        if waitingTrigger != nil { return waitingTrigger = name }
        let wait = lastRead.addingTimeInterval(2).timeIntervalSinceNow
        guard wait > 0 else { return read(name) }
        waitingTrigger = name
        DispatchQueue.main.asyncAfter(deadline: .now() + wait) { [weak self] in
            MainActor.assumeIsolated {
                guard let self, let name = self.waitingTrigger else { return }
                self.waitingTrigger = nil
                self.read(name)
            }
        }
    }

    private func read(_ trigger: String) {
        lastRead = Date()
        // The app checked is the one whose window is read.
        guard let app = NSWorkspace.shared.frontmostApplication, !exclude.excludes(app.bundleIdentifier) else { return }
        let name = app.localizedName ?? app.bundleIdentifier ?? ""
        reader.async { [weak self] in
            let element = AXUIElementCreateApplication(app.processIdentifier)
            AXUIElementSetMessagingTimeout(element, 0.5)
            guard let window = Accessibility.attribute(element, kAXFocusedWindowAttribute), CFGetTypeID(window) == AXUIElementGetTypeID() else { return }
            var budget = 5_000
            let tree = Accessibility.describe(window as! AXUIElement, depth: 40, budget: &budget)
            var lines: [String] = []
            Self.text(of: tree, into: &lines)
            let text = String(lines.joined(separator: "\n").prefix(Self.maxCharacters))
            let title = tree["title"] as? String ?? ""
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    guard let self, text != self.lastText else { return }
                    self.lastText = text
                    self.publish("device/window-read", ["app": name, "title": title, "text": text, "trigger": trigger])
                }
            }
        }
    }

    /// Plain text of an accessibility tree: titles, values and descriptions in tree order, without
    /// repeats in a row.
    nonisolated private static func text(of node: [String: Any], into lines: inout [String]) {
        for key in ["title", "value", "description"] {
            if let text = node[key] as? String, text != lines.last { lines.append(text) }
        }
        for child in node["children"] as? [[String: Any]] ?? [] { text(of: child, into: &lines) }
    }
}
