import XCTest

@testable import VoiceMeetCore

final class UpdateSourceTests: XCTestCase {
    func testTheRegistryUpdatesItself() {
        let source = UpdateSource.of(spec: "@iterate-com/mac-app@latest", copy: nil, version: "0.2.0")
        XCTAssertEqual(source, .registry(version: "0.2.0"))
        XCTAssertTrue(source.updatesItself)
        XCTAssertEqual(source.line(home: "/Users/jane"), "Version 0.2.0 · updates by itself")
    }

    func testATrialIsUpdatedByHand() {
        for spec in ["https://pkg.pr.new/@iterate-com/mac-app@1234", "/Users/jane/src/packages/mac-app", "@iterate-com/mac-app-other@1"] {
            let source = UpdateSource.of(spec: spec, copy: nil, version: "0.2.0")
            XCTAssertEqual(source, .trial(spec: spec, version: "0.2.0"), spec)
            XCTAssertFalse(source.updatesItself)
        }
    }

    func testACopyNeverUpdatesItselfWhateverTheSpec() {
        let source = UpdateSource.of(spec: "@iterate-com/mac-app@latest", copy: "/Users/jane/src/iterate-mac-app", version: "0.2.0")
        XCTAssertEqual(source, .copy(folder: "/Users/jane/src/iterate-mac-app"))
        XCTAssertFalse(source.updatesItself)
        XCTAssertEqual(source.line(home: "/Users/jane"), "Built from ~/src/iterate-mac-app")
        // a folder outside the home folder, and a home folder that is only a prefix of the name
        XCTAssertEqual(UpdateSource.copy(folder: "/opt/mac").line(home: "/Users/jane"), "Built from /opt/mac")
        XCTAssertEqual(UpdateSource.copy(folder: "/Users/janet/app").line(home: "/Users/jane"), "Built from /Users/janet/app")
        // an empty `copy` is no copy
        XCTAssertEqual(UpdateSource.of(spec: "/x", copy: "", version: "1"), .trial(spec: "/x", version: "1"))
    }
}
