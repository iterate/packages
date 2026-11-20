import AVFoundation
import AppKit
import ApplicationServices

/// The four permissions of macOS that the app holds for the mind. The app only reads them and
/// opens the system's own prompt or settings pane: the person gives each one.
enum Permission: String, CaseIterable {
    case screenRecording
    case accessibility
    case microphone
    case camera

    var title: String {
        switch self {
        case .screenRecording: return "Screen Recording"
        case .accessibility: return "Accessibility"
        case .microphone: return "Microphone"
        case .camera: return "Camera"
        }
    }

    /// What the person does next, for the guide that shows when a power is turned on.
    var steps: String {
        switch self {
        case .screenRecording:
            return "macOS asks next, or opens System Settings › Privacy & Security › Screen & System Audio Recording. Switch “iterate” on there.\n\niterate then starts again by itself, and its mark comes back in the menu bar."
        case .accessibility:
            return "macOS asks next, or opens System Settings › Privacy & Security › Accessibility. Switch “iterate” on there. Nothing else is needed."
        case .microphone, .camera:
            return "macOS asks next: choose Allow. If it does not ask, it opens System Settings › Privacy & Security › \(title): switch “iterate” on there."
        }
    }

    var isGranted: Bool {
        switch self {
        case .screenRecording: return CGPreflightScreenCaptureAccess()
        case .accessibility: return AXIsProcessTrusted()
        case .microphone: return AVCaptureDevice.authorizationStatus(for: .audio) == .authorized
        case .camera: return AVCaptureDevice.authorizationStatus(for: .video) == .authorized
        }
    }

    /// The person turned a power on and went on in the guide. The system shows its prompt the
    /// first time; after that only the settings pane can change the answer, so the app opens it.
    func request() {
        switch self {
        case .screenRecording:
            if !CGRequestScreenCaptureAccess() { openSettings() }
        case .accessibility:
            let prompt = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
            if !AXIsProcessTrustedWithOptions([prompt: true] as CFDictionary) { openSettings() }
        case .microphone:
            requestCapture(.audio)
        case .camera:
            requestCapture(.video)
        }
    }

    private func requestCapture(_ mediaType: AVMediaType) {
        if AVCaptureDevice.authorizationStatus(for: mediaType) == .notDetermined {
            AVCaptureDevice.requestAccess(for: mediaType) { _ in }
        } else {
            openSettings()
        }
    }

    private func openSettings() {
        let pane: String
        switch self {
        case .screenRecording: pane = "Privacy_ScreenCapture"
        case .accessibility: pane = "Privacy_Accessibility"
        case .microphone: pane = "Privacy_Microphone"
        case .camera: pane = "Privacy_Camera"
        }
        if let url = URL(string: "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?\(pane)") {
            NSWorkspace.shared.open(url)
        }
    }

    /// The argument that makes the app answer one question and exit: has it Screen Recording?
    static let checkScreenRecordingArgument = "--check-screen-recording"

    /// A running process keeps its first answer about Screen Recording, so a grant shows only in a
    /// new process. True when the person gave the permission and this process cannot use it yet.
    /// (After Scrawl by Kit Langton, which asks a fresh helper process in the same way.)
    static var screenRecordingWaitsForRestart: Bool {
        guard !Permission.screenRecording.isGranted, let executable = Bundle.main.executableURL else { return false }
        let check = Process()
        check.executableURL = executable
        check.arguments = [checkScreenRecordingArgument]
        guard (try? check.run()) != nil else { return false }
        check.waitUntilExit()
        return check.terminationStatus == 0
    }

    /// Starts the app again once this process has ended, so there are never two copies.
    static func restartTheApp() {
        let shell = Process()
        shell.executableURL = URL(fileURLWithPath: "/bin/sh")
        shell.arguments = [
            "-c", "while kill -0 \"$0\" 2>/dev/null; do sleep 0.1; done; exec /usr/bin/open \"$1\"",
            "\(ProcessInfo.processInfo.processIdentifier)", Bundle.main.bundlePath,
        ]
        try? shell.run()
        NSApp.terminate(nil)
    }
}

/// The kinds of thing a caller of the local endpoint (a mind) may use.
enum Power: String, CaseIterable {
    case screen
    case camera
    case microphone
    case speaker
    case accessibility
    case commands
    /// Banners on the screen, a call's among them (`Banners`): an output, beside the speakers.
    case banners

    /// The permission of macOS that the power needs. The speakers, commands and banners need none.
    var permission: Permission? {
        switch self {
        case .screen: return .screenRecording
        case .camera: return .camera
        case .microphone: return .microphone
        case .accessibility: return .accessibility
        case .speaker, .commands, .banners: return nil
        }
    }
}

/// How much of one thing a mind may use. The person chooses it in the panel; it is kept across
/// runs, and it is `off` until the person chooses.
enum Sharing: String, CaseIterable, Identifiable {
    case off
    /// Each use waits for the person's approval (`Approval`).
    case ask
    case shared

    var id: String { rawValue }

    var title: String {
        switch self {
        case .off: return "Off"
        case .ask: return "Ask"
        case .shared: return "Shared"
        }
    }
}

/// One thing the person shares or not: a display, a camera, the microphone, the speakers, the
/// text of the window in front, commands, or banners. Each display and each camera is a thing of its own.
struct Shareable: Identifiable, Hashable {
    /// Its name in the settings and for a caller, for example `screen.1` or `microphone`.
    let id: String
    let power: Power
    let title: String
    /// What a use of it is, for the approval and the prompt.
    let does: String
    /// An SF Symbol.
    let symbol: String

    var sharing: Sharing {
        get { Sharing(rawValue: UserDefaults.standard.string(forKey: "sharing.\(id)") ?? "") ?? .off }
        nonmutating set { UserDefaults.standard.set(newValue.rawValue, forKey: "sharing.\(id)") }
    }

    var isPermitted: Bool { power.permission?.isGranted ?? true }

    static func display(_ display: (id: CGDirectDisplayID, name: String)) -> Shareable {
        Shareable(id: "screen.\(display.id)", power: .screen, title: display.name, does: "see the display \"\(display.name)\"", symbol: "display")
    }

    static func camera(_ device: AVCaptureDevice) -> Shareable {
        Shareable(id: "camera.\(device.uniqueID)", power: .camera, title: device.localizedName, does: "see the camera \"\(device.localizedName)\"", symbol: "video")
    }

    static let microphone = Shareable(id: "microphone", power: .microphone, title: "Microphone", does: "hear the microphone", symbol: "mic")
    static let speaker = Shareable(id: "speaker", power: .speaker, title: "Speakers", does: "play sound through the speakers", symbol: "speaker.wave.2")
    static let accessibility = Shareable(id: "accessibility", power: .accessibility, title: "Window text", does: "read the window in front", symbol: "text.viewfinder")
    static let commands = Shareable(id: "commands", power: .commands, title: "Commands", does: "run commands", symbol: "terminal")
    /// Ask and Shared both show: a button is pressed by the person alone.
    static let banners = Shareable(id: "banners", power: .banners, title: "Banners", does: "show banners on the screen", symbol: "bell.badge")

    /// Everything on this Mac now, in the panel's order.
    @MainActor
    static var all: [Shareable] {
        Screen.displays.map(display) + Camera.devices.map(camera) + [microphone, speaker, banners, accessibility, commands]
    }
}
