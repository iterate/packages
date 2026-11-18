public enum CameraPhase: Equatable, Sendable {
    case off
    /// The app asked the system whether it may use the camera. The person answers the prompt.
    case checkingAccess
    case starting
    /// The camera runs. The associated value is the camera's name.
    case on(String)
    case denied
    case failed(String)
}

public enum CameraEvent: Equatable, Sendable {
    case startRequested
    case accessGranted
    case accessDenied
    case sessionStarted(String)
    case sessionFailed(String)
    case stopRequested
}

public enum CameraEffect: Equatable, Sendable {
    case checkAccess
    case startSession
    case stopSession
}

public struct CameraState: Equatable, Sendable {
    public private(set) var phase: CameraPhase = .off

    public init() {}

    /// True while the app holds, or is about to hold, the camera.
    public var isRunning: Bool {
        switch phase {
        case .starting, .on: return true
        case .off, .checkingAccess, .denied, .failed: return false
        }
    }

    public var isOn: Bool {
        if case .on = phase { return true }
        return false
    }

    public var statusLine: String {
        switch phase {
        case .off: return "Camera off"
        case .checkingAccess: return "Waiting for the camera permission…"
        case .starting: return "Starting the camera…"
        case .on(let name): return "Camera on: \(name)"
        case .denied: return "Camera not allowed: System Settings › Privacy & Security › Camera"
        case .failed(let message): return "Camera failed: \(message)"
        }
    }

    /// Every pair of phase and event has a defined result. A pair with no meaning changes nothing.
    public mutating func handle(_ event: CameraEvent) -> [CameraEffect] {
        switch (phase, event) {
        case (.off, .startRequested), (.denied, .startRequested), (.failed, .startRequested):
            phase = .checkingAccess
            return [.checkAccess]
        case (.checkingAccess, .accessGranted):
            phase = .starting
            return [.startSession]
        case (.checkingAccess, .accessDenied):
            phase = .denied
            return []
        case (.starting, .sessionStarted(let name)):
            phase = .on(name)
            return []
        case (.starting, .sessionFailed(let message)), (.on, .sessionFailed(let message)):
            phase = .failed(message)
            return [.stopSession]
        case (.checkingAccess, .stopRequested):
            phase = .off
            return []
        case (.starting, .stopRequested), (.on, .stopRequested):
            phase = .off
            return [.stopSession]
        default:
            return []
        }
    }
}
