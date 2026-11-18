import CoreImage
import Foundation
import Network

/// The app's local endpoint: a Unix socket in the person's own folder.
///
/// A small file lent to a mind with `iterate provide` (`bridge/mac-endpoint.ts`) asks it one
/// question for each connection, as one line of JSON, and gets one line of JSON back. What it
/// may ask is in `AppModel.answer`: the person can forbid each power in the menu.
@MainActor
final class LocalEndpoint {
    static let socketURL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/voice-meet-mac/endpoint.sock")

    /// Answers one request. An `EndpointRefusal` carries the words the caller reads.
    var onRequest: (_ method: String, _ parameters: [String: Any]) async throws -> [String: Any] = { _, _ in [:] }

    private let log = AppLog("endpoint")
    private var listener: NWListener?

    func start() {
        let url = Self.socketURL
        do {
            // Only the person's own processes can reach the socket: the folder is theirs alone.
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(),
                withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700]
            )
            try? FileManager.default.removeItem(at: url)
            let parameters = NWParameters.tcp
            parameters.requiredLocalEndpoint = NWEndpoint.unix(path: url.path)
            let listener = try NWListener(using: parameters)
            listener.newConnectionHandler = { [weak self] connection in
                MainActor.assumeIsolated { self?.serve(connection, received: Data()) }
            }
            listener.stateUpdateHandler = { [log] state in
                if case .failed(let error) = state { log.error("the listener failed: \(error)") }
            }
            listener.start(queue: .main)
            self.listener = listener
            log.info("listening on \(url.path)")
        } catch {
            log.error("no local endpoint: \(AppLog.describe(error))")
        }
    }

    func stop() {
        listener?.cancel()
        listener = nil
        try? FileManager.default.removeItem(at: Self.socketURL)
    }

    /// Reads up to the first line end, answers, and closes: one request for each connection.
    private func serve(_ connection: NWConnection, received: Data) {
        if received.isEmpty { connection.start(queue: .main) }
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [weak self] data, _, isComplete, error in
            MainActor.assumeIsolated {
                guard let self, error == nil else { return connection.cancel() }
                let received = received + (data ?? Data())
                if let lineEnd = received.firstIndex(of: 0x0A) {
                    let line = Data(received[received.startIndex..<lineEnd])
                    Task { @MainActor in
                        let answer = await self.answer(line)
                        connection.send(content: answer, completion: .contentProcessed { _ in connection.cancel() })
                    }
                } else if isComplete || received.count > 16 * 1024 * 1024 {
                    connection.cancel()
                } else {
                    self.serve(connection, received: received)
                }
            }
        }
    }

    private func answer(_ line: Data) async -> Data {
        var reply: [String: Any]
        do {
            guard let request = try JSONSerialization.jsonObject(with: line) as? [String: Any],
                let method = request["method"] as? String
            else { throw EndpointRefusal("a request is one line of JSON with a \"method\"") }
            reply = ["ok": try await onRequest(method, request)]
        } catch {
            let words = (error as? EndpointRefusal)?.words ?? AppLog.describe(error)
            log.info("refused: \(words)")
            reply = ["error": words]
        }
        let data = (try? JSONSerialization.data(withJSONObject: reply)) ?? Data(#"{"error":"the answer is no JSON"}"#.utf8)
        return data + Data([0x0A])
    }
}

/// Why the endpoint did not do what was asked, in words for the caller (a mind's agent).
struct EndpointRefusal: Error {
    let words: String

    init(_ words: String) {
        self.words = words
    }
}

/// One still picture of a display or of the camera, as JPEG bytes. Nothing is written to disk.
enum Snapshot {
    private static let context = CIContext()

    static func jpeg(of picture: CIImage, maxWidth: Int) -> (data: Data, width: Int, height: Int)? {
        var image = picture
        let scale = min(1, CGFloat(max(maxWidth, 1)) / image.extent.width)
        if scale < 1 {
            image = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        }
        guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
            let data = context.jpegRepresentation(
                of: image,
                colorSpace: colorSpace,
                options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.7]
            )
        else { return nil }
        return (data, Int(image.extent.width), Int(image.extent.height))
    }
}
