import AVFoundation
import VoiceMeetCore

/// The one owner of the microphone: ONE `AVAudioEngine` with Apple voice processing (echo
/// cancellation, noise suppression, gain control) on its input and output.
///
/// The first design said that every remote voice must play through this engine's `farEndPlayer`,
/// because Apple's echo canceller would remove only what the same engine plays. A measurement on
/// 18 Nov 2026 (the README's "Notes from the first runs") did not show that: speech
/// that another program played was removed about as well. So `farEndPlayer` is a place for remote
/// voices, not a rule. The engine plays nothing yet. It logs the microphone's level, and it keeps
/// samples only while a caller of the local endpoint listens (`listen`).
@MainActor
final class AudioOwner {
    var onEvent: (MicrophoneEvent) -> Void = { _ in }

    private let log = AppLog("audio")
    private var engine: AVAudioEngine?
    private var farEndPlayer: AVAudioPlayerNode?
    private var configurationObserver: NSObjectProtocol?
    private var levelWindow = LevelWindow()
    private let recording = Recording()

    /// Call only when macOS has given the microphone. Reports `engineStarted` or `engineFailed`.
    func start() {
        stop()
        log.info(
            "start: input device \(AudioDevices.describeDefault(.input)); output device \(AudioDevices.describeDefault(.output))"
        )
        let engine = AVAudioEngine()
        let input = engine.inputNode

        // Voice processing can be set only while the engine is stopped. Turning it on for the input
        // node puts the output node in the same mode.
        do {
            try input.setVoiceProcessingEnabled(true)
        } catch {
            log.error("voice processing did not turn on: \(AppLog.describe(error))")
            onEvent(.engineFailed("Apple voice processing did not turn on: \(error.localizedDescription)"))
            return
        }
        // Sound of other apps stays as loud as the system allows while the microphone is on.
        input.voiceProcessingOtherAudioDuckingConfiguration = AVAudioVoiceProcessingOtherAudioDuckingConfiguration(
            enableAdvancedDucking: false,
            duckingLevel: .min
        )

        let farEndPlayer = AVAudioPlayerNode()
        engine.attach(farEndPlayer)
        self.engine = engine
        self.farEndPlayer = farEndPlayer

        // A change of device, channel count or sample rate stops the engine and sends this notification.
        configurationObserver = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange,
            object: engine,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.engineConfigurationChanged() }
        }

        connectAndStart(engine, farEndPlayer: farEndPlayer)
    }

    /// After a configuration change: the SAME engine takes the new format and starts again.
    ///
    /// The first start of a voice-processing engine itself changes the configuration on a Mac: the
    /// system joins the microphone and the speakers into one device, and the microphone format
    /// grows (3, then 9 channels on a MacBook Pro, macOS 15.7.4). A new engine for each change makes
    /// that happen again each time; that used up all automatic restarts. Apple's sample "Using voice
    /// processing" starts its one engine again.
    func restart() {
        guard let engine, let farEndPlayer else {
            start()
            return
        }
        connectAndStart(engine, farEndPlayer: farEndPlayer)
    }

    private func connectAndStart(_ engine: AVAudioEngine, farEndPlayer: AVAudioPlayerNode) {
        let input = engine.inputNode
        let output = engine.outputNode
        input.removeTap(onBus: 0)

        // ONE client format for the microphone side and the speaker side. Apple's voice-processing
        // unit does not initialise when they differ: error -10875, "client-side input and output
        // formats do not match". With no format given, the tap took the unit's own microphone format
        // and the mixer fed the speaker side in stereo; that failed on macOS 15.7.4. Apple's sample
        // gives its one `voiceIOFormat` to the same three places.
        let voiceFormat = input.outputFormat(forBus: 0)
        log.info(
            "connecting: client format \(Self.describe(voiceFormat)); microphone hardware \(Self.describe(input.inputFormat(forBus: 0))); speaker hardware \(Self.describe(output.outputFormat(forBus: 0)))"
        )
        guard voiceFormat.sampleRate > 0, voiceFormat.channelCount > 0 else {
            log.error("no microphone is available")
            onEvent(.engineFailed("no microphone is available"))
            return
        }

        engine.connect(farEndPlayer, to: engine.mainMixerNode, format: voiceFormat)
        engine.connect(engine.mainMixerNode, to: output, format: voiceFormat)
        input.installTap(
            onBus: 0,
            bufferSize: 1024,
            format: voiceFormat,
            block: Self.levelTap(recording: recording) { [weak self, weak engine] reading in
                Task { @MainActor in
                    guard let self, let engine, engine === self.engine else { return }
                    self.took(reading)
                }
            }
        )
        levelWindow = LevelWindow()

        engine.prepare()
        do {
            try engine.start()
        } catch {
            log.error("the engine did not start: \(AppLog.describe(error))")
            onEvent(.engineFailed(error.localizedDescription))
            return
        }
        log.info(
            "engine started: running \(engine.isRunning), voice processing \(input.isVoiceProcessingEnabled), bypassed \(input.isVoiceProcessingBypassed), gain control \(input.isVoiceProcessingAGCEnabled), muted \(input.isVoiceProcessingInputMuted), speaker side \(Self.describe(output.inputFormat(forBus: 0)))"
        )
        onEvent(.engineStarted)
    }

    func stop() {
        if let configurationObserver {
            NotificationCenter.default.removeObserver(configurationObserver)
        }
        configurationObserver = nil
        guard let engine else { return }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        self.engine = nil
        farEndPlayer = nil
        recording.end()
        log.info("engine stopped; the microphone is released")
    }

    /// Some seconds of what the microphone hears from now on, as a WAV file in memory: one channel,
    /// 16 bits, about 16 000 samples a second. It ends early when the engine stops.
    func listen(seconds: Double) async -> Data {
        await withCheckedContinuation { continuation in
            recording.begin(seconds: seconds, continuation)
        }
    }

    /// The voice-processing mute. Apple's muted-talker detection works only with this mute.
    func setMuted(_ isMuted: Bool) {
        engine?.inputNode.isVoiceProcessingInputMuted = isMuted
        log.info("voice-processing mute set to \(isMuted)")
    }

    private func engineConfigurationChanged() {
        guard let engine else { return }
        log.info(
            "configuration change: engine running \(engine.isRunning); input device \(AudioDevices.describeDefault(.input)); output device \(AudioDevices.describeDefault(.output))"
        )
        // The notification also comes while the engine still runs; only a stopped engine needs a restart.
        guard !engine.isRunning else { return }
        onEvent(.configurationChanged)
    }

    /// One buffer's reading arrived from the tap. The log gets the first buffer, then one line for
    /// every 2 seconds: that shows whether sound arrives and how loud it is.
    private func took(_ reading: TapReading) {
        let now = ProcessInfo.processInfo.systemUptime
        if levelWindow.buffers == 0, levelWindow.total == 0 {
            log.info(
                "first buffer: \(reading.frames) frames, \(reading.channels) ch at \(Int(reading.sampleRate)) Hz, \(Self.decibelText(reading.decibels)) dB"
            )
            levelWindow.startedAt = now
        }
        levelWindow.add(reading)
        guard now - levelWindow.startedAt >= 2 else { return }
        log.info(
            "level: \(levelWindow.buffers) buffers in \(String(format: "%.1f", now - levelWindow.startedAt)) s, loudest \(Self.decibelText(levelWindow.loudest)) dB, quietest \(Self.decibelText(levelWindow.quietest)) dB, \(reading.channels) ch at \(Int(reading.sampleRate)) Hz, \(levelWindow.total) buffers since the start"
        )
        levelWindow.startNext(at: now)
    }

    private static func decibelText(_ decibels: Float) -> String {
        String(format: "%.1f", decibels)
    }

    private static func describe(_ format: AVAudioFormat) -> String {
        "\(format.channelCount) ch at \(Int(format.sampleRate)) Hz\(format.isInterleaved ? ", interleaved" : "")"
    }

    /// The tap runs on an audio thread, so it is built outside the main actor. It computes one level
    /// for each buffer from the first channel and drops the samples.
    private nonisolated static func levelTap(
        recording: Recording,
        report: @escaping @Sendable (TapReading) -> Void
    ) -> AVAudioNodeTapBlock {
        return { buffer, _ in
            guard let samples = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return }
            let count = Int(buffer.frameLength)
            recording.add(samples, count: count, sampleRate: buffer.format.sampleRate)
            var sumOfSquares: Float = 0
            for index in 0..<count {
                sumOfSquares += samples[index] * samples[index]
            }
            let rootMeanSquare = (sumOfSquares / Float(count)).squareRoot()
            let decibels = 20 * log10(max(rootMeanSquare, 0.000_001))
            report(
                TapReading(
                    decibels: decibels,
                    frames: buffer.frameLength,
                    channels: buffer.format.channelCount,
                    sampleRate: buffer.format.sampleRate
                )
            )
        }
    }
}

