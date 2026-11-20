import Foundation

/// WHERE THE INSTALLED APP CAME FROM, and so whether it updates itself. `npx @iterate-com/mac-app`
/// writes it to config.json: `spec` is what the setup ran from, and `copy` is set only when it ran
/// from a copy that `init` made (the copy has `.iterate-mac-app.json`). An app built from a copy
/// runs what was built: its owner changes the source and updates it with `update` in the copy.
public enum UpdateSource: Equatable, Sendable {
    /// npm's registry: once an hour the app asks for a newer version and runs its `update`.
    case registry(version: String)
    /// A pkg.pr.new link or a folder of the package: a trial, updated by hand.
    case trial(spec: String, version: String)
    /// An owner's copy, made by `init`: built from that folder, never updated by the app.
    case copy(folder: String)

    public static let package = "@iterate-com/mac-app"

    public static func of(spec: String, copy: String?, version: String) -> UpdateSource {
        if let copy, !copy.isEmpty { return .copy(folder: copy) }
        // `@iterate-com/mac-app@latest`, never `@iterate-com/mac-app-other`
        if spec == package || spec.hasPrefix("\(package)@") { return .registry(version: version) }
        return .trial(spec: spec, version: version)
    }

    public var updatesItself: Bool {
        if case .registry = self { return true }
        return false
    }

    /// The panel's line, with the home folder written as `~`.
    public func line(home: String) -> String {
        switch self {
        case .registry(let version): return "Version \(version) · updates by itself"
        case .trial(_, let version): return "Version \(version), a trial · updated by hand"
        case .copy(let folder):
            let shown = !home.isEmpty && folder.hasPrefix(home + "/") ? "~" + folder.dropFirst(home.count) : folder
            return "Built from \(shown)"
        }
    }
}
