import CoreMedia
import Foundation

/// Where the recorder's lines go: the app's log, or stderr in `record-run`. Set it before a start.
nonisolated(unsafe) public var recordLog: (String) -> Void = { FileHandle.standardError.write(Data("\($0)\n".utf8)) }
func log(_ text: String) { recordLog(text) }

/// The ratio that turns `mach_absolute_time` ticks into nanoseconds (125/3 on Apple Silicon).
public struct MachTimebase: Equatable {
    public let numer: UInt64
    public let denom: UInt64

    public init(numer: UInt64, denom: UInt64) {
        self.numer = numer
        self.denom = denom
    }

    public func nanos(ticks: UInt64) -> UInt64 {
        // Split to stay inside 64 bits: ticks * 125 overflows after about 4 years of uptime.
        let whole = ticks / denom, rest = ticks % denom
        return whole * numer + rest * numer / denom
    }
}

/// One (host time, wall time) pair. Every track maps host time to wall milliseconds through the
/// same anchor, so they share one timeline.
public struct ClockAnchor: Equatable {
    public let hostNanos: UInt64
    public let wallMs: Double

    public init(hostNanos: UInt64, wallMs: Double) {
        self.hostNanos = hostNanos
        self.wallMs = wallMs
    }

    public func wallMs(hostNanos value: UInt64) -> Double {
        wallMs + Double(Int64(bitPattern: value &- hostNanos)) / 1_000_000
    }
}

/// Wall milliseconds now, on the recorder's one timeline. Every time the recorder uses (sample
/// times, slot names, the moments a slot closes) comes from it, so they agree even while the
/// system clock is being set.
func nowMs() -> Double { HostClock.shared.nowMs() }

/// Host time to wall milliseconds through one anchor. Capture frames carry host time; mapping them
/// all through the same anchor puts them on one timeline, which a wall-clock read at each callback
/// would not (callbacks run late). The anchor is taken again when the system clock is set, after a
/// wake (host time stops while the Mac sleeps), and when the two drift more than 250 ms apart: the
/// system's own time sync steps the clock by tens of ms, and a small step is not followed.
final class HostClock {
    static let shared = HostClock()
    let timebase: MachTimebase
    private let lock = NSLock()
    private var anchor = ClockAnchor(hostNanos: 0, wallMs: 0)

    private init() {
        var info = mach_timebase_info_data_t()
        mach_timebase_info(&info)
        timebase = MachTimebase(numer: UInt64(info.numer), denom: UInt64(info.denom))
        anchor = take()
    }

    /// Reads wall time between two host reads and pairs it with their middle.
    private func take() -> ClockAnchor {
        let before = mach_absolute_time()
        let wall = Date().timeIntervalSince1970 * 1000
        let after = mach_absolute_time()
        return ClockAnchor(hostNanos: timebase.nanos(ticks: before / 2 + after / 2), wallMs: wall)
    }

    /// A new anchor; returns how far the timeline moved (ms, + is forward).
    func reanchor() -> Double {
        let fresh = take()
        let before = current.wallMs(hostNanos: fresh.hostNanos)
        lock.withLock { anchor = fresh }
        return fresh.wallMs - before
    }

    /// The system clock minus the timeline (ms).
    func drift() -> Double { Date().timeIntervalSince1970 * 1000 - nowMs() }

    func nowMs() -> Double { current.wallMs(hostNanos: timebase.nanos(ticks: mach_absolute_time())) }

    var current: ClockAnchor { lock.withLock { anchor } }

    /// A CMTime on the host clock (CMClockGetHostTimeClock counts nanoseconds of mach time).
    func wallMs(hostTime: CMTime) -> Double {
        let nanos = CMTimeConvertScale(hostTime, timescale: 1_000_000_000, method: .roundHalfAwayFromZero).value
        return current.wallMs(hostNanos: UInt64(max(0, nanos)))
    }

    func hostNow() -> CMTime { CMClockGetTime(CMClockGetHostTimeClock()) }
}
