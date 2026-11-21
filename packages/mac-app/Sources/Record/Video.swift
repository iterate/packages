import CoreImage
import CoreMedia
import Foundation
import UniformTypeIdentifiers
import VideoToolbox

/// One track: the recorder ticks it (to close slots when no sample comes) and stops it.
protocol Track: AnyObject {
    var id: String { get }
    func tick()
    func stop()
}

/// The bytes of a compressed sample (a copy: the sample buffer goes back to the encoder).
func bytes(of sample: CMSampleBuffer) -> Data? {
    guard let block = sample.dataBuffer else { return nil }
    var data = Data(count: CMBlockBufferGetDataLength(block))
    let status = data.withUnsafeMutableBytes { CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: $0.count, destination: $0.baseAddress!) }
    return status == noErr ? data : nil
}

/// RFC 6381 codec string of an `hvcC` box (ISO/IEC 14496-15 annex E), so that it always says what
/// the encoder chose: `hvc1.<space><profile>.<compat, bits reversed>.<tier><level>.<constraints>`.
public func hevcCodecString(_ c: [UInt8]) -> String? {
    guard c.count >= 13 else { return nil }
    let space = ["", "A", "B", "C"][Int(c[1] >> 6)]
    let tier = (c[1] >> 5) & 1 == 1 ? "H" : "L"
    var compat: UInt32 = 0
    for i in 0..<4 { compat = compat << 8 | UInt32(c[2 + i]) }
    var reversed: UInt32 = 0
    for i in 0..<32 where compat & (1 << i) != 0 { reversed |= 1 << (31 - i) }
    var constraints = Array(c[6..<12])
    while let last = constraints.last, last == 0 { constraints.removeLast() }
    let parts = ["hvc1", "\(space)\(c[1] & 0x1f)", String(reversed, radix: 16, uppercase: true), "\(tier)\(c[12])"]
    return (parts + constraints.map { String($0, radix: 16, uppercase: true) }).joined(separator: ".")
}

/// A video track: pixel buffers in, one HEVC file per slot out. Our own VTCompressionSession
/// encodes (hardware, real time, no frame reordering, a quality target), so that we can force
/// keyframes. Sample times are Unix ms × 90 (a 90 kHz clock).
///
/// At each slot boundary the newest frame is encoded again with the boundary as its time, as a
/// keyframe, by the first frame past it or by the tick 200 ms after it (a still screen). A frame
/// exactly on the boundary is itself that keyframe. More keyframes every `keyframeSeconds`. Each
/// sample waits for the next one: only then is its duration known. A run of samples ends at a
/// pause, an unplugged source or a clock jump (`cut`); after a resume or a jump the track begins
/// again at once with its newest frame (a still screen sends no new one). Nothing at or before the
/// end of what was written is written again.
final class VideoTrack: Track {
    let id: String
    private let r: Recorder
    private let queue: DispatchQueue
    private let keyMs: Double
    private var session: VTCompressionSession?
    private var size = (width: 0, height: 0)
    private var newest: CVPixelBuffer?  // the newest frame of the source, also while paused
    private var lastTicks: Int64 = -1  // the end of what was written, or the newest sample's time
    private var slot: Int64?  // slot of the last encoded frame; nil while not recording
    private var restart = false  // begin again with `newest` once the timeline passes `lastTicks`
    private var ended = false  // the source is gone (an unplugged screen or camera)
    private var resized = false
    private var nextKey = 0.0
    /// The JPEG of each slot's first frame; it goes to the spool with the slot's video file.
    private var pictures: [Int64: Data] = [:]
    private var paused: Bool
    private var held: (sample: CMSampleBuffer, ticks: Int64, real: Bool)?
    private var file: SlotFile?
    private var closed: Int64 = -1  // the newest slot whose file is written
    private var info: [String: Any] = [:]
    private var extra: [String: Any] = [:]

