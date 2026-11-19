import XCTest

@testable import VoiceMeetCore

/// The lines are the CLI's own: the states of `iterate provide --json` (core/lib/src/cli/provide-state.ts)
/// on stdout, and its human lines on stderr, copied as it prints them.
final class LendStateTests: XCTestCase {
    private let start = Date(timeIntervalSince1970: 1_800_000_000)
    private func at(_ seconds: TimeInterval) -> Date { start.addingTimeInterval(seconds) }
    private let clock: (Date) -> String = { "t\(Int($0.timeIntervalSince1970) - 1_800_000_000)" }

    private let connecting = #"{"state":"connecting","mind":"iterate.example.com","name":"itx.jane.mac"}"#
    private let live = #"{"state":"live","mind":"iterate.example.com","name":"itx.jane.mac","again":false}"#
    private let liveAgain = #"{"state":"live","mind":"iterate.example.com","name":"itx.jane.mac","again":true}"#
    private func reconnecting(_ attempt: Int, inMs: Int, _ failure: String) -> String {
        #"{"state":"reconnecting","attempt":\#(attempt),"of":14,"inMs":\#(inMs),"lastFailure":"\#(failure)"}"#
    }

    func testEachStateDecodes() {
        XCTAssertEqual(ProvideState.of(line: connecting), .connecting(mind: "iterate.example.com", name: "itx.jane.mac"))
        XCTAssertEqual(ProvideState.of(line: liveAgain), .live(mind: "iterate.example.com", name: "itx.jane.mac", again: true))
        XCTAssertEqual(ProvideState.of(line: reconnecting(3, inMs: 4000, "fetch failed")), .reconnecting(attempt: 3, of: 14, inMs: 4000, lastFailure: "fetch failed"))
        XCTAssertEqual(
            ProvideState.of(line: #"{"state":"notAllowed","why":"No member has allowed this key yet.","link":"https://iterate.example.com/keys/enrol?provide=jane.mac","waiting":true}"#),
            .notAllowed(why: "No member has allowed this key yet.", link: "https://iterate.example.com/keys/enrol?provide=jane.mac", waiting: true)
        )
        XCTAssertEqual(
            ProvideState.of(line: #"{"state":"notAllowed","why":"This key was allowed to lend itx.herdr, not itx.jane.mac.","waiting":false}"#),
            .notAllowed(why: "This key was allowed to lend itx.herdr, not itx.jane.mac.", link: nil, waiting: false)
        )
        XCTAssertEqual(ProvideState.of(line: #"{"state":"incompatible","why":"x"}"#), .incompatible(why: "x"))
        XCTAssertEqual(ProvideState.of(line: #"{"state":"stopped","why":"y"}"#), .stopped(why: "y"))
        // a line that is no state, or a state this app does not know, is none
        XCTAssertNil(ProvideState.of(line: "itx.jane.mac"))
        XCTAssertNil(ProvideState.of(line: #"{"state":"dancing"}"#))
    }

    func testALendGoesLiveFromTheCLIsState() {
        var state = LendState()
        XCTAssertEqual(state.handle(.started, now: at(0)), [.startProcess])
        XCTAssertEqual(state.phase, .connecting(since: at(0)))
        XCTAssertEqual(state.handle(.stateLine(connecting), now: at(1)), [])
        XCTAssertEqual(state.phase, .connecting(since: at(0)))
        XCTAssertEqual(state.handle(.humanLine("itx.jane.mac is live for iterate.example.com. Press Ctrl-C to stop."), now: at(2)), [])
        XCTAssertEqual(state.phase, .connecting(since: at(0)), "a human line changes no phase")
        XCTAssertEqual(state.handle(.stateLine(live), now: at(2)), [])
        XCTAssertEqual(state.phase, .live(since: at(2)))
        XCTAssertEqual(state.statusLine(now: at(9), clock: clock), "Live since t2")
    }

    func testReconnectingSaysTheCLIsAttemptAndItsWait() {
        var state = livePhase()
        _ = state.handle(.stateLine(reconnecting(1, inMs: 1000, "1006: connection closed")), now: at(10))
        XCTAssertEqual(state.phase, .reconnecting(attempt: 1, of: 14, nextTryAt: at(11), lastFailure: "1006: connection closed"))
        _ = state.handle(.stateLine(reconnecting(2, inMs: 2000, "fetch failed")), now: at(11))
        XCTAssertEqual(state.phase, .reconnecting(attempt: 2, of: 14, nextTryAt: at(13), lastFailure: "fetch failed"))
        XCTAssertEqual(
            state.statusLine(now: at(11.5), clock: clock),
            "Reconnecting: attempt 2 of 14, next try in 2 s. Last failure: fetch failed"
        )
        XCTAssertEqual(state.statusLine(now: at(13), clock: clock), "Reconnecting: attempt 2 of 14, trying now. Last failure: fetch failed")
        XCTAssertEqual(state.phase.attempt, 2)
        _ = state.handle(.stateLine(liveAgain), now: at(17))
        XCTAssertEqual(state.phase, .live(since: at(17)))
    }

    func testAnEndedProcessStartsAgainWithALongerWaitEachQuickTime() {
        var state = LendState()
        _ = state.handle(.started, now: at(0))
        _ = state.handle(.stateLine(#"{"state":"stopped","why":"getaddrinfo ENOTFOUND example.com"}"#), now: at(1))
        XCTAssertEqual(state.handle(.processEnded(status: 1, ranFor: 1), now: at(1)), [.startProcessAfter(seconds: 4)])
        XCTAssertEqual(state.phase, .stopped(reason: "the lend process ended (exit 1): getaddrinfo ENOTFOUND example.com", nextStartAt: at(5)))
        XCTAssertEqual(state.handle(.timerFired, now: at(5)), [.startProcess])
        XCTAssertEqual(state.handle(.processEnded(status: 1, ranFor: 1), now: at(6)), [.startProcessAfter(seconds: 8)])
        XCTAssertEqual(state.phase, .stopped(reason: "the lend process ended (exit 1): it printed nothing", nextStartAt: at(14)))
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

    func testTheStoppedStateIsTheReasonEvenWhenStderrPrintsTheErrorAfterIt() {
        var state = LendState()
        _ = state.handle(.started, now: at(0))
        _ = state.handle(.stateLine(#"{"state":"stopped","why":"iterate.example.com could not be reached. Check the address."}"#), now: at(1))
        for line in [
            "Error: iterate.example.com could not be reached. Check the address.",
            "    at async Command.parseAsync (/x/commander/lib/command.js:1122:5)",
        ] {
            _ = state.handle(.humanLine(line), now: at(1))
        }
        XCTAssertEqual(state.handle(.processEnded(status: 1, ranFor: 1), now: at(1)), [.startProcessAfter(seconds: 4)])
        XCTAssertEqual(
            state.statusLine(now: at(1), clock: clock),
            "Stopped: the lend process ended (exit 1): iterate.example.com could not be reached. Check the address. Next start in 4 s"
        )
    }

    func testAProcessThatEndsWithNoStateGivesItsLastHumanLineAndTheNetworkStartsTheWaitsAnew() {
        var state = LendState()
        _ = state.handle(.started, now: at(0))
        // node itself fails before the CLI can print a state: its error and stack trace
        let printed = [
            "Error: Cannot find module '/x/iterate/bin/iterate.js'",
            "    at Module._resolveFilename (node:internal/modules/cjs/loader:1225:15)",
            "^",
        ]
        for _ in 1...6 {
            for line in printed { _ = state.handle(.humanLine(line), now: at(1)) }
            _ = state.handle(.processEnded(status: 1, ranFor: 1), now: at(1))
            _ = state.handle(.timerFired, now: at(2))
        }
        for line in printed { _ = state.handle(.humanLine(line), now: at(2)) }
        XCTAssertEqual(state.handle(.processEnded(status: 1, ranFor: 1), now: at(2)), [.startProcessAfter(seconds: 60)])
        XCTAssertEqual(
            state.statusLine(now: at(2), clock: clock),
            "Stopped: the lend process ended (exit 1): Cannot find module '/x/iterate/bin/iterate.js'. Next start in 60 s"
        )
        XCTAssertEqual(
            state.statusLine(now: at(70), clock: clock),
            "Stopped: the lend process ended (exit 1): Cannot find module '/x/iterate/bin/iterate.js'. Starting again now"
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
        var reconnectingState = livePhase()
        _ = reconnectingState.handle(.stateLine(reconnecting(1, inMs: 1000, "1006: gone")), now: at(10))
        XCTAssertEqual(reconnectingState.handle(.reconnectNow(why: "the Mac woke"), now: at(11)), [.startProcess])
    }

    func testTheNetworkComingBackStartsALendThatIsNotLive() {
        var state = livePhase()
        XCTAssertEqual(state.handle(.networkCameBack, now: at(5)), [])
        XCTAssertTrue(state.isLive)
        _ = state.handle(.stateLine(reconnecting(1, inMs: 1000, "1006: gone")), now: at(10))
        _ = state.handle(.stateLine(reconnecting(2, inMs: 2000, "fetch failed")), now: at(11))
        XCTAssertEqual(state.handle(.networkCameBack, now: at(12)), [.startProcess])
        XCTAssertEqual(state.phase, .connecting(since: at(12)))
    }

    func testTheCLIGivingUpEndsInStoppedWithItsWords() {
        var state = livePhase()
        _ = state.handle(.stateLine(reconnecting(14, inMs: 30000, "fetch failed")), now: at(10))
        let why = "itx.jane.mac disconnected and could not reconnect (fetch failed). Run iterate provide again."
        _ = state.handle(.stateLine(#"{"state":"stopped","why":"\#(why)"}"#), now: at(40))
        XCTAssertEqual(state.handle(.processEnded(status: 1, ranFor: 40), now: at(40)), [.startProcessAfter(seconds: 4)])
        XCTAssertEqual(state.statusLine(now: at(41), clock: clock), "Stopped: the lend process ended (exit 1): \(why) Next start in 3 s")
    }

    func testAKeyNoMemberAllowedYetShowsTheLink() {
        var state = LendState()
        _ = state.handle(.started, now: at(0))
        _ = state.handle(.stateLine(connecting), now: at(0))
        _ = state.handle(
            .stateLine(#"{"state":"notAllowed","why":"No member has allowed this key yet.","link":"https://iterate.example.com/keys/enrol?actor=bridge-jane-mac&provide=jane.mac","waiting":true}"#),
            now: at(1)
        )
        XCTAssertEqual(
            state.phase,
            .notAllowed(reason: "No member has allowed this key yet.", link: "https://iterate.example.com/keys/enrol?actor=bridge-jane-mac&provide=jane.mac", nextStartAt: nil)
        )
        XCTAssertEqual(
            state.statusLine(now: at(1), clock: clock),
            "Not allowed: No member has allowed this key yet. A member opens the link and allows it with a passkey."
        )
        _ = state.handle(.stateLine(live), now: at(30))
        XCTAssertTrue(state.isLive)
    }

    func testARemovedKeyIsNotAllowedAndWaitsLongBeforeTheNextStart() {
        var state = livePhase()
        _ = state.handle(.stateLine(reconnecting(1, inMs: 1000, "1000: token ended")), now: at(10))
        _ = state.handle(
            .stateLine(#"{"state":"notAllowed","why":"the key is not one this mind knows.","link":"https://iterate.example.com/keys/enrol?provide=jane.mac","waiting":false}"#),
            now: at(11)
        )
        XCTAssertEqual(state.phase, .notAllowed(reason: "the key is not one this mind knows.", link: "https://iterate.example.com/keys/enrol?provide=jane.mac", nextStartAt: nil))
        XCTAssertEqual(state.handle(.processEnded(status: 1, ranFor: 300), now: at(400)), [.startProcessAfter(seconds: 300)])
        XCTAssertEqual(state.phase.link, "https://iterate.example.com/keys/enrol?provide=jane.mac")
        XCTAssertEqual(state.handle(.timerFired, now: at(700)), [.startProcess])
    }

    func testAnIncompatibleCLISaysToUpdateItAndWaitsLong() {
        var state = LendState()
        _ = state.handle(.started, now: at(0))
        let why = "the statement is for another mind: this iterate CLI and the mind do not agree on the protocol"
        _ = state.handle(.stateLine(#"{"state":"incompatible","why":"\#(why)"}"#), now: at(1))
        XCTAssertEqual(state.phase, .incompatible(reason: why, nextStartAt: nil))
        XCTAssertEqual(state.phase.name, "incompatible")
        XCTAssertEqual(state.statusLine(now: at(1), clock: clock), "Incompatible: \(why). Update the iterate CLI: run `npx @iterate-com/mac-app update`.")
        XCTAssertEqual(state.handle(.processEnded(status: 1, ranFor: 1), now: at(1)), [.startProcessAfter(seconds: 300)])
        XCTAssertEqual(state.phase, .incompatible(reason: why, nextStartAt: at(301)))
        XCTAssertEqual(
            state.statusLine(now: at(1), clock: clock),
            "Incompatible: \(why). Update the iterate CLI: run `npx @iterate-com/mac-app update`. Next try in 300 s."
        )
        XCTAssertEqual(state.handle(.timerFired, now: at(301)), [.startProcess])
    }

    func testNoActiveMindStopsTheProcessAndIgnoresItsEnd() {
        var state = livePhase()
        XCTAssertEqual(state.handle(.stopRequested, now: at(20)), [.stopProcess])
        XCTAssertEqual(state.handle(.processEnded(status: 15, ranFor: 20), now: at(21)), [])
        XCTAssertEqual(state.handle(.reconnectNow(why: "the network came back"), now: at(22)), [])
        XCTAssertEqual(state.phase, .idle)
    }

    private func livePhase() -> LendState {
        var state = LendState()
        _ = state.handle(.started, now: at(0))
        _ = state.handle(.stateLine(live), now: at(2))
        return state
    }
}
