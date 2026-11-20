import AppKit
import VoiceMeetCore

/// The iterate mark for the menu bar, drawn from the logo's own vector paths
/// (`packages/ui/src/components/iterate-logo.svg`), so the package needs no image file for it.
enum IterateIcon {
    /// The two paths of the logo's "i", in the logo's coordinates (500 × 500, y down).
    private static let paths = [
        "M264.649 170.149H289.821L286.092 186.904L276.303 233.444L270.709 259.971L263.717 293.015L258.124 320.008L251.131 352.586L249.267 364.687V371.668L249.733 372.133H253.462L259.522 369.806L266.048 365.617L275.371 357.24L282.829 349.328L286.558 345.14L288.888 346.071L294.948 350.725L308 360.498L307.068 362.36L303.339 367.944L296.813 376.322L291.685 382.837L286.558 388.422L282.363 393.076L275.837 399.592L272.108 402.849L267.446 406.573L262.785 409.83L256.725 413.554L247.869 417.742L238.08 420.535L231.554 421H224.096L216.637 420.069L211.51 418.673L206.382 416.811L201.255 413.088L196.594 408.434L192.865 400.988L191.466 394.938L191 389.818V383.768L193.797 365.152L199.857 335.832L207.315 301.392L224.096 223.205L225.028 216.224V206.916L224.562 205.054L222.231 204.123L219.434 203.193L206.382 203.658L196.127 204.589H193.331V178.526L194.263 175.734L258.59 170.615L264.649 170.149Z",
        "M264.649 78H268.844L275.836 78.9308L282.362 80.7924L287.49 83.5848L292.151 87.7734L295.414 92.8928L297.278 96.616L299.143 105.924L299.609 113.836L299.143 118.49L298.677 122.213L296.812 128.729L293.549 134.779L290.286 138.502L286.091 141.76L282.362 143.621L278.167 145.018L274.438 145.948L267.912 146.414H260.92L254.394 145.483L249.267 144.087L244.139 141.294L239.944 138.037L236.681 133.383L233.884 127.332L232.486 121.282L232.02 117.559V108.716L232.952 101.735L234.816 95.6852L237.613 90.1004L240.41 86.3772L246.936 82.1886L252.529 79.8616L259.522 78.4654L264.649 78Z",
    ]

    /// The mark's height in the menu bar, in points. The bar is 24 points high; at 16 the mark had
    /// too little room above and below.
    private static let menuBarHeight: CGFloat = 13

    /// Every mark is this wide, so the menu bar does not shift when the mark changes.
    private static let menuBarWidth: CGFloat = 11

    /// A template image: the system draws it light or dark with the menu bar.
    static let plain = mark(height: menuBarHeight, color: nil)
    /// The lend at a glance, as Apple's own items show a state: the plain mark while lent; dimmed
    /// while it connects; dimmed with a slash through it while it is not lent (as `wifi.slash`
    /// and `mic.slash` do). All are template images, readable in a light and a dark bar.
    static let connecting = mark(height: menuBarHeight, color: nil, alpha: 0.4)
    static let down = mark(height: menuBarHeight, color: nil, alpha: 0.4, slash: true)

    static func lend(_ glance: LendGlance) -> NSImage {
        switch glance {
        case .live: return plain
        case .connecting: return connecting
        case .down: return down
        }
    }
    /// While the screen is shared.
    static let red = mark(height: menuBarHeight, color: .systemRed)
    /// While only the microphone is on.
    static let orange = mark(height: menuBarHeight, color: .systemOrange)
    /// While a banner shows, a call's among them.
    static let green = mark(height: menuBarHeight, color: .systemGreen)

