import AVFoundation
import AppKit
import CoreAudio
import CoreGraphics
import Foundation
import ScreenCaptureKit

/// Screens: one SCStream per display at native pixels, cursor shown. Only frames whose status is
/// `.complete` are encoded: an idle screen sends none. A display change restarts every stream; a
/// track keeps its name, a new size starts with the next slot, and a display that is gone ends its
/// track. The windows of excluded apps are left out; a launch of such an app updates the filters.
final class Screens: NSObject, Source, SCStreamOutput, SCStreamDelegate {
    private let r: Recorder
    private let queue = DispatchQueue(label: "record.screens")
    private var streams: [SCStream: (track: VideoTrack, display: CGDirectDisplayID)] = [:]
    private var tracks: [String: VideoTrack] = [:]
    private var restartPending = false
    private var stopped = false
    private var observer: NSObjectProtocol?

    init(recorder: Recorder) { r = recorder }

    private static let displaysChanged: CGDisplayReconfigurationCallBack = { _, flags, user in
        guard !flags.contains(.beginConfigurationFlag), let user else { return }
        Unmanaged<Screens>.fromOpaque(user).takeUnretainedValue().displaysChanged()
    }

    func start() {
        guard CGPreflightScreenCaptureAccess() else { return log("screens: off, no Screen Recording permission") }
        CGDisplayRegisterReconfigurationCallback(Screens.displaysChanged, Unmanaged.passUnretained(self).toOpaque())
        observer = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didLaunchApplicationNotification, object: nil, queue: nil) {
            [weak self] note in
            let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
            if let self, self.r.options.exclude.excludes(app?.bundleIdentifier) { Task { await self.refilter() } }
        }
        Task { await self.open() }
    }

    /// Every app, also those with no window on screen now: their windows may show later.
    private func content() async throws -> (SCShareableContent, [SCRunningApplication]) {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        return (content, content.applications.filter { r.options.exclude.excludes($0.bundleIdentifier) })
    }

    private func refilter() async {
        guard let (content, excluded) = try? await content() else { return }
        for (stream, s) in queue.sync(execute: { streams }) {
            guard let display = content.displays.first(where: { $0.displayID == s.display }) else { continue }
            try? await stream.updateContentFilter(SCContentFilter(display: display, excludingApplications: excluded, exceptingWindows: []))
        }
        log("screens: \(excluded.count) excluded apps left out of the video")
    }

    private func open() async {
        let content: SCShareableContent, excluded: [SCRunningApplication]
        do {
            (content, excluded) = try await self.content()
        } catch {
            return log("screens: off, \(error.localizedDescription)")
        }
        if content.displays.isEmpty { log("screens: no display (the Mac may be locked); trying again at the next resume") }
        let ids = Set(content.displays.map { "screen-\($0.displayID)" })
        for (id, track) in queue.sync(execute: { tracks }) where !ids.contains(id) {
            log("\(id): the display is gone; its track ends")
            track.end()
        }
        for display in content.displays {
            let id = "screen-\(display.displayID)"
            let mode = CGDisplayCopyDisplayMode(display.displayID)
            let scale = Double(mode?.pixelWidth ?? display.width) / Double(max(1, display.width))
            var width = Double(display.width) * scale, height = Double(display.height) * scale
            if let maxWidth = r.options.maxWidth, width > Double(maxWidth) {
                height = height * Double(maxWidth) / width
                width = Double(maxWidth)
            }
            let config = SCStreamConfiguration()
            config.width = Int(width) & ~1
            config.height = Int(height) & ~1
            config.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(r.options.fps))
            config.showsCursor = true
            // allow-high-entropy-next-line: the name of Apple's pixel format constant, not a secret
            config.pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
            // The track keeps the newest frame to write it again at the next slot's start.
            config.queueDepth = 8
            let filter = SCContentFilter(display: display, excludingApplications: excluded, exceptingWindows: [])
            let stream = SCStream(filter: filter, configuration: config, delegate: self)
            guard let track = queue.sync(execute: { () -> VideoTrack? in
                guard !stopped else { return nil }
                let track = tracks[id] ?? VideoTrack(id: id, recorder: r)
                tracks[id] = track
                streams[stream] = (track, display.displayID)
                return track
            }) else { return }
            // Global display points and pixels per point, so that a mouse position maps to a screen.
            track.describe(["x": Int(display.frame.minX), "y": Int(display.frame.minY), "scale": round1(Double(config.width) / Double(display.width))])
            do {
                try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
                try await stream.startCapture()
                log("\(id): capturing \(config.width)×\(config.height) at up to \(r.options.fps) fps")
            } catch {
                log("\(id): not started, \(error.localizedDescription)")
                _ = queue.sync { streams.removeValue(forKey: stream) }
            }
        }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, let track = streams[stream]?.track, let buffer = sample.imageBuffer else { return }
        let info = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]]
        guard let raw = info?.first?[.status] as? Int, SCFrameStatus(rawValue: raw) == .complete else { return }
        track.append(buffer, hostTime: sample.presentationTimeStamp)
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        log("screens: a stream stopped: \(error.localizedDescription)")
        displaysChanged()
    }

    /// Debounced: a display change comes as a burst of callbacks.
    private func displaysChanged() {
        queue.async {
            guard !self.restartPending, !self.stopped else { return }
            self.restartPending = true
            self.queue.asyncAfter(deadline: .now() + 1) {
                self.restartPending = false
                guard !self.stopped else { return }
                log("screens: displays changed; restarting capture")
                let old = Array(self.streams.keys)
                self.streams.removeAll()
                Task {
                    for stream in old { try? await stream.stopCapture() }
                    await self.open()
                }
            }
        }
    }

    func resumed() {
        guard CGPreflightScreenCaptureAccess(), queue.sync(execute: { streams.isEmpty && !stopped }) else { return }
        Task { await open() }
    }

    func stop() {
        CGDisplayRemoveReconfigurationCallback(Screens.displaysChanged, Unmanaged.passUnretained(self).toOpaque())
        if let observer { NSWorkspace.shared.notificationCenter.removeObserver(observer) }
        let old = queue.sync { () -> [SCStream] in
            stopped = true
            defer { streams.removeAll() }
            return Array(streams.keys)
        }
        stopAll(old)
    }
}

