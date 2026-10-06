import SwiftUI
import WidgetKit

// ---- colors: the dashboard's palette -------------------------------------------------------------
enum Palette {
    static let pink = rgb(0xee, 0x8b, 0xb0), peach = rgb(0xf4, 0xac, 0x68), lavender = rgb(0xa9, 0x9d, 0xf7)
    static let mint = rgb(0x5f, 0xc7, 0x95), sky = rgb(0x6a, 0xa6, 0xec), butter = rgb(0xee, 0xc5, 0x5a)
    static func rgb(_ r: Double, _ g: Double, _ b: Double) -> Color { Color(red: r / 255, green: g / 255, blue: b / 255) }
}

private let ringStops: [(Double, Double, Double)] = [(0xee, 0x8b, 0xb0), (0xf4, 0xac, 0x68), (0xa9, 0x9d, 0xf7)]  // pink → peach → lavender

/// Color at position t (0…1) along the full goal, like the dashboard's ring.
func ringColor(_ t: Double) -> Color {
    let x = min(max(t, 0), 1) * Double(ringStops.count - 1)
    let i = min(Int(x), ringStops.count - 2), f = x - Double(i)
    let a = ringStops[i], b = ringStops[i + 1]
    return Palette.rgb(a.0 + (b.0 - a.0) * f, a.1 + (b.1 - a.1) * f, a.2 + (b.2 - a.2) * f)
}

// ---- formatting -----------------------------------------------------------------------------
func number(_ v: Double?) -> String { v.map { Int($0.rounded()).formatted() } ?? "—" }
func clock(_ d: Date) -> String { d.formatted(date: .omitted, time: .shortened) }
func duration(_ minutes: Double) -> String {
    let m = Int(minutes.rounded())
    return "\(m / 60)h \(String(format: "%02d", m % 60))m"
}
func parseISO(_ s: String?) -> Date? {
    guard let s else { return nil }
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let d = f.date(from: s) { return d }
    f.formatOptions = [.withInternetDateTime]
    return f.date(from: s)
}
func localDay(_ d: Date = Date()) -> String {
    let c = Calendar.current.dateComponents([.year, .month, .day], from: d)
    return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
}
func weekday(_ iso: String, short: Bool = false) -> String {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd"
    guard let d = f.date(from: iso) else { return iso }
    return d.formatted(.dateTime.weekday(short ? .abbreviated : .wide))
}
func ago(_ d: Date) -> String {
    let m = Int(Date().timeIntervalSince(d) / 60)
    return m < 60 ? "\(m) min ago" : m < 48 * 60 ? "\(m / 60)h ago" : "\(m / 1440) days ago"
}

// ---- steps and what's wrong, worked out once per entry -------------------------------------------
struct Display {
    var steps = "—", goal = "10,000", fraction = 0.0, met = false, day = "Today"
    var notice: String?, hint: String?

    init(_ e: AirEntry) {
        notice = Display.notice(e)
        switch e.problem {
        case .offline?, .server?: hint = "Start the dashboard, then click here."
        case .badKey?, .noKey?: hint = "Rebuild the widget (see macwidget/README.md)."
        case nil: hint = nil
        }
        guard let p = e.payload else { return }
        let goalSteps = p.steps?.goal ?? 10000
        steps = number(p.steps?.value)
        goal = number(goalSteps)
        fraction = (p.steps?.value ?? 0) / max(goalSteps, 1)
        met = (p.steps?.value ?? 0) >= goalSteps
        if let d = p.date, d != localDay() { day = weekday(d) }
    }

    private static func notice(_ e: AirEntry) -> String? {
        let since = e.payload != nil ? e.fetchedAt.map { " · as of \(clock($0))" } ?? "" : ""
        switch e.problem {
        case .offline: return (e.payload != nil ? "Dashboard offline" : "Dashboard isn't running") + since
        case .badKey: return "Widget key changed" + since
        case .noKey: return "Widget key missing"
        case .server: return "Dashboard error" + since
        case nil: break
        }
        guard let sync = e.payload?.sync else { return nil }
        if sync.googleConnected == false { return "Google login expired" }
        if let exp = sync.loginExpiresAt, Date(timeIntervalSince1970: exp).timeIntervalSinceNow < 86400 {
            return "Google login expires today"
        }
        if let air = parseISO(sync.airLastSync), Date().timeIntervalSince(air) > airStaleAfter {
            return "Air last synced \(ago(air))"
        }
        return nil
    }
}

// ---- ring ----------------------------------------------------------------------------------
struct StepsRing: View {
    let fraction: Double
    let lineWidth: CGFloat