    /// The synthetic source records while the Mac is locked: `pausable` false.
    let pausable: Bool

    init(id: String, recorder: Recorder, pausable: Bool = true) {
        self.id = id
        r = recorder
        self.pausable = pausable
        queue = DispatchQueue(label: "track.\(id)")
        keyMs = recorder.options.keyframeSeconds * 1000
        paused = pausable && recorder.isPaused
        recorder.add(self)
    }

    /// Facts for the slot event: `name`, or a screen's `x`, `y`, `scale`.
    func describe(_ facts: [String: Any]) { queue.async { self.extra = facts } }

    /// From any thread; `hostTime` is the frame's presentation time on the host clock.
    func append(_ pixelBuffer: CVPixelBuffer, hostTime: CMTime) {
        let wall = r.clock.wallMs(hostTime: hostTime)
        queue.async { self.frame(pixelBuffer, wall: wall) }
    }

    private func frame(_ pixelBuffer: CVPixelBuffer, wall: Double) {
        let last = newest
        newest = pixelBuffer
        ended = false
        guard !paused else { return }
        restart = false
        let ticks = Int64((wall * 90).rounded())
        guard ticks > lastTicks else { return }  // late, or behind what was written
        let s = Slot.start(wall)
        if let open = slot, s > open {
            // The frame before goes again at the boundary; a frame exactly on it starts the slot itself.
            if ticks > s * 90, let last { begin(last, at: Double(s)) } else { slot = nil }
        }
        let w = CVPixelBufferGetWidth(pixelBuffer), h = CVPixelBufferGetHeight(pixelBuffer)
        if session == nil || size != (w, h) {
            // A new size waits for the next slot: one file holds one size. This file ends here
            // (the rest of the slot is a hole), and the next one starts with the new size.
            guard slot == nil else {
                if !resized { cut(at: wall, keepSlot: true) }
                resized = true
                return
            }
            open(width: w, height: h)
        }
        let key = slot == nil || wall >= nextKey
        if slot == nil { slot = s }
        if key { nextKey = Double(s) + ((wall - Double(s)) / keyMs).rounded(.down) * keyMs + keyMs }
        encode(pixelBuffer, ticks: ticks, key: key, real: true)
    }

    /// `frame` again, as a keyframe at `ms`: the start of a slot, or of a new run.
    private func begin(_ frame: CVPixelBuffer, at ms: Double) {
        let w = CVPixelBufferGetWidth(frame), h = CVPixelBufferGetHeight(frame)
        if session == nil || size != (w, h) { open(width: w, height: h) }
        let s = Slot.start(ms)
        slot = s
        nextKey = Double(s) + ((ms - Double(s)) / keyMs).rounded(.down) * keyMs + keyMs
        encode(frame, ticks: Int64((ms * 90).rounded()), key: true, real: false)
    }

    private func encode(_ frame: CVPixelBuffer, ticks: Int64, key: Bool, real: Bool) {
        guard let session, let s = slot else { return }
        lastTicks = ticks
        // Here and not later: a slot that ends at once still has its picture.
        if pictures[s] == nil { pictures[s] = jpeg(frame, width: r.options.pictureWidth) }
        let properties = key ? [kVTEncodeFrameOptionKey_ForceKeyFrame: kCFBooleanTrue] as CFDictionary : nil
        VTCompressionSessionEncodeFrame(
            session, imageBuffer: frame, presentationTimeStamp: CMTime(value: ticks, timescale: 90_000), duration: .invalid,
            frameProperties: properties, infoFlagsOut: nil
        ) { [weak self] status, _, sample in
            guard let self else { return }
            // VideoToolbox runs in real time and may drop a frame, also a keyframe we asked for.
            guard status == noErr, let sample else { return self.queue.async { if key { self.keyLost() } } }
            self.queue.async { self.encoded(sample, ticks: ticks, real: real) }
        }
    }