/// Stops streams, waiting at most a second: a switch stops its source within a second.
private func stopAll(_ streams: [SCStream]) {
    guard !streams.isEmpty else { return }
    let done = DispatchSemaphore(value: 0)
    Task {
        for stream in streams { try? await stream.stopCapture() }
        done.signal()
    }
    _ = done.wait(timeout: .now() + 1)
}

/// Cameras and microphones: one AVCaptureSession per device. Bluetooth microphones stay closed:
/// opening one moves the headset to its hands-free mode for the whole run. A device that is
/// plugged in starts a track; one that is pulled ends it. A device keeps its track id across
/// restarts (`Recorder.number`). Everything here is on `queue`.
final class DeviceCapture: NSObject, Source, AVCaptureVideoDataOutputSampleBufferDelegate,
    AVCaptureAudioDataOutputSampleBufferDelegate
{
    private let r: Recorder
    private let media: AVMediaType
    private var open: [String: (session: AVCaptureSession, track: Track)] = [:]  // by unique id
    private var byOutput: [AVCaptureOutput: (Track, AVCaptureSession)] = [:]
    /// The time of the last camera frame that was kept, per output.
    private var lastKept: [AVCaptureOutput: CMTime] = [:]
    private var observers: [NSObjectProtocol] = []
    private let queue: DispatchQueue

    init(recorder: Recorder, media: AVMediaType) {
        r = recorder
        self.media = media
        queue = DispatchQueue(label: "record.capture.\(media.rawValue)")
    }

    private var name: String { media == .video ? "cameras" : "mics" }

    func start() {
        guard AVCaptureDevice.authorizationStatus(for: media) == .authorized else {
            return log("\(name): off, no \(media == .video ? "Camera" : "Microphone") permission")
        }
        for (note, plugged) in [(AVCaptureDevice.wasConnectedNotification, true), (AVCaptureDevice.wasDisconnectedNotification, false)] {
            observers.append(NotificationCenter.default.addObserver(forName: note, object: nil, queue: nil) { [weak self] note in
                guard let self, let device = note.object as? AVCaptureDevice, device.hasMediaType(self.media) else { return }
                self.queue.async { plugged ? self.add(device) : self.remove(device.uniqueID) }
            })
        }
        let types: [AVCaptureDevice.DeviceType] = media == .video ? [.builtInWideAngleCamera, .external] : [.microphone, .external]
        let devices = AVCaptureDevice.DiscoverySession(deviceTypes: types, mediaType: media, position: .unspecified).devices
        if devices.isEmpty { log("\(name): no devices") }
        // Built-in first, then by unique id: so a first start numbers them in that order.
        let builtIn = Int32(bitPattern: kAudioDeviceTransportTypeBuiltIn)
        let order = { (d: AVCaptureDevice) in (d.transportType == builtIn ? 0 : 1, d.uniqueID) }
        queue.sync { for device in devices.sorted(by: { order($0) < order($1) }) { add(device) } }
    }

    private func add(_ device: AVCaptureDevice) {
        guard open[device.uniqueID] == nil else { return }
        let transport = UInt32(bitPattern: device.transportType)
        if media == .audio, transport == kAudioDeviceTransportTypeBluetooth || transport == kAudioDeviceTransportTypeBluetoothLE {
            return log("mics: skipped \(device.localizedName): Bluetooth, and opening it would move the headset to hands-free")
        }
        let session = AVCaptureSession()
        guard let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input) else {
            return log("\(name): cannot open \(device.localizedName)")
        }
        session.addInput(input)
        let n = r.number(name, device: device.uniqueID)
        let track: Track
        let output: AVCaptureOutput
        if media == .video {
            let video = AVCaptureVideoDataOutput()
            // A camera's format belongs to the whole Mac: another program can set it back to
            // 1080p at 30 fps at any time. So the size limit is on our own output, which scales
            // down and keeps the frame's shape, and the rate limit is in `captureOutput`.
            let height = r.options.cameraHeight
            video.videoSettings = [
                // allow-high-entropy-next-line: the name of Apple's pixel format constant, not a secret
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
                kCVPixelBufferWidthKey as String: (height * 16 / 9) / 2 * 2,
                kCVPixelBufferHeightKey as String: height,
                AVVideoScalingModeKey: AVVideoScalingModeFit,
            ]
            video.setSampleBufferDelegate(self, queue: queue)
            output = video
            let camera = r.track("camera-\(n)") as? VideoTrack ?? VideoTrack(id: "camera-\(n)", recorder: r)
            camera.describe(["name": device.localizedName])
            track = camera
        } else {
            let audio = AVCaptureAudioDataOutput()
            audio.setSampleBufferDelegate(self, queue: queue)
            output = audio
            track = r.track("mic-\(n)") ?? AudioTrack(id: "mic-\(n)", recorder: r, channels: 1, bitrate: 64_000, name: device.localizedName)
        }
        guard session.canAddOutput(output) else { return }
        session.addOutput(output)
        if media == .video { chooseFormat(device) }
        byOutput[output] = (track, session)
        open[device.uniqueID] = (session, track)
        // a camera starts at the resume when the Mac is locked now
        if media == .audio || !r.isPaused { session.startRunning() }
        log("\(track.id): \(device.localizedName)")
    }

    private func remove(_ uid: String) {
        guard let (session, track) = open.removeValue(forKey: uid) else { return }
        session.stopRunning()
        byOutput = byOutput.filter { $0.value.1 !== session }
        (track as? VideoTrack)?.end()
        log("\(track.id): the device is gone; its track ends")
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sample: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let (track, session) = byOutput[output] else { return }
        // The session's clock is the host clock on macOS; convert anyway, in case it is not.
        let host = CMSyncConvertTime(sample.presentationTimeStamp, from: session.synchronizationClock ?? CMClockGetHostTimeClock(), to: CMClockGetHostTimeClock())
        if let video = track as? VideoTrack, let buffer = sample.imageBuffer {
            // At most `cameraFps`: 4 ms of slack, so that every second frame of 30 passes for 15.
            if let last = lastKept[output], CMTimeGetSeconds(host - last) < 1 / Double(r.options.cameraFps) - 0.004, CMTimeCompare(host, last) >= 0 {
                return
            }
            lastKept[output] = host
            video.append(buffer, hostTime: host)
        } else if let audio = track as? AudioTrack {
            audio.append(sample, hostTime: host)
        }
    }

    /// A paused camera is off: its session stops, so its light goes out. Microphones go on.
    func paused() {
        guard media == .video else { return }
        queue.async {
            for (session, track) in self.open.values {
                session.stopRunning()
                (track as? VideoTrack)?.forgetNewest()
            }
            log("cameras: off while paused")
        }
    }

    func resumed() {
        guard media == .video else { return }
        queue.async { for (session, _) in self.open.values where !session.isRunning { session.startRunning() } }
    }

    func stop() {
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
        queue.sync {
            for (session, _) in open.values { session.stopRunning() }
            open = [:]
            byOutput = [:]
        }
    }

    /// The format whose height is nearest to `cameraHeight`, among those that reach `cameraFps`;
    /// at most that rate. 1080p at 30 fps was 1.0 GB an hour, mostly sensor noise.
    private func chooseFormat(_ device: AVCaptureDevice) {
        let fps = Double(r.options.cameraFps), want = Int32(r.options.cameraHeight)
        func height(_ f: AVCaptureDevice.Format) -> Int32 { CMVideoFormatDescriptionGetDimensions(f.formatDescription).height }
        func rate(_ f: AVCaptureDevice.Format) -> Double { f.videoSupportedFrameRateRanges.map(\.maxFrameRate).max() ?? 0 }
        let fast = device.formats.filter { rate($0) >= fps - 0.5 }
        guard let best = (fast.isEmpty ? device.formats : fast).min(by: { abs(height($0) - want) < abs(height($1) - want) }),
            (try? device.lockForConfiguration()) != nil
        else { return }
        device.activeFormat = best
        device.activeVideoMinFrameDuration = CMTime(value: 1, timescale: CMTimeScale(min(fps, rate(best)).rounded()))
        device.unlockForConfiguration()
        let d = CMVideoFormatDescriptionGetDimensions(best.formatDescription)
        log("\(device.localizedName): \(d.width)×\(d.height) at up to \(Int(min(fps, rate(best)))) fps")
    }
}