/// What the tap keeps of one buffer: numbers only, no samples.
private struct TapReading: Sendable {
    /// The buffer's root mean square, in dB relative to full scale. -120 is digital silence.
    let decibels: Float
    let frames: AVAudioFrameCount
    let channels: AVAudioChannelCount
    let sampleRate: Double
}

/// The readings since the last "level" line of the log.
private struct LevelWindow {
    var startedAt: TimeInterval = 0
    var buffers = 0
    var total = 0
    var loudest: Float = -.infinity
    var quietest: Float = .infinity

    mutating func add(_ reading: TapReading) {
        buffers += 1
        total += 1
        loudest = max(loudest, reading.decibels)
        quietest = min(quietest, reading.decibels)
    }

    mutating func startNext(at time: TimeInterval) {
        startedAt = time
        buffers = 0
        loudest = -.infinity
        quietest = .infinity
    }
}

/// The sound a caller asked to hear (`AudioOwner.listen`). The tap adds samples on an audio thread;
/// nothing is kept when no caller listens.
private final class Recording: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Data, Never>?
    private var seconds = 0.0
    private var samples: [Int16] = []
    private var sampleRate = 16_000

    func begin(seconds: Double, _ continuation: CheckedContinuation<Data, Never>) {
        lock.lock()
        let earlier = self.continuation
        self.continuation = continuation
        self.seconds = seconds
        samples = []
        lock.unlock()
        // One caller at a time: an earlier one gets what it has, which is nothing.
        earlier?.resume(returning: Self.wave([], sampleRate: sampleRate))
    }

    /// Takes every third sample of 48 000 a second (the mean of three), so about 16 000 a second.
    func add(_ input: UnsafePointer<Float>, count: Int, sampleRate inputRate: Double) {
        lock.lock()
        guard continuation != nil else { return lock.unlock() }
        let step = max(1, Int((inputRate / 16_000).rounded()))
        sampleRate = Int(inputRate) / step
        var index = 0
        while index + step <= count {
            var sum: Float = 0
            for offset in 0..<step { sum += input[index + offset] }
            samples.append(Int16(max(-1, min(1, sum / Float(step))) * 32_767))
            index += step
        }
        let isComplete = Double(samples.count) >= seconds * Double(sampleRate)
        lock.unlock()
        if isComplete { end() }
    }

    func end() {
        lock.lock()
        let continuation = self.continuation
        self.continuation = nil
        let data = Self.wave(samples, sampleRate: sampleRate)
        samples = []
        lock.unlock()
        continuation?.resume(returning: data)
    }

    /// A WAV file: the 44 bytes of its header, then the samples.
    private static func wave(_ samples: [Int16], sampleRate: Int) -> Data {
        var data = Data()
        func append<Value>(_ value: Value) { withUnsafeBytes(of: value) { data.append(contentsOf: $0) } }
        let bytes = UInt32(samples.count * 2)
        data.append(contentsOf: Array("RIFF".utf8)); append(UInt32(36 + bytes)); data.append(contentsOf: Array("WAVEfmt ".utf8))
        append(UInt32(16)); append(UInt16(1)); append(UInt16(1)); append(UInt32(sampleRate)); append(UInt32(sampleRate * 2))
        append(UInt16(2)); append(UInt16(16)); data.append(contentsOf: Array("data".utf8)); append(bytes)
        samples.withUnsafeBufferPointer { data.append(UnsafeBufferPointer(rebasing: $0[...])) }
        return data
    }
}
