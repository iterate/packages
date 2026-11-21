import XCTest

@testable import Record

final class ClockTests: XCTestCase {
    func testTicksToNanosAndTheAnchor() {
        let silicon = MachTimebase(numer: 125, denom: 3)
        XCTAssertEqual(silicon.nanos(ticks: 24_000_000), 1_000_000_000)
        // No overflow after a long uptime (one year of 24 MHz ticks).
        let year: UInt64 = 24_000_000 * 86_400 * 365
        XCTAssertEqual(silicon.nanos(ticks: year), 86_400 * 365 * 1_000_000_000)
        let anchor = ClockAnchor(hostNanos: 5_000_000_000, wallMs: 1_700_000_000_000)
        XCTAssertEqual(anchor.wallMs(hostNanos: 5_250_000_000), 1_700_000_000_250)
        XCTAssertEqual(anchor.wallMs(hostNanos: 4_000_000_000), 1_699_999_999_000)  // before the anchor
    }
}

final class SlotTests: XCTestCase {
    func testSlotStartAndPaths() {
        // 2026-11-21T15:41:44.123Z
        let slot = Slot.start(1_795_275_704_123)
        XCTAssertEqual(slot, 1_795_275_690_000)
        XCTAssertEqual(Slot.path(device: "jonas.mac", track: "screen-1", slot: slot, ext: "mp4"), "/devices/jonas.mac/record/screen-1/2026-11-21/15/41-30.mp4")
        XCTAssertEqual(Slot.path(device: "jonas.mac", track: "camera-0", slot: slot - 30_000, ext: "jpg"), "/devices/jonas.mac/record/camera-0/2026-11-21/15/41-00.jpg")
        // The very edge of a slot, a day, a leap day and a year.
        XCTAssertEqual(Slot.start(Double(slot) + 29_999.9), slot)
        let at = { Slot.path(device: "d", track: "t", slot: $0, ext: "mp4").dropFirst("/devices/d/record/t/".count).dropLast(4) }
        XCTAssertEqual(at(0), "1970-01-01/00/00-00")
        XCTAssertEqual(at(951_782_370_000), "2000-02-28/23/59-30")
        XCTAssertEqual(at(951_782_400_000), "2000-02-29/00/00-00")
        XCTAssertEqual(at(1_798_761_570_000), "2026-12-31/23/59-30")
        XCTAssertEqual(at(1_798_761_600_000), "2027-01-01/00/00-00")
    }

