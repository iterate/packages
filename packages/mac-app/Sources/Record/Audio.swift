import AVFoundation
import CoreMedia
import Foundation

/// An audio track: PCM in, one AAC file per slot out. One encoder runs across slots: packet `n`
/// holds the sound from input sample `n × 1024 − 2112`, and that is its time. The encoder gets 960
/// samples of silence first, so a packet begins exactly at the first real sample (a start on a
/// slot boundary loses nothing). A file starts with the first packet that begins in its slot.
/// Times are samples at 48 kHz from Unix time zero. Input follows host time through `Resync`; a
/// new encoder only when host time jumps forward by more than 250 ms (a wake, a clock set).
final class AudioTrack: Track {
    static let rate = 48_000.0
    static let perSlot = Int64(rate) * Slot.ms / 1000
    static let maxStep: Int64 = 12_000  // 250 ms
    let id: String
    private let r: Recorder
    private let queue: DispatchQueue
    private let pcm: AVAudioFormat
    private let aac: AVAudioFormat
    private let bitrate: Int
    private var resampler: AVAudioConverter?
    private var encoder: AVAudioConverter?
    private var output: AVAudioCompressedBuffer?  // the encoder's packets, used again for each call
    private var origin: Int64 = 0  // sample of the first input to this encoder (the silence)
    private var firstSlot: Int64 = 0  // slot of the first real sample
    private var fed: Int64 = 0
    private var packets: Int64 = 0
    private var input: [AVAudioPCMBuffer] = []
    private var resynced = (added: 0, dropped: 0), rewound = false
    private var file: SlotFile?
    private var closed: Int64 = -1
    private var levels: [Int64: Level] = [:]
    private let header: Data
    private let info: [String: Any]

