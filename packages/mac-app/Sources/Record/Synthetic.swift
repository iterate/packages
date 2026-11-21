import CoreGraphics
import CoreMedia
import CoreVideo
import Foundation

/// A source that needs no permission, for tests: video `test-1` (moving bars, the frame's wall time
/// as a 48-bit strip at the bottom, 1280×720 at `fps`, with a 5 s still pause every 20 s of the
/// wall clock, from 3 s before each multiple of 20 s, so every other slot starts inside a pause),
/// and audio `test-2` (a 100 ms beep at the start of each wall-clock second). It records while the
/// Mac is locked.
final class Synthetic: Source {
    static let width = 1280, height = 720
    private let r: Recorder
    private let video: VideoTrack
    private let audio: AudioTrack
    private let queue = DispatchQueue(label: "record.synthetic")
    private var timers: [DispatchSourceTimer] = []
    private var pool: CVPixelBufferPool?
    private var audioStart = CMTime.zero
    private var samplesMade: Int64 = 0
    private let rate = 48_000.0

    init(recorder: Recorder) {
        r = recorder
        video = VideoTrack(id: "test-1", recorder: recorder, pausable: false)
        audio = AudioTrack(id: "test-2", recorder: recorder, channels: 1, bitrate: 64_000)
        let attributes: [CFString: Any] = [
            kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_32BGRA, kCVPixelBufferWidthKey: Synthetic.width,
            kCVPixelBufferHeightKey: Synthetic.height, kCVPixelBufferIOSurfacePropertiesKey: [:] as CFDictionary,
        ]
        CVPixelBufferPoolCreate(nil, nil, attributes as CFDictionary, &pool)
    }

    func start() {
        audioStart = r.clock.hostNow()
        every(1.0 / Double(r.options.fps)) { self.frame() }
        every(0.02) { self.sound() }
        log("synthetic: test-1 video 1280×720 \(r.options.fps) fps, test-2 audio")
    }

    private func every(_ seconds: Double, _ body: @escaping () -> Void) {
        let timer = DispatchSource.makeTimerSource(flags: .strict, queue: queue)
        timer.schedule(deadline: .now() + seconds, repeating: seconds, leeway: .milliseconds(1))
        timer.setEventHandler(handler: body)
        timer.resume()
        timers.append(timer)
    }

    func stop() {
        for timer in timers { timer.cancel() }
        queue.sync {}  // a handler that is running now ends before the writers close
    }

    private func frame() {
        let host = r.clock.hostNow()
        let wall = r.clock.wallMs(hostTime: host)
        if (wall + 3000).truncatingRemainder(dividingBy: 20_000) < 5000 { return }  // the still pause
        var buffer: CVPixelBuffer?
        guard let pool, CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer) == kCVReturnSuccess, let buffer else { return }
        CVPixelBufferLockBaseAddress(buffer, [])
        let w = Synthetic.width, h = Synthetic.height
        if let context = CGContext(
            data: CVPixelBufferGetBaseAddress(buffer), width: w, height: h, bitsPerComponent: 8,
            bytesPerRow: CVPixelBufferGetBytesPerRow(buffer), space: CGColorSpace(name: CGColorSpace.sRGB)!,
            bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
        {
            context.setFillColor(CGColor(red: 0.08, green: 0.1, blue: 0.16, alpha: 1))
            context.fill(CGRect(x: 0, y: 0, width: w, height: h))
            for i in 0..<6 {
                let x = (wall / Double(4 + i * 2)).truncatingRemainder(dividingBy: Double(w + 200)) - 200
                context.setFillColor(CGColor(red: Double(i) / 6, green: 0.6, blue: 1 - Double(i) / 6, alpha: 1))
                context.fill(CGRect(x: x, y: Double(120 + i * 70), width: 160, height: 50))
            }
            // The wall time as 48 bits, most significant first, 24 px blocks: a machine can read it back.
            let ms = Int64(wall.rounded(.down))
            for bit in 0..<48 {
                context.setFillColor(CGColor(gray: (ms >> (47 - bit)) & 1 == 1 ? 1 : 0, alpha: 1))
                context.fill(CGRect(x: 32 + bit * 24, y: h - 32, width: 24, height: 24))
            }
        }
        CVPixelBufferUnlockBaseAddress(buffer, [])
        video.append(buffer, hostTime: host)
    }

    private func sound() {
        let target = Int64((r.clock.hostNow() - audioStart).seconds * rate)
        let count = Int(target - samplesMade)
        guard count > 0 else { return }
        let startWall = r.clock.wallMs(hostTime: audioStart)
        var samples = [Float](repeating: 0, count: count)
        for i in 0..<count {
            let n = samplesMade + Int64(i)
            if (startWall + Double(n) / rate * 1000).truncatingRemainder(dividingBy: 1000) < 100 {
                samples[i] = Float(sin(2 * Double.pi * 880 * Double(n) / rate) * 0.3)
            }
        }
        let host = audioStart + CMTime(value: samplesMade, timescale: Int32(rate))
        samplesMade = target
        var asbd = AudioStreamBasicDescription(
            mSampleRate: rate, mFormatID: kAudioFormatLinearPCM, mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked,
            mBytesPerPacket: 4, mFramesPerPacket: 1, mBytesPerFrame: 4, mChannelsPerFrame: 1, mBitsPerChannel: 32, mReserved: 0)
        var format: CMAudioFormatDescription?
        guard CMAudioFormatDescriptionCreate(
            allocator: nil, asbd: &asbd, layoutSize: 0, layout: nil, magicCookieSize: 0, magicCookie: nil, extensions: nil,
            formatDescriptionOut: &format) == noErr
        else { return }
        var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: Int32(rate)), presentationTimeStamp: host, decodeTimeStamp: .invalid)
        var sample: CMSampleBuffer?
        guard CMSampleBufferCreate(
            allocator: nil, dataBuffer: nil, dataReady: false, makeDataReadyCallback: nil, refcon: nil, formatDescription: format,
            sampleCount: count, sampleTimingEntryCount: 1, sampleTimingArray: &timing, sampleSizeEntryCount: 0, sampleSizeArray: nil,
            sampleBufferOut: &sample) == noErr, let sample
        else { return }
        let ok = samples.withUnsafeMutableBytes { raw -> Bool in
            var list = AudioBufferList(mNumberBuffers: 1, mBuffers: AudioBuffer(mNumberChannels: 1, mDataByteSize: UInt32(raw.count), mData: raw.baseAddress))
            return CMSampleBufferSetDataBufferFromAudioBufferList(sample, blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0, bufferList: &list) == noErr
        }
        if ok { audio.append(sample, hostTime: host) }
    }
}
