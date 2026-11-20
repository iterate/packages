import XCTest

@testable import VoiceMeetCore

final class BannerStateTests: XCTestCase {
    private let page = URL(string: "https://dash.example.com/agents?contextPath=/agents/a&call=join")!
    private func call(_ id: Int) -> Banner { Banner.call(id: id, from: "Lunch agent", reason: "Lunch is ready", page: page) }
    private func notice(_ id: Int, _ buttons: [[String: Any]]? = nil) -> Banner {
        try! Banner.make(id: id, title: "Standup", body: "Join meeting X?", buttons: buttons, sound: "chime", seconds: nil, mind: "example.com").get()
    }

    // MARK: - a call

    func testACallRingsUntilAcceptedAndAcceptOpensThePage() {
        var state = BannerState()
        XCTAssertEqual(state.handle(.requested(call(1))), [.show(call(1)), .startTimer(id: 1, seconds: 30)])
        XCTAssertEqual(state.showing, call(1))
        XCTAssertEqual(call(1).defaultButton, 1)
        XCTAssertEqual(state.handle(.pressed(id: 1, index: 1)), [.hide, .open(page), .answer(id: 1, .pressed("Accept"))])
        XCTAssertEqual(state.phase, .ended(call(1), .pressed("Accept")))
    }

    func testDeclineOpensNothing() {
        var state = BannerState()
        _ = state.handle(.requested(call(1)))
        XCTAssertEqual(state.handle(.pressed(id: 1, index: 0)), [.hide, .answer(id: 1, .pressed("Decline"))])
    }

    func testABannerWithNoAnswerEndsByItself() {
        var state = BannerState()
        _ = state.handle(.requested(call(1)))
        XCTAssertEqual(state.handle(.timedOut(id: 1)), [.hide, .answer(id: 1, .noAnswer)])
        XCTAssertEqual(BannerOutcome.noAnswer.why, "no answer")
    }

    func testANewerCallReplacesACall() {
        var state = BannerState()
        _ = state.handle(.requested(call(1)))
        XCTAssertEqual(state.handle(.requested(call(2))), [.answer(id: 1, .replaced), .show(call(2)), .startTimer(id: 2, seconds: 30)])
        // the old one's timer and a late press change nothing
        XCTAssertEqual(state.handle(.timedOut(id: 1)), [])
        XCTAssertEqual(state.handle(.pressed(id: 1, index: 1)), [])
        XCTAssertEqual(state.showing, call(2))
    }

    // MARK: - the general form

    func testAPlainBannerDoesNotReplaceACallButACallReplacesAPlainOne() {
        var state = BannerState()
        _ = state.handle(.requested(call(1)))
        XCTAssertEqual(state.handle(.requested(notice(2))), [.answer(id: 2, .busy)])
        XCTAssertEqual(state.showing, call(1))

        var other = BannerState()
        _ = other.handle(.requested(notice(1)))
        XCTAssertEqual(other.handle(.requested(notice(2))), [.answer(id: 1, .replaced), .show(notice(2)), .startTimer(id: 2, seconds: 30)])
        XCTAssertEqual(other.handle(.requested(call(3))), [.answer(id: 2, .replaced), .show(call(3)), .startTimer(id: 3, seconds: 30)])
    }

    func testAPressAnswersItsLabelAndOpensItsPage() throws {
        let join = [["label": "Join", "style": "accept", "open": "https://meet.example.com/contexts/agents/meet/x"], ["label": "Not now"]]
        let banner = notice(1, join)
        XCTAssertEqual(banner.defaultButton, 0)
        XCTAssertFalse(banner.buttons[0].isRound)
        var state = BannerState()
        _ = state.handle(.requested(banner))
        XCTAssertEqual(
            state.handle(.pressed(id: 1, index: 0)),
            [.hide, .open(URL(string: "https://meet.example.com/contexts/agents/meet/x")!), .answer(id: 1, .pressed("Join"))]
        )
        var again = BannerState()
        _ = again.handle(.requested(banner))
        XCTAssertEqual(again.handle(.pressed(id: 1, index: 1)), [.hide, .answer(id: 1, .pressed("Not now"))])
        XCTAssertEqual(again.handle(.pressed(id: 1, index: 7)), [])
    }

    func testEscapeDismisses() {
        var state = BannerState()
        _ = state.handle(.requested(notice(1)))
        XCTAssertEqual(state.handle(.dismissed(id: 1)), [.hide, .answer(id: 1, .dismissed)])
        XCTAssertEqual(state.handle(.dismissed(id: 1)), [])
    }

