import Foundation

/// How a banner's button looks. `accept` and `decline` with a symbol are the round phone buttons of
/// a call; otherwise a button is a small capsule with its label.
public enum BannerStyle: String, Equatable, Sendable {
    case accept
    case decline
    case plain
}

public enum BannerSound: String, Equatable, Sendable {
    /// The ring of a call, looped until the banner ends.
    case ring
    /// One short sound as the banner comes.
    case chime
    case none
}

public struct BannerButton: Equatable, Sendable {
    public let label: String
    public let style: BannerStyle
    /// An SF Symbol's name.
    public let symbol: String?
    /// The page a press opens in the default browser, checked by `BannerState.page`.
    public let open: URL?

    public init(label: String, style: BannerStyle = .plain, symbol: String? = nil, open: URL? = nil) {
        self.label = label
        self.style = style
        self.symbol = symbol
        self.open = open
    }

    /// A round phone button: an accept or decline with a symbol.
    public var isRound: Bool { style != .plain && symbol != nil }
}

/// One banner on this Mac's screen: an output of the device, like a sound through its speakers.
public struct Banner: Equatable, Sendable {
    /// The app's own number for it, so that a late timer or a late press changes nothing.
    public let id: Int
    public let title: String
    public let body: String
    /// One to three.
    public let buttons: [BannerButton]
    public let sound: BannerSound
    public let seconds: TimeInterval
    /// A banner that looks like a call (`call.ring`): a plain banner does not replace it.
    public let isCall: Bool

    public static let titleLimit = 80
    public static let bodyLimit = 300
    public static let labelLimit = 24
    public static let secondsRange: ClosedRange<TimeInterval> = 5...120
    public static let defaultSeconds: TimeInterval = 30

    /// The button that Return presses: the first `accept`, else the first one.
    public var defaultButton: Int { buttons.firstIndex { $0.style == .accept } ?? 0 }

    /// A banner from a caller's words, clamped. `buttons` with no entry is one "OK"; more than three
    /// is refused; each `open` must pass `BannerState.page`. The refusal is in words, and comes
    /// before anything shows.
    public static func make(
        id: Int, title: String?, body: String?, buttons: [[String: Any]]?, sound: String?, seconds: Double?,
        isCall: Bool = false, mind: String
    ) -> Result<Banner, BannerRefusal> {
        let title = line(title, Self.titleLimit)
        guard !title.isEmpty else { return .failure(BannerRefusal("A banner needs a title.")) }
        let given = buttons ?? []
        guard given.count <= 3 else { return .failure(BannerRefusal("A banner has one to three buttons, not \(given.count).")) }
        var made: [BannerButton] = []
        for raw in given {
            let label = line(raw["label"] as? String, Self.labelLimit)
            guard !label.isEmpty else { return .failure(BannerRefusal("Each button needs a label.")) }
            guard !made.contains(where: { $0.label == label }) else {
                return .failure(BannerRefusal("Two buttons have the label \"\(label)\": the answer names the button by its label."))
            }
            guard let style = BannerStyle(rawValue: raw["style"] as? String ?? "plain") else {
                return .failure(BannerRefusal("A button's style is accept, decline or plain."))
            }
            var page: URL?
            if let open = raw["open"] as? String {
                switch BannerState.page(open, mind: mind) {
                case .success(let url): page = url
                case .failure(let refusal): return .failure(refusal)
                }
            }
            let symbol = (raw["symbol"] as? String).map { String($0.prefix(60)) }.flatMap { $0.isEmpty ? nil : $0 }
            made.append(BannerButton(label: label, style: style, symbol: symbol, open: page))
        }
        if made.isEmpty { made = [BannerButton(label: "OK")] }
        guard let sound = BannerSound(rawValue: sound ?? "chime") else {
            return .failure(BannerRefusal("A banner's sound is ring, chime or none."))
        }
        let wait = min(max(seconds ?? Self.defaultSeconds, Self.secondsRange.lowerBound), Self.secondsRange.upperBound)
        return .success(
            Banner(id: id, title: title, body: Self.text(body, Self.bodyLimit), buttons: made, sound: sound, seconds: wait, isCall: isCall))
    }

