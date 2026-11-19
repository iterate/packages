import AppKit
import SwiftUI

/// "Add a Mind": which mind, and the name this Mac is available under, as itx.<name>. A form in
/// the style of System Settings, in a small window of its own.
struct AddMindForm: View {
    /// The minds of the iterate CLI's profiles that this Mac does not have yet.
    let profiles: [String]
    let add: (_ mind: String, _ name: String) -> Void
    let cancel: () -> Void

    @State private var choice: String
    @State private var typed = ""
    @State private var name: String

    /// The picker's tag for an address typed by hand.
    private static let other = "\u{0}other"

    init(profiles: [String], name: String, add: @escaping (String, String) -> Void, cancel: @escaping () -> Void) {
        self.profiles = profiles
        self.add = add
        self.cancel = cancel
        _choice = State(initialValue: profiles.first ?? Self.other)
        _name = State(initialValue: name)
    }

    private var mind: String {
        (choice == Self.other ? typed : choice).trimmingCharacters(in: .whitespaces).lowercased()
    }

    private var trimmedName: String { name.trimmingCharacters(in: .whitespaces) }

    /// The rules of cli.mjs: a host name, and the name rule of `iterate provide`.
    private var mindProblem: String? {
        if mind.isEmpty { return nil }
        let host = #"^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$"#
        return mind.range(of: host, options: .regularExpression) == nil ? "A mind's address is a host name, such as example.com." : nil
    }

    private var nameProblem: String? {
        if trimmedName.isEmpty { return nil }
        if trimmedName.hasPrefix("itx.") { return "Leave out \"itx.\": it is always there." }
        let rule = #"^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)*$"#
        return trimmedName.range(of: rule, options: .regularExpression) == nil
            ? "Letters and digits, starting with a letter; dots between parts, such as jane.mac."
            : nil
    }

    private var isValid: Bool { !mind.isEmpty && !trimmedName.isEmpty && mindProblem == nil && nameProblem == nil }

    var body: some View {
        VStack(spacing: 0) {
            Form {
                Section {
                    if !profiles.isEmpty {
                        Picker("Mind", selection: $choice) {
                            ForEach(profiles, id: \.self) { Text($0).tag($0) }
                            Divider()
                            Text("Other Address…").tag(Self.other)
                        }
                    }
                    if choice == Self.other {
                        TextField(profiles.isEmpty ? "Mind" : "Address", text: $typed, prompt: Text("example.com"))
                        if let mindProblem { problem(mindProblem) }
                    }
                    LabeledContent("Name") {
                        HStack(spacing: 0) {
                            Text("itx.").foregroundStyle(.secondary)
                            TextField("Name", text: $name, prompt: Text("jane.mac"))
                                .labelsHidden()
                                .multilineTextAlignment(.leading)
                                .frame(width: 150)
                        }
                    }
                    if let nameProblem { problem(nameProblem) }
                } footer: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("This Mac is available to \(mind.isEmpty ? "the mind" : mind) as itx.\(trimmedName.isEmpty ? "<name>" : trimmedName).")
                        Text("A member allows it with a passkey in the browser.")
                    }
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .scrollDisabled(true)
            .fixedSize(horizontal: false, vertical: true)
            HStack {
                Spacer()
                Button("Cancel", role: .cancel, action: cancel).keyboardShortcut(.cancelAction)
                Button("Add") { add(mind, trimmedName) }
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
                    .disabled(!isValid)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 20)
        }
        .frame(width: 460)
    }

    private func problem(_ words: String) -> some View {
        Label(words, systemImage: "exclamationmark.circle.fill")
            .font(.callout)
            .foregroundStyle(.red)
    }
}

/// "Remove <mind>?": what removing does, and Cancel / Remove.
struct RemoveMindForm: View {
    let mind: String
    let isActive: Bool
    let remove: () -> Void
    let cancel: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("This Mac forgets \(mind) and deletes its key.")
                        if isActive { Text("It is available to no mind until you choose one.") }
                        Text("The key stays listed on the mind's /keys page until a member removes it there. It can do nothing now.")
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
                }
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .scrollDisabled(true)
            .fixedSize(horizontal: false, vertical: true)
            HStack {
                Spacer()
                Button("Cancel", role: .cancel, action: cancel).keyboardShortcut(.cancelAction)
                Button("Remove", role: .destructive, action: remove)
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
                    .tint(.red)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 20)
        }
        .frame(width: 460)
    }
}

/// A small titled window around one form, as a menu-bar app has no window of its own to put a
/// sheet on. One at a time: a new one closes the one before.
@MainActor
enum FormWindow {
    private static var current: NSWindow?

    static func show<Content: View>(title: String, _ content: Content) {
        close()
        let host = NSHostingController(rootView: content)
        host.sizingOptions = [.preferredContentSize]
        let window = NSWindow(contentViewController: host)
        window.title = title
        window.styleMask = [.titled, .closable]
        window.isReleasedWhenClosed = false
        window.level = .floating
        window.center()
        current = window
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }

    static func close() {
        current?.close()
        current = nil
    }

    /// Draws a form to a PNG file, on the window background, for a look at it with no click.
    static func render<Content: View>(_ content: Content, to file: URL) -> Bool {
        _ = NSApplication.shared
        let view = NSHostingView(rootView: content.background(Color(nsColor: .windowBackgroundColor)))
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: view.fittingSize), styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = view
        view.layoutSubtreeIfNeeded()
        guard let picture = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return false }
        view.cacheDisplay(in: view.bounds, to: picture)
        guard let png = picture.representation(using: .png, properties: [:]) else { return false }
        return (try? png.write(to: file)) != nil
    }
}
