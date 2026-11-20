import Foundation

/// The lend of this Mac to one mind: the app runs `iterate provide <bridge> --key … --json` and
/// reads the states it prints on stdout, one JSON object per line (core/lib/src/cli/provide-state.ts).
/// Its human lines on stderr go to the log, and the last one is the reason when the process ends
/// with no state. The CLI keeps a connection and reconnects by itself after it closes; the app
/// starts the process again when it ends. This machine turns the CLI's states and the process's end
/// into one phase that the panel says in words.
public enum LendPhase: Equatable, Sendable {
    /// No mind to lend to: none is set up, or none is active.
    case idle
    /// The lend process runs and is not live yet.
    case connecting(since: Date)
    case live(since: Date)
    /// The connection closed; the CLI tries again by itself at `nextTryAt` (its attempt `attempt`
    /// of `of`).
    case reconnecting(attempt: Int, of: Int, nextTryAt: Date, lastFailure: String)
    /// The lend process ended; the app starts it again at `nextStartAt`.
    case stopped(reason: String, nextStartAt: Date)
    /// The mind gave the key no token: a member has not allowed it yet, or removed it. `link` is
    /// where a member allows it. `nextStartAt` is set when the process ended and starts again then.
    case notAllowed(reason: String, link: String?, nextStartAt: Date?)
    /// This iterate CLI and the mind do not agree on the protocol: one of them is too old.
    case incompatible(reason: String, nextStartAt: Date?)
}

/// One line of `iterate provide --json` (core/lib/src/cli/provide-state.ts), as it prints it.
public enum ProvideState: Equatable, Sendable, Decodable {
    case connecting(mind: String, name: String)
    case live(mind: String, name: String, again: Bool)
    case reconnecting(attempt: Int, of: Int, inMs: Int, lastFailure: String)
    case notAllowed(why: String, link: String?, waiting: Bool)
    case incompatible(why: String)
    case stopped(why: String)

    private enum Keys: String, CodingKey {
        case state, mind, name, again, attempt, of, inMs, lastFailure, why, link, waiting
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: Keys.self)
        switch try values.decode(String.self, forKey: .state) {
        case "connecting":
            self = .connecting(mind: try values.decode(String.self, forKey: .mind), name: try values.decode(String.self, forKey: .name))
        case "live":
            self = .live(
                mind: try values.decode(String.self, forKey: .mind), name: try values.decode(String.self, forKey: .name),
                again: try values.decode(Bool.self, forKey: .again))
        case "reconnecting":
            self = .reconnecting(
                attempt: try values.decode(Int.self, forKey: .attempt), of: try values.decode(Int.self, forKey: .of),
                inMs: try values.decode(Int.self, forKey: .inMs), lastFailure: try values.decode(String.self, forKey: .lastFailure))
        case "notAllowed":
            self = .notAllowed(
                why: try values.decode(String.self, forKey: .why), link: try values.decodeIfPresent(String.self, forKey: .link),
                waiting: try values.decode(Bool.self, forKey: .waiting))
        case "incompatible":
            self = .incompatible(why: try values.decode(String.self, forKey: .why))
        case "stopped":
            self = .stopped(why: try values.decode(String.self, forKey: .why))
        case let other:
            throw DecodingError.dataCorruptedError(forKey: .state, in: values, debugDescription: "no state \(other)")
        }
    }

    /// One line of stdout, or nil when it is not one of the states.
    public static func of(line: String) -> ProvideState? {
        try? JSONDecoder().decode(ProvideState.self, from: Data(line.utf8))
    }
}

public enum LendEvent: Equatable, Sendable {
    /// A mind became active (at the start, or at a switch): its lend starts.
    case started
    /// No mind is active any more.
    case stopRequested
    /// One line the CLI printed on stdout: a state, in JSON.
    case stateLine(String)
    /// One line the CLI printed on stderr, for a person.
    case humanLine(String)
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
    /// After the key was refused, or the CLI and the mind did not agree, the next start waits this
    /// long: a member allows the key, or an update comes, in between.
    public static let refusedWaitSeconds = 300
    /// The panel's words for an incompatible CLI.
    public static let updateTheCLI = "Update the iterate CLI: run `npx @iterate-com/mac-app update`."

