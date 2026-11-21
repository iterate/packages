import Foundation

/// Slots of 30 s on the UTC clock, and the names of the files in them (README, "The files").
public enum Slot {
    public static let ms: Int64 = 30_000

    /// The start of the slot that holds `wallMs` (Unix ms).
    public static func start(_ wallMs: Double) -> Int64 { Int64((wallMs / Double(ms)).rounded(.down)) * ms }

    /// UTC calendar fields of a Unix ms time, without a calendar object (Howard Hinnant's days → civil).
    static func fields(_ t: Int64) -> (y: Int64, mo: Int64, d: Int64, h: Int64, mi: Int64, s: Int64) {
        let seconds = t / 1000
        let days = seconds / 86_400, rest = seconds % 86_400
        let z = days + 719_468
        let era = z / 146_097
        let doe = z - era * 146_097
        let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        let mp = (5 * doy + 2) / 153
        let d = doy - (153 * mp + 2) / 5 + 1
        let mo = mp < 10 ? mp + 3 : mp - 9
        return (yoe + era * 400 + (mo <= 2 ? 1 : 0), mo, d, rest / 3600, rest % 3600 / 60, rest % 60)
    }

    private static func two(_ n: Int64) -> String { n < 10 ? "0\(n)" : "\(n)" }

    /// `/devices/<device>/record/<track>/<YYYY-MM-DD>/<HH>/<MM>-<SS>.<ext>`: the file's path in the
    /// mind's files. Its path in the spool is the same without the first slash.
    public static func path(device: String, track: String, slot: Int64, ext: String) -> String {
        let f = fields(slot)
        return "/devices/\(device)/record/\(track)/\(f.y)-\(two(f.mo))-\(two(f.d))/\(two(f.h))/\(two(f.mi))-\(two(f.s)).\(ext)"
    }

    /// The payload of `record/slot-stored`: `{ t, tracks: { <track>: { kind, file, bytes, … } } }`,
    /// with sorted keys, so that the same slot always gives the same bytes.
    public static func event(t: Int64, tracks: [String: [String: Any]]) -> Data {
        (try? JSONSerialization.data(withJSONObject: ["t": t, "tracks": tracks], options: [.sortedKeys, .withoutEscapingSlashes])) ?? Data()
    }
}

/// Apps whose windows, titles and text are never recorded (password managers).
public struct ExcludeList: Sendable {
    public static let defaults: Set<String> = [
        "com.1password.1password", "com.agilebits.onepassword7", "com.apple.keychainaccess", "com.apple.Passwords",
    ]
    public let bundles: Set<String>

    public init(_ given: [String] = []) {
        bundles = Set((given.isEmpty ? Array(ExcludeList.defaults) : given).map { $0.lowercased() })
    }

    public func excludes(_ bundle: String?) -> Bool { bundle.map { bundles.contains($0.lowercased()) } ?? false }
}

/// The level of the sound of one slot: `rms` and `peak` over the slot in dBFS, and `levels`, the
/// peak of each half second of the slot (−99 for silence).
public struct Level {
    public static let halves = 60
    public private(set) var sum = 0.0, count = 0
    private var peak: Float = 0
    private var peaks = [Float](repeating: 0, count: halves)

    public init() {}

    /// `sum` of the squares and the `peak` of `count` samples that fall in half second `half`.
    public mutating func add(sum: Double, count: Int, peak: Float, half: Int) {
        self.sum += sum
        self.count += count
        self.peak = max(self.peak, peak)
        peaks[half] = max(peaks[half], peak)
    }

    public var rms: Double { round1(max(-120, 10 * log10(sum / Double(max(1, count))))) }
    public var peakDB: Double { round1(max(-120, 20 * log10(Double(peak)))) }
    public var levels: [Int] { peaks.map { $0 > 0 ? max(-99, min(0, Int((20 * log10(Double($0))).rounded()))) : -99 } }
}

/// How an audio track follows the host clock without a new encoder. Past 1 ms of drift, each
/// buffer gets samples repeated or dropped, at most 1 in 100 and spread evenly: one here and there
/// is not heard, a jump is. A step of 50 ms is followed within 5 s.
public enum Resync {
    /// 1 ms at 48 kHz.
    public static let tolerance: Int64 = 48

    /// Samples to add (+) or drop (−) in a buffer of `count`, for a `drift` (host time minus the
    /// sample count, in samples).
    public static func change(drift: Int64, count: Int) -> Int {
        guard abs(drift) > tolerance else { return 0 }
        let most = Int64(max(1, count / 100))
        return Int(max(-most, min(most, drift)))
    }

    /// The input sample for each output sample of a buffer that is `change` samples longer.
    public static func indices(count: Int, change: Int) -> [Int] {
        let out = max(0, count + change)
        return (0..<out).map { $0 * count / max(1, out) }
    }
}

/// Rounds to one decimal.
public func round1(_ value: Double) -> Double { (value * 10).rounded() / 10 }
