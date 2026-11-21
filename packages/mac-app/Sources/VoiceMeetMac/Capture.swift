import AVFoundation
import AppKit
import ApplicationServices
import Carbon.HIToolbox
import ScreenCaptureKit
import SwiftUI

/// ⌥⇧S in any app: a Carbon hot key, which needs no permission of macOS.
@MainActor
enum CaptureHotKey {
    static var pressed: () -> Void = {}

    /// False when macOS refuses the key.
    static func register() -> Bool {
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(
            GetApplicationEventTarget(),
            { _, _, _ in
                DispatchQueue.main.async { MainActor.assumeIsolated { CaptureHotKey.pressed() } }
                return noErr
            }, 1, &spec, nil, nil)
        var key: EventHotKeyRef?
        // the signature is "itxc"
        let id = EventHotKeyID(signature: 0x6974_7863, id: 1)
        return RegisterEventHotKey(UInt32(kVK_ANSI_S), UInt32(optionKey | shiftKey), id, GetApplicationEventTarget(), 0, &key) == noErr
    }
}

/// What the pill at the top of the display says.
@MainActor
final class CapturePill: ObservableObject {
    @Published var text = ""
    /// The mind the capture goes into, by its address: the pill shows its face.
    @Published var mind: String?
    @Published var startedAt: Date?
    /// The part of the bytes that went up, while the capture is sent.
    @Published var progress: Double?
}

/// A CAPTURE, made by the person: ⌥⇧S, then talk, click and draw (hold ⇧ and move the mouse: no
/// button), then ⌥⇧S again.
/// The gesture is Scrawl's, by Kit Langton (github.com/kitlangton/scrawl).
///
/// A capture is a folder with `capture.json` and the files it names. `capture.json` holds the
/// OBSERVATIONS, each with its time in milliseconds from the start: the screen (a movie), the voice,
/// the window in front (the app, its title, a browser's page, its accessibility tree), each click
/// and each ink mark with the accessibility element under it, and sharp pictures of the display at
/// those moments. The ink is on the screen, so the movie and the pictures show it.
///
/// `bridge/capture-upload.mjs` runs beside the capture from its start: it puts each picture into
/// the mind as soon as it exists, and the rest at the end, as files under `/captures/<id>/`, and
/// answers the text that goes to the clipboard.
@available(macOS 15.0, *)
@MainActor
final class Capture: NSObject, SCStreamDelegate, SCStreamOutput, SCRecordingOutputDelegate {
    /// Where the capture goes: Node, the iterate CLI, the uploader, the mind and this Mac's name there.
    struct Destination {
        let node: String
        let iterateBin: String
        let uploader: String
        let mind: String
        let name: String
    }

    /// The uploader beside one capture: lines to its stdin, JSON lines from its stdout.
    private final class Uploader: @unchecked Sendable {
        let process = Process()
        private let input = Pipe()
        private let lock = NSLock()
        private var pending = ""

