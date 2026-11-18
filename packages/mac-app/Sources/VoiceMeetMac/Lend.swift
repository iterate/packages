import Foundation

/// The lend of this Mac to its mind, kept by the app: it runs `iterate provide` of the bridge file
/// with the Mac's key, as `npx @iterate-com/mac-app` set it up, and runs it again when it ends.
/// Once an hour it asks npm for a newer version of the package and runs its `update`.
@MainActor
final class Lend {
    enum Phase: Equatable {
        /// `npx @iterate-com/mac-app` has not set this Mac up.
        case notSetUp
        case connecting
        case live
        case waiting(seconds: Int, reason: String)
    }

    /// What `npx @iterate-com/mac-app` wrote (cli.mjs `setup`).
    struct Config: Decodable {
        let mind: String
        let name: String
        let login: Bool
        let spec: String
        let node: String
        let iterateBin: String
        let bridge: String
        let keyFile: String
        let version: String
    }

    static let folder = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/iterate-mac-app")

    private(set) var phase: Phase = .notSetUp
    private(set) var config: Config?
    var onChange: (() -> Void)?
    /// True while a capture runs: an update waits for its end.
    var isBusy: () -> Bool = { false }

    private let log = AppLog("lend")
    private var process: Process?
    private var failures = 0
    private var stopping = false
    private var updateTimer: Timer?

    func start() {
        let file = Self.folder.appendingPathComponent("config.json")
        guard let data = try? Data(contentsOf: file), let config = try? JSONDecoder().decode(Config.self, from: data) else {
            log.info("not set up: no \(file.path); run npx @iterate-com/mac-app")
            return
        }
        self.config = config
        log.info("set up: lends to \(config.mind) as itx.\(config.name), version \(config.version), from \(config.spec)")
        run()
        let timer = Timer(timeInterval: 3600, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.checkForUpdate() }
        }
        RunLoop.main.add(timer, forMode: .common)
        updateTimer = timer
        DispatchQueue.main.asyncAfter(deadline: .now() + 60) { [weak self] in self?.checkForUpdate() }
    }

    func stop() {
        stopping = true
        process?.terminate()
    }

    private func set(_ phase: Phase) {
        self.phase = phase
        onChange?()
    }

    private func run() {
        guard let config, !stopping else { return }
        guard FileManager.default.isExecutableFile(atPath: config.node) else {
            return set(.waiting(seconds: 0, reason: "Node is gone from \(config.node): run npx @iterate-com/mac-app again"))
        }
        let child = Process()
        child.executableURL = URL(fileURLWithPath: config.node)
        child.arguments = [config.iterateBin, "provide", config.bridge, "--key", config.keyFile, "--name", config.name, "--mind", config.mind]
        var environment = ProcessInfo.processInfo.environment
        environment["ITERATE_MAC_APP_SUPERVISED"] = "1"
        child.environment = environment
        let output = Pipe()
        child.standardOutput = output
        child.standardError = output
        let startedAt = Date()
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return handle.readabilityHandler = nil }
            let text = String(decoding: data, as: UTF8.self)
            Task { @MainActor in
                guard let self else { return }
                for line in text.split(separator: "\n") where !line.isEmpty { self.log.info("provide: \(line.prefix(400))") }
                if text.contains("is live for") || text.contains("is live again") { self.set(.live) }
                if text.contains("disconnected") { self.set(.connecting) }
            }
        }
        child.terminationHandler = { [weak self] ended in
            let status = ended.terminationStatus
            Task { @MainActor in
                guard let self, !self.stopping else { return }
                self.process = nil
                // A lend that ran for a while starts again at once; one that failed at its start
                // waits longer each time, at most 5 minutes.
                self.failures = Date().timeIntervalSince(startedAt) > 60 ? 0 : self.failures + 1
                let wait = min(300, 2 << min(self.failures, 8))
                self.log.info("the lend ended (\(status)); again in \(wait) s")
                self.set(.waiting(seconds: wait, reason: "the lend ended (\(status))"))
                DispatchQueue.main.asyncAfter(deadline: .now() + .seconds(wait)) { [weak self] in self?.run() }
            }
        }
        do {
            try child.run()
            process = child
            set(.connecting)
        } catch {
            log.error("the lend did not start: \(AppLog.describe(error))")
            set(.waiting(seconds: 0, reason: "the lend did not start"))
        }
    }

    /// Asks npm for the newest version. Only for the registry: a pkg.pr.new link or a folder is a
    /// trial, updated by hand.
    private func checkForUpdate() {
        guard let config, config.spec.hasPrefix("@iterate-com/mac-app") else { return }
        guard let url = URL(string: "https://registry.npmjs.org/@iterate-com/mac-app/latest") else { return }
        Task { @MainActor in
            guard let (data, _) = try? await URLSession.shared.data(from: url),
                let latest = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["version"] as? String,
                latest != config.version
            else { return }
            guard !isBusy() else { return log.info("version \(latest) is out; the update waits for the capture to end") }
            log.info("version \(latest) is out (this is \(config.version)): updating")
            let npx = URL(fileURLWithPath: config.node).deletingLastPathComponent().appendingPathComponent("npx")
            let update = Process()
            update.executableURL = npx
            update.arguments = ["--yes", config.spec, "update"]
            var environment = ProcessInfo.processInfo.environment
            environment["PATH"] = "\(npx.deletingLastPathComponent().path):/usr/bin:/bin:/usr/sbin:/sbin"
            update.environment = environment
            // The update quits this app and opens the new one; it must outlive this process.
            try? update.run()
        }
    }
}