    func testABannerIsClampedAndHasOneOKByDefault() throws {
        let banner = try Banner.make(
            id: 1, title: String(repeating: "t", count: 500), body: "two\nlines", buttons: nil, sound: nil, seconds: 9_999, mind: "example.com"
        ).get()
        XCTAssertEqual(banner.title.count, Banner.titleLimit)
        XCTAssertEqual(banner.body, "two lines")
        XCTAssertEqual(banner.buttons, [BannerButton(label: "OK")])
        XCTAssertEqual(banner.sound, .chime)
        XCTAssertEqual(banner.seconds, 120)
        XCTAssertEqual(try Banner.make(id: 1, title: "t", body: nil, buttons: nil, sound: "none", seconds: 1, mind: "example.com").get().seconds, 5)
        let long = try Banner.make(
            id: 1, title: "t", body: nil, buttons: [["label": String(repeating: "l", count: 99)]], sound: nil, seconds: nil, mind: "example.com"
        ).get()
        XCTAssertEqual(long.buttons[0].label.count, Banner.labelLimit)
    }

    func testABannerThatMayNotShowIsRefusedInWordsBeforeItShows() {
        func refused(_ buttons: [[String: Any]]?, title: String? = "t", sound: String? = nil) -> String? {
            if case .failure(let refusal) = Banner.make(id: 1, title: title, body: nil, buttons: buttons, sound: sound, seconds: nil, mind: "example.com") {
                return refusal.words
            }
            return nil
        }
        XCTAssertNotNil(refused(nil, title: " "))
        XCTAssertNotNil(refused([["label": "a"], ["label": "b"], ["label": "c"], ["label": "d"]]))
        XCTAssertNotNil(refused([["label": ""]]))
        XCTAssertNotNil(refused([["label": "a"], ["label": "a"]]))
        XCTAssertNotNil(refused([["label": "a", "style": "loud"]]))
        XCTAssertNotNil(refused(nil, sound: "siren"))
        XCTAssertEqual(
            refused([["label": "Join", "open": "https://evil.test/"]]),
            "This Mac opens only pages of the mind it is lent to (example.com and its subdomains), not evil.test."
        )
    }

    func testAtMostSixBannersBeginInAMinute() {
        var state = BannerState()
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        for second in 0..<6 { XCTAssertNil(state.admit(now: start.addingTimeInterval(Double(second)))) }
        XCTAssertNotNil(state.admit(now: start.addingTimeInterval(30)))
        // the refused one does not count: a minute after the first, one more may show
        XCTAssertNil(state.admit(now: start.addingTimeInterval(60)))
        XCTAssertNotNil(state.admit(now: start.addingTimeInterval(60.5)))
    }

    // MARK: - pages

    func testWithNoURLACallsPageIsTheAgentsPageInTheDash() throws {
        let url = try BannerState.callPage(nil, agent: "/agents/meet/2026-11-20-1030-lunch", mind: "example.com").get()
        XCTAssertEqual(url.absoluteString, "https://dash.example.com/agents?contextPath=/agents/meet/2026-11-20-1030-lunch&call=join")
        XCTAssertEqual(try BannerState.callPage(nil, agent: "/agents/a", mind: "iterate.example.com").get().host, "dash.example.com")
        XCTAssertEqual(try BannerState.callPage(nil, agent: "/agents/a", mind: "iterate.iterate.com").get().host, "dash.iterate.com")
        XCTAssertEqual(try BannerState.callPage(nil, agent: "/agents/a", mind: "iterate.com").get().host, "dash.iterate.com")
        XCTAssertNil(try? BannerState.callPage(nil, agent: "/agents/a", mind: "com").get())
        XCTAssertNil(try? BannerState.callPage(nil, agent: "agents/a", mind: "example.com").get())
    }

    func testAPageIsOnlyOneOfTheMindsZone() {
        func allowed(_ url: String, mind: String = "example.com") -> Bool {
            (try? BannerState.page(url, mind: mind).get()) != nil
        }
        XCTAssertTrue(allowed("https://dash.example.com/agents/a?call=join"))
        XCTAssertTrue(allowed("https://meet.example.com/contexts/agents/a"))
        XCTAssertTrue(allowed("https://example.com/"))
        XCTAssertTrue(allowed("https://meet.example.com/x", mind: "iterate.example.com"))
        XCTAssertTrue(allowed("https://DASH.Example.com/", mind: "Example.com"))
        XCTAssertTrue(allowed("https://dash.iterate.com/", mind: "iterate.com"))
        XCTAssertFalse(allowed("http://dash.example.com/"))
        XCTAssertFalse(allowed("https://dash.example.com.evil.test/"))
        XCTAssertFalse(allowed("https://notexample.com/"))
        XCTAssertFalse(allowed("https://example.com@evil.test/"))
        XCTAssertFalse(allowed("https://user@dash.example.com/"))
        XCTAssertFalse(allowed("https://dash.example.com:8443/"))
        XCTAssertFalse(allowed("javascript:alert(1)"))
        XCTAssertFalse(allowed("file:///etc/passwd"))
        XCTAssertFalse(allowed("https://dash.example.com/", mind: ""))
        XCTAssertFalse(allowed("https://dash.evil.com/", mind: "iterate.com"))
        XCTAssertFalse(allowed("https://dash.com/", mind: "iterate.com"))
        XCTAssertFalse(allowed("https://dash.evil.com/", mind: "com"))
    }
}
