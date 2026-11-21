import AppKit
import SwiftUI

/// WHAT A MIND SAYS OF ITSELF: its name and its icon, for every view of the app that shows a mind.
/// The mind's website answers them to anyone at `/.well-known/iterate-profile`
/// (`{ name, description, icon }`, core/configs/default/profile.ts), so the read needs no key and
/// carries no credential.
///
/// THE PROFILE IS THE OWNER'S OWN WORDS, UNSIGNED: it proves nothing about who the mind is. So the
/// address is always shown beside the name, the name is one line of bounded length, and the icon
/// is an `https:` address on the mind's own website or a host under it, drawn as a picture only.
///
/// Each face is kept on disk (`faces/` in the app's folder): the panel draws at once and with no
/// network. A view that shows a face asks for a new read, at most once in five minutes for each
/// mind; a failed read keeps what is kept.
@MainActor
final class MindFaces: ObservableObject {
    static let shared = MindFaces()

    /// One mind's face.
    struct Face: Equatable {
        /// The mind's address: its website's hostname, as config.json names it (`example.com`).
        let address: String
        /// What the mind calls itself, or nil while it gave no name other than its address.
        var name: String?
        /// The mind's icon, drawn square, or nil for a mind with no icon (or none read yet).
        var icon: NSImage?

        /// The name to show: the mind's own, else its address.
        var title: String { name ?? address }
    }

    nonisolated static let folder = Lend.folder.appendingPathComponent("faces")
    /// How often a mind's profile is read again while its face is shown.
    private static let freshFor: TimeInterval = 300
    /// A profile's answer is small: a larger one is not read as a profile.
    private static let answerMaxLength = 16 * 1024
    /// The profile's own bound for an icon (core/configs/default/profile.ts).
    private static let iconMaxLength = 256 * 1024
    /// The icon is kept as a PNG of this many pixels a side: enough for 64 points at 2×.
    private nonisolated static let iconPixels = 128

    private var faces: [String: Face] = [:]
    private var askedAt: [String: Date] = [:]
    private let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieAcceptPolicy = .never
        configuration.httpShouldSetCookies = false
        configuration.timeoutIntervalForRequest = 5
        configuration.timeoutIntervalForResource = 10
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: configuration)
    }()

    /// The face of the mind at `address`, as it is kept: the name and icon last read, or the
    /// address alone. It reads no network; `refresh` does.
    func face(of address: String) -> Face {
        if let face = faces[address] { return face }
        let face = Self.stored(address) ?? Face(address: address)
        faces[address] = face
        return face
    }

    /// Reads the mind's profile again unless it was read in the last five minutes. The views that
    /// show the face draw again when the read changed it.
    func refresh(_ address: String) {
        guard Self.isHostname(address) else { return }
        if let at = askedAt[address], Date().timeIntervalSince(at) < Self.freshFor { return }
        askedAt[address] = Date()
        Task { await read(address) }
    }

    /// Reads the profile and the icon now, and keeps them. The answer is the face as it is after.
    @discardableResult
    func read(_ address: String) async -> Face {
        guard Self.isHostname(address), let url = URL(string: "https://\(address)/.well-known/iterate-profile") else {
            return face(of: address)
        }
        guard let answer = await fetch(url, max: Self.answerMaxLength),
            let json = try? JSONSerialization.jsonObject(with: answer) as? [String: Any]
        else { return face(of: address) }
        var face = Face(address: address, name: Self.name(json["name"], address: address))
        if let icon = Self.iconURL(json["icon"], address: address) {
            // an icon that does not load keeps the one kept
            face.icon = await fetch(icon, max: Self.iconMaxLength).flatMap(Self.square) ?? self.face(of: address).icon
        }
        if face != faces[address] {
            objectWillChange.send()
            faces[address] = face
            Self.store(face)
        }
        return face
    }

    private func fetch(_ url: URL, max: Int) async -> Data? {
        var request = URLRequest(url: url)
        request.httpShouldHandleCookies = false
        guard let (data, response) = try? await session.data(for: request),
            let http = response as? HTTPURLResponse, http.statusCode == 200,
            // a redirect to another host is not the mind's answer
            http.url?.host == url.host,
            data.count <= max
        else { return nil }
        return data
    }

    // MARK: - What the answer may say

    /// A hostname of letters, digits, hyphens and dots: the only kind of address read or kept.
    nonisolated static func isHostname(_ address: String) -> Bool {
        address.count <= 253 && address.contains(".")
            && address.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == ".") }
    }

    /// The name, one line of at most 80 characters, with no control character and no character
    /// that turns the direction of the text. nil when it is empty or only the address.
    nonisolated static func name(_ value: Any?, address: String) -> String? {
        guard let value = value as? String else { return nil }
        let unsafe = CharacterSet.controlCharacters.union(CharacterSet(charactersIn: "\u{200E}\u{200F}\u{202A}\u{202B}\u{202C}\u{202D}\u{202E}\u{2066}\u{2067}\u{2068}\u{2069}"))
        let words = value.unicodeScalars.map { unsafe.contains($0) ? " " : String($0) }.joined()
            .split(whereSeparator: \.isWhitespace).joined(separator: " ")
        let name = String(words.prefix(80)).trimmingCharacters(in: .whitespaces)
        return name.isEmpty || [address, "iterate.\(address)"].contains(name.lowercased()) ? nil : name
    }

    /// The icon's address, when it is an `https:` address on the mind's website or a host under it.
    nonisolated static func iconURL(_ value: Any?, address: String) -> URL? {
        guard let value = value as? String, value.count <= 2048, let url = URL(string: value),
            url.scheme == "https", url.user == nil, url.password == nil, url.port == nil,
            let host = url.host?.lowercased(), host == address || host.hasSuffix(".\(address)")
        else { return nil }
        return url
    }

    /// The picture drawn on a square of `iconPixels`, as PNG bytes: an SVG, a PNG or a JPEG alike.
    nonisolated static func square(_ data: Data) -> NSImage? {
        guard let image = NSImage(data: data), image.size.width > 0, image.size.height > 0,
            let picture = NSBitmapImageRep(
                bitmapDataPlanes: nil, pixelsWide: iconPixels, pixelsHigh: iconPixels, bitsPerSample: 8, samplesPerPixel: 4,
                hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)
        else { return nil }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: picture)
        // fills the square, as `object-fit: cover` does
        let scale = CGFloat(iconPixels) / min(image.size.width, image.size.height)
        let size = NSSize(width: image.size.width * scale, height: image.size.height * scale)
        image.draw(in: NSRect(x: (CGFloat(iconPixels) - size.width) / 2, y: (CGFloat(iconPixels) - size.height) / 2, width: size.width, height: size.height))
        NSGraphicsContext.restoreGraphicsState()
        let square = NSImage(size: NSSize(width: iconPixels, height: iconPixels))
        square.addRepresentation(picture)
        return square
    }

    // MARK: - On disk: faces/<address>.json and faces/<address>.png

    private struct Stored: Codable {
        let name: String?
    }

    private static func stored(_ address: String) -> Face? {
        guard isHostname(address),
            let data = try? Data(contentsOf: folder.appendingPathComponent("\(address).json")),
            let stored = try? JSONDecoder().decode(Stored.self, from: data)
        else { return nil }
        let icon = NSImage(contentsOf: folder.appendingPathComponent("\(address).png"))
        return Face(address: address, name: stored.name, icon: icon)
    }

    private static func store(_ face: Face) {
        guard isHostname(face.address) else { return }
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let png = folder.appendingPathComponent("\(face.address).png")
        if let picture = face.icon?.representations.first as? NSBitmapImageRep, let bytes = picture.representation(using: .png, properties: [:]) {
            try? bytes.write(to: png, options: .atomic)
        } else {
            try? FileManager.default.removeItem(at: png)
        }
        if let json = try? JSONEncoder().encode(Stored(name: face.name)) {
            try? json.write(to: folder.appendingPathComponent("\(face.address).json"), options: .atomic)
        }
    }
}