    public private(set) var phase: LendPhase = .idle
    /// The last human line that was no stack frame: the reason when the process ends with no state.
    public private(set) var lastLine = ""
    /// The `stopped` state's reason: it wins over `lastLine`, which stderr may print after it.
    public private(set) var stoppedWhy: String?
    /// Starts that ended quickly, one after the other: each waits longer (`backOff`).
    public private(set) var quickFailures = 0
    /// The mind's address as the CLI says it (`connecting` and `live`), for example
    /// `iterate.example.com`. The config may name the mind shorter (`example.com`). Nil until the
    /// CLI said it, and after a stop.
    public private(set) var mindAddress: String?

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
            mindAddress = nil
            return [.stopProcess]
        case (_, .started), (_, .reconnectNow):
            if case .idle = phase, case .reconnectNow = event { return [] }
            // a new or switched mind, or a person's or a wake's start, waits from the first wait again
            quickFailures = 0
            phase = .connecting(since: now)
            lastLine = ""
            stoppedWhy = nil
            return [.startProcess]
        case (.idle, _), (.live, .networkCameBack):
            return []
        case (_, .networkCameBack):
            // the failures were the network's: the next ones wait from the first wait again
            quickFailures = 0
            phase = .connecting(since: now)
            lastLine = ""
            stoppedWhy = nil
            return [.startProcess]
        case (_, .timerFired):
            switch phase {
            case .stopped, .notAllowed(_, _, .some), .incompatible(_, .some):
                phase = .connecting(since: now)
                lastLine = ""
                stoppedWhy = nil
                return [.startProcess]
            default:
                return []
            }
        case (_, .stateLine(let text)):
            if let state = ProvideState.of(line: text) { read(state, now: now) }
            return []
        case (_, .humanLine(let raw)):
            let text = raw.trimmingCharacters(in: .whitespaces)
            // a stack trace's frames ("at …") follow the error's own line; the error is the reason
            if !text.isEmpty, !text.hasPrefix("at "), text != "^" { lastLine = text }
            return []
        case (_, .processEnded(let status, let ranFor)):
            quickFailures = ranFor > 60 ? 0 : quickFailures + 1
            let refusedUntil = now.addingTimeInterval(TimeInterval(Self.refusedWaitSeconds))
            if case .notAllowed(let reason, let link, _) = phase {
                phase = .notAllowed(reason: reason, link: link, nextStartAt: refusedUntil)
                return [.startProcessAfter(seconds: Self.refusedWaitSeconds)]
            }
            if case .incompatible(let reason, _) = phase {
                phase = .incompatible(reason: reason, nextStartAt: refusedUntil)
                return [.startProcessAfter(seconds: Self.refusedWaitSeconds)]
            }
            let wait = Self.backOff(quickFailures: quickFailures)
            let said = stoppedWhy ?? (lastLine.isEmpty ? "it printed nothing" : Self.withoutPrefix(lastLine))
            phase = .stopped(reason: "the lend process ended (exit \(status)): \(said)", nextStartAt: now.addingTimeInterval(TimeInterval(wait)))
            return [.startProcessAfter(seconds: wait)]
        }
    }

    /// One state of the CLI.
    private mutating func read(_ state: ProvideState, now: Date) {
        switch state {
        case .connecting(let mind, _):
            mindAddress = mind
            if case .connecting = phase { return }
            phase = .connecting(since: now)
        case .live(let mind, _, _):
            mindAddress = mind
            phase = .live(since: now)
            quickFailures = 0
        case .reconnecting(let attempt, let of, let inMs, let lastFailure):
            phase = .reconnecting(attempt: attempt, of: of, nextTryAt: now.addingTimeInterval(TimeInterval(inMs) / 1000), lastFailure: lastFailure)
        case .notAllowed(let why, let link, _):
            phase = .notAllowed(reason: why, link: link, nextStartAt: nil)
        case .incompatible(let why):
            phase = .incompatible(reason: why, nextStartAt: nil)
        case .stopped(let why):
            // the process ends right after it: its end says this
            stoppedWhy = why
        }
    }

    /// "Error: X" → "X".
    private static func withoutPrefix(_ text: String) -> String {
        text.hasPrefix("Error: ") ? String(text.dropFirst("Error: ".count)) : text
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
        case .reconnecting(let attempt, let of, let next, let failure):
            let when = inSeconds(next) > 0 ? "next try in \(inSeconds(next)) s" : "trying now"
            return "Reconnecting: attempt \(attempt) of \(of), \(when). Last failure: \(failure)"
        case .stopped(let reason, let next):
            let when = inSeconds(next) > 0 ? "Next start in \(inSeconds(next)) s" : "Starting again now"
            return "Stopped: \(reason)\(reason.hasSuffix(".") ? "" : ".") \(when)"
        case .notAllowed(let reason, let link, let next):
            let fix = link == nil
                ? "A member allows the key on the mind's /keys page, or add the mind again."
                : "A member opens the link and allows it with a passkey."
            let again = next.map { " Next try in \(inSeconds($0)) s." } ?? ""
            return "Not allowed: \(reason) \(fix)\(again)"
        case .incompatible(let reason, let next):
            let again = next.map { " Next try in \(inSeconds($0)) s." } ?? ""
            return "Incompatible: \(reason). \(Self.updateTheCLI)\(again)"
        }
    }
}

extension LendPhase {
    /// The try the CLI is on, while it reconnects.
    public var attempt: Int? {
        if case .reconnecting(let attempt, _, _, _) = self { return attempt }
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
        case .incompatible: return "incompatible"
        }
    }
}
