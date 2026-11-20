import AppKit

@main
enum VoiceMeetMacApp {
    @MainActor
    static func main() {
        // A copy started only to answer one question (Permissions.swift): it opens nothing.
        if CommandLine.arguments.contains(Permission.checkScreenRecordingArgument) {
            exit(CGPreflightScreenCaptureAccess() ? 0 : 1)
        }
        // A copy started only to draw the panel to a PNG file, for a look at it with no click.
        if let flag = CommandLine.arguments.firstIndex(of: "--render-panel"), CommandLine.arguments.indices.contains(flag + 1) {
            // an optional third word draws the lend in that phase: live, reconnecting, stopped, not-allowed
            let phase = CommandLine.arguments.indices.contains(flag + 2) ? CommandLine.arguments[flag + 2] : nil
            exit(Panel.render(to: URL(fileURLWithPath: CommandLine.arguments[flag + 1]), phase: phase) ? 0 : 1)
        }
        // The same for the forms of the mind menu: Add a Mind, and Remove.
        if let flag = CommandLine.arguments.firstIndex(of: "--render-add-mind"), CommandLine.arguments.indices.contains(flag + 1) {
            // an optional third word is the name in the field, to see its check
            let name = CommandLine.arguments.indices.contains(flag + 2) ? CommandLine.arguments[flag + 2] : "jane.mac"
            let form = AddMindForm(profiles: ["example.com", "example.org"], name: name, add: { _, _ in }, cancel: {})
            exit(FormWindow.render(form, to: URL(fileURLWithPath: CommandLine.arguments[flag + 1])) ? 0 : 1)
        }
        if let flag = CommandLine.arguments.firstIndex(of: "--render-remove-mind"), CommandLine.arguments.indices.contains(flag + 1) {
            let form = RemoveMindForm(mind: "example.com", isActive: true, remove: {}, cancel: {})
            exit(FormWindow.render(form, to: URL(fileURLWithPath: CommandLine.arguments[flag + 1])) ? 0 : 1)
        }
        // The menu-bar mark in each state of the lend: `--render-icons <folder>`.
        if let flag = CommandLine.arguments.firstIndex(of: "--render-icons"), CommandLine.arguments.indices.contains(flag + 1) {
            exit(IterateIcon.render(to: URL(fileURLWithPath: CommandLine.arguments[flag + 1])) ? 0 : 1)
        }
        // A sample banner: `--render-banner <file> ring|request|notice [dark]`; `--render-ring <file> [dark]`
        // is the ring's.
        for flag in ["--render-banner", "--render-ring"] {
            guard let at = CommandLine.arguments.firstIndex(of: flag), CommandLine.arguments.indices.contains(at + 1) else { continue }
            let words = Array(CommandLine.arguments[(at + 2)...])
            let kind = flag == "--render-ring" ? "ring" : words.first ?? "notice"
            exit(BannerWindow.render(kind, to: URL(fileURLWithPath: CommandLine.arguments[at + 1]), dark: words.contains("dark")) ? 0 : 1)
        }
        // AVFoundation reports some mistakes as Objective-C exceptions. The log gets the reason.
        NSSetUncaughtExceptionHandler { exception in
            AppLog("app").error("uncaught exception \(exception.name.rawValue): \(exception.reason ?? "no reason")")
        }
        let application = NSApplication.shared
        let delegate = AppDelegate()
        application.delegate = delegate
        // A menu-bar-only app: no Dock icon and no window. Info.plist says the same (LSUIElement).
        application.setActivationPolicy(.accessory)
        withExtendedLifetime(delegate) {
            application.run()
        }
    }
}
