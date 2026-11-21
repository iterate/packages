import AppKit
import Record
import SwiftUI

/// THE RECORD OF THIS MAC, streamed into the mind it is lent to (`Sources/Record`): its screens,
/// cameras, microphones and speakers, each a switch of its own in the panel, all off until the
/// person turns one on. It records only while the Mac is lent to a mind, into that mind, and starts
/// again by itself when the app starts. A source whose permission macOS has not given stays off.
/// Screens and cameras pause while the Mac is locked or its displays sleep (the device's
/// presence); microphones and speakers go on.
///
/// The recorder writes 30-second files into a spool on this Mac
/// (`~/Library/Application Support/iterate-mac-app/record/<mind>/`); `bridge/record-upload.mjs`
/// puts them into the mind's files under `/devices/<name>/record/` and appends one
/// `record/slot-stored` for each slot to `/devices/<name>`, as the person (the CLI's own sign-in).
@MainActor
final class DeviceRecord: ObservableObject {
    struct Destination: Equatable {
        let node: String
        let iterateBin: String
        let uploader: String
        let mind: String
        let name: String
    }

    /// One switch of the panel: its source, its permission, its words.
    struct Switch: Identifiable {
        let source: RecordSource
        let title: String
        let symbol: String
        let permission: Permission
        var id: String { source.rawValue }
    }

    static let switches = [
        Switch(source: .screens, title: "Screens", symbol: "display", permission: .screenRecording),
        Switch(source: .cameras, title: "Camera", symbol: "video", permission: .camera),
        Switch(source: .mics, title: "Microphone", symbol: "mic", permission: .microphone),
        Switch(source: .speakers, title: "Speakers", symbol: "speaker.wave.2", permission: .screenRecording),
    ]

    /// The switches that are on, remembered across restarts.
    @Published private(set) var on: Set<RecordSource> = Set(
        RecordSource.allCases.filter { UserDefaults.standard.bool(forKey: "record.\($0.rawValue)") })
    /// The quiet line of state under the switches.
    @Published private(set) var line = "Off"
    @Published private(set) var isRecording = false

    var destination: () -> Destination? = { nil }
    /// The device's presence: "active", "idle", "locked", "asleep" (`DeviceEvents.presence`).
    var presence: () -> String? = { nil }
    var onChange: () -> Void = {}

    private let log = AppLog("record")
    /// Recorders start and stop here, one after the other: a stop waits for the last files.
    private let lifecycle = DispatchQueue(label: "record.lifecycle")
    private var recorder: Recorder?
    private var recordsTo: Destination?
    private var running: Set<RecordSource> = []
    private var paused = false
    private var uploader: Process?
    private var uploaderInput: FileHandle?
    private var uploaderEndedAt = Date.distantPast
    private var uploadFailure: String?
    private var pending = ""
    private var timer: Timer?

    func isOn(_ source: RecordSource) -> Bool { on.contains(source) }

    func set(_ source: RecordSource, _ value: Bool) {
        UserDefaults.standard.set(value, forKey: "record.\(source.rawValue)")
        if value { on.insert(source) } else { on.remove(source) }
        log.info("\(source.rawValue): \(value ? "on" : "off")")
        tick()
    }

