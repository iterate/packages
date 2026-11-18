// AVCaptureSession is safe to use from its own queue; AVFoundation does not say so to the compiler yet.
@preconcurrency import AVFoundation
import CoreImage
import VoiceMeetCore

/// The owner of one camera: one `AVCaptureSession`. A caller of the local endpoint can take one
/// still picture of it, and the menu shows it live while it is open. No frame is kept but the
/// newest one, in memory. Each camera has its own owner, so several can run at once.
@MainActor
final class Camera {
    var onEvent: (CameraEvent) -> Void = { _ in }
    /// The menu's camera preview draws this layer.
    let previewLayer = AVCaptureVideoPreviewLayer()

    /// This Mac's cameras.
    static var devices: [AVCaptureDevice] {
        AVCaptureDevice.DiscoverySession(
            deviceTypes: [.builtInWideAngleCamera, .external, .continuityCamera],
            mediaType: .video,
            position: .unspecified
        ).devices
    }

    /// The camera a caller means: by its name or its identifier, or the first one that is not off.
    static func resolve(_ wanted: String?) throws -> AVCaptureDevice {
        guard let wanted else {
            guard let first = devices.first(where: { Shareable.camera($0).sharing != .off }) else {
                throw EndpointRefusal("Every camera is off in the iterate panel on the Mac.")
            }
            return first
        }
        guard let device = devices.first(where: { $0.uniqueID == wanted || $0.localizedName == wanted }) else {
            throw EndpointRefusal("This Mac has no camera \"\(wanted)\". It has: \(devices.map(\.localizedName).joined(separator: ", ")).")
        }
        return device
    }

    private let deviceID: String

    init(deviceID: String) {
        self.deviceID = deviceID
    }

    private let log = AppLog("camera")
    private let sessionQueue = DispatchQueue(label: "com.iterate.voice-meet-mac.camera")
    private let frames = NewestFrame()
    private var session: AVCaptureSession?
    private var errorObserver: NSObjectProtocol?

    /// Call only when macOS has given the camera. Reports `sessionStarted` or `sessionFailed`.
    func start() {
        stop()
        guard let device = Self.devices.first(where: { $0.uniqueID == deviceID }) else {
            return fail("this camera is not connected")
        }
        let session = AVCaptureSession()
        let output = AVCaptureVideoDataOutput()
        output.alwaysDiscardsLateVideoFrames = true
        output.setSampleBufferDelegate(frames, queue: sessionQueue)
        do {
            let input = try AVCaptureDeviceInput(device: device)
            guard session.canAddInput(input), session.canAddOutput(output) else {
                return fail("the camera \(device.localizedName) cannot join a capture session")
            }
            session.addInput(input)
            session.addOutput(output)
        } catch {
            log.error("the camera did not open: \(AppLog.describe(error))")
            return fail(error.localizedDescription)
        }
        self.session = session
        previewLayer.session = session
        previewLayer.videoGravity = .resizeAspect
        errorObserver = NotificationCenter.default.addObserver(
            forName: AVCaptureSession.runtimeErrorNotification,
            object: session,
            queue: .main
        ) { [weak self] notification in
            let error = notification.userInfo?[AVCaptureSessionErrorKey] as? NSError
            let words = error?.localizedDescription ?? "the camera stopped"
            let detail = error.map(AppLog.describe) ?? words
            Task { @MainActor in
                self?.log.error("the session reported: \(detail)")
                self?.onEvent(.sessionFailed(words))
            }
        }

        let name = device.localizedName
        log.info("starting the camera \"\(name)\"")
        // `startRunning` blocks until the camera runs, so it is not called on the main thread.
        sessionQueue.async { [weak self] in
            session.startRunning()
            let isRunning = session.isRunning
            Task { @MainActor in
                guard let self, session === self.session else { return }
                self.onEvent(isRunning ? .sessionStarted(name) : .sessionFailed("the camera did not start"))
            }
        }
    }

    func stop() {
        if let errorObserver {
            NotificationCenter.default.removeObserver(errorObserver)
        }
        errorObserver = nil
        guard let session else { return }
        self.session = nil
        previewLayer.session = nil
        frames.clear()
        sessionQueue.async { session.stopRunning() }
        log.info("camera stopped; the camera is released")
    }

    /// The newest picture of the camera as JPEG bytes; nil before the first frame.
    func snapshot(maxWidth: Int) -> (data: Data, width: Int, height: Int)? {
        guard session != nil, let buffer = frames.newest() else { return nil }
        return Snapshot.jpeg(of: CIImage(cvPixelBuffer: buffer), maxWidth: maxWidth)
    }

    private func fail(_ words: String) {
        log.error(words)
        onEvent(.sessionFailed(words))
    }
}

/// Holds the newest frame of the camera. The capture queue writes it; the main thread reads it.
private final class NewestFrame: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, @unchecked Sendable {
    private let log = AppLog("camera")
    private let lock = NSLock()
    private var buffer: CVPixelBuffer?

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let pixelBuffer = sampleBuffer.imageBuffer else { return }
        lock.lock()
        let isFirst = buffer == nil
        buffer = pixelBuffer
        lock.unlock()
        if isFirst {
            log.info("first picture: \(CVPixelBufferGetWidth(pixelBuffer)) × \(CVPixelBufferGetHeight(pixelBuffer)) px")
        }
    }

    func newest() -> CVPixelBuffer? {
        lock.lock()
        defer { lock.unlock() }
        return buffer
    }

    func clear() {
        lock.lock()
        buffer = nil
        lock.unlock()
    }
}
