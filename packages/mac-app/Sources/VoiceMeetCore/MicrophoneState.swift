/// The system's microphone mode. Only the person can choose it; the app reads it.
public enum MicrophoneMode: String, Equatable, Sendable {
    case standard
    case voiceIsolation
    case wideSpectrum
    case unknown

    public var label: String {
        switch self {
        case .standard: return "Standard"
        case .voiceIsolation: return "Voice Isolation"
        case .wideSpectrum: return "Wide Spectrum"
        case .unknown: return "unknown"
        }
    }
}

public enum MicrophonePhase: Equatable, Sendable {
    case off
    /// The app asked the system whether it may use the microphone. The person answers the prompt.
    case checkingAccess
    case starting
    /// The one audio engine runs with Apple voice processing.
    case on
    case denied
    case failed(String)
}

public enum MicrophoneEvent: Equatable, Sendable {
    case startRequested
    case accessGranted
    case accessDenied
    case engineStarted
    case engineFailed(String)
    case stopRequested
    /// The audio hardware changed (device, channel count or sample rate) and the engine stopped itself.
    case configurationChanged
    case muteToggled
    case modesRead(active: MicrophoneMode, preferred: MicrophoneMode)
}

public enum MicrophoneEffect: Equatable, Sendable {
    case checkAccess
    case startEngine
    case stopEngine
    case restartEngine
    case setMuted(Bool)
}

public struct MicrophoneState: Equatable, Sendable {
    /// Restarts after a hardware change, for one "Start Microphone". Turning voice processing on can
    /// itself change the hardware configuration, so without a limit a restart could repeat for ever.
    public static let maximumAutomaticRestarts = 5

    public private(set) var phase: MicrophonePhase = .off
    public private(set) var isMuted = false
    public private(set) var activeMode: MicrophoneMode = .unknown
    public private(set) var preferredMode: MicrophoneMode = .unknown
    public private(set) var automaticRestarts = 0

    public init() {}

    /// True while the app holds, or is about to hold, the microphone.
    public var isRunning: Bool {
        switch phase {
        case .starting, .on: return true
        case .off, .checkingAccess, .denied, .failed: return false
        }
    }

    public var statusLine: String {
        switch phase {
        case .off: return "Microphone off"
        case .checkingAccess: return "Waiting for the microphone permission…"
        case .starting: return "Starting the microphone…"
        case .on:
            let restarts = automaticRestarts == 0 ? "" : ", \(automaticRestarts) restart(s) after a device change"
            return "Microphone \(isMuted ? "muted" : "on"), Apple voice processing\(restarts)"
        case .denied:
            return "Microphone not allowed: System Settings › Privacy & Security › Microphone"
        case .failed(let message): return "Microphone failed: \(message)"
        }
    }

    public var modeLine: String {
        guard phase == .on else { return "Microphone mode: shown while the microphone is on" }
        if activeMode == preferredMode { return "Microphone mode: \(activeMode.label)" }
        return "Microphone mode: \(activeMode.label) (you chose \(preferredMode.label))"
    }

    /// Every pair of phase and event has a defined result. A pair with no meaning changes nothing.
    public mutating func handle(_ event: MicrophoneEvent) -> [MicrophoneEffect] {
        switch (phase, event) {
        case (_, .modesRead(let active, let preferred)):
            activeMode = active
            preferredMode = preferred
            return []

        case (.off, .startRequested), (.denied, .startRequested), (.failed, .startRequested):
            phase = .checkingAccess
            isMuted = false
            automaticRestarts = 0
            return [.checkAccess]

        case (.checkingAccess, .accessGranted):
            phase = .starting
            return [.startEngine]
        case (.checkingAccess, .accessDenied):
            phase = .denied
            return []

        case (.starting, .engineStarted):
            phase = .on
            return isMuted ? [.setMuted(true)] : []
        case (.starting, .engineFailed(let message)), (.on, .engineFailed(let message)):
            phase = .failed(message)
            return [.stopEngine]

        case (.starting, .configurationChanged), (.on, .configurationChanged):
            guard automaticRestarts < Self.maximumAutomaticRestarts else {
                phase = .failed(
                    "the audio device changed more than \(Self.maximumAutomaticRestarts) times; start the microphone again"
                )
                return [.stopEngine]
            }
            automaticRestarts += 1
            phase = .starting
            return [.restartEngine]

        case (.on, .muteToggled):
            isMuted.toggle()
            return [.setMuted(isMuted)]

        case (.checkingAccess, .stopRequested):
            phase = .off
            return []
        case (.starting, .stopRequested), (.on, .stopRequested):
            phase = .off
            return [.stopEngine]

        default:
            return []
        }
    }
}
