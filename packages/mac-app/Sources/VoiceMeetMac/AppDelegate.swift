import AppKit
import ServiceManagement
import SwiftUI
import VoiceMeetCore

/// A menu-bar-only app: the iterate mark, and a panel under it (`Panel`). No window, no Dock icon.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSPopoverDelegate {
    private lazy var model = AppModel()
    private let log = AppLog("app")
    private let panelState = PanelState()
    private let lend = Lend()
    private let popover = NSPopover()
    private var statusItem: NSStatusItem?
    private var shownStatusIcon = ""
    private var terminationSignal: DispatchSourceSignal?
    private var grantWatch: Timer?
    private var displayPictureTimer: Timer?
    /// The cameras that run for the open panel's previews.
    private var camerasHeldByThePanel: Set<String> = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        logRunStart()
        quitOnTerminationSignal()

        let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.target = self
        statusItem.button?.action = #selector(togglePanel)
        self.statusItem = statusItem

        let panel = Panel(
            state: panelState,
            model: model,
            changed: { [weak self] in self?.choiceChanged() },
            allow: { [weak self] permission in self?.guide(permission) },
            copyPrompt: { [weak self] in self?.copyPrompt() },
            pressBanner: { [weak self] index in
                self?.popover.performClose(nil)
                if let index { self?.model.banners.press(index) } else { self?.model.banners.dismiss() }
            },
            lendActions: LendActions(
                reconnect: { [weak self] in self?.lend.reconnectNow() },
                use: { [weak self] mind in self?.lend.use(mind) },
                add: { [weak self] in self?.addMind() },
                remove: { [weak self] mind in self?.removeMind(mind) },
                open: { link in if let url = URL(string: link) { NSWorkspace.shared.open(url) } }
            )
        )
        let host = NSHostingController(rootView: panel)
        // The panel is as tall as its rows need.
        host.sizingOptions = [.preferredContentSize]
        popover.contentViewController = host
        popover.behavior = .transient
        popover.delegate = self

        model.onChange = { [weak self] in self?.stateDidChange() }
        // the address as the CLI says it (`iterate.example.com`), not the config's short name
        model.banners.activeMind = { [weak self] in self?.lend.state.mindAddress }
        model.banners.onChange = { [weak self] in self?.stateDidChange() }
        model.start()
        lend.isBusy = { [weak self] in (self?.model.microphone.isRunning ?? false) || (self?.model.isAnyCameraRunning ?? false) }
        lend.onChange = { [weak self] in self?.stateDidChange() }
        lend.start()
        openAtLogin()
        stateDidChange()
        watchForGrants()

        // At the very first start the panel opens by itself, so that the person sees the choices.
        if !UserDefaults.standard.bool(forKey: "panelShownAtFirstStart") {
            UserDefaults.standard.set(true, forKey: "panelShownAtFirstStart")
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in self?.togglePanel() }
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        lend.stop()
        model.shutDown()
        log.info("==== run end: the app quits")
    }

    /// `kill <process>` quits the app as its Quit button does: captures stop, the log gets its last
    /// line. So a script or an agent can end a run without a click.
    private func quitOnTerminationSignal() {
        signal(SIGTERM, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        source.setEventHandler {
            MainActor.assumeIsolated {
                AppLog("app").info("the termination signal arrived; the app quits")
                NSApp.terminate(nil)
            }
        }
        source.resume()
        terminationSignal = source
    }

    /// The installed app (in /Applications) starts at each login when the person said so to
    /// `npx @iterate-com/mac-app` (its config's `login`). A build run from elsewhere registers
    /// nothing, so that one copy alone is ever registered. System Settings › General › Login Items
    /// shows it and can turn it off.
    private func openAtLogin() {
        guard Bundle.main.bundlePath.hasPrefix("/Applications/") else { return }
        let service = SMAppService.mainApp
        let wanted = lend.config?.login ?? false
        do {
            if wanted, service.status != .enabled {
                try service.register()
            } else if !wanted, service.status == .enabled {
                try service.unregister()
            }
            log.info("login item: \(wanted ? "on" : "off") (status \(service.status.rawValue))")
        } catch {
            log.error("login item: not changed: \(AppLog.describe(error))")
        }
    }

    /// The lend's state for the panel.
    private func showLend() {
        var view = LendView()
        view.isSetUp = lend.config != nil
        view.minds = lend.config?.minds.map { LendView.Mind(mind: $0.mind, name: $0.name) } ?? []
        view.active = lend.config?.activeMind?.mind
        view.status = lend.state.statusLine(now: Date(), clock: Lend.clock)
        view.phase = lend.state.phase.name
        view.link = lend.state.phase.link ?? lend.commandLink
        view.commandLine = lend.commandLine
        view.isCommandRunning = lend.isCommandRunning
        view.source = lend.config.map { $0.source.line(home: NSHomeDirectory()) }
        if view != panelState.lend { panelState.lend = view }
    }

    /// "Add a Mind…": its address (the iterate CLI's profiles are offered) and the name this Mac
    /// is available under. The CLI's `add` makes the key and opens the link where a member allows it.
    private func addMind() {
        popover.performClose(nil)
        lend.profiles { [weak self] profiles in
            guard let self else { return }
            let known = Set(self.lend.config?.minds.map(\.mind) ?? [])
            let name = self.lend.activeMind?.name ?? "\(NSUserName().filter { $0.isLetter || $0.isNumber }).mac"
            FormWindow.show(
                title: "Add a Mind",
                AddMindForm(
                    profiles: profiles.filter { !known.contains($0) },
                    name: name,
                    add: { [weak self] mind, name in
                        FormWindow.close()
                        self?.log.info("the person adds \(mind) as itx.\(name)")
                        self?.lend.add(mind: mind, name: name)
                    },
                    cancel: { FormWindow.close() }
                )
            )
        }
    }

    private func removeMind(_ mind: String) {
        popover.performClose(nil)
        FormWindow.show(
            title: "Remove \(mind)?",
            RemoveMindForm(
                mind: mind,
                isActive: mind == lend.activeMind?.mind,
                remove: { [weak self] in
                    FormWindow.close()
                    self?.log.info("the person removes \(mind)")
                    self?.lend.remove(mind)
                },
                cancel: { FormWindow.close() }
            )
        )
    }

    /// The first lines of each run: which build ran, on what, and with which choices.
    private func logRunStart() {
        let executable = Bundle.main.executableURL
        let built = (try? executable?.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
        let builtText = built.map { ISO8601DateFormatter().string(from: $0) } ?? "unknown"
        log.info(
            "==== run start: process \(ProcessInfo.processInfo.processIdentifier), built \(builtText), macOS \(ProcessInfo.processInfo.operatingSystemVersionString), bundle \(Bundle.main.bundleIdentifier ?? "none (not run from the .app)"), log \(AppLog.fileURL.path)"
        )
        log.info("sharing: " + Shareable.all.map(Self.line).joined(separator: "; "))
    }

    private static func line(_ thing: Shareable) -> String {
        let waits = thing.sharing != .off && !thing.isPermitted ? ", waits for \(thing.power.permission?.title ?? "macOS")" : ""
        return "\(thing.id) (\(thing.title)) \(thing.sharing.rawValue)\(waits)"
    }

    // MARK: - The mark and the panel

    private func stateDidChange() {
        updateStatusButton()
        panelState.things = Shareable.all
        panelState.revision += 1
        let banner = model.banners.state.showing
        if banner != panelState.banner { panelState.banner = banner }
        showLend()
    }

    /// The iterate mark: green while a banner shows, red for 3 seconds at each use by a
    /// mind, orange while the microphone or a camera is on. Else the lend at a glance: plain while
    /// live, dimmed while it connects, dimmed and slashed while it is not lent.
    private func updateStatusButton() {
        guard let button = statusItem?.button else { return }
        let isInUse = model.lastUse.map { Date().timeIntervalSince($0.at) < 3 } ?? false
        if isInUse {
            DispatchQueue.main.asyncAfter(deadline: .now() + 3.1) { [weak self] in self?.updateStatusButton() }
        }
        let isCapturing = model.microphone.isRunning || model.isAnyCameraRunning
        let banner = model.banners.state.showing
        let glance = lend.state.phase.glance
        let shown = banner != nil ? "green" : isInUse ? "red" : isCapturing ? "orange" : glance.rawValue
        button.image =
            banner != nil ? IterateIcon.green : isInUse ? IterateIcon.red : isCapturing ? IterateIcon.orange : IterateIcon.lend(glance)
        let lendWords: String
        switch glance {
        case .live: lendWords = "iterate: lent"
        case .connecting: lendWords = "iterate: connecting"
        case .down: lendWords = "iterate: not lent"
        }
        let label =
            banner.map { $0.isCall ? "iterate: \($0.title) calls" : "iterate: \($0.title)" }
            ?? (isInUse ? "iterate: a mind uses this Mac now" : isCapturing ? "iterate: microphone or camera on" : lendWords)
        button.toolTip = label
        button.setAccessibilityLabel(label)
        if shown != shownStatusIcon {
            shownStatusIcon = shown
            log.info("menu-bar icon: the iterate mark, \(shown)")
        }
    }

    @objc private func togglePanel() {
        guard let button = statusItem?.button else { return }
        if popover.isShown {
            popover.performClose(nil)
        } else {
            // a lend that waits for its next start starts now: the owner looks at it
            lend.panelOpened()
            stateDidChange()
            NSApp.activate(ignoringOtherApps: true)
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        }
    }

    /// While the panel is open, a thing that is not off shows what a mind would get: a camera runs
    /// for its picture, and a display's picture is a new small one every second.
    func popoverDidShow(_ notification: Notification) {
        log.info("the panel opens")
        syncPreviews()
        let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.refreshDisplayPictures() }
        }
        RunLoop.main.add(timer, forMode: .common)
        displayPictureTimer = timer
    }

    func popoverDidClose(_ notification: Notification) {
        displayPictureTimer?.invalidate()
        displayPictureTimer = nil
        camerasHeldByThePanel.forEach(model.releaseCamera)
        camerasHeldByThePanel = []
        panelState.displayPictures = [:]
    }

    private func choiceChanged() {
        log.info("sharing: " + Shareable.all.map(Self.line).joined(separator: "; "))
        stateDidChange()
        if popover.isShown { syncPreviews() }
        // A thing was turned on whose permission macOS has not given: the guide starts.
        if let permission = Shareable.all.first(where: { $0.sharing != .off && !$0.isPermitted })?.power.permission,
            grantWatch == nil
        {
            guide(permission)
        }
    }

    /// The cameras whose choice is not off run for the open panel; the others do not.
    private func syncPreviews() {
        let wanted = Set(
            Shareable.all.filter { $0.power == .camera && $0.sharing != .off && $0.isPermitted }
                .map { String($0.id.dropFirst("camera.".count)) }
        )
        camerasHeldByThePanel.subtracting(wanted).forEach(model.releaseCamera)
        wanted.subtracting(camerasHeldByThePanel).forEach(model.holdCamera)
        camerasHeldByThePanel = wanted
        refreshDisplayPictures()
    }

    private func refreshDisplayPictures() {
        for thing in Shareable.all where thing.power == .screen {
            guard thing.sharing != .off, thing.isPermitted else {
                panelState.displayPictures[thing.id] = nil
                continue
            }
            Task { @MainActor in
                guard let picture = try? await Screen.image(of: Screen.id(of: thing), maxWidth: 480), popover.isShown else { return }
                panelState.displayPictures[thing.id] = picture
            }
        }
    }

    private func copyPrompt() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(Panel.prompt, forType: .string)
        log.info("the person copied the prompt")
        panelState.didCopy = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.panelState.didCopy = false }
    }

    // MARK: - The guide to a permission

    /// A thing was turned on and macOS has not given what it needs. The app says what comes, then
    /// macOS shows its own prompt or settings pane; the person answers there. The app waits for the
    /// answer and finishes the step: after a Screen Recording grant it starts again by itself.
    private func guide(_ permission: Permission) {
        let alert = NSAlert()
        alert.messageText = "Allow iterate: \(permission.title)"
        alert.informativeText = permission.steps
        alert.icon = NSApp.applicationIconImage
        alert.addButton(withTitle: "Continue")
        alert.addButton(withTitle: "Not Now")
        NSApp.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertFirstButtonReturn else {
            return log.info("the guide for \(permission.title): the person chose Not Now")
        }
        log.info("the guide for \(permission.title): macOS asks the person")
        permission.request()
        watchForGrants()
    }

    /// Looks once a second, for at most 5 minutes, whether macOS gave what the things that are not
    /// off still wait for. It runs after the guide and at the start of the app, so a switch set in
    /// System Settings is seen without another click. After the 5 minutes, the panel's "Allow…"
    /// button starts it again.
    private func watchForGrants() {
        var waiting = Set(Shareable.all.filter { $0.sharing != .off }.compactMap(\.power.permission).filter { !$0.isGranted })
        grantWatch?.invalidate()
        grantWatch = nil
        guard !waiting.isEmpty else { return }
        var looksLeft = 300
        let timer = Timer(timeInterval: 1, repeats: true) { [weak self] timer in
            MainActor.assumeIsolated {
                guard let self else { return timer.invalidate() }
                looksLeft -= 1
                for permission in waiting where permission.isGranted {
                    waiting.remove(permission)
                    self.log.info("macOS gave \(permission.title)")
                    self.stateDidChange()
                    if self.popover.isShown { self.syncPreviews() }
                }
                if waiting.contains(.screenRecording), Permission.screenRecordingWaitsForRestart {
                    timer.invalidate()
                    self.log.info("macOS gave Screen Recording; the app starts again to use it")
                    Permission.restartTheApp()
                } else if waiting.isEmpty || looksLeft <= 0 {
                    timer.invalidate()
                    self.grantWatch = nil
                    if !waiting.isEmpty {
                        self.log.info("no answer from macOS in 5 minutes for: \(waiting.map(\.title).sorted().joined(separator: ", ")); the panel still offers it")
                    }
                }
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        grantWatch = timer
    }
}