    /// A banner that looks like a call: who calls, the reason, Decline and Accept as the red and
    /// green phone buttons, the ring, 30 s. Accept opens the call's page (`BannerState.callPage`).
    public static func call(id: Int, from: String, reason: String, page: URL) -> Banner {
        Banner(
            id: id, title: line(from, titleLimit), body: text(reason, 160),
            buttons: [
                BannerButton(label: "Decline", style: .decline, symbol: "phone.down.fill"),
                BannerButton(label: "Accept", style: .accept, symbol: "phone.fill", open: page),
            ],
            sound: .ring, seconds: defaultSeconds, isCall: true
        )
    }

    public init(id: Int, title: String, body: String, buttons: [BannerButton], sound: BannerSound, seconds: TimeInterval, isCall: Bool) {
        self.id = id
        self.title = title
        self.body = body
        self.buttons = buttons
        self.sound = sound
        self.seconds = seconds
        self.isCall = isCall
    }

    /// One line, cut to `limit`.
    static func line(_ text: String?, _ limit: Int) -> String {
        String((text ?? "").split(whereSeparator: \.isNewline).joined(separator: " ").trimmingCharacters(in: .whitespaces).prefix(limit))
    }

    /// Text with its line breaks as spaces (the banner wraps it), cut to `limit`.
    static func text(_ text: String?, _ limit: Int) -> String { line(text, limit) }
}

/// How a banner ended, as the caller reads it.
public enum BannerOutcome: Equatable, Sendable {
    case pressed(String)
    case noAnswer
    /// Escape, or the person closed it in the panel.
    case dismissed
    /// A newer banner came while this one showed.
    case replaced
    /// A call shows: a plain banner does not replace it. Nothing showed.
    case busy

    /// `why` in the bridge's answer.
    public var why: String? {
        switch self {
        case .pressed: return nil
        case .noAnswer: return "no answer"
        case .dismissed: return "dismissed"
        case .replaced: return "replaced"
        case .busy: return "busy"
        }
    }
}

public enum BannerPhase: Equatable, Sendable {
    case idle
    case showing(Banner)
    case ended(Banner, BannerOutcome)
}

public enum BannerEvent: Equatable, Sendable {
    case requested(Banner)
    /// The person pressed button `index`.
    case pressed(id: Int, index: Int)
    case dismissed(id: Int)
    case timedOut(id: Int)
}

public enum BannerEffect: Equatable, Sendable {
    /// The banner, its sound and the mark in the menu bar.
    case show(Banner)
    case hide
    /// `timedOut(id)` after `seconds`.
    case startTimer(id: Int, seconds: TimeInterval)
    case open(URL)
    /// The caller of banner `id` gets its answer.
    case answer(id: Int, BannerOutcome)
}

/// THE BANNERS OF THIS MAC: one at a time. A newer banner replaces the one showing, except that a
/// plain banner does not replace a call (it is refused as `busy`). Each ends by itself after its
/// `seconds` as "no answer", and at most `perMinute` begin in a minute. Every pair of phase and
/// event has a defined result; an event for a banner that is not the one showing changes nothing.
public struct BannerState: Equatable, Sendable {
    public static let perMinute = 6

    public private(set) var phase: BannerPhase = .idle
    /// When the banners of the last minute began.
    private var recent: [Date] = []

    public init() {}

    public var showing: Banner? {
        if case .showing(let banner) = phase { return banner }
        return nil
    }

    /// Nil when a banner may begin now; else the words of the refusal. One that may begin counts.
    public mutating func admit(now: Date) -> String? {
        recent = recent.filter { now.timeIntervalSince($0) < 60 }
        guard recent.count < Self.perMinute else {
            return "This Mac showed \(Self.perMinute) banners in the last minute, the most it allows. Try again later, or say it in the chat."
        }
        recent.append(now)
        return nil
    }

