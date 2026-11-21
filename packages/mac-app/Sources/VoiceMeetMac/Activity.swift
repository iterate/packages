import AppKit
import SwiftUI

/// WHAT A MIND DID WITH THIS MAC, as the person sees it: one line for each act of a caller of the
/// local endpoint ("Ran a command", "Took a picture of the display"), with its time.
///
/// Each act shows twice. While it runs and for a few seconds after, a pill at the top right of the
/// screen names it, with the face of the mind the Mac is lent to. And the panel lists the last
/// acts under "Activity". The list is in memory alone: it starts empty with the app.
@MainActor
final class ActivityLog: ObservableObject {
    struct Entry: Identifiable, Equatable {
        let id: Int
        let at: Date
        /// The thing of the Mac that was used: its symbol leads the line.
        let symbol: String
        /// What is done, while it runs: "Taking a picture of the display “Built-in”".
        let doing: String
        /// The same when it is over: "Took a picture of the display “Built-in”".
        let did: String
        /// More of it, on a second line: a command's words.
        let detail: String?
        /// The mind the Mac was lent to, by its address.
        let mind: String?
        /// When the act was over; nil while it runs.
        var endedAt: Date?
        /// Why it failed, when it did.
        var failure: String?

        var isRunning: Bool { endedAt == nil }
    }

    /// The newest first, at most `kept`.
    @Published fileprivate(set) var entries: [Entry] = []
    /// The mind the Mac is lent to now, by its address.
    var mind: () -> String? = { nil }

    private static let kept = 50
    private var next = 1
    private let pill = ActivityPillWindow()
    /// The person's choice in the panel: each act shows in a pill on the screen. Off: the panel's
    /// list and the red 𝑖 in the menu bar alone.
    @Published var showsPill = UserDefaults.standard.object(forKey: "activity.pill") as? Bool ?? true {
        didSet {
            UserDefaults.standard.set(showsPill, forKey: "activity.pill")
            if !showsPill { pill.close() }
        }
    }

    /// An act starts. The answer names it for `ended`.
    func began(_ thing: Shareable, doing: String, did: String, detail: String? = nil) -> Int {
        let entry = Entry(id: next, at: Date(), symbol: thing.symbol, doing: doing, did: did, detail: detail, mind: mind(), endedAt: nil, failure: nil)
        next += 1
        entries = Array(([entry] + entries).prefix(Self.kept))
        if showsPill { pill.show(entries, newAct: entry.id) }
        return entry.id
    }

    /// The act is over, well or with a failure.
    func ended(_ id: Int, failure: String? = nil) {
        guard let index = entries.firstIndex(where: { $0.id == id }) else { return }
        entries[index].endedAt = Date()
        entries[index].failure = failure
        if showsPill { pill.show(entries) }
    }

    func stop() {
        pill.close()
    }
}

/// The pill at the top right of the screen with the pointer: the acts that run, or the last one
/// for a few seconds after its end. Its × hides it until the next act begins, also while an act
/// runs on. A picture of the screen that a mind takes does not show it.
@MainActor
private final class ActivityPillWindow {
    /// How long the last act stays after its end.
    private static let lingers: TimeInterval = 4
    private var panel: NSPanel?
    private let shown = ShownActivity()
    private var hide: DispatchWorkItem?
    /// The act that was showing when the person pressed ×: the pill stays away until a newer one.
    private var dismissedUpTo = 0

