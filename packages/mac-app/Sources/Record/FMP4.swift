import Foundation

/// A small fragmented-MP4 writer: one track, `ftyp` + `moov` as the header, then `moof` + `mdat`
/// per fragment (ISO/IEC 14496-12). Box for box it matches what `AVAssetWriter` writes for the
/// same samples, except for valid differences (REPORT-recorder-hardening of the prototype).
public enum FMP4 {
    public struct Sample: Equatable {
        public let size: Int
        public let duration: UInt32
        public let sync: Bool
        public init(size: Int, duration: UInt32, sync: Bool) {
            self.size = size
            self.duration = duration
            self.sync = sync
        }
    }

    static func box(_ type: String, _ parts: Data...) -> Data {
        var body = Data()
        for p in parts { body.append(p) }
        var d = be(UInt32(8 + body.count))
        d.append(type.data(using: .ascii)!)
        d.append(body)
        return d
    }

    static func full(_ type: String, version: UInt8 = 0, flags: UInt32 = 0, _ parts: Data...) -> Data {
        var d = be(UInt32(version) << 24 | flags)
        for p in parts { d.append(p) }
        return box(type, d)
    }

    static func be<T: FixedWidthInteger>(_ v: T) -> Data { withUnsafeBytes(of: v.bigEndian) { Data($0) } }
    static func zeros(_ n: Int) -> Data { Data(count: n) }
    static let matrix: Data = [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x4000_0000].reduce(into: Data()) { $0.append(be(UInt32($1))) }

    /// `hvc1` + `hvcC` or `avc1` + `avcC`; `config` is the body of the configuration box.
    public static func videoEntry(type: String, configType: String, config: Data, width: Int, height: Int) -> Data {
        var d = zeros(6) + be(UInt16(1)) + zeros(16)
        d += be(UInt16(width)) + be(UInt16(height)) + be(UInt32(0x48_0000)) + be(UInt32(0x48_0000))
        d += zeros(4) + be(UInt16(1)) + zeros(32) + be(UInt16(0x18)) + be(Int16(-1))
        return box(type, d, box(configType, config))
    }