    public mutating func handle(_ event: BannerEvent) -> [BannerEffect] {
        switch (phase, event) {
        case (.showing(let old), .requested(let banner)) where old.isCall && !banner.isCall:
            return [.answer(id: banner.id, .busy)]
        case (.showing(let old), .requested(let banner)):
            phase = .showing(banner)
            return [.answer(id: old.id, .replaced), .show(banner), .startTimer(id: banner.id, seconds: banner.seconds)]
        case (_, .requested(let banner)):
            phase = .showing(banner)
            return [.show(banner), .startTimer(id: banner.id, seconds: banner.seconds)]
        case (.showing(let banner), .pressed(let id, let index)) where id == banner.id && banner.buttons.indices.contains(index):
            let button = banner.buttons[index]
            phase = .ended(banner, .pressed(button.label))
            return [.hide] + (button.open.map { [.open($0)] } ?? []) + [.answer(id: id, .pressed(button.label))]
        case (.showing(let banner), .dismissed(let id)) where id == banner.id:
            phase = .ended(banner, .dismissed)
            return [.hide, .answer(id: id, .dismissed)]
        case (.showing(let banner), .timedOut(let id)) where id == banner.id:
            phase = .ended(banner, .noAnswer)
            return [.hide, .answer(id: id, .noAnswer)]
        default:
            return []
        }
    }

    /// The page of a call, for `call.ring`: the given one, checked, or, with none, the agent's page
    /// in the mind's Dash, which joins the call on arrival, muted (`call=join`).
    public static func callPage(_ given: String?, agent: String, mind: String) -> Result<URL, BannerRefusal> {
        guard agent.hasPrefix("/") else {
            return .failure(BannerRefusal("ring needs the agent's path, such as /agents/meet/…"))
        }
        if let given, !given.isEmpty { return page(given, mind: mind) }
        guard let zone = zone(of: mind) else { return .failure(noZone(mind)) }
        // the Dash's address of one agent, `/agents<agent's path>` (packages/ui `dash-paths.ts`), and
        // its join on arrival. The Dash reads `?contextPath=` only for a path a URL cannot carry.
        var page = URLComponents()
        page.scheme = "https"
        page.host = "dash.\(zone)"
        page.path = "/agents" + agent
        page.queryItems = [URLQueryItem(name: "call", value: "join")]
        return page.url.map { .success($0) } ?? .failure(BannerRefusal("No page could be made for \(agent)."))
    }

    /// A page a press may open: https, with no user or port, on the mind's zone or a subdomain of
    /// it, never any other origin. `mind` is the mind's address as the lend says it.
    public static func page(_ given: String, mind: String) -> Result<URL, BannerRefusal> {
        guard let zone = zone(of: mind) else { return .failure(noZone(mind)) }
        guard let page = URLComponents(string: given), page.scheme?.lowercased() == "https",
            let host = page.host?.lowercased(), !host.isEmpty,
            page.user == nil, page.password == nil, page.port == nil || page.port == 443,
            let url = page.url
        else {
            return .failure(BannerRefusal("A page to open must be an https address with no user or port; \(given.prefix(200)) is not."))
        }
        guard host == zone || host.hasSuffix(".\(zone)") else {
            return .failure(BannerRefusal("This Mac opens only pages of the mind it is lent to (\(zone) and its subdomains), not \(host)."))
        }
        return .success(url)
    }

    /// The zone of the mind's address: without a leading `iterate.` when two labels are left
    /// (`iterate.example.com` has its apps on `*.example.com`; `iterate.com` is its own zone). Nil
    /// for a zone of one label, which would let any site of that top-level domain in.
    static func zone(of mind: String) -> String? {
        let address = mind.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
        let rest = address.hasPrefix("iterate.") ? String(address.dropFirst("iterate.".count)) : ""
        let zone = rest.contains(".") ? rest : address
        guard zone.contains("."), !zone.contains("/"), !zone.contains("@") else { return nil }
        return zone
    }

    private static func noZone(_ mind: String) -> BannerRefusal {
        BannerRefusal("This Mac is lent to no mind whose pages it can check (\(mind.isEmpty ? "none" : mind)): it opens nothing.")
    }
}

public struct BannerRefusal: Error, Equatable, Sendable {
    public let words: String

    public init(_ words: String) {
        self.words = words
    }
}
