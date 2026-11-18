import AppKit
import ApplicationServices
import CoreImage
import ScreenCaptureKit

/// A still picture of a whole display, at any time. It needs the Screen Recording permission.
enum Screen {
    /// This Mac's displays, the main one first.
    static var displays: [(id: CGDirectDisplayID, name: String)] {
        NSScreen.screens.compactMap { screen in
            (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID).map { ($0, screen.localizedName) }
        }
    }

    /// The display a caller means: by its number (0 is the main one), or the first one that is not
    /// off. A display that is off is refused.
    static func resolve(_ index: Int?) throws -> Shareable {
        let things = displays.map(Shareable.display)
        guard let index else {
            guard let first = things.first(where: { $0.sharing != .off }) else {
                throw EndpointRefusal("Every display is off in the iterate panel on the Mac.")
            }
            return first
        }
        guard things.indices.contains(index) else {
            throw EndpointRefusal("No display \(index): this Mac has \(things.count) display(s), numbered from 0.")
        }
        return things[index]
    }

    /// The display of a thing made by `Shareable.display`.
    static func id(of thing: Shareable) -> CGDirectDisplayID {
        CGDirectDisplayID(thing.id.dropFirst("screen.".count)) ?? CGMainDisplayID()
    }

    /// A picture of one display, at most `maxWidth` pixels wide.
    static func image(of wanted: CGDirectDisplayID, maxWidth: Int) async throws -> CGImage {
        guard Permission.screenRecording.isGranted else {
            throw EndpointRefusal("macOS has not given this app Screen Recording. The Mac's owner gives it from the iterate panel.")
        }
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first(where: { $0.displayID == wanted }) else {
            throw EndpointRefusal("That display is not connected.")
        }
        let filter = SCContentFilter(display: display, excludingWindows: [])
        let pixelWidth = filter.contentRect.width * CGFloat(filter.pointPixelScale)
        let scale = min(1, CGFloat(max(maxWidth, 1)) / pixelWidth)
        let configuration = SCStreamConfiguration()
        configuration.width = Int(pixelWidth * scale)
        configuration.height = Int(filter.contentRect.height * CGFloat(filter.pointPixelScale) * scale)
        configuration.showsCursor = true
        return try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
    }

    static func snapshot(of display: CGDirectDisplayID, maxWidth: Int) async throws -> (data: Data, width: Int, height: Int) {
        let image = try await image(of: display, maxWidth: maxWidth)
        guard let picture = Snapshot.jpeg(of: CIImage(cgImage: image), maxWidth: maxWidth) else {
            throw EndpointRefusal("The app could not make a picture of the display.")
        }
        return picture
    }
}

/// The accessibility tree of the window in front: what is on screen as text and controls, not as
/// a picture. It needs the Accessibility permission.
enum Accessibility {
    static func frontWindow(maxDepth: Int, maxNodes: Int) throws -> [String: Any] {
        guard Permission.accessibility.isGranted else {
            throw EndpointRefusal(
                "This app has no Accessibility permission. The person gives it in the iterate menu (Grant Accessibility…)."
            )
        }
        guard let application = NSWorkspace.shared.frontmostApplication else {
            throw EndpointRefusal("No application is in front.")
        }
        let element = AXUIElementCreateApplication(application.processIdentifier)
        var budget = maxNodes
        var answer: [String: Any] = [
            "application": application.localizedName ?? "",
            "bundleIdentifier": application.bundleIdentifier ?? "",
        ]
        if let window = attribute(element, kAXFocusedWindowAttribute), CFGetTypeID(window) == AXUIElementGetTypeID() {
            // The type was checked on the line above.
            answer["window"] = describe(window as! AXUIElement, depth: maxDepth, budget: &budget)
        }
        answer["truncated"] = budget <= 0
        return answer
    }

    private static func describe(_ element: AXUIElement, depth: Int, budget: inout Int) -> [String: Any] {
        budget -= 1
        var node: [String: Any] = [:]
        for (key, name) in [
            ("role", kAXRoleAttribute), ("title", kAXTitleAttribute), ("value", kAXValueAttribute),
            ("description", kAXDescriptionAttribute),
        ] {
            if let text = attribute(element, name) as? String, !text.isEmpty {
                node[key] = String(text.prefix(2_000))
            }
        }
        if depth > 0, let children = attribute(element, kAXChildrenAttribute) as? [AXUIElement], !children.isEmpty {
            var described: [[String: Any]] = []
            for child in children where budget > 0 {
                described.append(describe(child, depth: depth - 1, budget: &budget))
            }
            node["children"] = described
        }
        return node
    }

    private static func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
        var value: CFTypeRef?
        return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
    }
}

/// Runs a command as a child of this app. macOS counts a child's use of the screen, the camera,
/// the microphone and Accessibility as this app's, so the command has the app's permissions.
enum Commands {
    private static let maximumOutputBytes = 8 * 1024 * 1024

    static func run(_ argv: [String], stdin: Data, timeout: TimeInterval) async throws -> [String: Any] {
        guard let command = argv.first else { throw EndpointRefusal("run needs a command: argv is a list of strings.") }
        let process = Process()
        // A bare name is found on the PATH, as in a shell; a path is run as it is.
        process.executableURL = URL(fileURLWithPath: command.contains("/") ? command : "/usr/bin/env")
        process.arguments = command.contains("/") ? Array(argv.dropFirst()) : argv
        let input = Pipe(), output = Pipe(), errors = Pipe()
        process.standardInput = input
        process.standardOutput = output
        process.standardError = errors
        do {
            try process.run()
        } catch {
            throw EndpointRefusal("The command did not start: \(error.localizedDescription)")
        }
        let deadline = DispatchWorkItem { process.terminate() }
        DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: deadline)
        // The pipes are read off the main thread while the command runs, or a full pipe would stop it.
        async let standardOutput = read(output)
        async let standardError = read(errors)
        input.fileHandleForWriting.write(stdin)
        try? input.fileHandleForWriting.close()
        let (out, err) = await (standardOutput, standardError)
        process.waitUntilExit()
        deadline.cancel()
        return [
            "exitCode": Int(process.terminationStatus),
            "timedOut": process.terminationReason == .uncaughtSignal,
            "stdoutBase64": out.prefix(maximumOutputBytes).base64EncodedString(),
            "stderrBase64": err.prefix(maximumOutputBytes).base64EncodedString(),
        ]
    }

    private static func read(_ pipe: Pipe) async -> Data {
        await withCheckedContinuation { continuation in
            DispatchQueue.global().async {
                continuation.resume(returning: pipe.fileHandleForReading.readDataToEndOfFile())
            }
        }
    }
}