    func testTheSlotEventIsTheSameBytesEveryTime() throws {
        let tracks: [String: [String: Any]] = [
            "mic-0": ["kind": "audio", "file": "/devices/d/record/mic-0/2026-11-21/15/41-30.mp4", "bytes": 3, "levels": [-99, -10]],
            "screen-1": ["kind": "video", "file": "/devices/d/record/screen-1/2026-11-21/15/41-30.mp4", "parts": [[712, 0], [9000, 10011]], "x": 0],
        ]
        let a = Slot.event(t: 1_795_275_690_000, tracks: tracks), b = Slot.event(t: 1_795_275_690_000, tracks: tracks)
        XCTAssertEqual(a, b)
        let text = String(decoding: a, as: UTF8.self)
        // allow-high-entropy-next-line: a Unix time in milliseconds, not a secret
        XCTAssertTrue(text.hasPrefix(#"{"t":1795275690000,"tracks":{"mic-0":{"bytes":3,"file":"/devices/d/"#), text)
        let read = try XCTUnwrap(JSONSerialization.jsonObject(with: a) as? [String: Any])
        XCTAssertEqual((read["tracks"] as? [String: Any])?.keys.sorted(), ["mic-0", "screen-1"])
    }

    func testExcludeList() {
        let defaults = ExcludeList()
        XCTAssertTrue(defaults.excludes("com.1password.1password"))
        XCTAssertTrue(defaults.excludes("com.apple.Passwords"))
        XCTAssertFalse(defaults.excludes("com.apple.Safari"))
        XCTAssertFalse(defaults.excludes(nil))
        XCTAssertTrue(ExcludeList(["com.example.Bank"]).excludes("com.example.bank"))
    }

    func testHEVCCodecString() {
        // hvcC of an Apple HEVC Main stream, level 3.1 (93): profile 1, compatibility 0x60000000, constraint 0xB0.
        var c: [UInt8] = [1, 0x01, 0x60, 0, 0, 0, 0xB0, 0, 0, 0, 0, 0, 93]
        XCTAssertEqual(hevcCodecString(c), "hvc1.1.6.L93.B0")
        (c[1], c[2], c[12]) = (0x22, 0x20, 153)  // high tier, Main 10
        XCTAssertEqual(hevcCodecString(c), "hvc1.2.4.H153.B0")
    }

    func testLevels() {
        var level = Level()
        level.add(sum: 0.01 * 0.01 * 100, count: 100, peak: 0.1, half: 0)
        level.add(sum: 1, count: 1, peak: 1, half: 59)
        level.add(sum: 0, count: 100, peak: 0, half: 30)
        XCTAssertEqual(level.levels.count, 60)
        XCTAssertEqual(level.levels[0], -20)
        XCTAssertEqual(level.levels[59], 0)
        XCTAssertEqual(level.levels[30], -99, "silence")
        XCTAssertEqual(level.peakDB, 0)
        XCTAssertEqual(level.rms, round1(10 * log10(1.01 / 201)))
    }

    /// The audio follows host time by repeating or dropping single samples, at most 1 in 100.
    func testResync() {
        XCTAssertEqual(Resync.change(drift: 48, count: 1024), 0, "1 ms is inside the tolerance")
        XCTAssertEqual(Resync.change(drift: 49, count: 1024), 10)
        XCTAssertEqual(Resync.change(drift: -2496, count: 1024), -10, "a −52 ms step: 10 samples a buffer")
        let longer = Resync.indices(count: 1000, change: 10)
        XCTAssertEqual(longer.count, 1010)
        XCTAssertEqual(Set(longer), Set(0..<1000), "every sample is kept")
        XCTAssertEqual(Set(Resync.indices(count: 1000, change: -10)).count, 990, "no sample twice")
        let repeats = longer.indices.dropFirst().filter { longer[$0] == longer[$0 - 1] }
        XCTAssertTrue(zip(repeats, repeats.dropFirst()).allSatisfy { $1 - $0 >= 90 }, "spread evenly")
    }
}

final class FMP4Tests: XCTestCase {
    func u32(_ b: [UInt8], _ p: Int) -> Int { Int(b[p]) << 24 | Int(b[p + 1]) << 16 | Int(b[p + 2]) << 8 | Int(b[p + 3]) }

    /// Top-level boxes, or the children of a box, as (type, start, end).
    func boxes(_ b: [UInt8], from: Int = 0, to: Int? = nil) -> [(type: String, start: Int, end: Int)] {
        var out: [(String, Int, Int)] = [], p = from
        let end = to ?? b.count
        while p + 8 <= end {
            let size = u32(b, p)
            guard size >= 8, p + size <= end else { break }
            out.append((String(bytes: b[(p + 4)..<(p + 8)], encoding: .ascii) ?? "", p, p + size))
            p += size
        }
        return out
    }

    /// A file of fragments through `SlotFile`, with the given sample counts; sample `i` has
    /// `i % 7 + 1` bytes, each byte the sample's index, so a byte tells which sample it is. A new
    /// fragment starts at each count's first sample, 5 s after the fragment before.
    func check(_ counts: [Int]) {
        let header = FMP4.header(video: false, timescale: 48_000, entry: FMP4.aacEntry(rate: 48_000, channels: 2, bitrate: 128_000))
        let file = SlotFile(slot: 0, header: header)
        var index = 0, sizes: [[Int]] = []
        for (f, n) in counts.enumerated() {
            var t = Int64(f) * 240_000 + 1234
            sizes.append([])
            for i in 0..<n {
                let size = index % 7 + 1
                file.append(Data(repeating: UInt8(index & 0xff), count: size), at: t, duration: 1024, sync: true, newFragment: i == 0)
                sizes[f].append(size)
                t += 1024
                index += 1
            }
        }
        let data = file.close().reduce(Data(), +)
        let size = file.size
        let b = [UInt8](data)
        XCTAssertEqual(size, data.count)
        let top = boxes(b)
        XCTAssertEqual(top.map(\.type), ["ftyp", "moov"] + counts.flatMap { _ in ["moof", "mdat"] })
        XCTAssertEqual(top.last?.end, data.count, "the boxes cover the file exactly")
        // `parts`: where each fragment starts, and its first sample's time.
        XCTAssertEqual(file.fragments.map(\.offset), counts.indices.map { top[2 + 2 * $0].start })
        XCTAssertEqual(file.fragments.map(\.ticks), counts.indices.map { Int64($0) * 240_000 + 1234 })
        index = 0
        for (f, samples) in sizes.enumerated() {
            let moof = top[2 + 2 * f], mdat = top[3 + 2 * f]
            XCTAssertEqual(mdat.end - mdat.start, 8 + samples.reduce(0, +))
            let inMoof = boxes(b, from: moof.start + 8, to: moof.end)
            XCTAssertEqual(u32(b, inMoof[0].start + 12), f + 1, "mfhd sequence")
            let traf = boxes(b, from: inMoof[1].start + 8, to: inMoof[1].end)
            XCTAssertEqual(traf.map(\.type), ["tfhd", "tfdt", "trun"])
            XCTAssertEqual(u32(b, traf[1].start + 16), f * 240_000 + 1234, "tfdt")
            let trun = traf[2].start
            XCTAssertEqual(u32(b, trun + 12), samples.count)
            let offset = u32(b, trun + 16)
            XCTAssertEqual(moof.start + offset, mdat.start + 8, "the data offset points at the first sample")
            var p = moof.start + offset
            for (i, s) in samples.enumerated() {
                XCTAssertEqual(u32(b, trun + 20 + 12 * i), 1024)
                XCTAssertEqual(u32(b, trun + 24 + 12 * i), s)
                XCTAssertTrue(b[p..<p + s].allSatisfy { $0 == UInt8(index & 0xff) }, "sample \(index) is where the trun says")
                p += s
                index += 1
            }
            XCTAssertEqual(p, mdat.end)
        }
    }

    func testOneFragment() { check([5]) }
    func testThreeFragmentsOfOddCounts() { check([1, 3, 7]) }
    func testAFragmentOfAWholeAudioSlot() { check([1407]) }

    func testAGapStartsANewFragment() {
        let file = SlotFile(slot: 0, header: Data([0, 0, 0, 8, 0x66, 0x72, 0x65, 0x65]))
        file.append(Data([1]), at: 0, duration: 10, sync: true, newFragment: true)
        file.append(Data([2]), at: 10, duration: 10, sync: false, newFragment: false)
        file.append(Data([3]), at: 50, duration: 10, sync: true, newFragment: false)  // a pause from 20 to 50
        _ = file.close()
        XCTAssertEqual(file.fragments.map(\.ticks), [0, 50])
    }

    func testHeaders() {
        let audio = FMP4.header(video: false, timescale: 48_000, entry: FMP4.aacEntry(rate: 48_000, channels: 2, bitrate: 128_000))
        // AudioSpecificConfig for 48 kHz stereo AAC-LC is 0x11 0x90.
        XCTAssertNotNil(audio.range(of: Data([0x05, 0x02, 0x11, 0x90])))
        XCTAssertNotNil(audio.range(of: Data("soun".utf8)))
        let entry = FMP4.videoEntry(type: "hvc1", configType: "hvcC", config: Data([1, 2, 3]), width: 5120, height: 2880)
        let video = FMP4.header(video: true, timescale: 90_000, width: 5120, height: 2880, entry: entry)
        XCTAssertEqual(boxes([UInt8](video)).map(\.type), ["ftyp", "moov"])
        XCTAssertEqual(boxes([UInt8](video)).last?.end, video.count)
    }
}

/// The spool, with no device: a slot is sealed once every track that began it has written it, its
/// event names exactly the files that are there, and a sealed slot takes nothing more, also after
/// a restart.
final class SpoolTests: XCTestCase {
    var spool: URL!

    override func setUp() {
        spool = FileManager.default.temporaryDirectory.appendingPathComponent("record-tests-\(UUID().uuidString)")
    }

    func recorder() -> Recorder { Recorder(options: RecordOptions(spool: spool, device: "test.mac")) }
    func slots() -> [String] { ((try? FileManager.default.contentsOfDirectory(atPath: spool.appendingPathComponent("slots").path)) ?? []).sorted() }
    func entry(_ kind: String) -> [String: Any] { ["kind": kind] }

    func testASlotIsSealedWhenItsLastTrackHasWritten() throws {
        let r = recorder(), t: Int64 = 1_795_275_690_000
        XCTAssertTrue(r.opening(track: "screen-1", slot: t))
        XCTAssertTrue(r.opening(track: "mic-0", slot: t))
        r.finished(track: "mic-0", slot: t, parts: [Data([1, 2]), Data([3])], size: 3, entry: entry("audio"), picture: nil)
        XCTAssertEqual(slots(), ["\(t).open"], "one track of two has written: the slot is open")
        r.finished(track: "screen-1", slot: t, parts: [Data([9])], size: 1, entry: entry("video"), picture: Data([0xff, 0xd8]))
        XCTAssertEqual(slots(), ["\(t).json"])
        let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: spool.appendingPathComponent("slots/\(t).json"))) as? [String: Any])
        XCTAssertEqual(payload["t"] as? Int64, t)
        let tracks = try XCTUnwrap(payload["tracks"] as? [String: [String: Any]])
        XCTAssertEqual(tracks.keys.sorted(), ["mic-0", "screen-1"])
        // Each named file is in the spool at its path in the mind, whole.
        for (path, bytes) in [(tracks["mic-0"]?["file"], 3), (tracks["screen-1"]?["file"], 1), (tracks["screen-1"]?["picture"], 2)] {
            let path = try XCTUnwrap(path as? String)
            XCTAssertTrue(path.hasPrefix("/devices/test.mac/record/"))
            XCTAssertEqual(try Data(contentsOf: spool.appendingPathComponent(String(path.dropFirst()))).count, bytes)
        }
        XCTAssertEqual(tracks["mic-0"]?["bytes"] as? Int, 3)
        XCTAssertNil(tracks["mic-0"]?["picture"])
        // Sealed: no track begins this slot again, nor an earlier one.
        XCTAssertFalse(r.opening(track: "camera-0", slot: t))
        XCTAssertFalse(r.opening(track: "camera-0", slot: t - 30_000))
        XCTAssertTrue(r.opening(track: "camera-0", slot: t + 30_000))
    }

    func testATrackWritesASlotOnce() {
        let r = recorder(), t: Int64 = 1_795_275_690_000
        XCTAssertTrue(r.opening(track: "mic-0", slot: t))
        XCTAssertTrue(r.opening(track: "screen-1", slot: t))
        r.finished(track: "mic-0", slot: t, parts: [Data([1])], size: 1, entry: entry("audio"), picture: nil)
        XCTAssertFalse(r.opening(track: "mic-0", slot: t), "switched off and on in one slot: it begins with the next")
    }

    func testARestartSealsWhatAnEarlierRunLeftOpen() {
        let t: Int64 = 1_795_275_690_000
        let first = recorder()
        XCTAssertTrue(first.opening(track: "mic-0", slot: t))
        XCTAssertTrue(first.opening(track: "screen-1", slot: t))
        first.finished(track: "mic-0", slot: t, parts: [Data([1])], size: 1, entry: entry("audio"), picture: nil)
        // The app dies here: screen-1's file of the slot was in memory.
        let second = recorder()
        second.start()
        defer { second.stop() }
        XCTAssertEqual(slots(), ["\(t).json"], "sealed with the one file that was written")
        XCTAssertFalse(second.opening(track: "screen-1", slot: t), "a slot is written once")
        XCTAssertTrue(second.opening(track: "screen-1", slot: t + 30_000))
    }
}