    var body: some View {
        GeometryReader { g in
            let side = min(g.size.width, g.size.height), r = (side - lineWidth) / 2
            let f = min(max(fraction, 0), 1), angle = 2 * Double.pi * f
            ZStack {
                Circle().inset(by: lineWidth / 2).stroke(.quaternary, lineWidth: lineWidth)
                if f > 0 {
                    Group {
                        Circle().inset(by: lineWidth / 2).trim(from: 0, to: f)
                            .stroke(AngularGradient(colors: ringStops.indices.map { ringColor(Double($0) / Double(ringStops.count - 1)) },
                                                    center: .center),
                                    style: StrokeStyle(lineWidth: lineWidth, lineCap: .butt))
                            .rotationEffect(.degrees(-90))
                        Circle().fill(ringColor(0)).frame(width: lineWidth, height: lineWidth).offset(y: -r)
                        Circle().fill(ringColor(f)).frame(width: lineWidth, height: lineWidth)
                            .offset(x: r * sin(angle), y: -r * cos(angle))
                    }
                    .widgetAccentable()
                }
            }
            .frame(width: side, height: side)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

/// Ring with the step count in the middle.
struct RingWithSteps: View {
    let d: Display
    let lineWidth: CGFloat
    var numberSize: CGFloat = 24

    var body: some View {
        ZStack {
            StepsRing(fraction: d.fraction, lineWidth: lineWidth)
            VStack(spacing: 1) {
                Text(d.met ? "Goal met" : d.day)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(d.met ? AnyShapeStyle(Palette.mint) : AnyShapeStyle(.secondary))
                Text(d.steps).font(.system(size: numberSize, weight: .regular)).monospacedDigit()
                    .minimumScaleFactor(0.6).lineLimit(1)
                Text("of \(d.goal)").font(.system(size: 11)).foregroundStyle(.secondary)
            }
            .padding(.horizontal, lineWidth + 6)
        }
    }
}

// ---- pieces -----------------------------------------------------------------------------------
struct StatusChip: View {
    let status: StatDisplay.Status

    var body: some View {
        let (text, color): (String, Color) = switch status {
        case .normal: ("Normal", Palette.mint)
        case .high: ("High", .orange)
        case .low: ("Low", .orange)
        case .learning: ("Learning", .secondary)
        }
        Text(text).font(.system(size: 10, weight: .semibold)).foregroundStyle(color)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(Capsule().fill(color.opacity(0.15)))
    }
}

/// Compact stat: label, value, one line of context. Used beside the ring and in the Overview grid.
struct StatRow: View {
    let s: StatDisplay
    var valueSize: CGFloat = 20

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 5) {
                Label(s.title.uppercased(), systemImage: s.icon)
                    .font(.system(size: 10.5, weight: .semibold)).foregroundStyle(s.color)
                    .lineLimit(1).widgetAccentable()
                if let st = s.status, st != .normal { StatusChip(status: st) }
            }
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(s.value ?? "—").font(.system(size: valueSize, weight: .regular)).monospacedDigit()
                if s.value != nil, let unit = s.unit { Text(unit).font(.system(size: 11)).foregroundStyle(.secondary) }
            }
            .lineLimit(1).minimumScaleFactor(0.7)
            Text(s.sub).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.85)
        }
    }
}

/// One stat filling a small tile, laid out like Apple's single-number widgets.
struct StatTile: View {
    let s: StatDisplay

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center) {
                Image(systemName: s.icon).font(.system(size: 17, weight: .semibold)).foregroundStyle(s.color).widgetAccentable()
                Spacer(minLength: 4)
                if let st = s.status { StatusChip(status: st) }
            }
            Text(s.title).font(.system(size: 13, weight: .semibold)).padding(.top, 6)
            Spacer(minLength: 2)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(s.value ?? "—").font(.system(size: 34, weight: .regular)).monospacedDigit()
                if s.value != nil, let unit = s.unit { Text(unit).font(.system(size: 12, weight: .medium)).foregroundStyle(.secondary) }
            }
            .lineLimit(1).minimumScaleFactor(0.5)
            Text(s.sub).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(2).minimumScaleFactor(0.85)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

/// One line: icon, value with unit, and a short label. For the Overview's activity column.
struct MiniRow: View {
    let s: StatDisplay

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: s.icon).font(.system(size: 11, weight: .semibold)).foregroundStyle(s.color)
                .frame(width: 14).widgetAccentable()
            Text(s.value ?? "—").font(.system(size: 16, weight: .regular)).monospacedDigit().fixedSize()
            if s.value != nil, let unit = s.unit, unit != "today" {
                Text(unit).font(.system(size: 11)).foregroundStyle(.secondary).fixedSize()
            }
            Text(s.title.lowercased()).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
        }
    }
}