    func show(_ entries: [ActivityLog.Entry], newAct: Int? = nil) {
        if let newAct, newAct <= dismissedUpTo { return }
        guard newAct != nil || (entries.first?.id ?? 0) > dismissedUpTo else { return }
        let running = entries.filter(\.isRunning)
        guard let lead = running.first ?? entries.first else { return close() }
        shown.entry = lead
        shown.others = max(running.count - 1, 0)
        let screen = NSScreen.screens.first { $0.frame.contains(NSEvent.mouseLocation) } ?? NSScreen.main
        let width: CGFloat = 340
        let height: CGFloat = lead.detail == nil ? 40 : 56
        let frame = NSRect(
            x: (screen?.visibleFrame.maxX ?? 800) - width - 12, y: (screen?.visibleFrame.maxY ?? 600) - height - 10, width: width, height: height)
        let panel = self.panel ?? makePanel(frame)
        self.panel = panel
        panel.setFrame(frame, display: true)
        panel.orderFrontRegardless()
        hide?.cancel()
        // while an act runs the pill stays
        guard running.isEmpty else { return }
        let work = DispatchWorkItem { [weak self] in self?.close() }
        hide = work
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.lingers, execute: work)
    }

    func close() {
        hide?.cancel()
        panel?.orderOut(nil)
    }

    private func dismiss() {
        dismissedUpTo = shown.entry?.id ?? dismissedUpTo
        close()
    }

    private func makePanel(_ frame: NSRect) -> NSPanel {
        let panel = NSPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.level = NSWindow.Level(rawValue: NSWindow.Level.statusBar.rawValue + 1)
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        // only the × takes a click; the pill is small and at the edge
        panel.ignoresMouseEvents = false
        // not in a picture or a recording of the screen: the mind asked for the screen, not for this
        panel.sharingType = .none
        panel.contentView = NSHostingView(rootView: ActivityPillView(shown: shown, dismiss: { [weak self] in self?.dismiss() }))
        return panel
    }
}

@MainActor
private final class ShownActivity: ObservableObject {
    @Published var entry: ActivityLog.Entry?
    /// How many more acts run beside the one shown.
    @Published var others = 0
}

private struct ActivityPillView: View {
    @ObservedObject var shown: ShownActivity
    var dismiss: () -> Void = {}

    var body: some View {
        HStack(spacing: 9) {
            if let entry = shown.entry {
                if let mind = entry.mind { MindAvatar(mind: mind, size: 24) }
                VStack(alignment: .leading, spacing: 1) {
                    Text(ActivityLine.title(of: entry) + (shown.others > 0 ? " · \(shown.others) more" : ""))
                        .font(.system(size: 13, weight: .medium))
                        .lineLimit(1)
                    if let detail = entry.detail {
                        Text(detail).font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                    }
                }
                Spacer(minLength: 0)
                if entry.isRunning { ProgressView().controlSize(.small) }
                Button(action: dismiss) {
                    Image(systemName: "xmark").font(.system(size: 10, weight: .bold)).foregroundStyle(.secondary)
                        .frame(width: 18, height: 18).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help("Hide until the next act. The panel's Activity keeps the list.")
            }
        }
        .padding(.leading, 8)
        .padding(.trailing, 12)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(.separator))
    }
}

/// One act as words.
enum ActivityLine {
    static func title(of entry: ActivityLog.Entry) -> String {
        if let failure = entry.failure { return "\(entry.did): \(failure)" }
        return entry.isRunning ? entry.doing : entry.did
    }

    /// How long an act took, when that is worth a word: a second or more.
    static func took(_ entry: ActivityLog.Entry) -> String? {
        guard let endedAt = entry.endedAt else { return "now" }
        let seconds = endedAt.timeIntervalSince(entry.at)
        return seconds < 1 ? nil : seconds < 60 ? "\(Int(seconds.rounded())) s" : "\(Int(seconds / 60)) min"
    }
}

