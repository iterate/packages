import XCTest

@testable import VoiceMeetCore

final class MicrophoneStateTests: XCTestCase {
    private func state(after events: [MicrophoneEvent]) -> MicrophoneState {
        var state = MicrophoneState()
        for event in events { _ = state.handle(event) }
        return state
    }

    func testTheEngineStartsOnlyAfterThePersonAllowsTheMicrophone() {
        var state = MicrophoneState()
        XCTAssertEqual(state.handle(.startRequested), [.checkAccess])
        XCTAssertEqual(state.phase, .checkingAccess)
        XCTAssertFalse(state.isRunning)

        XCTAssertEqual(state.handle(.accessGranted), [.startEngine])
        XCTAssertEqual(state.phase, .starting)

        XCTAssertEqual(state.handle(.engineStarted), [])
        XCTAssertEqual(state.phase, .on)
        XCTAssertTrue(state.isRunning)
    }

    func testADeniedMicrophoneStartsNoEngine() {
        var state = state(after: [.startRequested])
        XCTAssertEqual(state.handle(.accessDenied), [])
        XCTAssertEqual(state.phase, .denied)
    }

    func testAnAnswerAfterStopStartsNoEngine() {
        var state = state(after: [.startRequested, .stopRequested])
        XCTAssertEqual(state.phase, .off)
        XCTAssertEqual(state.handle(.accessGranted), [])
        XCTAssertEqual(state.phase, .off)
    }

    func testAnEngineThatFailsIsStoppedAndSaysWhy() {
        var state = state(after: [.startRequested, .accessGranted])
        XCTAssertEqual(state.handle(.engineFailed("no input device")), [.stopEngine])
        XCTAssertEqual(state.phase, .failed("no input device"))
    }

    func testADeviceChangeRestartsTheEngineAndKeepsTheMute() {
        var state = state(after: [.startRequested, .accessGranted, .engineStarted, .muteToggled])
        XCTAssertTrue(state.isMuted)

        XCTAssertEqual(state.handle(.configurationChanged), [.restartEngine])
        XCTAssertEqual(state.phase, .starting)
        XCTAssertEqual(state.automaticRestarts, 1)

        XCTAssertEqual(state.handle(.engineStarted), [.setMuted(true)])
        XCTAssertEqual(state.phase, .on)
    }

    func testRestartsAfterDeviceChangesAreLimited() {
        var state = state(after: [.startRequested, .accessGranted, .engineStarted])
        for _ in 0..<MicrophoneState.maximumAutomaticRestarts {
            XCTAssertEqual(state.handle(.configurationChanged), [.restartEngine])
            XCTAssertEqual(state.handle(.engineStarted), [])
        }
        XCTAssertEqual(state.handle(.configurationChanged), [.stopEngine])
        guard case .failed = state.phase else { return XCTFail("expected a failed phase, got \(state.phase)") }

        XCTAssertEqual(state.handle(.startRequested), [.checkAccess])
        XCTAssertEqual(state.automaticRestarts, 0)
    }

    func testMuteWorksOnlyWhileTheMicrophoneIsOn() {
        var state = MicrophoneState()
        XCTAssertEqual(state.handle(.muteToggled), [])
        XCTAssertFalse(state.isMuted)

        state = self.state(after: [.startRequested, .accessGranted, .engineStarted])
        XCTAssertEqual(state.handle(.muteToggled), [.setMuted(true)])
        XCTAssertEqual(state.handle(.muteToggled), [.setMuted(false)])
    }

    func testStopReleasesTheMicrophone() {
        var state = state(after: [.startRequested, .accessGranted, .engineStarted])
        XCTAssertEqual(state.handle(.stopRequested), [.stopEngine])
        XCTAssertEqual(state.phase, .off)
    }

    func testTheModeLineNamesTheActiveModeAndThePersonsChoice() {
        var state = state(after: [.startRequested, .accessGranted, .engineStarted])
        _ = state.handle(.modesRead(active: .standard, preferred: .voiceIsolation))
        XCTAssertEqual(state.modeLine, "Microphone mode: Standard (you chose Voice Isolation)")

        _ = state.handle(.modesRead(active: .voiceIsolation, preferred: .voiceIsolation))
        XCTAssertEqual(state.modeLine, "Microphone mode: Voice Isolation")
    }
}