        init?(_ argv: [String], said: @escaping @MainActor ([String: Any]) -> Void, ended: @escaping @MainActor () -> Void) {
            let output = Pipe()
            process.executableURL = URL(fileURLWithPath: argv[0])
            process.arguments = Array(argv.dropFirst())
            process.standardInput = input
            process.standardOutput = output
            process.standardError = FileHandle.nullDevice
            output.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let text = String(decoding: handle.availableData, as: UTF8.self)
                DispatchQueue.main.async {
                    MainActor.assumeIsolated {
                        guard let self else { return }
                        var lines = (self.pending + text).components(separatedBy: "\n")
                        self.pending = lines.removeLast()
                        for line in lines {
                            if let object = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any] { said(object) }
                        }
                    }
                }
            }
            process.terminationHandler = { _ in
                output.fileHandleForReading.readabilityHandler = nil
                // after the last line that the handler above queued
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { MainActor.assumeIsolated { ended() } }
            }
            guard (try? process.run()) != nil else { return nil }
        }

        /// From the main thread, and from the voice's queue.
        func send(_ line: String) {
            lock.lock()
            defer { lock.unlock() }
            try? input.fileHandleForWriting.write(contentsOf: Data((line + "\n").utf8))
        }
    }

    /// The voice for the uploader, while the capture runs: the microphone's sound as 16 000
    /// samples a second, one channel, 16 bits. Used on the voice's queue alone.
    private final class Voice: @unchecked Sendable {
        let queue = DispatchQueue(label: "com.iterate.capture.voice")
        var uploader: Uploader?
        private var converter: AVAudioConverter?
        private let speech = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16_000, channels: 1, interleaved: true)!

        func take(_ sampleBuffer: CMSampleBuffer) {
            guard let uploader, let description = sampleBuffer.formatDescription else { return }
            let format = AVAudioFormat(cmAudioFormatDescription: description)
            if converter?.inputFormat != format { converter = AVAudioConverter(from: format, to: speech) }
            guard let converter else { return }
            try? sampleBuffer.withAudioBufferList { list, _ in
                guard let sound = AVAudioPCMBuffer(pcmFormat: format, bufferListNoCopy: list.unsafePointer),
                    let converted = AVAudioPCMBuffer(pcmFormat: speech, frameCapacity: AVAudioFrameCount(Double(sound.frameLength) * 16_000 / format.sampleRate) + 64)
                else { return }
                var isGiven = false
                converter.convert(to: converted, error: nil) { _, status in
                    status.pointee = isGiven ? .noDataNow : .haveData
                    isGiven = true
                    return sound
                }
                guard converted.frameLength > 0, let samples = converted.int16ChannelData?[0] else { return }
                uploader.send("audio " + Data(bytes: samples, count: Int(converted.frameLength) * 2).base64EncodedString())
            }
        }
    }

    static let folder = Lend.folder.appendingPathComponent("captures")
    /// A capture ends by itself after this long.
    static let maximumSeconds = 600.0

    private(set) var isRunning = false
    /// The last capture's outcome, for the panel.
    private(set) var lastLine: String?
    var onChange: () -> Void = {}
    var destination: () -> Destination? = { nil }
    /// The guide to a permission of macOS (the app's delegate has it).
    var allow: (Permission) -> Void = { _ in }

    private let log = AppLog("capture")
    private let pill = CapturePill()
    private var id = ""
    private var folder = Capture.folder
    private var zero = Date()
    private var screen: NSScreen?
    private var stream: SCStream?
    private var observations: [[String: Any]] = []
    private var displayID: CGDirectDisplayID = 0
    private var pictures = 0
    private var lastPictureAt = Date.distantPast
    private var uploader: Uploader?
    private let voice = Voice()
    private var sendingTo: String?
    /// The clipboard's change count after this capture's text went there: a later text of the same
    /// capture takes its place only while the person copied nothing else.
    private var copiedAt: Int?
    private var moveMonitor: Any?
    private var marks = 0
    /// The numbered pictures an agent looks at: one for each mark and each click, cut out of the
    /// display's picture around it.
    private var panels: [[String: Any]] = []
    private var panelsAsked = 0
    /// Every picture that is still being taken: the end waits for them.
    private var pictureTasks: [Task<Void, Never>] = []
    /// What a numbered picture shows. `box` and `click` are points of the display from its top left.
    private struct Panel {
        let n: Int
        let did: String
        let from: Int
        let t: Int
        let box: CGRect
        var click: CGPoint?
        var on: [String: Any]?
    }
    /// ⇧ is still down from ⌥⇧S at the start: ink waits until ⇧ was let go once.
    private var isInkArmed = false
    private var trees = 0
    private var windowKey = ""
    private var overlay: NSPanel?
    private var pillPanel: NSPanel?
    private var ink: InkView?
    private var timer: Timer?
    private var ticks = 0
    private var clickMonitor: Any?
    private var finished: CheckedContinuation<Void, Never>?
    private var isEnding = false

    /// ⌥⇧S: start, or end and send.
    func toggle() {
        Task { @MainActor in
            if isRunning { await end(send: true) } else { await start() }
        }
    }

    // MARK: - Start

    private func start() async {
        guard !isEnding else { return }
        guard Permission.screenRecording.isGranted else { return allow(.screenRecording) }
        if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined { _ = await AVCaptureDevice.requestAccess(for: .audio) }
        // the display under the pointer
        let pointer = NSEvent.mouseLocation
        guard let screen = NSScreen.screens.first(where: { $0.frame.contains(pointer) }) ?? NSScreen.main,
            let displayID = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID
        else { return }
        let stamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: "-", with: "").replacingOccurrences(of: ":", with: "")
        id = "\(stamp)-\(String(format: "%04x", UInt16.random(in: 0...UInt16.max)))"
        folder = Self.folder.appendingPathComponent(id)
        // A capture stays on this Mac for an agent here to read, for 7 days.
        for old in (try? FileManager.default.contentsOfDirectory(at: Self.folder, includingPropertiesForKeys: [.contentModificationDateKey])) ?? [] {
            if let changed = try? old.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate, changed < Date().addingTimeInterval(-7 * 86_400) {
                try? FileManager.default.removeItem(at: old)
            }
        }
        do {
            try FileManager.default.createDirectory(at: folder.appendingPathComponent("pictures"), withIntermediateDirectories: true)
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            guard let display = content.displays.first(where: { $0.displayID == displayID }) else { return fail("That display is not connected.") }
            let filter = SCContentFilter(display: display, excludingWindows: [])
            let configuration = SCStreamConfiguration()
            // a small movie: the pictures are the sharp part
            let scale = min(CGFloat(filter.pointPixelScale), 1600 / filter.contentRect.width)
            configuration.width = Int(filter.contentRect.width * scale)
            configuration.height = Int(filter.contentRect.height * scale)
            configuration.minimumFrameInterval = CMTime(value: 1, timescale: 10)
            configuration.showsCursor = true
            configuration.captureMicrophone = Permission.microphone.isGranted
            let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
            let recording = SCRecordingOutputConfiguration()
            recording.outputURL = folder.appendingPathComponent("screen.mp4")
            recording.outputFileType = .mp4
            recording.videoCodecType = .hevc
            try stream.addRecordingOutput(SCRecordingOutput(configuration: recording, delegate: self))
            if configuration.captureMicrophone { try stream.addStreamOutput(self, type: .microphone, sampleHandlerQueue: voice.queue) }
            try await stream.startCapture()
            self.stream = stream
        } catch {
            return fail("The recording did not start: \(AppLog.describe(error))")
        }
        self.screen = screen
        self.displayID = displayID
        zero = Date()
        observations = []
        pictures = 0
        lastPictureAt = .distantPast
        startUploader()
        marks = 0
        panels = []
        panelsAsked = 0
        pictureTasks = []
        trees = 0
        windowKey = ""
        ticks = 0
        isRunning = true
        showOverlay(on: screen)
        isInkArmed = false
        say("⇧ and move draws · ⌥⇧S sends", startedAt: zero)
        observeWindow()
        picture("start", after: 0.3)
        clickMonitor = NSEvent.addGlobalMonitorForEvents(matching: .leftMouseDown) { [weak self] _ in
            MainActor.assumeIsolated { self?.clicked() }
        }
        // Ink needs no button: while ⇧ alone is down, the pointer's way is a stroke.
        moveMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.mouseMoved, .leftMouseDragged]) { [weak self] event in
            let isInk = event.modifierFlags.intersection([.shift, .option, .command, .control]) == .shift
            MainActor.assumeIsolated { self?.moved(isInk: isInk) }
        }
        let timer = Timer(timeInterval: 1.0 / 30, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.tick() } }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
        log.info("capture \(id) starts on \"\(screen.localizedName)\", \(configuration(of: screen)), voice \(Permission.microphone.isGranted ? "on" : "off: no Microphone permission")")
        onChange()
    }

    private func configuration(of screen: NSScreen) -> String {
        "\(Int(screen.frame.width)) × \(Int(screen.frame.height)) points at \(screen.backingScaleFactor)x"
    }

    // MARK: - While it runs

    /// Milliseconds since the start.
    private var now: Int { max(0, Int(Date().timeIntervalSince(zero) * 1000)) }

    private func observe(_ kind: String, at t: Int? = nil, _ fields: [String: Any?]) {
        var observation: [String: Any] = ["t": t ?? now, "kind": kind]
        for (key, value) in fields { if let value { observation[key] = value } }
        observations.append(observation)
    }

    /// 30 times a second: a stroke ends when ⇧ is let go. Once a second: the window in front.
    private func tick() {
        if !NSEvent.modifierFlags.contains(.shift) {
            isInkArmed = true
            endStroke()
        }
        ticks += 1
        if ticks % 30 == 0 {
            observeWindow()
            if Date().timeIntervalSince(zero) > Self.maximumSeconds { toggle() }
        }
    }

    /// A new observation when the app in front, its window's title or its page changes.
    private func observeWindow() {
        guard let application = NSWorkspace.shared.frontmostApplication, application.processIdentifier != ProcessInfo.processInfo.processIdentifier else { return }
        var title: String?
        var url: String?
        if AXIsProcessTrusted() {
            let element = AXUIElementCreateApplication(application.processIdentifier)
            AXUIElementSetMessagingTimeout(element, 0.3)
            if let window = Accessibility.attribute(element, kAXFocusedWindowAttribute), CFGetTypeID(window) == AXUIElementGetTypeID() {
                // The type was checked on the line above.
                let window = window as! AXUIElement
                title = Accessibility.attribute(window, kAXTitleAttribute) as? String
                url = Accessibility.attribute(window, kAXDocumentAttribute) as? String ?? Accessibility.pageURL(in: window)
            }
        }
        let key = [application.bundleIdentifier, title, url].map { $0 ?? "" }.joined(separator: "\n")
        guard key != windowKey else { return }
        windowKey = key
        // the window as text, for the first few windows: a tree is large
        var tree: String?
        if trees < 6, let window = try? Accessibility.frontWindow(maxDepth: 12, maxNodes: 1_500),
            let data = try? JSONSerialization.data(withJSONObject: window, options: [.sortedKeys])
        {
            tree = "accessibility/\(trees).json"
            try? FileManager.default.createDirectory(at: folder.appendingPathComponent("accessibility"), withIntermediateDirectories: true)
            try? data.write(to: folder.appendingPathComponent(tree!))
            trees += 1
        }
        observe("window", ["application": application.localizedName, "bundleIdentifier": application.bundleIdentifier, "title": title, "url": url, "accessibilityTree": tree])
        if now > 1_000 { picture("window", after: 0.5) }
    }

    /// The pointer moved. With ⇧ down it draws; a stroke ends when ⇧ is let go.
    private func moved(isInk: Bool) {
        let point = NSEvent.mouseLocation
        guard isInk, isInkArmed, let screen, screen.frame.contains(point) else { return endStroke() }
        ink?.add(x: point.x - screen.frame.minX, y: screen.frame.maxY - point.y, t: now)
    }

    /// A mark from a script on this Mac: the same stroke as one by hand.
    func mark(_ points: [[Double]]) {
        guard isRunning else { return }
        endStroke()
        for point in points where point.count == 2 { ink?.add(x: point[0], y: point[1], t: now) }
        endStroke()
    }

    private func endStroke() {
        if let stroke = ink?.end() { inked(stroke) }
    }

    /// A sharp picture of the display, now or a moment later, straight to the uploader. At most
    /// 12 for a capture: a mark always gets one, a click or a window only among the first 8 and
    /// not within a second of another.
    private func picture(_ reason: String, after seconds: Double = 0, isMark: Bool = false, shows: ((Int) -> Panel)? = nil) {
        guard pictures < (isMark || reason == "end" ? 12 : 8), isMark || Date().timeIntervalSince(lastPictureAt) > 1 else { return }
        pictures += 1
        lastPictureAt = Date()
        let file = "pictures/\(String(format: "%02d", pictures)).jpg"
        let capture = id
        var panel: Panel?
        if let shows {
            panelsAsked += 1
            panel = shows(panelsAsked)
        }
        pictureTasks.append(
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
                await self.takePicture(file, reason, of: capture, panel: panel)
            })
    }

    private func takePicture(_ file: String, _ reason: String, of capture: String, panel: Panel? = nil) async {
        let t = now
        guard isRunning, capture == id, let image = try? await Screen.image(of: displayID, maxWidth: 2_000),
            let picture = Snapshot.jpeg(of: CIImage(cgImage: image), maxWidth: 2_000), capture == id,
            (try? picture.data.write(to: folder.appendingPathComponent(file))) != nil
        else { return }
        observe("picture", at: t, ["file": file, "reason": reason, "pixelWidth": picture.width, "pixelHeight": picture.height])
        uploader?.send("put \(file)")
        if let panel { cut(panel, from: image, picture: file) }
    }

    /// One numbered picture: the part of the display around a mark or a click, with its number in
    /// the corner. The box is twice the mark's size and at least 640 × 400 points, so that what is
    /// near the mark can be read.
    private func cut(_ panel: Panel, from image: CGImage, picture: String) {
        guard let screen else { return }
        let display = screen.frame.size
        let scale = CGFloat(image.width) / display.width
        let size = CGSize(width: min(display.width, max(640, panel.box.width * 2)), height: min(display.height, max(400, panel.box.height * 2)))
        let origin = CGPoint(
            x: max(0, min(display.width - size.width, panel.box.midX - size.width / 2)),
            y: max(0, min(display.height - size.height, panel.box.midY - size.height / 2)))
        // a CGImage counts from its top left, as the box does
        guard let part = image.cropping(to: CGRect(x: origin.x * scale, y: origin.y * scale, width: size.width * scale, height: size.height * scale).integral),
            let context = CGContext(
                data: nil, width: part.width, height: part.height, bitsPerComponent: 8, bytesPerRow: 0,
                space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
        else { return }
        let height = CGFloat(part.height)
        context.draw(part, in: CGRect(x: 0, y: 0, width: part.width, height: part.height))
        if let click = panel.click {
            // a click leaves no ink: a ring says where it was
            context.setStrokeColor(CGColor(red: 1, green: 0.1, blue: 0.1, alpha: 1))
            context.setLineWidth(5)
            context.strokeEllipse(in: CGRect(x: (click.x - origin.x) * scale - 16, y: height - (click.y - origin.y) * scale - 16, width: 32, height: 32))
        }
        let badge = CGRect(x: 0, y: height - 56, width: 64, height: 56)
        context.setFillColor(CGColor(gray: 0, alpha: 1))
        context.fill(badge)
        let number = CTLineCreateWithAttributedString(
            NSAttributedString(string: String(panel.n), attributes: [.font: NSFont.boldSystemFont(ofSize: 40), .foregroundColor: NSColor.white]))
        let bounds = CTLineGetBoundsWithOptions(number, .useGlyphPathBounds)
        context.textPosition = CGPoint(x: badge.midX - bounds.midX, y: badge.midY - bounds.midY)
        CTLineDraw(number, context)
        let file = "\(panel.n).jpg"
        guard let numbered = context.makeImage(), let jpeg = Snapshot.jpeg(of: CIImage(cgImage: numbered), maxWidth: 2_000),
            (try? jpeg.data.write(to: folder.appendingPathComponent(file))) != nil
        else { return }
        var entry: [String: Any] = ["n": panel.n, "did": panel.did, "from": panel.from, "t": panel.t, "file": file, "picture": picture]
        // What was under it, when the app in front names it in a few words (a terminal answers its whole text).
        if let on = panel.on, let words = (on["title"] ?? on["description"]) as? String, !words.isEmpty, words.count <= 60 {
            entry["on"] = "“\(words)”"
        }
        panels.append(entry)
        uploader?.send("put \(file)")
    }

    /// All the numbered pictures on one: an agent reads it first. Two in a row, each 780 pixels wide.
    private func writeSheet() {
        let cells = panels.sorted { ($0["n"] as? Int ?? 0) < ($1["n"] as? Int ?? 0) }.compactMap { panel -> CGImage? in
            guard let file = panel["file"] as? String, let source = CGImageSourceCreateWithURL(folder.appendingPathComponent(file) as CFURL, nil) else { return nil }
            return CGImageSourceCreateImageAtIndex(source, 0, nil)
        }
        guard cells.count > 1 else { return }
        let cellWidth: CGFloat = 780, gap: CGFloat = 6
        let heights = cells.map { CGFloat($0.height) * cellWidth / CGFloat($0.width) }
        let rows = stride(from: 0, to: cells.count, by: 2).map { heights[$0..<min($0 + 2, cells.count)].max() ?? 0 }
        let size = CGSize(width: cellWidth * 2 + gap * 3, height: rows.reduce(gap) { $0 + $1 + gap })
        guard
            let context = CGContext(
                data: nil, width: Int(size.width), height: Int(size.height), bitsPerComponent: 8, bytesPerRow: 0,
                space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
        else { return }
        context.setFillColor(CGColor(gray: 0.13, alpha: 1))
        context.fill(CGRect(origin: .zero, size: size))
        context.interpolationQuality = .high
        var top = gap
        for (index, cell) in cells.enumerated() {
            let column = CGFloat(index % 2)
            context.draw(cell, in: CGRect(x: gap + column * (cellWidth + gap), y: size.height - top - heights[index], width: cellWidth, height: heights[index]))
            if index % 2 == 1 { top += rows[index / 2] + gap }
        }
        guard let sheet = context.makeImage(), let jpeg = Snapshot.jpeg(of: CIImage(cgImage: sheet), maxWidth: 2_000),
            (try? jpeg.data.write(to: folder.appendingPathComponent("sheet.jpg"))) != nil
        else { return }
        uploader?.send("put sheet.jpg")
    }

    /// A click in another app (a global monitor sees no click in this app's own windows).
    private func clicked() {
        guard let screen, screen.frame.contains(NSEvent.mouseLocation) else { return }
        let point = NSEvent.mouseLocation
        let place = CGPoint(x: point.x - screen.frame.minX, y: screen.frame.maxY - point.y)
        let on = element(at: point)
        let t = now
        observe("click", at: t, ["x": Int(place.x), "y": Int(place.y), "on": on])
        picture("click", after: 0.4) { Panel(n: $0, did: "clicked", from: t, t: t, box: CGRect(origin: place, size: .zero), click: place, on: on) }
    }

    private func inked(_ stroke: InkView.Stroke) {
        guard let screen, let first = stroke.points.first, let last = stroke.points.last else { return }
        marks += 1
        let xs = stroke.points.map(\.x), ys = stroke.points.map(\.y)
        // the middle of the mark, as a point of the whole desktop with its origin at the bottom left
        let middle = CGPoint(x: screen.frame.minX + (xs.min()! + xs.max()!) / 2, y: screen.frame.maxY - (ys.min()! + ys.max()!) / 2)
        let on = element(at: middle)
        observe("ink", at: first.t, ["to": last.t, "mark": marks, "points": stroke.points.map { [Int($0.x), Int($0.y), $0.t] }, "on": on])
        let box = CGRect(x: xs.min()!, y: ys.min()!, width: xs.max()! - xs.min()!, height: ys.max()! - ys.min()!)
        picture("mark \(marks)", after: 0.15, isMark: true) { Panel(n: $0, did: "drew", from: first.t, t: last.t, box: box, on: nil) }
    }

    /// The accessibility element of the app in front at a point of the desktop: its role, title and value.
    private func element(at point: CGPoint) -> [String: Any]? {
        guard AXIsProcessTrusted(), let application = NSWorkspace.shared.frontmostApplication, let primary = NSScreen.screens.first else { return nil }
        let root = AXUIElementCreateApplication(application.processIdentifier)
        AXUIElementSetMessagingTimeout(root, 0.3)
        var found: AXUIElement?
        // Accessibility counts from the top left of the first display
        guard AXUIElementCopyElementAtPosition(root, Float(point.x), Float(primary.frame.maxY - point.y), &found) == .success, let found else { return nil }
        var budget = 1
        let described = Accessibility.describe(found, depth: 0, budget: &budget)
        return described.isEmpty ? nil : described.mapValues { ($0 as? String).map { String($0.prefix(300)) } ?? $0 }
    }

    // MARK: - End

    private func end(send: Bool) async {
        guard isRunning, !isEnding else { return }
        isEnding = true
        defer { isEnding = false }
        endStroke()
        // every mark and click has its picture before the ink goes
        for task in pictureTasks { await task.value }
        pictureTasks = []
        let durationMs = now
        if send {
            // The last picture, with the ink still on the screen. It is the one numbered picture
            // of a capture with no mark and no click: the whole display.
            pictures += 1
            let whole = panels.isEmpty ? screen.map { Panel(n: 1, did: "the screen at the end", from: 0, t: durationMs, box: CGRect(origin: .zero, size: $0.frame.size)) } : nil
            await takePicture("pictures/\(String(format: "%02d", pictures)).jpg", "end", of: id, panel: whole)
            writeSheet()
            // The text is on the clipboard now: nothing below is waited for.
            if (try? writeManifest(durationMs: durationMs)) != nil { uploader?.send("copy") }
        }
        timer?.invalidate()
        timer = nil
        for monitor in [clickMonitor, moveMonitor] { if let monitor { NSEvent.removeMonitor(monitor) } }
        clickMonitor = nil
        moveMonitor = nil
        overlay?.orderOut(nil)
        overlay = nil
        ink = nil
        isRunning = false
        onChange()
        if let stream {
            // the movie is whole once the recording output says so; a stream that fails says it too
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                finished = continuation
                Task { @MainActor in
                    try? await stream.stopCapture()
                    try? await Task.sleep(nanoseconds: 5_000_000_000)
                    self.movieIsWhole()
                }
            }
        }
        stream = nil
        guard send else {
            uploader?.send("discard")
            uploader = nil
            try? FileManager.default.removeItem(at: folder)
            log.info("capture \(id): discarded by the person")
            return say("Discarded", for: 2)
        }
        say(copiedAt == nil ? "Sending…" : "Copied: paste it to an agent", progress: 0)
        do {
            try await writeBundle(durationMs: durationMs)
        } catch {
            return fail("The capture was not written: \(AppLog.describe(error))")
        }
        guard let uploader else {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(folder.path, forType: .string)
            return fail("No mind is set up. The capture is in \(folder.path)", keep: true)
        }
        uploader.send("finish")
    }

    private func movieIsWhole() {
        finished?.resume()
        finished = nil
    }

    nonisolated func recordingOutputDidFinishRecording(_ recordingOutput: SCRecordingOutput) {
        Task { @MainActor in self.movieIsWhole() }
    }

    nonisolated func recordingOutput(_ recordingOutput: SCRecordingOutput, didFailWithError error: Error) {
        let words = AppLog.describe(error)
        Task { @MainActor in
            self.log.error("capture \(self.id): the recording failed: \(words)")
            self.movieIsWhole()
        }
    }

    /// The stream ended by itself (the display went away, macOS stopped it): the capture ends with what it has.
    nonisolated func stream(_ stream: SCStream, didStopWithError error: Error) {
        let words = AppLog.describe(error)
        Task { @MainActor in
            self.log.error("capture \(self.id): the stream stopped: \(words)")
            if self.isRunning { await self.end(send: true) }
        }
    }

    /// Cuts the voice out of the movie, and writes `capture.json` again with both.
    private func writeBundle(durationMs: Int) async throws {
        let movie = AVURLAsset(url: folder.appendingPathComponent("screen.mp4"))
        let movieMs = Int(try await movie.load(.duration).seconds * 1000)
        observe("screen", at: 0, ["to": movieMs, "file": "screen.mp4"])
        if !(try await movie.loadTracks(withMediaType: .audio)).isEmpty, let export = AVAssetExportSession(asset: movie, presetName: AVAssetExportPresetAppleM4A) {
            try await export.export(to: folder.appendingPathComponent("voice.m4a"), as: .m4a)
            observe("voice", at: 0, ["to": movieMs, "file": "voice.m4a"])
        }
        try writeManifest(durationMs: movieMs)
        log.info("capture \(id): \(movieMs / 1000) s, \(observations.count) observations, \(pictures) pictures, \(marks) marks")
    }

    /// `capture.json`: every observation with its time, and the numbered pictures. Written twice:
    /// at the end for the text, and again when the movie is whole.
    private func writeManifest(durationMs: Int) throws {
        let frame = screen?.frame ?? .zero
        let displayName: String = screen?.localizedName ?? ""
        let displayScale: CGFloat = screen?.backingScaleFactor ?? 1
        let iso = ISO8601DateFormatter()
        let manifest: [String: Any] = [
            "schema": 1,
            "capture": id,
            "startedAt": iso.string(from: zero),
            "endedAt": iso.string(from: zero.addingTimeInterval(Double(durationMs) / 1000)),
            "durationMs": durationMs,
            // the voice comes to the uploader while the person talks
            "microphone": Permission.microphone.isGranted,
            "panels": panels.sorted { ($0["n"] as? Int ?? 0) < ($1["n"] as? Int ?? 0) },
            "by": [
                "adapter": ["name": "mac-app", "version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""],
                "device": destination()?.name ?? Host.current().localizedName ?? "",
                "method": "person",
            ],
            // points of the desktop; an ink point and a click count from this display's top left
            "display": [
                "name": displayName, "scale": displayScale,
                "frame": ["x": Int(frame.minX), "y": Int(frame.minY), "w": Int(frame.width), "h": Int(frame.height)],
            ],
            "observations": observations.sorted { ($0["t"] as? Int ?? 0) < ($1["t"] as? Int ?? 0) },
        ]
        try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys]).write(to: folder.appendingPathComponent("capture.json"))
    }

    /// The uploader starts with the capture: it connects to the mind and gets its upload links
    /// while the person talks.
    private func startUploader() {
        sendingTo = nil
        copiedAt = nil
        guard let destination = destination() else { return uploader = nil }
        let capture = id
        sendingTo = destination.mind
        uploader = Uploader(
            [destination.node, destination.uploader, folder.path, "--iterate", destination.iterateBin, "--mind", destination.mind],
            said: { [weak self] line in if self?.id == capture { self?.uploaderSaid(line) } },
            ended: { [weak self] in
                guard let self, self.id == capture, self.uploader != nil else { return }
                self.uploader = nil
                self.fail("Not sent: the uploader ended. The capture is in \(self.folder.path)", keep: true)
            })
        let uploader = self.uploader
        voice.queue.async { [voice] in voice.uploader = uploader }
    }

    /// The microphone's sound, on the voice's queue: to the uploader, which has the mind put it into words.
    nonisolated func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        if type == .microphone { voice.take(sampleBuffer) }
    }

    /// `copy` is the text for the clipboard: with the mind's paths, or this Mac's with `failed`.
    private func uploaderSaid(_ line: [String: Any]) {
        let mind = sendingTo ?? "the mind"
        if let progress = line["progress"] as? Double, pill.progress != nil { pill.progress = progress }
        // what was just heard, while the capture runs: the sign that the microphone hears the person
        if let words = line["words"] as? String, !words.isEmpty, isRunning { say("…" + words.suffix(44), startedAt: zero) }
        if let text = line["copy"] as? String, copiedAt == nil || copiedAt == NSPasteboard.general.changeCount {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
            copiedAt = NSPasteboard.general.changeCount
            if line["failed"] == nil {
                log.info("capture \(id): \(text.count) characters copied")
                say("Copied: paste it to an agent", progress: pill.progress)
            }
        }
        if let reason = line["failed"] as? String {
            uploader = nil
            fail("Not sent to \(mind): \(reason.prefix(200)). The capture is in \(folder.path)", keep: true)
        } else if line["done"] != nil {
            uploader = nil
            log.info("capture \(id): sent to \(mind) as /captures/\(id)/")
            // The folder stays: an agent on this Mac reads the pictures from it.
            lastLine = "Sent to \(mind) at \(Lend.clock(Date())), and copied"
            say("Copied: paste it to an agent", for: 3)
            onChange()
        }
    }

    private func fail(_ reason: String, keep: Bool = false) {
        log.error("capture \(id): \(reason)")
        if !keep { try? FileManager.default.removeItem(at: folder) }
        lastLine = reason
        say(reason, for: 8)
        onChange()
    }

    // MARK: - The overlay and the pill

    private func panel(_ frame: NSRect, level: Int) -> NSPanel {
        let panel = NSPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.level = NSWindow.Level(rawValue: level)
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        return panel
    }

    /// A clear window over the whole display, for the ink. Every click goes through it.
    private func showOverlay(on screen: NSScreen) {
        let overlay = panel(screen.frame, level: NSWindow.Level.statusBar.rawValue)
        overlay.ignoresMouseEvents = true
        let ink = InkView(frame: NSRect(origin: .zero, size: screen.frame.size))
        overlay.contentView = ink
        overlay.orderFrontRegardless()
        self.overlay = overlay
        self.ink = ink
    }

    /// The pill at the top of the display: what the capture does now. With `seconds`, it goes away after them.
    private func say(_ text: String, startedAt: Date? = nil, progress: Double? = nil, for seconds: Double? = nil) {
        pill.text = text
        pill.mind = destination()?.mind
        pill.startedAt = startedAt
        pill.progress = progress
        let screen = self.screen ?? NSScreen.main
        // room for the dot, the clock and the two buttons while it records
        let controls: CGFloat = startedAt == nil ? 60 : 250
        let face: CGFloat = pill.mind == nil ? 0 : 26
        let bar: CGFloat = progress == nil ? 0 : 110
        let width = min(controls + face + bar + CGFloat(text.count * 8), 760)
        let frame = NSRect(x: (screen?.frame.midX ?? 400) - width / 2, y: (screen?.visibleFrame.maxY ?? 800) - 48, width: width, height: 36)
        let panel = pillPanel ?? self.panel(frame, level: NSWindow.Level.statusBar.rawValue + 1)
        if pillPanel == nil {
            panel.contentView = NSHostingView(
                rootView: CapturePillView(
                    pill: pill,
                    send: { [weak self] in self?.toggle() },
                    discard: { [weak self] in Task { @MainActor in await self?.end(send: false) } }))
            pillPanel = panel
        }
        panel.setFrame(frame, display: true)
        panel.orderFrontRegardless()
        guard let seconds else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { [weak self] in
            // a newer line stays
            if self?.pill.text == text { self?.pillPanel?.orderOut(nil) }
        }
    }
}