/// The panel's "Activity": a line that opens the list of the last acts, each with its time.
struct ActivityList: View {
    @ObservedObject var log: ActivityLog
    @Binding var isOpen: Bool
    /// How many acts the open list shows.
    var shown = 8

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                isOpen.toggle()
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                        .rotationEffect(.degrees(isOpen ? 90 : 0))
                        .foregroundStyle(.secondary)
                    Text("Activity").font(.subheadline.weight(.semibold))
                    if let last = log.entries.first, !isOpen {
                        Text("\(ActivityLine.title(of: last)), \(Self.clock(last.at))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }
                    Spacer(minLength: 0)
                    if !log.entries.isEmpty {
                        Text("\(log.entries.count)").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("What a mind did with this Mac since the app started")
            if isOpen {
                Toggle("Show each act on the screen", isOn: $log.showsPill).toggleStyle(.checkbox).font(.caption)
                if log.entries.isEmpty {
                    Text("No mind has used this Mac since the app started.").font(.caption).foregroundStyle(.secondary)
                }
                ForEach(log.entries.prefix(shown)) { entry in row(entry) }
                if log.entries.count > shown {
                    Text("and \(log.entries.count - shown) before these").font(.caption).foregroundStyle(.tertiary)
                }
            }
        }
    }

    private func row(_ entry: ActivityLog.Entry) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(Self.clock(entry.at)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            Image(systemName: entry.symbol).font(.caption).frame(width: 16).foregroundStyle(entry.isRunning ? Color.red : Color.secondary)
            VStack(alignment: .leading, spacing: 1) {
                Text(ActivityLine.title(of: entry)).font(.caption).lineLimit(2)
                if let detail = entry.detail {
                    Text(detail).font(.system(size: 10, design: .monospaced)).foregroundStyle(.secondary).lineLimit(2).truncationMode(.middle).textSelection(.enabled)
                }
            }
            Spacer(minLength: 0)
            if let took = ActivityLine.took(entry) { Text(took).font(.caption.monospacedDigit()).foregroundStyle(.tertiary) }
        }
    }

    private static func clock(_ date: Date) -> String {
        date.formatted(date: .omitted, time: .standard)
    }
}

extension ActivityLog {
    /// Draws the pill and the panel's open list to PNG files in `folder`, with sample acts, in
    /// light and dark: a look with no Mac bar (`--render-activity <folder>`).
    static func render(to folder: URL) -> Bool {
        _ = NSApplication.shared
        let log = ActivityLog()
        let now = Date()
        log.entries = [
            Entry(id: 4, at: now, symbol: Shareable.commands.symbol, doing: "Running a command", did: "Ran a command", detail: "/bin/zsh -lc git -C ~/src/app status --short", mind: "iterate.com", endedAt: nil, failure: nil),
            Entry(id: 3, at: now.addingTimeInterval(-42), symbol: "display", doing: "", did: "Took a picture of the display “Built-in Retina Display”", detail: nil, mind: "iterate.com", endedAt: now.addingTimeInterval(-41.6), failure: nil),
            Entry(id: 2, at: now.addingTimeInterval(-95), symbol: Shareable.microphone.symbol, doing: "", did: "Listened to the microphone for 5 s", detail: nil, mind: "iterate.com", endedAt: now.addingTimeInterval(-90), failure: nil),
            Entry(id: 1, at: now.addingTimeInterval(-300), symbol: Shareable.commands.symbol, doing: "", did: "Ran a command", detail: "/usr/bin/false", mind: "iterate.com", endedAt: now.addingTimeInterval(-299), failure: "it ended with status 1"),
        ]
        let shown = ShownActivity()
        shown.entry = log.entries.first
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        var drawn = true
        for (dark, tone) in [(false, "light"), (true, "dark")] {
            let views: [(String, NSView)] = [
                ("pill", NSHostingView(rootView: ActivityPillView(shown: shown).frame(width: 340, height: 56).padding(12).background(Color(nsColor: .windowBackgroundColor)))),
                ("list", NSHostingView(rootView: ActivityList(log: log, isOpen: .constant(true)).frame(width: 398).padding(16).background(Color(nsColor: .windowBackgroundColor)))),
            ]
            for (name, view) in views {
                let appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
                view.appearance = appearance
                let window = NSWindow(contentRect: NSRect(origin: .zero, size: view.fittingSize), styleMask: [.borderless], backing: .buffered, defer: false)
                window.appearance = appearance
                window.contentView = view
                view.layoutSubtreeIfNeeded()
                guard let picture = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return false }
                view.cacheDisplay(in: view.bounds, to: picture)
                let file = folder.appendingPathComponent("activity-\(name)-\(tone).png")
                drawn = drawn && (picture.representation(using: .png, properties: [:]).map { (try? $0.write(to: file)) != nil } ?? false)
            }
        }
        return drawn
    }
}
