import XCTest

@testable import VoiceMeetCore

final class PresenceTests: XCTestCase {
    private let onConsole: [String: Any] = ["kCGSSessionOnConsoleKey": 1, "kCGSessionLoginDoneKey": 1]

    func testAnUnlockedSessionInFrontWithADisplayAwake() {
        let presence = Presence.read(idle: 42.7, session: onConsole, displaysAsleep: [false, true])
        XCTAssertEqual(presence, Presence(idleSeconds: 42, screenLocked: false, displayAsleep: false))
        XCTAssertEqual(presence.dictionary["idleSeconds"] as? Int, 42)
    }

    func testTheLockKeyIsThereOnlyWhileLocked() {
        var locked = onConsole
        locked["CGSSessionScreenIsLocked"] = 1
        XCTAssertTrue(Presence.read(idle: 1, session: locked, displaysAsleep: [false]).screenLocked)
        locked["CGSSessionScreenIsLocked"] = true
        XCTAssertTrue(Presence.read(idle: 1, session: locked, displaysAsleep: [false]).screenLocked)
    }

    func testASessionNotOnTheConsoleOrNoSessionIsLocked() {
        XCTAssertTrue(Presence.read(idle: 1, session: ["kCGSSessionOnConsoleKey": 0], displaysAsleep: [false]).screenLocked)
        XCTAssertTrue(Presence.read(idle: 1, session: nil, displaysAsleep: [false]).screenLocked)
        // a dictionary with no console key is taken as on the console
        XCTAssertFalse(Presence.read(idle: 1, session: [:], displaysAsleep: [false]).screenLocked)
    }

    func testEveryDisplayAsleepOrNoneOnlineIsAsleep() {
        XCTAssertTrue(Presence.read(idle: 1, session: onConsole, displaysAsleep: [true, true]).displayAsleep)
        XCTAssertTrue(Presence.read(idle: 1, session: onConsole, displaysAsleep: []).displayAsleep)
    }

    func testAnOddIdleValueIsKeptInBounds() {
        XCTAssertEqual(Presence.read(idle: .nan, session: onConsole, displaysAsleep: [false]).idleSeconds, 0)
        XCTAssertEqual(Presence.read(idle: .infinity, session: onConsole, displaysAsleep: [false]).idleSeconds, Int(Int32.max))
        XCTAssertEqual(Presence.read(idle: -3, session: onConsole, displaysAsleep: [false]).idleSeconds, 0)
        XCTAssertEqual(Presence.read(idle: 1e300, session: onConsole, displaysAsleep: [false]).idleSeconds, Int(Int32.max))
    }
}
