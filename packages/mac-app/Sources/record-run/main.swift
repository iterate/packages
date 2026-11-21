import Foundation
import Record

// record-run: the recorder from a terminal, for tests. The app runs the same library.
//
//   record-run --spool <folder> --device <name> [--synthetic] [--screens] [--cameras] [--mics]
//              [--speakers] [--seconds N] [--switch-off-at N]
//
// --switch-off-at N switches every source off after N seconds and goes on running (a switch's
// stop). Real sources need the app's permissions: run it through the app's `run` method.
// SIGINT or SIGTERM stops it as --seconds does.
var arguments = Array(CommandLine.arguments.dropFirst())
func value(_ flag: String) -> String? {
    guard let i = arguments.firstIndex(of: flag), i + 1 < arguments.count else { return nil }
    return arguments[i + 1]
}
guard let spool = value("--spool"), let device = value("--device") else {
    FileHandle.standardError.write(Data("record-run --spool <folder> --device <name> [--synthetic] [--screens] [--cameras] [--mics] [--speakers] [--seconds N] [--switch-off-at N]\n".utf8))
    exit(2)
}
let sources = Set(RecordSource.allCases.filter { arguments.contains("--\($0.rawValue)") })
let recorder = Recorder(options: RecordOptions(spool: URL(fileURLWithPath: spool), device: device))
recordLog = { line in
    let stamp = ISO8601DateFormatter.string(from: Date(), timeZone: .current, formatOptions: [.withFullTime, .withFractionalSeconds])
    FileHandle.standardError.write(Data("\(stamp) \(line)\n".utf8))
}
recorder.start()
recorder.set(sources)

func finish() {
    DispatchQueue.global().async {
        recorder.stop()
        exit(0)
    }
}
signal(SIGINT, SIG_IGN)
signal(SIGTERM, SIG_IGN)
let signalSources = [SIGINT, SIGTERM].map { number -> DispatchSourceSignal in
    let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
    source.setEventHandler { finish() }
    source.resume()
    return source
}
if let seconds = value("--seconds").flatMap(Double.init) {
    DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { finish() }
}
if let seconds = value("--switch-off-at").flatMap(Double.init) {
    DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { recorder.set([]) }
}
// The signal sources must outlive the run loop: a freed source is cancelled.
withExtendedLifetime(signalSources) { RunLoop.main.run() }
