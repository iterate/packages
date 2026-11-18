import Foundation
import OSLog

/// The app's log. Every line goes to two places:
///
/// - the system's unified log, subsystem `com.iterate.voice-meet-mac`;
/// - the text file `~/Library/Logs/voice-meet-mac/app.log`, which a person or an agent can follow
///   with `tail -F`.
///
/// The lines hold states, events, formats, sizes, counts, device names and errors. They hold no
/// picture, no sound and no window title.
struct AppLog: Sendable {
    static let subsystem = "com.iterate.voice-meet-mac"
    static let directory = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Logs/voice-meet-mac", isDirectory: true)
    static let fileURL = directory.appendingPathComponent("app.log")

    private let category: String
    private let logger: Logger

    init(_ category: String) {
        self.category = category
        logger = Logger(subsystem: Self.subsystem, category: category)
    }

    func info(_ message: String) {
        logger.info("\(message, privacy: .public)")
        LogFile.shared.write(level: "I", category: category, message: message)
    }

    func error(_ message: String) {
        logger.error("\(message, privacy: .public)")
        LogFile.shared.write(level: "E", category: category, message: message)
    }

    /// The domain and the code say more than the localized text ("The operation couldn't be completed").
    static func describe(_ error: Error) -> String {
        let nsError = error as NSError
        var text = "\(nsError.domain) \(nsError.code): \(nsError.localizedDescription)"
        if let underlying = nsError.userInfo[NSUnderlyingErrorKey] as? NSError {
            text += " (underlying \(underlying.domain) \(underlying.code))"
        }
        return text
    }
}

/// The one writer of `app.log`. A lock makes it safe from every thread; each line is written at
/// once, so a crash loses nothing that was logged.
private final class LogFile: @unchecked Sendable {
    static let shared = LogFile()

    private let lock = NSLock()
    private let handle: FileHandle?
    private let timestamps: ISO8601DateFormatter

    private init() {
        timestamps = ISO8601DateFormatter()
        timestamps.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let manager = FileManager.default
        try? manager.createDirectory(at: AppLog.directory, withIntermediateDirectories: true)
        if !manager.fileExists(atPath: AppLog.fileURL.path) {
            manager.createFile(atPath: AppLog.fileURL.path, contents: nil)
        }
        handle = try? FileHandle(forWritingTo: AppLog.fileURL)
        _ = try? handle?.seekToEnd()
    }

    func write(level: String, category: String, message: String) {
        // Under the lock: a date formatter may not be used from two threads at once.
        lock.lock()
        defer { lock.unlock() }
        let line = "\(timestamps.string(from: Date())) \(level) [\(category)] \(message)\n"
        try? handle?.write(contentsOf: Data(line.utf8))
    }
}