/// Speakers: what the Mac plays, through a ScreenCaptureKit stream of its own with
/// `capturesAudio` (the Screen Recording grant covers it). One track, `speaker-0`, AAC 128 kbit/s
/// stereo. Our own sound is left out. The stream also makes video (it cannot make none): 2×2
/// pixels at one frame a second, dropped.
///
/// The track's time is ScreenCaptureKit's own stamp, with nothing added: measured on 21 Nov 2026,
/// it is 1.2 ms after the time the microphone track gives the same sound (MacBook Pro speakers
/// and microphone). Not measured: a Bluetooth output.
final class Speakers: NSObject, Source, SCStreamOutput, SCStreamDelegate {
    private let r: Recorder
    private let track: AudioTrack
    private let queue = DispatchQueue(label: "record.speakers")
    private var stream: SCStream?
    private var stopped = false
    /// Bounded recovery: a stream that stops is opened again, at most 5 times in a row. A minute
    /// of sound after a restart counts as healthy, and the count starts again.
    private var restarts = 0, openedAt = 0.0

    init(recorder: Recorder) {
        r = recorder
        track = AudioTrack(id: "speaker-0", recorder: recorder, channels: 2, bitrate: 128_000)
    }

    func start() {
        guard CGPreflightScreenCaptureAccess() else { return log("speakers: off, no Screen Recording permission") }
        Task { await open() }
    }

