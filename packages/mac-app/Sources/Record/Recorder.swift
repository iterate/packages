import AppKit
import Foundation

/// What a recorder may record. Each one is a switch of its own.
public enum RecordSource: String, CaseIterable, Sendable {
    case screens, cameras, mics, speakers
    /// A source that needs no permission: a moving picture `test-1` and a beep each second `test-2`.
    case synthetic

    /// The beginning of the ids of its tracks.
    var prefix: String {
        switch self {
        case .screens: return "screen-"
        case .cameras: return "camera-"
        case .mics: return "mic-"
        case .speakers: return "speaker-"
        case .synthetic: return "test-"
        }
    }
}

public struct RecordOptions: Sendable {
    /// The spool of one mind: a file's path here is its path in the mind's files.
    public var spool: URL
    /// The device's name in the mind: `/devices/<device>`.
    public var device: String
    public var fps = 10
    public var quality = 0.45
    public var keyframeSeconds = 10.0
    public var pictureWidth = 640
    public var cameraHeight = 720
    public var cameraFps = 15
    public var maxWidth: Int?
    public var exclude = ExcludeList()

    public init(spool: URL, device: String) {
        self.spool = spool
        self.device = device
    }
}

/// Records the sources that are switched on into the spool: one file per track per 30-second slot,
/// a picture per video file, and for each slot ONE file `slots/<t>.json`, the payload of the event
/// `record/slot-stored`, once every track of the slot has closed. The uploader
/// (`bridge/record-upload.mjs`) takes it from there.
///
/// Who owns what: `lock` guards `sources`, `tracks` and `paused`. `slots` (a queue) owns the open
/// slots and every write to the spool, in this order: the media file, its picture, the slot's
/// `.open` file (its entries so far, so that a crash keeps what was written), and at the seal its
/// rename to `.json`. A slot that is sealed takes nothing more, also after a restart (`sealed`).
public final class Recorder: @unchecked Sendable {
    public let options: RecordOptions
    let clock = HostClock.shared
    private let lock = NSLock()
    private var sources: [RecordSource: Source] = [:]
    private var tracks: [Track] = []
    private var paused = false
    private let control = DispatchQueue(label: "record.control")
    private let slots = DispatchQueue(label: "record.slots")
    private var entries: [Int64: [String: [String: Any]]] = [:]
    private var open: [Int64: Set<String>] = [:]
    private var sealed: Int64 = -1
    private let tickQueue = DispatchQueue(label: "record.tick")
    private var timer: DispatchSourceTimer?
    private var observers: [(NotificationCenter, NSObjectProtocol)] = []
    private var activity: NSObjectProtocol?

    public init(options: RecordOptions) {
        self.options = options
    }

    var isPaused: Bool { lock.withLock { paused } }
    func add(_ track: Track) { lock.withLock { tracks.append(track) } }
    func track(_ id: String) -> Track? { lock.withLock { tracks.first { $0.id == id } } }

    /// The ids of the tracks that record now.
    public var trackIDs: [String] { lock.withLock { tracks.map(\.id) } }

