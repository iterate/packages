// swift-tools-version: 5.9
import PackageDescription

var products: [Product] = [
    .library(name: "VoiceMeetCore", targets: ["VoiceMeetCore"]),
]
var targets: [Target] = [
    .target(name: "VoiceMeetCore"),
    .testTarget(name: "VoiceMeetCoreTests", dependencies: ["VoiceMeetCore"]),
]

// The app needs AppKit, ScreenCaptureKit and AVFoundation, so only a Mac gets its target. On Linux
// the package is VoiceMeetCore and its tests.
#if os(macOS)
products.append(.executable(name: "VoiceMeetMac", targets: ["VoiceMeetMac"]))
targets.append(.executableTarget(name: "VoiceMeetMac", dependencies: ["VoiceMeetCore"]))
#endif

let package = Package(
    name: "voice-meet-mac",
    // macOS 14.0 is the first with SCContentSharingPicker and with the control of ducking.
    platforms: [.macOS(.v14)],
    products: products,
    targets: targets
)
