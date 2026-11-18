import XCTest

@testable import VoiceMeetCore

final class CameraStateTests: XCTestCase {
    func testTheCameraStartsOnlyAfterThePersonAllowsIt() {
        var state = CameraState()
        XCTAssertEqual(state.handle(.startRequested), [.checkAccess])
        XCTAssertFalse(state.isRunning)
        XCTAssertEqual(state.handle(.accessGranted), [.startSession])
        XCTAssertEqual(state.handle(.sessionStarted("FaceTime HD Camera")), [])
        XCTAssertTrue(state.isOn)
        XCTAssertEqual(state.statusLine, "Camera on: FaceTime HD Camera")
    }

    func testADeniedCameraStartsNoSession() {
        var state = CameraState()
        _ = state.handle(.startRequested)
        XCTAssertEqual(state.handle(.accessDenied), [])
        XCTAssertEqual(state.phase, .denied)
        XCTAssertFalse(state.isRunning)
    }

    func testAStopReleasesTheCameraAndAFailureDoesToo() {
        var state = CameraState()
        for event in [CameraEvent.startRequested, .accessGranted, .sessionStarted("Camera")] {
            _ = state.handle(event)
        }
        XCTAssertEqual(state.handle(.sessionFailed("the camera was unplugged")), [.stopSession])
        XCTAssertEqual(state.phase, .failed("the camera was unplugged"))

        for event in [CameraEvent.startRequested, .accessGranted, .sessionStarted("Camera")] {
            _ = state.handle(event)
        }
        XCTAssertEqual(state.handle(.stopRequested), [.stopSession])
        XCTAssertEqual(state.phase, .off)
    }
}