    /// A file must start with a keyframe: the track begins again at once, with a new one.
    private func keyLost() { (slot, restart) = (nil, !paused) }

    private func encoded(_ sample: CMSampleBuffer, ticks: Int64, real: Bool) {
        if let held { put(held, until: ticks) }
        held = (sample, ticks, real)
        if let file, ticks >= (file.slot + Slot.ms) * 90 { finish() }
    }

    /// Writes a held sample into its slot's file, lasting until `end` (at most to the slot's end).
    private func put(_ h: (sample: CMSampleBuffer, ticks: Int64, real: Bool), until end: Int64) {
        let s = h.ticks / (Slot.ms * 90) * Slot.ms
        guard s > closed, let data = bytes(of: h.sample) else { return }
        if let file, file.slot != s { finish() }
        let attachments = CMSampleBufferGetSampleAttachmentsArray(h.sample, createIfNecessary: false) as? [[CFString: Any]]
        let sync = attachments?.first?[kCMSampleAttachmentKey_NotSync] as? Bool != true
        if file == nil {
            guard sync else { return keyLost() }
            guard let format = h.sample.formatDescription, let header = header(format) else { return }
            guard r.opening(track: id, slot: s) else { return closed = s }
            file = SlotFile(slot: s, header: header)
        }
        file?.append(data, at: h.ticks - s * 90, duration: min(end, (s + Slot.ms) * 90) - h.ticks, sync: sync, newFragment: sync)
        if h.real { file?.frames += 1 }
    }

    private func header(_ format: CMFormatDescription) -> Data? {
        let atoms = CMFormatDescriptionGetExtension(format, extensionKey: kCMFormatDescriptionExtension_SampleDescriptionExtensionAtoms) as? [String: Any]
        let dims = CMVideoFormatDescriptionGetDimensions(format)
        guard let config = atoms?["hvcC"] as? Data else {
            log("\(id): the encoder gave no hvcC")
            return nil
        }
        info = ["kind": "video", "codec": hevcCodecString([UInt8](config)) ?? "hvc1", "width": Int(dims.width), "height": Int(dims.height)]
            .merging(extra) { a, _ in a }
        let entry = FMP4.videoEntry(type: "hvc1", configType: "hvcC", config: config, width: Int(dims.width), height: Int(dims.height))
        return FMP4.header(video: true, timescale: 90_000, width: Int(dims.width), height: Int(dims.height), entry: entry)
    }

    private func finish() {
        guard let file else { return }
        self.file = nil
        closed = file.slot
        let parts = file.close()
        var entry = info
        entry["frames"] = file.frames
        entry["parts"] = file.fragments.map { [$0.offset, Int($0.ticks / 90)] }
        r.finished(track: id, slot: file.slot, parts: parts, size: file.size, entry: entry, picture: pictures[file.slot])
        pictures = pictures.filter { $0.key > file.slot }
    }

    func tick() {
        queue.async {
            let now = nowMs()
            if !self.paused, let frame = self.newest {
                if let open = self.slot, now >= Double(open + Slot.ms) + 200 {
                    self.begin(frame, at: Double(Slot.start(now - 200)))
                } else if self.slot == nil, self.restart, Int64(now * 90) > self.lastTicks {
                    self.restart = false
                    self.begin(frame, at: now)
                }
            }
            if let file = self.file, self.held == nil, now >= Double(file.slot + Slot.ms) + 200 { self.finish() }
        }
    }

    /// The display sleeps or the Mac is locked: the last frame lasts until now, and nothing more
    /// is written until `resume`. A slot without a file means "not recorded".
    func pause() { stopRun(at: nowMs()) { $0.paused = true } }

    func resume() { queue.async { (self.paused, self.restart) = (false, !self.ended) } }

    /// A camera that was off has no newest frame: after it starts again, its first new frame
    /// begins the run, not the one from before the pause.
    func forgetNewest() { queue.async { self.newest = nil } }