struct NoticeLine: View {
    let text: String

    var body: some View {
        Label(text, systemImage: "exclamationmark.circle.fill")
            .font(.system(size: 10.5, weight: .medium)).foregroundStyle(.orange).lineLimit(1)
    }
}

/// Nothing to show yet: say why.
struct MessageView: View {
    let d: Display

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Fitbit Air", systemImage: "figure.walk").font(.system(size: 13, weight: .semibold))
            Spacer(minLength: 0)
            Text(d.notice ?? "Loading…").font(.system(size: 13, weight: .medium))
            if let h = d.hint { Text(h).font(.system(size: 11)).foregroundStyle(.secondary) }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

// ---- Steps widget -------------------------------------------------------------------------------
struct StepsView: View {
    let entry: AirEntry
    let stats: [Metric]
    @Environment(\.widgetFamily) private var family

    var body: some View {
        let d = Display(entry)
        if entry.payload == nil {
            MessageView(d: d)
        } else if family == .systemSmall {
            StepsSmall(d: d)
        } else {
            StepsMedium(d: d, stats: stats.map { stat($0, entry) })
        }
    }
}

/// Like Apple's battery widget: ring top-left, the big number below.
struct StepsSmall: View {
    let d: Display

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                ZStack {
                    StepsRing(fraction: d.fraction, lineWidth: 7)
                    Image(systemName: "figure.walk").font(.system(size: 19, weight: .semibold)).foregroundStyle(.secondary)
                }
                .frame(width: 58, height: 58)
                Spacer()
                if d.notice != nil {
                    Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.orange)
                }
            }
            Spacer(minLength: 4)
            Text(d.steps)
                .font(.system(size: 38, weight: .regular))
                .monospacedDigit().minimumScaleFactor(0.6).lineLimit(1)
            Text(d.met ? "Goal met · \(d.goal)" : "of \(d.goal) steps")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(d.met ? AnyShapeStyle(Palette.mint) : AnyShapeStyle(.secondary))
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

/// Ring with today's steps, then the two stats you picked.
struct StepsMedium: View {
    let d: Display
    let stats: [StatDisplay]

    var body: some View {
        HStack(spacing: 18) {
            RingWithSteps(d: d, lineWidth: 11).frame(width: 122, height: 122)
            VStack(alignment: .leading, spacing: 10) {
                ForEach(stats.indices, id: \.self) { StatRow(s: stats[$0]) }
                if let n = d.notice { NoticeLine(text: n) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// ---- Stat widget --------------------------------------------------------------------------------
struct StatWidgetView: View {
    let entry: AirEntry
    let metrics: [Metric]
    @Environment(\.widgetFamily) private var family

    var body: some View {
        let d = Display(entry)
        if entry.payload == nil {
            MessageView(d: d)
        } else if family == .systemSmall {
            StatTile(s: stat(metrics[0], entry))
                .overlay(alignment: .bottomTrailing) {
                    if d.notice != nil { Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.orange).font(.system(size: 11)) }
                }
        } else {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 16) {
                    StatTile(s: stat(metrics[0], entry))
                    Divider()
                    StatTile(s: stat(metrics[1], entry))
                }
                if let n = d.notice { NoticeLine(text: n) }
            }
        }
    }
}

// ---- Overview widget (large) ----------------------------------------------------------------------
struct OverviewView: View {
    let entry: AirEntry
    private let grid: [Metric] = [.heart, .sleep, .sitting, .spo2, .skinTemp, .hrv]

    var body: some View {
        let d = Display(entry)
        if entry.payload == nil {
            MessageView(d: d)
        } else {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 16) {
                    RingWithSteps(d: d, lineWidth: 11, numberSize: 24).frame(width: 112, height: 112)
                    VStack(alignment: .leading, spacing: 9) {
                        ForEach([Metric.distance, .calories, .activeMinutes, .zoneMinutes], id: \.self) { MiniRow(s: stat($0, entry)) }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                Divider()
                Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 10) {
                    ForEach(0..<3, id: \.self) { row in
                        GridRow {
                            StatRow(s: stat(grid[row * 2], entry), valueSize: 18)
                            StatRow(s: stat(grid[row * 2 + 1], entry), valueSize: 18)
                        }
                    }
                }
                Spacer(minLength: 0)
                if let n = d.notice { NoticeLine(text: n) }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}