private struct CapturePillView: View {
    @ObservedObject var pill: CapturePill
    let send: () -> Void
    let discard: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            if let mind = pill.mind { MindAvatar(mind: mind, size: 22) }
            if let startedAt = pill.startedAt {
                Circle().fill(.red).frame(width: 9, height: 9)
                Text(startedAt, style: .timer).monospacedDigit()
            }
            Text(pill.text).lineLimit(1).truncationMode(.middle)
            if let progress = pill.progress { ProgressView(value: min(max(progress, 0), 1)).frame(width: 90) }
            if pill.startedAt != nil {
                Button("Send", action: send)
                Button("Discard", action: discard)
            }
        }
        .font(.system(size: 13, weight: .medium))
        .controlSize(.small)
        .padding(.leading, pill.mind == nil ? 14 : 7)
        .padding(.trailing, 14)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.regularMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(.separator))
    }
}

/// The ink: red strokes along the pointer's way. A stroke goes away 4 seconds after its end.
private final class InkView: NSView {
    /// Points of the display from its top left, each with its time in milliseconds.
    struct Stroke {
        var points: [(x: CGFloat, y: CGFloat, t: Int)]
        var isEnded = false
    }

    private var strokes: [Stroke] = []

    func add(x: CGFloat, y: CGFloat, t: Int) {
        if strokes.last?.isEnded ?? true { strokes.append(Stroke(points: [])) }
        strokes[strokes.count - 1].points.append((x, y, t))
        needsDisplay = true
    }

    /// Ends the stroke that runs, and answers it. A few points are no mark (⇧ for a capital letter): nil.
    func end() -> Stroke? {
        guard let stroke = strokes.last, !stroke.isEnded else { return nil }
        guard stroke.points.count >= 5 else {
            strokes.removeLast()
            needsDisplay = true
            return nil
        }
        strokes[strokes.count - 1].isEnded = true
        let endedAt = stroke.points.last?.t ?? 0
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in
            self?.strokes.removeAll { $0.isEnded && ($0.points.last?.t ?? 0) <= endedAt }
            self?.needsDisplay = true
        }
        return stroke
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.systemRed.setStroke()
        for stroke in strokes {
            let path = NSBezierPath()
            path.lineWidth = 4
            path.lineCapStyle = .round
            path.lineJoinStyle = .round
            for (index, point) in stroke.points.enumerated() {
                let place = NSPoint(x: point.x, y: bounds.height - point.y)
                if index == 0 { path.move(to: place) } else { path.line(to: place) }
            }
            path.stroke()
        }
    }
}
