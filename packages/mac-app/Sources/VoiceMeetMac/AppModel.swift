import AVFoundation
import AppKit
import VoiceMeetCore

/// Answers the local endpoint's callers (a mind, through `iterate provide`) from the Mac's screen,
/// camera, microphone, speakers and accessibility, and runs commands for them. Each power is off
/// until the person turns it on in the menu. Nothing is written to disk.
@MainActor
final class AppModel {
    private(set) var microphone = MicrophoneState()
    /// How often a caller used each thing in this run (by `Shareable.id`), and the last use.
    private(set) var uses: [String: Int] = [:]
    private(set) var lastUse: (thing: Shareable, at: Date)?
    var onChange: (() -> Void)?
    /// ⌥⇧S, from a script on this Mac (`capture.toggle` on the socket): the bridge lends no such call.
    var toggleCapture: (() -> Void)?
    /// A mark in the capture that runs, from a script on this Mac (`capture.mark`): points of the
    /// display from its top left. The same as ink by hand, for a test with no hand.
    var markCapture: (([[Double]]) -> Void)?

    private let log = AppLog("state")
    private let audioOwner = AudioOwner()
    private var cameras: [String: CameraUnit] = [:]
    private let endpoint = LocalEndpoint()
    private let speaker = Speaker()
    /// Banners on the screen, a call's among them: the window, the sound, a button's page.
    let banners = Banners()
    /// The person's approvals, for things whose choice is "Ask".
    let approval = Approval()
    /// What a mind did with this Mac, for the pill on the screen and the panel's list.
    let acts = ActivityLog()
    /// What this Mac tells its mind about itself: presence, and keyboard and mouse when shared.
    let deviceEvents = DeviceEvents()
    private var activity: NSObjectProtocol?
    private var microphoneHolders = 0
    private var isListening = false

    /// True while any camera runs, for the mark in the menu bar.
    var isAnyCameraRunning: Bool { cameras.values.contains { $0.state.isRunning } }

    /// The panel's preview of one camera draws this layer.
    func cameraPreviewLayer(for id: String) -> CALayer { unit(id).owner.previewLayer }

    init() {
        audioOwner.onEvent = { [weak self] event in self?.send(event) }
        endpoint.onRequest = { [weak self] method, parameters in try await self?.answer(method, parameters) ?? [:] }
    }

    /// Opens the local endpoint. Not in `init`: a copy of the app that only draws the panel to a
    /// file (`Panel.render`) must not take the running app's socket.
    func start() {
        endpoint.start()
        deviceEvents.readPresence = { Self.presence() }
        deviceEvents.start()
    }

    func shutDown() {
        endpoint.stop()
        acts.stop()
        deviceEvents.stop()
        audioOwner.stop()
        speaker.stop()
        banners.stop()
        cameras.values.forEach { $0.owner.stop() }
    }

    // MARK: - The local endpoint

