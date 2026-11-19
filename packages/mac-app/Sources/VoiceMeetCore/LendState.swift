import Foundation

/// The lend of this Mac to one mind: the app runs `iterate provide <bridge> --key …` and reads the
/// lines it prints (core/lib/src/cli/provide.ts and bridge-key.ts), as they are. The CLI keeps a
/// connection and reconnects by itself after it closes; the app starts the process again when it
/// ends. This machine turns the CLI's lines and the process's end into one phase that the panel
/// says in words.
public enum LendPhase: Equatable, Sendable {
    /// No mind to lend to: none is set up, or none is active.
    case idle
    /// The lend process runs and has not said "is live" yet.
    case connecting(since: Date)
    case live(since: Date)
    /// The connection closed; the CLI tries again by itself. `nextTryAt` is when, by its schedule
    /// (`reconnectDelaysSeconds`); nil after its last try, when it gives up and ends.
    case reconnecting(attempt: Int, nextTryAt: Date?, lastFailure: String)
    /// The lend process ended; the app starts it again at `nextStartAt`.
    case stopped(reason: String, nextStartAt: Date)
    /// The mind gave the key no token: a member has not allowed it yet, or removed it. `link` is
    /// where a member allows it. `nextStartAt` is set when the process ended and starts again then.
    case notAllowed(reason: String, link: String?, nextStartAt: Date?)
}

public enum LendEvent: Equatable, Sendable {
    /// A mind became active (at the start, or at a switch): its lend starts.
    case started
    /// No mind is active any more.
    case stopRequested
    /// One line the CLI printed, on stdout or stderr.
    case line(String)
    /// The lend process ended by itself, after it ran for `ranFor` seconds.
    case processEnded(status: Int32, ranFor: TimeInterval)
    /// The wait before the next start is over.
    case timerFired
    /// The person pressed "Reconnect now" or the Mac woke from sleep: start again at once, even
    /// from live (after a sleep the connection is most often dead, and the CLI notices it late).
    case reconnectNow(why: String)
    /// The network came back after it was gone: start again at once, unless the lend is live.
    case networkCameBack
}

public enum LendEffect: Equatable, Sendable {
    /// End the lend process if one runs, cancel a wait, and start a new process now.
    case startProcess
    /// End the lend process if one runs, and cancel a wait.
    case stopProcess
    /// Start a new process after this many seconds (one wait at a time: a new one replaces it).
    case startProcessAfter(seconds: Int)
}

public struct LendState: Equatable, Sendable {
    /// The CLI's schedule (provide.ts `RECONNECT_DELAYS_MS`), in seconds: the wait before each try
    /// to reconnect. The CLI does not print it, so the app keeps a copy to say "next try in".
    public static let reconnectDelaysSeconds: [Int] = [1, 2, 4, 8, 15] + Array(repeating: 30, count: 9)
    /// After the key was refused, the next start waits this long: a member allows it in between.
    public static let notAllowedWaitSeconds = 300

    public private(set) var phase: LendPhase = .idle
    /// The last line the CLI printed that was not a link or blank: the reason when it ends.
    public private(set) var lastLine = ""
    /// Starts that ended quickly, one after the other: each waits longer (`backOff`).
    public private(set) var quickFailures = 0

    public init() {}

    public var isLive: Bool {
        if case .live = phase { return true }
        return false
    }

    /// The wait after the n-th quick failure: 4, 8, 16 … at most 60 seconds, so a mind that cannot
    /// be reached for a while is lent again within a minute of its return. A lend that ran for over
    /// a minute starts again after 2 seconds.
    public static func backOff(quickFailures: Int) -> Int { min(60, 2 << min(quickFailures, 8)) }

    /// Every pair of phase and event has a defined result. `now` is the clock, a test's or the Mac's.
    public mutating func handle(_ event: LendEvent, now: Date) -> [LendEffect] {
        switch (phase, event) {
        case (_, .stopRequested):
            phase = .idle
            quickFailures = 0
            return [.stopProcess]
        case (_, .started), (_, .reconnectNow):
            if case .idle = phase, case .reconnectNow = event { return [] }
            // a new or switched mind starts its back-off from the first wait
            // a new or switched mind, or a person's or a wake's start, waits from the first wait again
            quickFailures = 0
            phase = .connecting(since: now)
            lastLine = ""
            return [.startProcess]
        case (.idle, _), (.live, .networkCameBack):
            return []
        case (_, .networkCameBack):
            // the failures were the network's: the next ones wait from the first wait again
            quickFailures = 0
            phase = .connecting(since: now)
            lastLine = ""
            return [.startProcess]
        case (_, .timerFired):
            switch phase {
            case .stopped, .notAllowed(_, _, .some):
                phase = .connecting(since: now)
                lastLine = ""
                return [.startProcess]
            default:
                return []
            }
        case (_, .line(let text)):
            return read(text, now: now)
        case (_, .processEnded(let status, let ranFor)):
            quickFailures = ranFor > 60 ? 0 : quickFailures + 1
            if case .notAllowed(let reason, let link, _) = phase {
                let wait = Self.notAllowedWaitSeconds
                phase = .notAllowed(reason: reason, link: link, nextStartAt: now.addingTimeInterval(TimeInterval(wait)))
                return [.startProcessAfter(seconds: wait)]
            }
            let wait = Self.backOff(quickFailures: quickFailures)
            let said = lastLine.isEmpty ? "it printed nothing" : Self.withoutPrefix(lastLine)
            phase = .stopped(reason: "the lend process ended (exit \(status)): \(said)", nextStartAt: now.addingTimeInterval(TimeInterval(wait)))
            return [.startProcessAfter(seconds: wait)]
        }
    }