/// A mind's icon in a circle. A mind with no icon is the first letter of its name on a colour
/// that its address gives, the same in every view. It reads the profile again, at most once in
/// five minutes (`MindFaces.refresh`). A `badge` is a dot at its bottom right, such as the lend's.
///
///     MindAvatar(mind: "example.com", size: 22)
struct MindAvatar: View {
    /// The mind's address, as config.json names it (`example.com`).
    let mind: String
    var size: CGFloat = 24
    var badge: Color?
    @ObservedObject private var faces = MindFaces.shared

    init(mind: String, size: CGFloat = 24, badge: Color? = nil) {
        self.mind = mind
        self.size = size
        self.badge = badge
    }

    var body: some View {
        let face = faces.face(of: mind)
        ZStack {
            if let icon = face.icon {
                Image(nsImage: icon).resizable().interpolation(.high).aspectRatio(contentMode: .fill)
            } else {
                Self.colour(of: mind)
                Text(Self.initial(of: face.title))
                    .font(.system(size: size * 0.46, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(Color.primary.opacity(0.12), lineWidth: 0.5))
        .overlay(alignment: .bottomTrailing) {
            if let badge {
                let width = max(8, size * 0.3)
                Circle()
                    .fill(badge)
                    .frame(width: width, height: width)
                    .overlay(Circle().strokeBorder(Color(nsColor: .windowBackgroundColor), lineWidth: max(1.5, width * 0.2)))
                    .offset(x: width * 0.15, y: width * 0.15)
            }
        }
        .accessibilityLabel(face.title)
        .task(id: mind) { faces.refresh(mind) }
    }

    /// The first letter or digit of the name, in capitals.
    static func initial(of name: String) -> String {
        name.first { $0.isLetter || $0.isNumber }.map { String($0).uppercased() } ?? "?"
    }

    /// A colour of middle tone that the address alone gives: the same on every Mac.
    static func colour(of address: String) -> Color {
        // FNV-1a: Swift's own hash changes from run to run
        let hash = address.utf8.reduce(UInt32(2_166_136_261)) { ($0 ^ UInt32($1)) &* 16_777_619 }
        return Color(hue: Double(hash % 360) / 360, saturation: 0.55, brightness: 0.72)
    }
}

/// A mind as a row: its avatar, its name, and under the name its address and an optional note
/// (this Mac's name there). `MindAvatar` is the circle alone.
struct MindLabel: View {
    let mind: String
    var size: CGFloat = 24
    /// Words after the address, such as `itx.jane.mac`.
    var note: String?
    /// A dot on the avatar (`MindAvatar.badge`).
    var badge: Color?
    @ObservedObject private var faces = MindFaces.shared

    var body: some View {
        let face = faces.face(of: mind)
        HStack(spacing: size > 26 ? 10 : 8) {
            MindAvatar(mind: mind, size: size, badge: badge)
            VStack(alignment: .leading, spacing: 1) {
                Text(face.title)
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(1)
                Text([mind, note].compactMap { $0 }.joined(separator: " · "))
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
    }
}
