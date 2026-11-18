import AppKit
import LocalAuthentication

/// The person's approval of one use, for a thing whose choice is "Ask". The app says
/// what a mind wants to do; the person approves it once or for half an hour, with Touch ID (or the
/// Mac's password where there is no Touch ID), or denies it. A caller that gets no answer in a
/// minute is refused.
@MainActor
final class Approval {
    private static let window: TimeInterval = 30 * 60
    private static let patience: TimeInterval = 60

    private let log = AppLog("approval")
    private var approvedUntil: [String: Date] = [:]
    private var isAsking = false

    /// Until when the person approved a thing without another question; nil when they did not.
    func isApproved(_ thing: Shareable) -> Date? {
        approvedUntil[thing.id].flatMap { $0 > Date() ? $0 : nil }
    }

    func end(_ thing: Shareable) {
        approvedUntil[thing.id] = nil
        log.info("the person ended the approval to \(thing.does)")
    }

    /// Returns when the person approved; throws the refusal a caller reads when they did not.
    func ask(for thing: Shareable, what: String) async throws {
        // One question at a time: a second caller waits for the first answer, which may cover it.
        while isAsking { try await Task.sleep(nanoseconds: 200_000_000) }
        if isApproved(thing) != nil { return }
        isAsking = true
        defer { isAsking = false }

        let alert = NSAlert()
        alert.messageText = "Your mind wants to \(thing.does)"
        alert.informativeText = what
        alert.icon = NSApp.applicationIconImage
        alert.addButton(withTitle: "Approve Once")
        alert.addButton(withTitle: "Approve for 30 Minutes")
        alert.addButton(withTitle: "Deny")
        alert.window.level = .floating
        NSApp.activate(ignoringOtherApps: true)
        // Bounded: with no answer the question goes away and the caller is refused.
        let giveUp = DispatchWorkItem { NSApp.abortModal() }
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.patience, execute: giveUp)
        let answer = alert.runModal()
        giveUp.cancel()
        alert.window.orderOut(nil)

        guard answer == .alertFirstButtonReturn || answer == .alertSecondButtonReturn else {
            let words = answer == .alertThirdButtonReturn ? "denied it" : "gave no answer in \(Int(Self.patience)) seconds"
            log.info("to \(thing.does): the person \(words)")
            throw EndpointRefusal("The Mac's owner \(words) to \(thing.does).")
        }
        do {
            let reason = "approve that your mind may \(thing.does)"
            guard try await LAContext().evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) else {
                throw EndpointRefusal("The Mac's owner did not confirm with Touch ID to \(thing.does).")
            }
        } catch let refusal as EndpointRefusal {
            throw refusal
        } catch {
            log.info("to \(thing.does): no confirmation: \(AppLog.describe(error))")
            throw EndpointRefusal("The Mac's owner did not confirm with Touch ID to \(thing.does).")
        }
        if answer == .alertSecondButtonReturn {
            approvedUntil[thing.id] = Date().addingTimeInterval(Self.window)
        }
        log.info("to \(thing.does): the person approved \(answer == .alertSecondButtonReturn ? "for 30 minutes" : "this one use")")
    }
}