    /// One line of the CLI. Lines it does not know change nothing but `lastLine`.
    private mutating func read(_ raw: String, now: Date) -> [LendEffect] {
        let text = raw.trimmingCharacters(in: .whitespaces)
        // a stack trace's frames ("at …") follow the error's own line; the error is the reason
        guard !text.isEmpty, !text.hasPrefix("at "), text != "^" else { return [] }
        if text.hasPrefix("https://"), text.contains("/keys/enrol") {
            // the link alone on its line, after "is not allowed on … yet"
            if case .notAllowed(let reason, _, let next) = phase { phase = .notAllowed(reason: reason, link: text, nextStartAt: next) }
            return []
        }
        lastLine = text
        let link = text.range(of: #"https://\S+/keys/enrol\S*"#, options: .regularExpression).map { String(text[$0]) }
        if text.contains(" is live for ") || text.contains(" is live again") {
            phase = .live(since: now)
            quickFailures = 0
        } else if text.contains("is not allowed on") && text.hasSuffix("yet. A member of the mind opens this link and signs with a passkey:") {
            phase = .notAllowed(reason: "No member has allowed this Mac's key yet.", link: link, nextStartAt: nil)
        } else if text.contains("is not allowed on") || text.contains("gave this bridge's key no token")
            || text.contains("Nobody allowed this bridge's key in time") || text.contains("This key was allowed to lend")
        {
            phase = .notAllowed(reason: Self.withoutLink(Self.withoutPrefix(text)), link: link ?? phase.link, nextStartAt: nil)
        } else if text.contains(" disconnected (") && text.hasSuffix("Reconnecting...") {
            let reason = text.range(of: #"\((.*)\)"#, options: .regularExpression).map { String(text[$0].dropFirst().dropLast()) } ?? text
            phase = .reconnecting(attempt: 1, nextTryAt: Self.nextTry(attempt: 1, now: now), lastFailure: reason)
        } else if text.hasPrefix("Could not reconnect: ") || (text.hasPrefix("Could not lend ") && text.contains(" again: ")) {
            let attempt = (phase.attempt ?? 0) + 1
            phase = .reconnecting(attempt: attempt, nextTryAt: Self.nextTry(attempt: attempt, now: now), lastFailure: Self.withoutPrefix(text))
        }
        return []
    }

    /// The CLI's n-th try comes `reconnectDelaysSeconds[n - 1]` after the one before; after the
    /// last it gives up.
    private static func nextTry(attempt: Int, now: Date) -> Date? {
        guard attempt >= 1, attempt <= reconnectDelaysSeconds.count else { return nil }
        return now.addingTimeInterval(TimeInterval(reconnectDelaysSeconds[attempt - 1]))
    }

    /// "Could not reconnect: X" → "X".
    private static func withoutPrefix(_ text: String) -> String {
        for prefix in ["Could not reconnect: ", "Error: "] where text.hasPrefix(prefix) { return String(text.dropFirst(prefix.count)) }
        if text.hasPrefix("Could not lend "), let range = text.range(of: " again: ") { return String(text[range.upperBound...]) }
        return text
    }

    private static func withoutLink(_ text: String) -> String {
        guard let range = text.range(of: " A member allows it at ") else { return text }
        return String(text[..<range.lowerBound])
    }

    /// The phase in words, with its reason and time. `clock` writes a time of day.
    public func statusLine(now: Date, clock: (Date) -> String) -> String {
        let inSeconds = { (date: Date) in max(0, Int(date.timeIntervalSince(now).rounded(.up))) }
        switch phase {
        case .idle:
            return "Not lent: no mind is active"
        case .connecting(let since):
            return "Connecting… (since \(clock(since)))"
        case .live(let since):
            return "Live since \(clock(since))"
        case .reconnecting(let attempt, let next, let failure):
            let when = next.map { inSeconds($0) > 0 ? "next try in \(inSeconds($0)) s" : "trying now" } ?? "the CLI gave up; it starts again"
            return "Reconnecting: attempt \(attempt), \(when). Last failure: \(failure)"
        case .stopped(let reason, let next):
            let when = inSeconds(next) > 0 ? "Next start in \(inSeconds(next)) s" : "Starting again now"
            return "Stopped: \(reason)\(reason.hasSuffix(".") ? "" : ".") \(when)"
        case .notAllowed(let reason, let link, let next):
            let fix = link == nil
                ? "A member allows the key on the mind's /keys page, or add the mind again."
                : "A member opens the link and allows it with a passkey."
            let again = next.map { " Next try in \(inSeconds($0)) s." } ?? ""
            return "Not allowed: \(reason) \(fix)\(again)"
        }
    }
}

extension LendPhase {
    /// The try the CLI is on, while it reconnects.
    public var attempt: Int? {
        if case .reconnecting(let attempt, _, _) = self { return attempt }
        return nil
    }

    /// Where a member allows the key, when the CLI printed it.
    public var link: String? {
        if case .notAllowed(_, let link, _) = self { return link }
        return nil
    }

    /// One word for the log.
    public var name: String {
        switch self {
        case .idle: return "idle"
        case .connecting: return "connecting"
        case .live: return "live"
        case .reconnecting: return "reconnecting"
        case .stopped: return "stopped"
        case .notAllowed: return "not allowed"
        }
    }
}
