import AppIntents
import SwiftUI

// ---- the stats you can pick in Edit Widget -------------------------------------------------------
enum Metric: String, AppEnum, CaseIterable {
    case heart, restingHR, hrv, sleep, sitting, spo2, skinTemp, breathing, zoneMinutes, activeMinutes, distance, calories, vo2max

    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Stat")
    static var caseDisplayRepresentations: [Metric: DisplayRepresentation] = [
        .heart: "Heart rate",
        .restingHR: "Resting heart rate",
        .hrv: "Heart rate variability",
        .sleep: "Sleep",
        .sitting: "Time sitting",
        .spo2: "Blood oxygen",
        .skinTemp: "Skin temperature",
        .breathing: "Breathing rate",
        .zoneMinutes: "Active Zone Minutes",
        .activeMinutes: "Active minutes",
        .distance: "Distance",
        .calories: "Calories",
        .vo2max: "Cardio fitness (VO₂ max)",
    ]
}

struct StepsConfig: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Steps"
    static var description = IntentDescription("Pick the two stats shown beside the steps ring (medium size).")
    @Parameter(title: "First stat", default: .heart) var first: Metric
    @Parameter(title: "Second stat", default: .sleep) var second: Metric
}

struct StatConfig: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Stat"
    static var description = IntentDescription("Pick the stat to show. The medium size also shows a second one.")
    @Parameter(title: "Stat", default: .spo2) var metric: Metric
    @Parameter(title: "Second stat (medium)", default: .skinTemp) var second: Metric
}

// ---- how each stat reads ------------------------------------------------------------------------
struct StatDisplay {
    enum Status { case normal, high, low, learning }
    var title: String
    var icon: String
    var color: Color
    var value: String?          // nil shows "—"
    var unit: String?
    var sub: String
    var status: Status?
}

func fmt(_ v: Double, _ dp: Int) -> String { v.formatted(.number.precision(.fractionLength(dp))) }
func signed(_ v: Double, _ dp: Int) -> String {
    (v > 0.05 ? "+" : v < -0.05 ? "−" : "±") + fmt(abs(v), dp)
}

func stat(_ m: Metric, _ e: AirEntry) -> StatDisplay {
    let p = e.payload
    let a = p?.activity, v = p?.vitals
    switch m {
    case .heart:
        // Resting HR lands after the first night; until then the latest 5-min average leads.
        let h = p?.heart
        let at = parseISO(h?.latestAt)
        let range = (h?.min).flatMap { lo in (h?.max).map { "today \(number(lo))–\(number($0))" } }
        var s = StatDisplay(title: "Heart", icon: "heart.fill", color: Palette.pink, value: nil, unit: nil, sub: "no readings yet today")
        if let r = h?.resting {
            s.value = number(r); s.unit = "bpm resting"
            s.sub = h?.latest.map { l in "now \(number(l))" + (at.map { " · \(clock($0))" } ?? "") } ?? range ?? s.sub
        } else if let l = h?.latest {
            s.value = number(l); s.unit = at.map { "bpm · \(clock($0))" } ?? "bpm"
            s.sub = range ?? s.sub
        }
        return s
    case .sleep:
        var s = StatDisplay(title: "Sleep", icon: "moon.zzz.fill", color: Palette.lavender, value: nil, unit: nil, sub: "no night recorded yet")
        if let sl = p?.sleep, let mins = sl.minutes {
            s.value = duration(mins)
            let when = sl.date == (p?.date ?? localDay()) ? "last night" : sl.date.map { weekday($0, short: true) } ?? "last night"
            if let a = parseISO(sl.start), let b = parseISO(sl.end) {
                s.sub = "\(when) · \(clock(a))–\(clock(b))"
            } else {
                s.sub = when
            }
        }
        return s
    case .sitting:
        return StatDisplay(title: "Sitting", icon: "chair.lounge.fill", color: Palette.butter,
                           value: a?.sittingMin.map(duration), unit: nil,
                           sub: a?.sittingLongestMin.map { "longest stretch \(duration($0))" } ?? "counted while you're awake")
    case .zoneMinutes:
        let week = a?.azmWeek.map { "\(number($0)) of \(number(a?.azmGoal ?? 150)) this week" } ?? "this week: —"
        return StatDisplay(title: "Zone min", icon: "bolt.heart.fill", color: Palette.lavender,
                           value: number(a?.azm ?? 0), unit: "today", sub: week)
    case .activeMinutes:
        return StatDisplay(title: "Active", icon: "figure.run", color: Palette.peach,
                           value: a?.activeMin.map(number), unit: "min",
                           sub: "goal \(number(a?.activeGoal ?? 30)) min a day")
    case .distance:
        return StatDisplay(title: "Distance", icon: "map.fill", color: Palette.sky,
                           value: a?.distance.map { fmt($0, 2) }, unit: a?.distanceUnit ?? "km", sub: "today")
    case .calories:
        return StatDisplay(title: "Calories", icon: "flame.fill", color: Palette.peach,
                           value: a?.calories.map(number), unit: "kcal", sub: "burned today")
    case .restingHR:
        return vital(v?.rhr, title: "Resting HR", icon: "heart.circle.fill", color: Palette.pink)
    case .hrv:
        return vital(v?.hrv, title: "HRV", icon: "waveform.path.ecg", color: Palette.mint)
    case .spo2:
        return vital(v?.spo2, title: "Blood oxygen", icon: "drop.fill", color: Palette.pink)
    case .skinTemp:
        return vital(v?.skinTemp, title: "Skin temp", icon: "thermometer.medium", color: Palette.peach, signedValue: true)
    case .breathing:
        return vital(v?.breathing, title: "Breathing", icon: "lungs.fill", color: Palette.sky)
    case .vo2max:
        let x = v?.vo2max
        return StatDisplay(title: "VO₂ max", icon: "speedometer", color: Palette.mint,
                           value: x?.value.map { fmt($0, 0) }, unit: x?.value != nil ? "ml/kg/min" : nil,
                           sub: x?.value != nil ? "cardio fitness" : "needs runs with GPS")
    }
}

/// Overnight readings: value plus where it sits against your own normal, as the dashboard shows it.
private func vital(_ x: Payload.Vital?, title: String, icon: String, color: Color, signedValue: Bool = false) -> StatDisplay {
    var s = StatDisplay(title: title, icon: icon, color: color, value: nil, unit: nil, sub: "appears after a night of sleep")
    guard let x, let value = x.value else { return s }
    let dp = x.dp ?? 0
    let show = { (v: Double) in signedValue ? signed(v, dp) : fmt(v, dp) }
    s.value = show(value)
    s.unit = signedValue ? "\(x.unit ?? "°") vs baseline" : x.unit
    switch x.status {
    case "normal"?: s.status = .normal
    case "high"?: s.status = .high
    case "low"?: s.status = .low
    default: s.status = .learning
    }
    if let n = x.normal, let b = x.band {
        s.sub = "your normal \(show(n - b)) to \(show(n + b))"
    } else {
        s.sub = "learning your normal · \(x.nights ?? 0) of 3 nights"
    }
    return s
}
