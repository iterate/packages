import XCTest

@testable import VoiceMeetCore

/// The lines are the CLI's own (core/lib/src/cli/provide.ts, bridge-key.ts), copied as it prints them.
final class LendStateTests: XCTestCase {
    private let start = Date(timeIntervalSince1970: 1_800_000_000)
    private func at(_ seconds: TimeInterval) -> Date { start.addingTimeInterval(seconds) }
    private let clock: (Date) -> String = { "t\(Int($0.timeIntervalSince1970) - 1_800_000_000)" }

    func testALendGoesLiveFromTheCLIsLine() {
        var state = LendState()
        XCTAssertEqual(state.handle(.started, now: at(0)), [.startProcess])
        XCTAssertEqual(state.phase, .connecting(since: at(0)))
        XCTAssertEqual(state.handle(.line("itx.jane.mac"), now: at(1)), [])
        XCTAssertEqual(state.handle(.line("itx.jane.mac is live for example.com. Press Ctrl-C to stop."), now: at(2)), [])
        XCTAssertEqual(state.phase, .live(since: at(2)))
        XCTAssertEqual(state.statusLine(now: at(9), clock: clock), "Live since t2")
    }

    func testReconnectingCountsTheCLIsAttemptsAndSaysTheNextTry() {
        var state = live()
        _ = state.handle(.line("itx.jane.mac disconnected (1006: connection closed). Reconnecting..."), now: at(10))
        XCTAssertEqual(state.phase, .reconnecting(attempt: 1, nextTryAt: at(11), lastFailure: "1006: connection closed"))
        _ = state.handle(.line("Could not reconnect: fetch failed"), now: at(11))
        XCTAssertEqual(state.phase, .reconnecting(attempt: 2, nextTryAt: at(13), lastFailure: "fetch failed"))
        XCTAssertEqual(
            state.statusLine(now: at(11.5), clock: clock),
            "Reconnecting: attempt 2, next try in 2 s. Last failure: fetch failed"
        )
        _ = state.handle(.line("Could not lend itx.jane.mac again: the stub was disposed"), now: at(13))
        XCTAssertEqual(state.phase.attempt, 3)
        _ = state.handle(.line("Reconnected: itx.jane.mac is live again."), now: at(17))
        XCTAssertEqual(state.phase, .live(since: at(17)))
    }

    func testAnEndedProcessStartsAgainWithALongerWaitEachQuickTime() {
        var state = LendState()
        _ = state.handle(.started, now: at(0))
        _ = state.handle(.line("getaddrinfo ENOTFOUND example.com"), now: at(1))
        XCTAssertEqual(state.handle(.processEnded(status: 1, ranFor: 1), now: at(1)), [.startProcessAfter(seconds: 4)])
        XCTAssertEqual(state.phase, .stopped(reason: "the lend process ended (exit 1): getaddrinfo ENOTFOUND example.com", nextStartAt: at(5)))
        XCTAssertEqual(state.handle(.timerFired, now: at(5)), [.startProcess])
        XCTAssertEqual(state.handle(.processEnded(status: 1, ranFor: 1), now: at(6)), [.startProcessAfter(seconds: 8)])
        XCTAssertEqual(state.handle(.timerFired, now: at(14)), [.startProcess])
        // one that ran for a while starts again soon
        XCTAssertEqual(state.handle(.processEnded(status: 1, ranFor: 600), now: at(614)), [.startProcessAfter(seconds: 2)])
    }

    func testANewMindStartsItsBackOffFromTheFirstWait() {
        var state = LendState()
        _ = state.handle(.started, now: at(0))
        _ = state.handle(.processEnded(status: 1, ranFor: 1), now: at(1))
        _ = state.handle(.timerFired, now: at(5))
        XCTAssertEqual(state.handle(.processEnded(status: 1, ranFor: 1), now: at(6)), [.startProcessAfter(seconds: 8)])
        // a switch to another mind
        _ = state.handle(.started, now: at(7))
        XCTAssertEqual(state.handle(.processEnded(status: 1, ranFor: 1), now: at(8)), [.startProcessAfter(seconds: 4)])
        // no mind, then one again
        _ = state.handle(.stopRequested, now: at(9))
        XCTAssertEqual(state.quickFailures, 0)
    }

    func testAnErrorWithAStackTraceIsTheReasonAndTheNetworkStartsTheWaitsAnew() {
        var state = LendState()
        _ = state.handle(.started, now: at(0))
        // each start prints the error and its stack trace again
        let printed = [
            "Error: example.com could not be reached. Check the address.",
            "    at async Command.parseAsync (/x/commander/lib/command.js:1122:5)",
            "    at async file:///x/iterate/bin/iterate.js:102:3",
        ]
        for _ in 1...6 {
            for line in printed { _ = state.handle(.line(line), now: at(1)) }
            _ = state.handle(.processEnded(status: 1, ranFor: 1), now: at(1))
            _ = state.handle(.timerFired, now: at(2))
        }
        for line in printed { _ = state.handle(.line(line), now: at(2)) }
        XCTAssertEqual(state.handle(.processEnded(status: 1, ranFor: 1), now: at(2)), [.startProcessAfter(seconds: 60)])
        XCTAssertEqual(
            state.statusLine(now: at(2), clock: clock),
            "Stopped: the lend process ended (exit 1): example.com could not be reached. Check the address. Next start in 60 s"
        )
        XCTAssertEqual(
            state.statusLine(now: at(70), clock: clock),
            "Stopped: the lend process ended (exit 1): example.com could not be reached. Check the address. Starting again now"
        )
        XCTAssertEqual(state.handle(.networkCameBack, now: at(30)), [.startProcess])
        XCTAssertEqual(state.handle(.processEnded(status: 1, ranFor: 0), now: at(31)), [.startProcessAfter(seconds: 4)])
    }