    /// Whether a person is likely at this Mac now (VoiceMeetCore `Presence`): read at each
    /// `state()`, from calls that need no permission of macOS.
    private static func presence() -> Presence {
        // every kind of input: a key, a mouse move, a click, a scroll
        let anyInput = CGEventType(rawValue: ~0)!
        var displays = [CGDirectDisplayID](repeating: 0, count: 16)
        var count: UInt32 = 0
        if CGGetOnlineDisplayList(UInt32(displays.count), &displays, &count) != .success { count = 0 }
        return Presence.read(
            idle: CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: anyInput),
            session: CGSessionCopyCurrentDictionary() as? [String: Any],
            displaysAsleep: displays.prefix(Int(count)).map { CGDisplayIsAsleep($0) != 0 }
        )
    }

    /// A thing that is off, or whose permission macOS has not given, is a refusal with the reason.
    /// A thing on "Ask" waits for the person's approval. A caller can change no choice and can
    /// bring up no permission prompt: the person does both in the panel.
    private func answer(_ method: String, _ parameters: [String: Any]) async throws -> [String: Any] {
        let maxWidth = parameters["maxWidth"] as? Int ?? 1600
        switch method {
        case "state":
            return [
                "things": Shareable.all.map { thing -> [String: Any] in
                    var row: [String: Any] = [
                        "thing": thing.id, "kind": thing.power.rawValue, "name": thing.title,
                        "sharing": thing.sharing.rawValue, "permitted": thing.isPermitted, "uses": uses[thing.id] ?? 0,
                    ]
                    if thing.power == .screen { row["display"] = Screen.displays.firstIndex { Shareable.display($0) == thing } }
                    return row
                },
                "microphone": microphone.statusLine,
                "presence": Self.presence().dictionary,
            ]
        case "screen.snapshot":
            let display = try Screen.resolve(parameters["display"] as? Int)
            return try await act(display, what: "A still picture of the display \"\(display.title)\".", doing: "Taking a picture of the display “\(display.title)”", did: "Took a picture of the display “\(display.title)”") {
                self.lend(try await Screen.snapshot(of: Screen.id(of: display), maxWidth: maxWidth), of: "the display \"\(display.title)\"")
            }
        case "camera.snapshot":
            let device = try Camera.resolve(parameters["camera"] as? String)
            let owner = unit(device.uniqueID).owner
            return try await act(.camera(device), what: "A still picture of the camera \"\(device.localizedName)\".", doing: "Taking a picture with the camera “\(device.localizedName)”", did: "Took a picture with the camera “\(device.localizedName)”") {
              try await self.withCamera(device.uniqueID) {
                // The first frames of a camera are dark: it sets its exposure for a moment.
                try await wait(seconds: 5, for: "the camera's first picture") { owner.snapshot(maxWidth: 16) != nil }
                try await Task.sleep(nanoseconds: 700_000_000)
                guard let picture = owner.snapshot(maxWidth: maxWidth) else {
                    throw EndpointRefusal("The camera gave no picture.")
                }
                return self.lend(picture, of: "the camera \"\(device.localizedName)\"")
              }
            }
        case "microphone.listen":
            let seconds = min(max(parameters["seconds"] as? Double ?? 5, 0.5), 60)
            return try await act(.microphone, what: "\(String(format: "%.0f", seconds)) seconds of the microphone.", doing: "Listening to the microphone for \(String(format: "%.0f", seconds)) s", did: "Listened to the microphone for \(String(format: "%.0f", seconds)) s") {
              try await self.withMicrophone {
                // One recording at a time: a second caller waits for the first one's end.
                while self.isListening { try await Task.sleep(nanoseconds: 100_000_000) }
                self.isListening = true
                defer { self.isListening = false }
                let wave = await self.audioOwner.listen(seconds: seconds)
                self.log.info("endpoint: lent \(String(format: "%.1f", seconds)) s of the microphone, \(wave.count) bytes of WAV")
                return ["wavBase64": wave.base64EncodedString(), "seconds": seconds]
              }
            }
        case "speaker.play":
            guard let sound = Data(base64Encoded: parameters["soundBase64"] as? String ?? ""), !sound.isEmpty else {
                throw EndpointRefusal("speaker.play needs a sound: the bytes of a sound file.")
            }
            let player = try speaker.open(sound)
            return try await act(.speaker, what: "Play a sound of \(String(format: "%.1f", player.duration)) seconds through the speakers.", doing: "Playing a sound through the speakers", did: "Played a sound of \(String(format: "%.0f", player.duration)) s through the speakers") {
                self.log.info("endpoint: plays a sound of \(String(format: "%.1f", player.duration)) s, \(sound.count) bytes")
                try await self.speaker.play(player)
                return ["seconds": player.duration]
            }
        case "speaker.say":
            guard let words = parameters["words"] as? String, !words.isEmpty else {
                throw EndpointRefusal("speaker.say needs words.")
            }
            return try await act(.speaker, what: "Say through the speakers:\n\n\(words.prefix(700))", doing: "Speaking through the speakers", did: "Spoke through the speakers", detail: Self.oneLine(words)) {
                self.log.info("endpoint: says \(words.count) characters through the speakers")
                try await self.speaker.say(String(words.prefix(5_000)))
                return ["characters": min(words.count, 5_000)]
            }
        case "accessibility.frontWindow":
            return try await act(.accessibility, what: "The text and controls of the window in front.", doing: "Reading the text of the window in front", did: "Read the text of the window in front") {
                try Accessibility.frontWindow(
                    maxDepth: parameters["maxDepth"] as? Int ?? 12,
                    maxNodes: parameters["maxNodes"] as? Int ?? 1_500
                )
            }
        case "run":
            guard let argv = parameters["argv"] as? [String] else {
                throw EndpointRefusal("run needs a command: argv is a list of strings.")
            }
            let stdin = Data(base64Encoded: parameters["stdinBase64"] as? String ?? "") ?? Data()
            let input = String(data: stdin, encoding: .utf8) ?? ""
            let shown = argv.joined(separator: " ").prefix(300) + (input.isEmpty ? "" : "\n\nWith this input:\n" + input.prefix(700))
            return try await act(.commands, what: "Run this command with this app's permissions:\n\n\(shown)", doing: "Running a command", did: "Ran a command", detail: Self.oneLine(argv.joined(separator: " "))) {
                self.log.info("endpoint: runs \(argv.joined(separator: " ").prefix(300))")
                return try await Commands.run(argv, stdin: stdin, timeout: parameters["timeoutSeconds"] as? Double ?? 120)
            }
        // No approval first: the banner is the question, and Ask and Shared both show it.
        case "banner.show":
            return try await shown(parameters, did: "Showed a banner") { try await self.banners.show(parameters) }
        case "call.ring":
            return try await shown(parameters, did: "Rang a call") { try await self.banners.ring(parameters) }
        case "capture.toggle":
            guard let toggleCapture else { throw EndpointRefusal("A capture needs macOS 15.") }
            toggleCapture()
            return [:]
        case "capture.mark":
            guard let markCapture, let points = parameters["points"] as? [[Double]] else { throw EndpointRefusal("capture.mark needs points: [[x, y], …].") }
            markCapture(points)
            return [:]
        default:
            throw EndpointRefusal(
                "No method \"\(method)\". The methods are: state, screen.snapshot, camera.snapshot, microphone.listen, speaker.play, speaker.say, accessibility.frontWindow, run, banner.show, call.ring."
            )
        }
    }

    /// Refuses a thing that is off or not permitted, asks the person first when its choice is
    /// "Ask", then counts the use, so that the menu bar and the panel show it.
    private func use(_ thing: Shareable, what: String) async throws {
        let sharing = thing.sharing
        guard sharing != .off else {
            throw EndpointRefusal("The Mac's owner has this off in the iterate panel: \(thing.title). A mind cannot \(thing.does).")
        }
        if let permission = thing.power.permission, !permission.isGranted {
            throw EndpointRefusal(
                "macOS has not given this app \(permission.title). The Mac's owner gives it from the iterate panel, at \(thing.title)."
            )
        }
        if sharing == .ask, approval.isApproved(thing) == nil {
            try await approval.ask(for: thing, what: what)
        }
        count(thing)
    }

    /// One act of a caller with `thing`: `use` first, then `body`, and the person sees it in the
    /// pill on the screen and in the panel's list, from its start to its end. A refusal before
    /// the act (the thing is off, the person said no) is no act.
    private func act(
        _ thing: Shareable, what: String, doing: String, did: String, detail: String? = nil, _ body: () async throws -> [String: Any]
    ) async throws -> [String: Any] {
        try await use(thing, what: what)
        let id = acts.began(thing, doing: doing, did: did, detail: detail)
        do {
            let answer = try await body()
            acts.ended(id)
            return answer
        } catch {
            acts.ended(id, failure: Self.oneLine(AppLog.describe(error), limit: 90))
            throw error
        }
    }

    /// A banner or a call: it has its own window, so the list has it and the pill is short.
    private func shown(_ parameters: [String: Any], did: String, _ body: () async throws -> [String: Any]) async throws -> [String: Any] {
        guard Shareable.banners.sharing != .off else { return try await body() }
        count(.banners)
        let id = acts.began(.banners, doing: did, did: did, detail: (parameters["title"] as? String).map { Self.oneLine($0) })
        // the answer comes when the person presses a button: the act for the list is the showing
        acts.ended(id)
        return try await body()
    }

    /// Words on one line, cut: for a line of the activity list.
    private static func oneLine(_ words: String, limit: Int = 160) -> String {
        let line = words.split(whereSeparator: \.isNewline).joined(separator: " ")
        return line.count > limit ? line.prefix(limit) + "…" : line
    }

    /// One use of `thing`, for the menu bar and the panel.
    private func count(_ thing: Shareable) {
        uses[thing.id, default: 0] += 1
        lastUse = (thing, Date())
        log.info("endpoint: a caller uses \(thing.id) (\(thing.title)), use \(uses[thing.id] ?? 0) of this run")
        onChange?()
    }

    /// Runs `body` with one camera on.
    private func withCamera<Answer>(_ id: String, _ body: () async throws -> Answer) async throws -> Answer {
        holdCamera(id)
        defer { releaseCamera(id) }
        try await wait(seconds: 10, for: "the camera") { self.unit(id).state.isOn }
        return try await body()
    }

    /// A camera runs while it has a holder: a caller's snapshot, or the panel's preview while the
    /// panel is open. It stops when the last holder lets go.
    func holdCamera(_ id: String) {
        let unit = unit(id)
        unit.holders += 1
        if !unit.state.isRunning { send(.startRequested, to: id) }
    }

    func releaseCamera(_ id: String) {
        let unit = unit(id)
        unit.holders = max(0, unit.holders - 1)
        if unit.holders == 0 { send(.stopRequested, to: id) }
    }

    /// Each camera has its own state machine and its own owner, so several can run at once.
    private final class CameraUnit {
        var state = CameraState()
        var holders = 0
        let owner: Camera

        init(_ owner: Camera) {
            self.owner = owner
        }
    }

    private func unit(_ id: String) -> CameraUnit {
        if let unit = cameras[id] { return unit }
        let unit = CameraUnit(Camera(deviceID: id))
        unit.owner.onEvent = { [weak self] event in self?.send(event, to: id) }
        cameras[id] = unit
        return unit
    }

    /// Runs `body` with the microphone on. The microphone runs while it has a holder (a call), and
    /// stops when the last one lets go.
    private func withMicrophone<Answer>(_ body: () async throws -> Answer) async throws -> Answer {
        microphoneHolders += 1
        if !microphone.isRunning { send(MicrophoneEvent.startRequested) }
        defer {
            microphoneHolders -= 1
            if microphoneHolders == 0 { send(MicrophoneEvent.stopRequested) }
        }
        try await wait(seconds: 10, for: "the microphone") { self.microphone.phase == .on }
        // The engine starts twice on a Mac (the README's "Notes from the first runs"): let it settle.
        try await Task.sleep(nanoseconds: 1_500_000_000)
        try await wait(seconds: 10, for: "the microphone") { self.microphone.phase == .on }
        return try await body()
    }

    /// Waits, at most `seconds`, until `isReady`. The wait is bounded: a refusal names what did not come.
    private func wait(seconds: Double, for what: String, until isReady: () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(seconds)
        while !isReady() {
            guard Date() < deadline else { throw EndpointRefusal("Gave up after \(Int(seconds)) s of waiting for \(what).") }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
    }

    private func lend(_ picture: (data: Data, width: Int, height: Int), of source: String) -> [String: Any] {
        log.info("endpoint: lent a picture of \(source), \(picture.width) × \(picture.height) px, \(picture.data.count) bytes of JPEG")
        return [
            "jpegBase64": picture.data.base64EncodedString(),
            "pixelWidth": picture.width,
            "pixelHeight": picture.height,
        ]
    }

    // MARK: - The two state machines

    private func send(_ event: MicrophoneEvent) {
        let effects = microphone.handle(event)
        log.info("microphone: \(Self.short(event)) -> \(Self.short(microphone.phase))\(Self.list(effects))")
        for effect in effects {
            switch effect {
            // `use` has checked the permission; a caller brings up no prompt.
            case .checkAccess: send(Permission.microphone.isGranted ? MicrophoneEvent.accessGranted : .accessDenied)
            case .startEngine: audioOwner.start()
            case .stopEngine: audioOwner.stop()
            case .restartEngine: audioOwner.restart()
            case .setMuted(let isMuted): audioOwner.setMuted(isMuted)
            }
        }
        stateDidChange()
    }

    private func send(_ event: CameraEvent, to id: String) {
        let unit = unit(id)
        let effects = unit.state.handle(event)
        log.info("camera \(id.suffix(6)): \(Self.short(event)) -> \(Self.short(unit.state.phase))\(Self.list(effects))")
        for effect in effects {
            switch effect {
            case .checkAccess: send(Permission.camera.isGranted ? .accessGranted : .accessDenied, to: id)
            case .startSession: unit.owner.start()
            case .stopSession: unit.owner.stop()
            }
        }
        stateDidChange()
    }

    /// One activity token while the microphone or the camera runs, so App Nap does not slow them.
    private func stateDidChange() {
        let isBusy = microphone.isRunning || isAnyCameraRunning
        if isBusy, activity == nil {
            activity = ProcessInfo.processInfo.beginActivity(
                options: [.userInitiated, .latencyCritical],
                reason: "The microphone or the camera is in use"
            )
        } else if !isBusy, let token = activity {
            ProcessInfo.processInfo.endActivity(token)
            activity = nil
        }
        onChange?()
    }

    /// `String(describing:)` puts the module's name before every type; the log is easier to read without.
    private static func short(_ value: Any) -> String {
        String(describing: value).replacingOccurrences(of: "VoiceMeetCore.", with: "")
    }

    private static func list(_ effects: [Any]) -> String {
        effects.isEmpty ? "" : "; effects: " + effects.map(short).joined(separator: ", ")
    }
}