    static func mark(height: CGFloat, color: NSColor?, alpha: CGFloat = 1, slash: Bool = false) -> NSImage {
        let glyph = glyph()
        let bounds = glyph.bounds
        let scale = height / bounds.height
        let width = max(menuBarWidth, ceil(bounds.width * scale))
        var transform = AffineTransform(translationByX: (width - bounds.width * scale) / 2, byY: 0)
        transform.scale(scale)
        transform.translate(x: -bounds.minX, y: -bounds.minY)
        glyph.transform(using: transform)
        // A flipped image has y down, as the logo has.
        let image = NSImage(size: NSSize(width: width, height: height), flipped: true) { _ in
            let ink = color ?? .black
            ink.withAlphaComponent(alpha).setFill()
            glyph.fill()
            if slash {
                // from the top left to the bottom right, with a gap cut on each side of it
                let line = NSBezierPath()
                line.move(to: NSPoint(x: 1, y: 1.5))
                line.line(to: NSPoint(x: width - 1, y: height - 1.5))
                line.lineCapStyle = .round
                NSGraphicsContext.current?.compositingOperation = .clear
                line.lineWidth = 3.2
                line.stroke()
                NSGraphicsContext.current?.compositingOperation = .sourceOver
                ink.setStroke()
                line.lineWidth = 1.3
                line.stroke()
            }
            return true
        }
        image.isTemplate = color == nil
        return image
    }

    /// Each lend mark on a light and a dark menu bar, as the system tints a template image, 8 times
    /// its size, one PNG each in `folder` (`--render-icons <folder>`), for a look with no Mac bar.
    static func render(to folder: URL) -> Bool {
        let zoom: CGFloat = 8
        let bar = NSSize(width: 40, height: 24)
        for glance in LendGlance.allCases {
            for (look, background, ink) in [("light", NSColor(white: 0.93, alpha: 1), NSColor.black), ("dark", NSColor(white: 0.16, alpha: 1), NSColor.white)] {
                let mark = lend(glance)
                guard let bitmap = NSBitmapImageRep(
                    bitmapDataPlanes: nil, pixelsWide: Int(bar.width * zoom), pixelsHigh: Int(bar.height * zoom), bitsPerSample: 8,
                    samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)
                else { return false }
                NSGraphicsContext.saveGraphicsState()
                NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
                background.setFill()
                NSRect(x: 0, y: 0, width: bar.width * zoom, height: bar.height * zoom).fill()
                // a template image: its alpha, in the bar's ink
                let size = NSSize(width: mark.size.width * zoom, height: mark.size.height * zoom)
                let place = NSRect(x: (bar.width * zoom - size.width) / 2, y: (bar.height * zoom - size.height) / 2, width: size.width, height: size.height)
                let tinted = NSImage(size: size, flipped: false) { rect in
                    mark.draw(in: rect)
                    ink.setFill()
                    rect.fill(using: .sourceAtop)
                    return true
                }
                tinted.draw(in: place)
                NSGraphicsContext.restoreGraphicsState()
                guard let png = bitmap.representation(using: .png, properties: [:]),
                    (try? png.write(to: folder.appendingPathComponent("mark-\(glance.rawValue)-\(look).png"))) != nil
                else { return false }
            }
        }
        return true
    }

    static func glyph() -> NSBezierPath {
        let glyph = NSBezierPath()
        for path in paths {
            glyph.append(read(path))
        }
        return glyph
    }

    /// Reads a path that has only the absolute commands M, L, H, V and Z, as the logo's paths have.
    private static func read(_ data: String) -> NSBezierPath {
        let path = NSBezierPath()
        let scanner = Scanner(string: data)
        var command: Character = "M"
        var point = NSPoint.zero
        while !scanner.isAtEnd {
            if let letter = scanner.scanCharacters(from: .letters)?.last {
                command = letter
            }
            switch command {
            case "M", "L":
                guard let x = scanner.scanDouble(), let y = scanner.scanDouble() else { return path }
                point = NSPoint(x: x, y: y)
                if command == "M" {
                    path.move(to: point)
                    command = "L"
                } else {
                    path.line(to: point)
                }
            case "H":
                guard let x = scanner.scanDouble() else { return path }
                point.x = x
                path.line(to: point)
            case "V":
                guard let y = scanner.scanDouble() else { return path }
                point.y = y
                path.line(to: point)
            default:
                path.close()
                return path
            }
        }
        return path
    }
}