    func testReconnectNowEndsTheWaitAndAnAttempt() {
        var state = LendState()
        _ = state.handle(.started, now: at(0))
        _ = state.handle(.processEnded(status: 1, ranFor: 1), now: at(1))
        XCTAssertEqual(state.handle(.reconnectNow(why: "the person pressed Reconnect now"), now: at(2)), [.startProcess])
        XCTAssertEqual(state.phase, .connecting(since: at(2)))
        // a timer of the old wait that fires anyway starts nothing
        XCTAssertEqual(state.handle(.timerFired, now: at(5)), [])
        var reconnecting = live()
        _ = reconnecting.handle(.line("itx.jane.mac disconnected (1006: gone). Reconnecting..."), now: at(10))
        XCTAssertEqual(reconnecting.handle(.reconnectNow(why: "the Mac woke"), now: at(11)), [.startProcess])
    }

    func testTheNetworkComingBackStartsALendThatIsNotLive() {
        var state = live()
        XCTAssertEqual(state.handle(.networkCameBack, now: at(5)), [])
        XCTAssertTrue(state.isLive)
        _ = state.handle(.line("itx.jane.mac disconnected (1006: gone). Reconnecting..."), now: at(10))
        _ = state.handle(.line("Could not reconnect: fetch failed"), now: at(11))
        XCTAssertEqual(state.handle(.networkCameBack, now: at(12)), [.startProcess])
        XCTAssertEqual(state.phase, .connecting(since: at(12)))
    }

    func testTheCLIGivingUpEndsInStoppedWithItsWords() {
        var state = live()
        _ = state.handle(.line("itx.jane.mac disconnected (1006: gone). Reconnecting..."), now: at(10))
        for attempt in 1...14 { _ = state.handle(.line("Could not reconnect: fetch failed"), now: at(10 + Double(attempt))) }
        XCTAssertEqual(state.phase, .reconnecting(attempt: 15, nextTryAt: nil, lastFailure: "fetch failed"))
        XCTAssertEqual(
            state.statusLine(now: at(30), clock: clock),
            "Reconnecting: attempt 15, the CLI gave up; it starts again. Last failure: fetch failed"
        )
        _ = state.handle(.line("itx.jane.mac disconnected and could not reconnect (fetch failed). Run iterate provide again."), now: at(30))
        XCTAssertEqual(state.handle(.processEnded(status: 1, ranFor: 30), now: at(30)), [.startProcessAfter(seconds: 4)])
        XCTAssertEqual(
            state.statusLine(now: at(31), clock: clock),
            "Stopped: the lend process ended (exit 1): itx.jane.mac disconnected and could not reconnect (fetch failed). Run iterate provide again. Next start in 3 s"
        )
    }

    func testAKeyNoMemberAllowedYetShowsTheLink() {
        var state = LendState()
        _ = state.handle(.started, now: at(0))
        for line in [
            "This bridge's key is not allowed on example.com yet. A member of the mind opens this link and signs with a passkey:",
            "",
            "  https://example.com/keys/enrol?actor=bridge-jane-mac&provide=jane.mac",
            "",
            "Waiting for that...",
        ] {
            _ = state.handle(.line(line), now: at(1))
        }
        XCTAssertEqual(
            state.phase,
            .notAllowed(reason: "No member has allowed this Mac's key yet.", link: "https://example.com/keys/enrol?actor=bridge-jane-mac&provide=jane.mac", nextStartAt: nil)
        )
        _ = state.handle(.line("itx.jane.mac is live for example.com. Press Ctrl-C to stop."), now: at(30))
        XCTAssertTrue(state.isLive)
    }

    func testARemovedKeyIsNotAllowedAndWaitsLongBeforeTheNextStart() {
        var state = live()
        _ = state.handle(.line("itx.jane.mac disconnected (1000: token ended). Reconnecting..."), now: at(10))
        _ = state.handle(
            .line("Could not reconnect: This bridge's key is not allowed on example.com: unknown key. A member allows it at https://example.com/keys/enrol?provide=jane.mac"),
            now: at(11)
        )
        XCTAssertEqual(state.phase, .notAllowed(reason: "This bridge's key is not allowed on example.com: unknown key.", link: "https://example.com/keys/enrol?provide=jane.mac", nextStartAt: nil))
        XCTAssertEqual(state.handle(.processEnded(status: 1, ranFor: 300), now: at(400)), [.startProcessAfter(seconds: 300)])
        XCTAssertEqual(state.phase.link, "https://example.com/keys/enrol?provide=jane.mac")
        XCTAssertEqual(state.handle(.timerFired, now: at(700)), [.startProcess])
    }

    func testNoActiveMindStopsTheProcessAndIgnoresItsEnd() {
        var state = live()
        XCTAssertEqual(state.handle(.stopRequested, now: at(20)), [.stopProcess])
        XCTAssertEqual(state.handle(.processEnded(status: 15, ranFor: 20), now: at(21)), [])
        XCTAssertEqual(state.handle(.reconnectNow(why: "the network came back"), now: at(22)), [])
        XCTAssertEqual(state.phase, .idle)
    }

    private func live() -> LendState {
        var state = LendState()
        _ = state.handle(.started, now: at(0))
        _ = state.handle(.line("itx.jane.mac is live for example.com. Press Ctrl-C to stop."), now: at(2))
        return state
    }
}