    func start() {
        recordLog = { line in AppLog("record").info(line) }
        let timer = Timer(timeInterval: 2, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.tick() } }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
        tick()
    }

    /// At quit: the last files are written and sealed; the uploader sends them now or at the next start.
    func stop() {
        timer?.invalidate()
        if let recorder { lifecycle.sync { recorder.stop() } }
        recorder = nil
        try? uploaderInput?.close()
    }

    static func spool(for mind: String) -> URL {
        Lend.folder.appendingPathComponent("record").appendingPathComponent(mind)
    }

    /// Every 2 s, at each switch, and at once when the presence changes (`AppModel`).
    func tick() {
        let destination = destination()
        let wanted = destination == nil ? [] : Set(on.filter { source in Self.switches.first { $0.source == source }?.permission.isGranted ?? true })
        // another mind, or none: the record follows the lend
        if destination != recordsTo || wanted.isEmpty, let old = recorder {
            lifecycle.async { old.stop() }
            recorder = nil
            running = []
        }
        if destination != recordsTo { endUploader() }
        recordsTo = destination
        if let destination, !wanted.isEmpty {
            if recorder == nil {
                let recorder = Recorder(options: RecordOptions(spool: Self.spool(for: destination.mind), device: destination.name))
                lifecycle.async { recorder.start() }
                self.recorder = recorder
                paused = false
            }
            if wanted != running {
                let recorder = recorder!
                lifecycle.async { recorder.set(wanted) }
                running = wanted
            }
            if let state = presence() {
                let shouldPause = state == "locked" || state == "asleep"
                if shouldPause != paused, let recorder {
                    paused = shouldPause
                    lifecycle.async { recorder.pause(shouldPause) }
                }
            }
        }
        let waiting = destination.map { Self.waiting(in: Self.spool(for: $0.mind)) } ?? 0
        if let destination, recorder != nil || waiting > 0 {
            if uploader == nil, Date().timeIntervalSince(uploaderEndedAt) > 10 { startUploader(destination) }
        } else {
            endUploader()
        }
        showState(waiting: waiting, destination: destination)
    }

    private func showState(waiting: Int, destination: Destination?) {
        var parts: [String] = []
        if destination == nil {
            parts.append(on.isEmpty ? "Off" : "Waits for the Mac to be lent to a mind")
        } else if let recorder {
            let tracks = recorder.trackIDs.count
            parts.append(paused ? "Paused: \(presence() ?? "locked")" : "Recording \(tracks) track\(tracks == 1 ? "" : "s")")
        } else {
            parts.append("Off")
        }
        if waiting > 0 { parts.append("\(waiting) slot\(waiting == 1 ? "" : "s") waiting") }
        if let uploadFailure, waiting > 0 { parts.append("upload failing: \(uploadFailure)") }
        let line = parts.joined(separator: " · ")
        let isRecording = recorder != nil
        if line != self.line { self.line = line }
        if isRecording != self.isRecording {
            self.isRecording = isRecording
            onChange()
        }
    }

    /// The slots in the spool that wait for the uploader.
    private static func waiting(in spool: URL) -> Int {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: spool.appendingPathComponent("slots").path)) ?? []
        return names.filter { $0.hasSuffix(".json") }.count
    }

    // MARK: - The uploader

    private func startUploader(_ destination: Destination) {
        let process = Process()
        let stdin = Pipe(), stdout = Pipe()
        process.executableURL = URL(fileURLWithPath: destination.node)
        process.arguments = [
            destination.uploader, Self.spool(for: destination.mind).path, "--name", destination.name, "--iterate", destination.iterateBin,
            "--mind", destination.mind,
        ]
        process.standardInput = stdin
        process.standardOutput = stdout
        process.standardError = FileHandle.nullDevice
        stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let text = String(decoding: handle.availableData, as: UTF8.self)
            DispatchQueue.main.async { MainActor.assumeIsolated { self?.uploaderSaid(text) } }
        }
        process.terminationHandler = { [weak self] ended in
            stdout.fileHandleForReading.readabilityHandler = nil
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    guard let self, self.uploader === ended else { return }
                    self.log.info("uploader ended (status \(ended.terminationStatus))")
                    (self.uploader, self.uploaderInput, self.uploaderEndedAt) = (nil, nil, Date())
                }
            }
        }
        guard (try? process.run()) != nil else {
            uploadFailure = "the uploader did not start"
            uploaderEndedAt = Date()
            return
        }
        uploader = process
        uploaderInput = stdin.fileHandleForWriting
        log.info("uploader: \(Self.spool(for: destination.mind).path) to \(destination.mind) at /devices/\(destination.name)")
    }

    /// Its stdin closes: it ends the slot it is on, then exits.
    private func endUploader() {
        guard uploader != nil else { return }
        try? uploaderInput?.close()
        // a new one waits: the old one may still be on its last slot
        (uploaderInput, uploader, uploaderEndedAt) = (nil, nil, Date())
    }

    private func uploaderSaid(_ text: String) {
        var lines = (pending + text).components(separatedBy: "\n")
        pending = lines.removeLast()
        for line in lines {
            guard let said = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any] else { continue }
            if said["uploaded"] != nil { uploadFailure = nil }
            if let why = said["failed"] as? String {
                if uploadFailure != why { log.error("upload: \(why)") }
                uploadFailure = String(why.prefix(80))
            }
            if let slot = said["dropped"], let why = said["why"] as? String { log.error("upload: slot \(slot) dropped: \(why)") }
        }
    }
}

/// The panel's group "Record": a switch for each source, the window text, and one line of state.
struct RecordSection: View {
    @ObservedObject var record: DeviceRecord
    @ObservedObject var window: DeviceWindow
    let allow: (Permission) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text("RECORD").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
            ForEach(DeviceRecord.switches) { item in
                row(item.title, symbol: item.symbol, permission: item.permission, isOn: Binding(
                    get: { record.isOn(item.source) }, set: { record.set(item.source, $0) }))
            }
            VStack(alignment: .leading, spacing: 4) {
                Toggle("Window text: the text of the window in front", isOn: $window.readsWindowText)
                    .toggleStyle(.checkbox)
                    .help("On a new app or window, a click, a pause after typing, the end of a scroll; at most every 2 s. Never of a password manager.")
                Text("The app in front and its window's title go to the mind always, while the Mac is lent.")
                    .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            .font(.caption)
            .padding(.leading, 30)
            if window.readsWindowText, !Permission.accessibility.isGranted { missing(.accessibility) }
            Text(record.line).font(.caption).foregroundStyle(.secondary).lineLimit(2).textSelection(.enabled)
        }
    }

    private func row(_ title: String, symbol: String, permission: Permission, isOn: Binding<Bool>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 10) {
                Image(systemName: symbol).font(.system(size: 14)).frame(width: 20)
                    .foregroundStyle(isOn.wrappedValue && permission.isGranted ? Color.accentColor : Color.secondary)
                Text(title)
                Spacer(minLength: 8)
                Toggle("", isOn: isOn).toggleStyle(.switch).controlSize(.small).labelsHidden()
            }
            if isOn.wrappedValue, !permission.isGranted { missing(permission) }
        }
    }

    /// A source with no permission says so in its row and stays off.
    private func missing(_ permission: Permission) -> some View {
        HStack(spacing: 8) {
            Label("Off: macOS has not allowed \(permission.title)", systemImage: "exclamationmark.triangle.fill")
                .font(.caption).foregroundStyle(.orange)
            Spacer()
            Button("Allow…") { allow(permission) }.controlSize(.small)
        }
        .padding(.leading, 30)
    }
}
