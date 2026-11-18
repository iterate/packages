import AVFoundation

/// Plays sound through the Mac's speakers for a caller of the local endpoint: a sound file's
/// bytes, or words in the system's voice. One sound at a time; a call returns when its sound ends.
@MainActor
final class Speaker: NSObject, AVAudioPlayerDelegate, AVSpeechSynthesizerDelegate {
    /// The longest sound a caller may play, in seconds.
    static let longestSound: TimeInterval = 300

    private let synthesizer = AVSpeechSynthesizer()
    private var player: AVAudioPlayer?
    private var ended: CheckedContinuation<Void, Never>?

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    /// Reads a sound file's bytes (WAV, AIFF, MP3, AAC and the like), ready to play.
    func open(_ sound: Data) throws -> AVAudioPlayer {
        guard let player = try? AVAudioPlayer(data: sound) else {
            throw EndpointRefusal("That is no sound this Mac can play. Send the bytes of a WAV, AIFF, MP3 or AAC file.")
        }
        guard player.duration <= Self.longestSound else {
            throw EndpointRefusal("That sound is \(Int(player.duration)) s long; the longest allowed is \(Int(Self.longestSound)) s.")
        }
        return player
    }

    func play(_ player: AVAudioPlayer) async throws {
        try claim()
        player.delegate = self
        self.player = player
        await withCheckedContinuation { continuation in
            ended = continuation
            if !player.play() { finish() }
        }
    }

    func say(_ words: String) async throws {
        try claim()
        await withCheckedContinuation { continuation in
            ended = continuation
            synthesizer.speak(AVSpeechUtterance(string: words))
        }
    }

    func stop() {
        player?.stop()
        synthesizer.stopSpeaking(at: .immediate)
        finish()
    }

    private func claim() throws {
        guard ended == nil else { throw EndpointRefusal("The speakers already play a sound for a caller. Ask again when it has ended.") }
    }

    private func finish() {
        player = nil
        ended?.resume()
        ended = nil
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in self.finish() }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in self.finish() }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in self.finish() }
    }
}