    init(id: String, recorder: Recorder, channels: Int, bitrate: Int, name: String? = nil) {
        self.id = id
        r = recorder
        self.bitrate = bitrate
        queue = DispatchQueue(label: "track.\(id)")
        pcm = AVAudioFormat(standardFormatWithSampleRate: AudioTrack.rate, channels: AVAudioChannelCount(channels))!
        aac = AVAudioFormat(settings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: AudioTrack.rate, AVNumberOfChannelsKey: channels])!
        header = FMP4.header(video: false, timescale: UInt32(AudioTrack.rate), entry: FMP4.aacEntry(rate: Int(AudioTrack.rate), channels: channels, bitrate: bitrate))
        info = ["kind": "audio", "codec": "mp4a.40.2", "rate": Int(AudioTrack.rate), "channels": channels].merging(name.map { ["name": $0] } ?? [:]) { a, _ in a }
        recorder.add(self)
    }

    func append(_ sample: CMSampleBuffer, hostTime: CMTime) {
        let wall = r.clock.wallMs(hostTime: hostTime)
        queue.async { self.write(sample, wall: wall) }
    }

    private func write(_ sample: CMSampleBuffer, wall: Double) {
        guard var buffer = convert(sample) else { return }
        let position = Int64((wall * AudioTrack.rate / 1000).rounded())
        if encoder != nil, position - (origin + fed) > AudioTrack.maxStep {
            log("\(id): host time jumped \((position - origin - fed) / 48) ms ahead; new encoder")
            drain(end: true)
        }
        if encoder == nil { startEncoder(at: position) }
        let drift = position - (origin + fed)
        let n = Int(buffer.frameLength)
        // Host time went back (a clock set): input is dropped until it reaches the sample count.
        rewound = rewound || drift < -AudioTrack.maxStep
        if rewound {
            guard -drift < n else { return resynced.dropped += n }
            (rewound, buffer) = (false, drift < 0 ? remap(buffer, Array(Int(-drift)..<n)) : buffer)
            resynced.dropped += Int(max(0, -drift))
        } else if case let change = Resync.change(drift: drift, count: n), change != 0 {
            buffer = remap(buffer, Resync.indices(count: n, change: change))
            if change > 0 { resynced.added += change } else { resynced.dropped -= change }
        }
        measure(buffer)
        input.append(buffer)
        fed += Int64(buffer.frameLength)
        drain(end: false)
    }

    /// A copy of `buffer` made of the input samples at `indices`.
    private func remap(_ buffer: AVAudioPCMBuffer, _ indices: [Int]) -> AVAudioPCMBuffer {
        guard let out = AVAudioPCMBuffer(pcmFormat: pcm, frameCapacity: AVAudioFrameCount(max(1, indices.count))),
            let from = buffer.floatChannelData, let to = out.floatChannelData
        else { return buffer }
        out.frameLength = AVAudioFrameCount(indices.count)
        for c in 0..<Int(pcm.channelCount) {
            for (i, j) in indices.enumerated() { to[c][i] = from[c][j] }
        }
        return out
    }

    /// The sample buffer as float PCM at 48 kHz with the track's channels.
    private func convert(_ sample: CMSampleBuffer) -> AVAudioPCMBuffer? {
        guard let description = sample.formatDescription else { return nil }
        let format = AVAudioFormat(cmAudioFormatDescription: description)
        let frames = AVAudioFrameCount(sample.numSamples)
        guard frames > 0, let source = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { return nil }
        source.frameLength = frames
        guard CMSampleBufferCopyPCMDataIntoAudioBufferList(sample, at: 0, frameCount: Int32(frames), into: source.mutableAudioBufferList) == noErr
        else { return nil }
        if format == pcm { return source }
        if resampler?.inputFormat != format {
            resampler = AVAudioConverter(from: format, to: pcm)
            resampler?.downmix = true
        }
        let capacity = AVAudioFrameCount(Double(frames) * AudioTrack.rate / format.sampleRate) + 64
        guard let resampler, let out = AVAudioPCMBuffer(pcmFormat: pcm, frameCapacity: capacity) else { return nil }
        var given = false
        _ = resampler.convert(to: out, error: nil) { _, status in
            if given {
                status.pointee = .noDataNow
                return nil
            }
            given = true
            status.pointee = .haveData
            return source
        }
        return out.frameLength > 0 ? out : nil
    }

    /// Adds the buffer's samples to the level of the slot and the half second each one falls in.
    private func measure(_ buffer: AVAudioPCMBuffer) {
        guard let data = buffer.floatChannelData else { return }
        let n = Int(buffer.frameLength), channels = Int(pcm.channelCount)
        let half = AudioTrack.perSlot / Int64(Level.halves)
        var i = 0
        while i < n {
            let position = origin + fed + Int64(i)
            let s = position / AudioTrack.perSlot * Slot.ms
            let index = Int(position % AudioTrack.perSlot / half)
            // Up to the end of this half second (which is never past the end of the slot).
            let stop = min(n, i + Int(half - position % half))
            var sum: Float = 0, peak: Float = 0
            for c in 0..<channels {
                for x in UnsafeBufferPointer(start: data[c] + i, count: stop - i) {
                    sum += x * x
                    peak = max(peak, abs(x))
                }
            }
            levels[s, default: Level()].add(sum: Double(sum), count: (stop - i) * channels, peak: peak, half: index)
            i = stop
        }
    }

    private func startEncoder(at position: Int64) {
        let encoder = AVAudioConverter(from: pcm, to: aac)!
        encoder.bitRate = bitrate
        self.encoder = encoder
        output = AVAudioCompressedBuffer(format: aac, packetCapacity: 32, maximumPacketSize: max(1, encoder.maximumOutputPacketSize))
        let silence = AVAudioPCMBuffer(pcmFormat: pcm, frameCapacity: 960)!
        silence.frameLength = 960  // zeros
        origin = position - 960
        firstSlot = Slot.start(Double(position) / 48)
        fed = 960
        packets = 0
        input = [silence]
    }

    /// Takes every packet the encoder has ready (all of them at the end of an encoder).
    private func drain(end: Bool) {
        guard let encoder, let out = output else { return }
        while true {
            let status = encoder.convert(to: out, error: nil) { _, status in
                guard !self.input.isEmpty else {
                    status.pointee = end ? .endOfStream : .noDataNow
                    return nil
                }
                status.pointee = .haveData
                return self.input.removeFirst()
            }
            for i in 0..<Int(out.packetCount) {
                guard let d = out.packetDescriptions?[i] else { continue }
                packet(Data(bytes: out.data + Int(d.mStartOffset), count: Int(d.mDataByteSize)))
            }
            if out.packetCount == 0 || status == .error || status == .endOfStream { break }
        }
        if end { self.encoder = nil }
    }

    private func packet(_ bytes: Data) {
        let begin = origin + packets * 1024 - 2112
        packets += 1
        let s = begin / AudioTrack.perSlot * Slot.ms
        // Priming that falls before the slot of the first sample, or a slot already written: dropped.
        guard s >= firstSlot, s > closed else { return }
        if let file, file.slot != s { finish() }
        if file == nil {
            guard r.opening(track: id, slot: s) else { return closed = s }
            file = SlotFile(slot: s, header: header)
        }
        guard let file else { return }
        let t = begin - s * AudioTrack.perSlot / Slot.ms
        guard t >= file.end else { return }
        file.append(bytes, at: t, duration: 1024, sync: true, newFragment: false)
    }

    private func finish() {
        guard let file else { return }
        self.file = nil
        closed = file.slot
        var entry = info
        if let level = levels[file.slot], level.count > 0 {
            entry["rms"] = level.rms
            entry["peak"] = level.peakDB
            entry["levels"] = level.levels
        }
        levels = levels.filter { $0.key > file.slot }
        let parts = file.close()
        r.finished(track: id, slot: file.slot, parts: parts, size: file.size, entry: entry, picture: nil)
    }

    func tick() {
        queue.async {
            // Late enough for the encoder's delay and the capture's buffers.
            if let file = self.file, nowMs() >= Double(file.slot + Slot.ms) + 2000 { self.finish() }
        }
    }

    func stop() {
        queue.sync {
            drain(end: true)
            finish()
            if resynced != (0, 0) { log("\(id): followed the clock by \(resynced.added) samples added, \(resynced.dropped) dropped") }
        }
    }
}
