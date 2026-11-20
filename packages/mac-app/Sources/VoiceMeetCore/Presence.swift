import Foundation

/// WHETHER A PERSON IS LIKELY AT THIS MAC, as `state()` says it: an agent reads it before it rings.
/// Three facts, read when asked, kept nowhere: the seconds since the last key press, mouse move or
/// click (of any app, no permission needed), whether the session's screen is locked, and whether
/// every display sleeps. Idle under some minutes, not locked and a display awake is the sign that a
/// person is likely there; none of it says who.
public struct Presence: Equatable, Sendable {
    public let idleSeconds: Int
    public let screenLocked: Bool
    public let displayAsleep: Bool

    public init(idleSeconds: Int, screenLocked: Bool, displayAsleep: Bool) {
        self.idleSeconds = idleSeconds
        self.screenLocked = screenLocked
        self.displayAsleep = displayAsleep
    }

    /// The facts from what macOS gives: `idle` from `CGEventSource.secondsSinceLastEventType`, the
    /// session's dictionary from `CGSessionCopyCurrentDictionary` (nil when there is none), and
    /// `CGDisplayIsAsleep` of each online display.
    public static func read(idle: Double, session: [String: Any]?, displaysAsleep: [Bool]) -> Presence {
        // a huge value (no input since the boot) is kept in bounds; an odd one is none
        let seconds = idle.isNaN || idle <= 0 ? 0 : Int(min(idle, Double(Int32.max)))
        // the key is there only while the screen is locked; a session that is not on the console
        // (another user's in front, by fast user switching) is as locked for whoever is there
        let locked = flag(session?["CGSSessionScreenIsLocked"]) || session.map { !flag($0["kCGSSessionOnConsoleKey"] ?? true) } ?? true
        // no display online (a closed lid with none other) is no display to see
        let asleep = displaysAsleep.allSatisfy { $0 }
        return Presence(idleSeconds: seconds, screenLocked: locked, displayAsleep: asleep)
    }

    public var dictionary: [String: Any] {
        ["idleSeconds": idleSeconds, "screenLocked": screenLocked, "displayAsleep": displayAsleep]
    }

    private static func flag(_ value: Any?) -> Bool {
        if let bool = value as? Bool { return bool }
        if let number = value as? NSNumber { return number.intValue != 0 }
        return false
    }
}