    /// `mp4a` + `esds` for AAC-LC.
    public static func aacEntry(rate: Int, channels: Int, bitrate: Int) -> Data {
        let index = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000].firstIndex(of: rate) ?? 3
        // AudioSpecificConfig: object type 2 (5 bits), frequency index (4), channels (4), 3 zero bits.
        let asc = Data([UInt8(2 << 3 | index >> 1), UInt8((index & 1) << 7 | channels << 3)])
        func descriptor(_ tag: UInt8, _ body: Data) -> Data { Data([tag, UInt8(body.count)]) + body }
        let decoderConfig = descriptor(
            0x04, Data([0x40, 0x15, 0, 0, 0]) + be(UInt32(bitrate)) + be(UInt32(bitrate)) + descriptor(0x05, asc))
        let es = descriptor(0x03, be(UInt16(1)) + Data([0]) + decoderConfig + descriptor(0x06, Data([0x02])))
        let d = zeros(6) + be(UInt16(1)) + zeros(8) + be(UInt16(channels)) + be(UInt16(16)) + zeros(4) + be(UInt32(rate << 16))
        return box("mp4a", d, full("esds", es))
    }

    /// `ftyp` + `moov` for one track (id 1) with the given sample entry.
    public static func header(video: Bool, timescale: UInt32, width: Int = 0, height: Int = 0, entry: Data) -> Data {
        let ftyp = box("ftyp", "iso6".data(using: .ascii)! + be(UInt32(0)) + "iso6isommp41".data(using: .ascii)!)
        let mvhd = full("mvhd", zeros(8) + be(UInt32(1000)) + zeros(4) + be(UInt32(0x10000)) + be(UInt16(0x100)) + zeros(10) + matrix + zeros(24) + be(UInt32(2)))
        let tkhd = full(
            "tkhd", flags: 3,
            zeros(8) + be(UInt32(1)) + zeros(4) + zeros(4) + zeros(8) + zeros(4) + be(UInt16(video ? 0 : 0x100)) + zeros(2) + matrix
                + be(UInt32(width << 16)) + be(UInt32(height << 16)))
        let mdhd = full("mdhd", zeros(8) + be(timescale) + zeros(4) + be(UInt16(0x55c4)) + zeros(2))
        let hdlr = full("hdlr", zeros(4) + (video ? "vide" : "soun").data(using: .ascii)! + zeros(12) + zeros(1))
        let media = video ? full("vmhd", flags: 1, zeros(8)) : full("smhd", zeros(4))
        let dinf = box("dinf", full("dref", be(UInt32(1)), full("url ", flags: 1)))
        let stbl = box(
            "stbl", full("stsd", be(UInt32(1)), entry), full("stts", zeros(4)), full("stsc", zeros(4)), full("stsz", zeros(8)),
            full("stco", zeros(4)))
        let trak = box("trak", tkhd, box("mdia", mdhd, hdlr, box("minf", media, dinf, stbl)))
        let mvex = box("mvex", full("trex", be(UInt32(1)) + be(UInt32(1)) + zeros(12)))
        return ftyp + box("moov", mvhd, trak, mvex)
    }

    /// The `moof` and the `mdat` header of one fragment; the samples' bytes follow it, so a caller
    /// appends them once, where they already are. `decodeTime` is the first sample's time.
    public static func fragmentHeader(sequence: UInt32, decodeTime: UInt64, samples: [Sample]) -> Data {
        var entries = Data(capacity: samples.count * 12)
        var bodySize = 0
        for s in samples {
            // sync: depends on nothing; else: depends on others and is not a sync sample.
            entries += be(s.duration) + be(UInt32(s.size)) + be(UInt32(s.sync ? 0x0200_0000 : 0x0101_0000))
            bodySize += s.size
        }
        func moof(offset: UInt32) -> Data {
            let trun = full("trun", flags: 0x701, be(UInt32(samples.count)) + be(offset) + entries)
            // tfhd flag 0x020000: data offsets count from the start of this moof.
            return box("moof", full("mfhd", be(sequence)), box("traf", full("tfhd", flags: 0x2_0000, be(UInt32(1))), full("tfdt", version: 1, be(decodeTime)), trun))
        }
        // The moof's size does not depend on the offset written in it.
        let size = moof(offset: 0).count
        return moof(offset: UInt32(size + 8)) + be(UInt32(8 + bodySize)) + "mdat".data(using: .ascii)!
    }
}

/// The open file of one track for one slot, kept as its parts (header, then per fragment its `moof`
/// and its samples) until the slot ends. Times are ticks from the slot's start. A new fragment
/// starts at a sync sample the caller asks for, and at a gap (a pause inside the slot).
public final class SlotFile {
    public let slot: Int64
    public private(set) var parts: [Data]
    public private(set) var size: Int
    private var samples: [FMP4.Sample] = []
    private var bodies: [Data] = []
    private var start: Int64 = 0
    public private(set) var end: Int64 = -1
    private var sequence: UInt32 = 0
    public var frames = 0
    /// Where each fragment starts in the file, and its first sample's time.
    public private(set) var fragments: [(offset: Int, ticks: Int64)] = []

    public init(slot: Int64, header: Data) {
        self.slot = slot
        parts = [header]
        size = header.count
    }

    public func append(_ bytes: Data, at t: Int64, duration: Int64, sync: Bool, newFragment: Bool) {
        if !samples.isEmpty, newFragment || t != end { flush() }
        if samples.isEmpty { start = t }
        samples.append(FMP4.Sample(size: bytes.count, duration: UInt32(max(1, duration)), sync: sync))
        bodies.append(bytes)
        end = t + max(1, duration)
    }

    private func flush() {
        guard !samples.isEmpty else { return }
        sequence += 1
        let header = FMP4.fragmentHeader(sequence: sequence, decodeTime: UInt64(start), samples: samples)
        fragments.append((size, start))
        parts.append(header)
        parts += bodies
        size += header.count + samples.reduce(0) { $0 + $1.size }
        samples = []
        bodies = []
    }

    public func close() -> [Data] {
        flush()
        return parts
    }
}