    public func start() {
        // Slot ends are timed work: App Nap would delay the timer of a process in the background.
        activity = ProcessInfo.processInfo.beginActivity(options: .userInitiatedAllowingIdleSystemSleep, reason: "recording")
        slots.sync { recover() }
        for (center, name, reason) in [
            (NotificationCenter.default, Notification.Name.NSSystemClockDidChange, "clock set"),
            // Host time stood still while the Mac slept.
            (NSWorkspace.shared.notificationCenter, NSWorkspace.didWakeNotification, "wake"),
        ] {
            observers.append((center, center.addObserver(forName: name, object: nil, queue: nil) { [weak self] _ in self?.clockChanged(reason) }))
        }
        let timer = DispatchSource.makeTimerSource(queue: tickQueue)
        timer.schedule(deadline: .now() + 0.1, repeating: 0.1)
        var ticks = 0
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            for track in self.lock.withLock({ self.tracks }) { track.tick() }
            ticks += 1
            if ticks % 10 == 0 { self.slots.async { self.sealStale() } }
            // A clock set that came with no notification, or a slow drift of the host clock.
            if ticks % 100 == 0, abs(self.clock.drift()) > 250 { self.clockChanged("drift") }
        }
        timer.resume()
        self.timer = timer
        log("record: device \(options.device), spool \(options.spool.path), slots sealed up to \(sealed)")
    }

    /// Starts the sources that are in `wanted` and stops the others, each with its tracks: a track
    /// that stops writes what it has, and its slot is sealed when its other tracks close.
    public func set(_ wanted: Set<RecordSource>) {
        control.async {
            let running = Set(self.lock.withLock { self.sources.keys })
            for kind in running.subtracting(wanted) {
                guard let source = self.lock.withLock({ self.sources.removeValue(forKey: kind) }) else { continue }
                source.stop()
                let stopping = self.lock.withLock { () -> [Track] in
                    defer { self.tracks.removeAll { $0.id.hasPrefix(kind.prefix) } }
                    return self.tracks.filter { $0.id.hasPrefix(kind.prefix) }
                }
                for track in stopping { track.stop() }
                log("record: \(kind.rawValue) off")
            }
            for kind in wanted.subtracting(running) {
                let source: Source
                switch kind {
                case .screens: source = Screens(recorder: self)
                case .cameras: source = DeviceCapture(recorder: self, media: .video)
                case .mics: source = DeviceCapture(recorder: self, media: .audio)
                case .speakers: source = Speakers(recorder: self)
                case .synthetic: source = Synthetic(recorder: self)
                }
                self.lock.withLock { self.sources[kind] = source }
                source.start()
                log("record: \(kind.rawValue) on")
            }
        }
    }

    /// The Mac is locked or its displays sleep: screens and cameras pause and start again by
    /// themselves; a camera's capture stops, so its light is off. Microphones and speakers go on.
    public func pause(_ on: Bool) {
        let (changed, video, sources) = lock.withLock { () -> (Bool, [VideoTrack], [Source]) in
            defer { paused = on }
            return (paused != on, tracks.compactMap { $0 as? VideoTrack }.filter(\.pausable), Array(self.sources.values))
        }
        guard changed else { return }
        log(on ? "record: paused" : "record: resumed")
        for track in video { on ? track.pause() : track.resume() }
        for source in sources { on ? source.paused() : source.resumed() }
    }

    /// Stops every source and track, writes what is left and seals every slot.
    public func stop() {
        set([])
        control.sync {}
        timer?.cancel()
        tickQueue.sync {}
        slots.sync {
            open = [:]
            for slot in entries.keys.sorted() { seal(slot) }
        }
        for (center, observer) in observers { center.removeObserver(observer) }
        if let activity { ProcessInfo.processInfo.endActivity(activity) }
        log("record: stopped")
    }

    /// A new anchor for the timeline. Audio follows it by itself (`Resync`). Forward, slots are
    /// skipped. Backward, the tracks write nothing until the timeline passes what they wrote last.
    /// A jump of more than 1 s also ends each video track's last frame at the jump.
    func clockChanged(_ reason: String) {
        let before = nowMs()
        let step = clock.reanchor()
        log(String(format: "record: clock %@, timeline moved %+.0f ms", reason, step))
        guard abs(step) > 1000 else { return }
        for video in lock.withLock({ tracks.compactMap { $0 as? VideoTrack } }) { video.clockJumped(at: before) }
    }

    // MARK: the slots and the spool (called by the tracks)

    /// Whether `track` may begin its file of `slot`: not in a slot that is sealed, nor twice in one
    /// slot (a source switched off and on again). Such a track begins with the next slot.
    func opening(track: String, slot: Int64) -> Bool {
        slots.sync {
            guard slot > sealed, entries[slot]?[track] == nil else {
                log("\(track): slot \(slot) is written already; this track begins with the next one")
                return false
            }
            open[slot, default: []].insert(track)
            return true
        }
    }

    /// The file of `track` for `slot` is whole: into the spool with its picture, then its entry.
    /// A file that cannot be written gets no entry.
    func finished(track: String, slot: Int64, parts: [Data], size: Int, entry: [String: Any], picture: Data?) {
        slots.sync {
            defer {
                open[slot]?.remove(track)
                if open[slot]?.isEmpty != false { seal(slot) }
            }
            let file = Slot.path(device: options.device, track: track, slot: slot, ext: "mp4")
            guard write(file, parts) else { return }
            var entry = entry
            entry["file"] = file
            entry["bytes"] = size
            let picturePath = Slot.path(device: options.device, track: track, slot: slot, ext: "jpg")
            if let picture, write(picturePath, [picture]) { entry["picture"] = picturePath }
            entries[slot, default: [:]][track] = entry
            _ = write("slots/\(slot).open", [Slot.event(t: slot, tracks: entries[slot]!)])
        }
    }

    /// On `slots`: the slot's event file is final. Its `.open` file becomes `.json`.
    private func seal(_ slot: Int64) {
        open[slot] = nil
        guard let tracks = entries.removeValue(forKey: slot) else { return }
        sealed = max(sealed, slot)
        _ = write("sealed", [Data("\(sealed)".utf8)])
        let from = url("slots/\(slot).open"), to = url("slots/\(slot).json")
        if rename(from.path, to.path) != 0 {
            log("record: slot \(slot): the event file could not be renamed (\(errno)); writing it again")
            if write("slots/\(slot).json", [Slot.event(t: slot, tracks: tracks)]) { try? FileManager.default.removeItem(at: from) }
        }
    }

    /// On `slots`, about once a second: a slot that ended more than 10 s ago with a track still
    /// "open" (a track that began it and never wrote it) is sealed with what it has.
    private func sealStale() {
        let limit = Int64(nowMs()) - Slot.ms - 10_000
        for slot in open.keys.sorted() where slot < limit { seal(slot) }
    }

    /// On `slots`, at start: what an earlier run left. Its open slots are sealed as they are (its
    /// open files were in memory and are gone), half-written files are deleted, and `sealed` is the
    /// newest slot it sealed.
    private func recover() {
        sealed = Int64((try? String(contentsOf: url("sealed"), encoding: .utf8)) ?? "") ?? -1
        let walker = FileManager.default.enumerator(at: options.spool, includingPropertiesForKeys: nil)
        var parts = 0
        while let file = walker?.nextObject() as? URL {
            if file.pathExtension == "part" {
                try? FileManager.default.removeItem(at: file)
                parts += 1
            } else if file.deletingLastPathComponent().lastPathComponent == "slots", let t = Int64(file.deletingPathExtension().lastPathComponent) {
                sealed = max(sealed, t)
                if file.pathExtension == "open" { rename(file.path, url("slots/\(t).json").path) }
            }
        }
        if parts > 0 { log("record: deleted \(parts) half-written files of an earlier run") }
    }

    func url(_ path: String) -> URL { options.spool.appendingPathComponent(path.hasPrefix("/") ? String(path.dropFirst()) : path) }

    /// Writes a file whole: its parts in order to `<name>.part`, then a rename. False when it could
    /// not: then nothing may refer to it. It tries twice, because the uploader removes the folders
    /// it empties, and one can go between our making it and our writing into it.
    func write(_ path: String, _ parts: [Data]) -> Bool {
        let file = url(path), part = file.appendingPathExtension("part")
        func attempt() throws {
            try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            guard FileManager.default.createFile(atPath: part.path, contents: nil) else { throw CocoaError(.fileWriteUnknown) }
            let handle = try FileHandle(forWritingTo: part)
            defer { try? handle.close() }
            for data in parts { try handle.write(contentsOf: data) }
            try handle.synchronize()
            guard rename(part.path, file.path) == 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
        }
        do {
            do { try attempt() } catch { try attempt() }
            return true
        } catch {
            try? FileManager.default.removeItem(at: part)
            log("record: cannot write \(path): \(error.localizedDescription)")
            return false
        }
    }

    /// A stable number for a capture device, so that its track id is the same after a restart.
    /// Kept in `devices.json` of the spool. Callers ask for built-in devices first, then by unique
    /// id: a first start numbers them so.
    func number(_ kind: String, device uid: String) -> Int {
        slots.sync {
            let file = url("devices.json")
            var map = (try? Data(contentsOf: file)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Int] } ?? [:]
            if let n = map["\(kind)/\(uid)"] { return n }
            let taken = Set(map.filter { $0.key.hasPrefix("\(kind)/") }.values)
            let n = (0...).first { !taken.contains($0) }!
            map["\(kind)/\(uid)"] = n
            if let data = try? JSONSerialization.data(withJSONObject: map, options: .sortedKeys) { _ = write("devices.json", [data]) }
            return n
        }
    }
}

/// One kind of source behind one switch.
protocol Source: AnyObject {
    func start()
    /// Stops the capture; the recorder then stops the source's tracks.
    func stop()
    /// The Mac is locked or its displays sleep (after the tracks paused).
    func paused()
    /// After an unlock or a wake: open again what could not open (a locked Mac lists no display).
    func resumed()
}

extension Source {
    func paused() {}
    func resumed() {}
}
