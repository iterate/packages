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
            exit(Panel.render(to: URL(fileURLWithPath: CommandLine.arguments[flag + 1])) ? 0 : 1)
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