    /// The source is gone (an unplugged screen or camera): its track ends now.
    func end() { stopRun(at: nowMs()) { $0.ended = true } }

    /// The clock jumped (`ms` is the moment on the old timeline): time it skipped holds no frame,
    /// and time that comes again is not written twice. The track begins again on the new timeline.
    func clockJumped(at ms: Double) { stopRun(at: ms) { $0.restart = !$0.ended } }

    private func stopRun(at ms: Double, _ change: @escaping (VideoTrack) -> Void) {
        queue.async {
            self.restart = false
            change(self)
            self.cut(at: ms)
        }
    }

    /// On `queue`: the held sample lasts until `ms`; the next frame begins a new run (or, with
    /// `keepSlot`, the next slot does).
    private func cut(at ms: Double, keepSlot: Bool = false) {
        if let session { VTCompressionSessionCompleteFrames(session, untilPresentationTimeStamp: .invalid) }
        // After the encoder's last outputs, which it queued behind this block.
        queue.async {
            let end = Int64((ms * 90).rounded())
            if let held = self.held { self.put(held, until: max(held.ticks + 1, end)) }
            self.held = nil
            self.lastTicks = max(self.lastTicks, end)
            if !keepSlot { self.slot = nil }
        }
    }

    func stop() {
        pause()
        queue.sync {}
        queue.sync {
            finish()
            if let session { VTCompressionSessionInvalidate(session) }
            session = nil
        }
    }

    private func open(width: Int, height: Int) {
        if let old = session {
            VTCompressionSessionCompleteFrames(old, untilPresentationTimeStamp: .invalid)
            VTCompressionSessionInvalidate(old)
            session = nil
        }
        resized = false
        let options = r.options
        var made: VTCompressionSession?
        let spec = [kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder: kCFBooleanTrue] as CFDictionary
        let status = VTCompressionSessionCreate(
            allocator: nil, width: Int32(width), height: Int32(height), codecType: kCMVideoCodecType_HEVC, encoderSpecification: spec,
            imageBufferAttributes: nil, compressedDataAllocator: nil, outputCallback: nil, refcon: nil, compressionSessionOut: &made)
        guard status == noErr, let made else {
            log("\(id): no HEVC encoder for \(width)×\(height) (status \(status))")
            return
        }
        let settings: [(CFString, CFTypeRef)] = [
            (kVTCompressionPropertyKey_RealTime, kCFBooleanTrue),
            (kVTCompressionPropertyKey_AllowFrameReordering, kCFBooleanFalse),
            (kVTCompressionPropertyKey_ProfileLevel, kVTProfileLevel_HEVC_Main_AutoLevel),
            (kVTCompressionPropertyKey_Quality, options.quality as CFNumber),
            (kVTCompressionPropertyKey_ExpectedFrameRate, options.fps as CFNumber),
            // We force every keyframe; this is only a backstop.
            (kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration, (Double(Slot.ms) / 1000 + 1) as CFNumber),
        ]
        for (key, value) in settings where VTSessionSetProperty(made, key: key, value: value) != noErr {
            log("\(id): encoder refused \(key)")
        }
        VTCompressionSessionPrepareToEncodeFrames(made)
        session = made
        size = (width, height)
        log("\(id): \(width)×\(height) HEVC")
    }
}

/// The picture of a frame: a JPEG, `width` pixels wide.
func jpeg(_ frame: CVPixelBuffer, width: Int, quality: Double = 0.6) -> Data? {
    let image = CIImage(cvPixelBuffer: frame)
    let scale = Double(width) / image.extent.width
    let scaled = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    guard let cg = pictureContext.createCGImage(scaled, from: scaled.extent.integral) else { return nil }
    let data = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
    CGImageDestinationAddImage(destination, cg, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
    return CGImageDestinationFinalize(destination) ? data as Data : nil
}

private let pictureContext = CIContext()