    private func open() async {
        let display: SCDisplay
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            guard let first = content.displays.first else { return log("speakers: off, no display; trying again at the next resume") }
            display = first
        } catch {
            return log("speakers: off, \(error.localizedDescription)")
        }
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = true
        config.sampleRate = 48_000
        config.channelCount = 2
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        config.showsCursor = false
        let stream = SCStream(filter: SCContentFilter(display: display, excludingWindows: []), configuration: config, delegate: self)
        do {
            try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
            // Without a screen output the stream logs an error for every frame it drops.
            try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
            try await stream.startCapture()
        } catch {
            return log("speakers: off, \(error.localizedDescription)")
        }
        let keep = queue.sync { () -> Bool in
            if !stopped { (self.stream, openedAt) = (stream, ProcessInfo.processInfo.systemUptime) }
            return !stopped
        }
        guard keep else { return stopAll([stream]) }
        log("speaker-0: capturing the Mac's sound, 48000 Hz 2 ch")
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, sample.isValid, sample.numSamples > 0 else { return }
        if restarts > 0, ProcessInfo.processInfo.systemUptime - openedAt >= 60 { restarts = 0 }
        track.append(sample, hostTime: sample.presentationTimeStamp)
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        queue.async {
            guard !self.stopped, self.stream === stream else { return }
            self.stream = nil
            self.restarts += 1
            guard self.restarts <= 5 else { return log("speaker-0: stopped (\(error.localizedDescription)); 5 restarts in a row, staying off") }
            log("speaker-0: stopped (\(error.localizedDescription)); opening again in 1 s (restart \(self.restarts) of 5)")
            self.queue.asyncAfter(deadline: .now() + 1) {
                guard !self.stopped else { return }
                Task { await self.open() }
            }
        }
    }

    func resumed() {
        guard CGPreflightScreenCaptureAccess(), queue.sync(execute: { stream == nil && !stopped }) else { return }
        Task { await open() }
    }

    func stop() {
        let old = queue.sync { () -> SCStream? in
            stopped = true
            defer { stream = nil }
            return stream
        }
        stopAll(old.map { [$0] } ?? [])
    }
}
