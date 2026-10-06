// Fitbit Air — native macOS widgets. Read today's steps, heart rate, sleep and overnight vitals from the
// local dashboard (server.py) through GET /api/widget.
import AppIntents
import SwiftUI
import WidgetKit

let dashboardURL = URL(string: "http://127.0.0.1:8787")!  // change if you run the dashboard with DASH_PORT
let refreshEvery: TimeInterval = 15 * 60                  // macOS may stretch this to save power
let airStaleAfter: TimeInterval = 3 * 3600                // same nudge threshold as the dashboard header

// ---- what /api/widget returns (only the fields the widgets show) ------------------------------
struct Payload: Codable {
    struct Steps: Codable { var value: Double?; var goal: Double? }
    struct Heart: Codable { var resting: Double?; var latest: Double?; var latestAt: String?; var min: Double?; var max: Double? }
    struct Sleep: Codable { var minutes: Double?; var date: String?; var start: String?; var end: String? }
    struct Activity: Codable {
        var sittingMin: Double?; var sittingLongestMin: Double?
        var azm: Double?; var azmWeek: Double?; var azmGoal: Double?
        var activeMin: Double?; var activeGoal: Double?
        var distance: Double?; var distanceUnit: String?; var calories: Double?
    }
    /// An overnight reading judged against your own 30-day normal (status: normal / high / low / learning).
    struct Vital: Codable {
        var value: Double?; var unit: String?; var dp: Int?; var date: String?
        var normal: Double?; var band: Double?; var status: String?; var nights: Int?
    }
    struct Vitals: Codable { var rhr, hrv, breathing, spo2, skinTemp, vo2max: Vital? }
    struct Sync: Codable { var airLastSync: String?; var googleConnected: Bool?; var loginExpiresAt: Double? }
    var date: String?
    var steps: Steps?
    var heart: Heart?
    var sleep: Sleep?
    var activity: Activity?
    var vitals: Vitals?
    var sync: Sync?
}

enum Problem { case offline, badKey, noKey, server }

struct AirEntry: TimelineEntry {
    let date: Date
    let payload: Payload?
    let problem: Problem?
    let fetchedAt: Date?   // when `payload` was fetched; older than `date` when it came from the cache
}

// ---- fetching: key from the widget bundle, last good reading cached in the widget's sandbox --------
enum Loader {
    static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }()
    static var cacheURL: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("last-widget.json")
    }

    /// Copied from data/widget_secret into the bundle at build time (mode 600).
    static func key() -> String? {
        guard let url = Bundle.main.url(forResource: "widget_secret", withExtension: nil),
              let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        let key = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return key.isEmpty ? nil : key
    }

    static func load() async -> AirEntry {
        guard let key = key() else { return fallback(.noKey) }
        var req = URLRequest(url: dashboardURL.appendingPathComponent("api/widget"),
                             cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 8)
        req.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            switch (resp as? HTTPURLResponse)?.statusCode {
            case 200:
                guard let payload = try? decoder.decode(Payload.self, from: data) else { return fallback(.server) }
                try? FileManager.default.createDirectory(at: cacheURL.deletingLastPathComponent(), withIntermediateDirectories: true)
                try? data.write(to: cacheURL, options: .atomic)
                let now = Date()
                return AirEntry(date: now, payload: payload, problem: nil, fetchedAt: now)
            case 401: return fallback(.badKey)
            default: return fallback(.server)
            }
        } catch {
            return fallback(.offline)
        }
    }

    /// Keep showing the last good reading, flagged with what went wrong.
    static func fallback(_ problem: Problem) -> AirEntry {
        guard let data = try? Data(contentsOf: cacheURL),
              let payload = try? decoder.decode(Payload.self, from: data) else {
            return AirEntry(date: Date(), payload: nil, problem: problem, fetchedAt: nil)
        }
        let at = (try? FileManager.default.attributesOfItem(atPath: cacheURL.path))?[.modificationDate] as? Date
        return AirEntry(date: Date(), payload: payload, problem: problem, fetchedAt: at)
    }
}

extension AirEntry {
    /// Shown in the widget gallery before any real data exists.
    static let sample: AirEntry = {
        func vital(_ v: Double, _ unit: String, _ dp: Int, _ normal: Double, _ band: Double) -> Payload.Vital {
            .init(value: v, unit: unit, dp: dp, date: nil, normal: normal, band: band, status: "normal", nights: 14)
        }
        return AirEntry(
            date: Date(),
            payload: Payload(
                date: nil, steps: .init(value: 6234, goal: 10000),
                heart: .init(resting: 58, latest: 72, latestAt: nil, min: 52, max: 131),
                sleep: .init(minutes: 437, date: nil, start: nil, end: nil),
                activity: .init(sittingMin: 312, sittingLongestMin: 74, azm: 22, azmWeek: 96, azmGoal: 150,
                                activeMin: 24, activeGoal: 30, distance: 4.6, distanceUnit: "km", calories: 1840),
                vitals: .init(rhr: vital(58, "bpm", 0, 57, 2), hrv: vital(44, "ms", 0, 42, 4),
                              breathing: vital(14.6, "br/min", 1, 14.4, 0.6), spo2: vital(96.4, "%", 1, 96.1, 1),
                              skinTemp: vital(0.1, "°C", 1, 0, 0.3),
                              vo2max: .init(value: 44, unit: "ml/kg/min", dp: 0)),
                sync: .init(airLastSync: nil, googleConnected: true, loginExpiresAt: nil)),
            problem: nil, fetchedAt: Date())
    }()
}

// ---- timelines ---------------------------------------------------------------------------------
/// For the fixed-layout Overview widget.
struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> AirEntry { .sample }

    func getSnapshot(in context: Context, completion: @escaping (AirEntry) -> Void) {
        Task {
            let entry = await Loader.load()
            completion(context.isPreview && entry.payload == nil ? .sample : entry)
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<AirEntry>) -> Void) {
        Task {
            let entry = await Loader.load()
            completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(refreshEvery))))
        }
    }
}

/// For the widgets you configure with Edit Widget: the reading plus your choices.
struct ConfiguredEntry<Config: WidgetConfigurationIntent>: TimelineEntry {
    let air: AirEntry
    let config: Config
    var date: Date { air.date }
}

struct IntentProvider<Config: WidgetConfigurationIntent>: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> ConfiguredEntry<Config> { .init(air: .sample, config: Config()) }

    func snapshot(for configuration: Config, in context: Context) async -> ConfiguredEntry<Config> {
        let entry = await Loader.load()
        return .init(air: context.isPreview && entry.payload == nil ? .sample : entry, config: configuration)
    }

    func timeline(for configuration: Config, in context: Context) async -> Timeline<ConfiguredEntry<Config>> {
        let entry = ConfiguredEntry(air: await Loader.load(), config: configuration)
        return Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(refreshEvery)))
    }
}

// ---- the widgets --------------------------------------------------------------------------------
extension View {
    func airWidget() -> some View {
        containerBackground(.background, for: .widget)
            .widgetURL(URL(string: "fitbitair://open"))  // the app opens the dashboard, then quits
    }
}

struct StepsWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "FitbitAir", intent: StepsConfig.self, provider: IntentProvider<StepsConfig>()) { e in
            StepsView(entry: e.air, stats: [e.config.first, e.config.second]).airWidget()
        }
        .configurationDisplayName("Steps")
        .description("Today's steps toward your goal. On the medium size, pick two stats to show beside the ring.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct StatWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "FitbitAirStat", intent: StatConfig.self, provider: IntentProvider<StatConfig>()) { e in
            StatWidgetView(entry: e.air, metrics: [e.config.metric, e.config.second]).airWidget()
        }
        .configurationDisplayName("Stat")
        .description("One stat of your choice, like blood oxygen or time sitting. The medium size shows two.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct OverviewWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FitbitAirOverview", provider: Provider()) { entry in
            OverviewView(entry: entry).airWidget()
        }
        .configurationDisplayName("Overview")
        .description("Steps, heart, sleep, sitting and your overnight vitals on one card.")
        .supportedFamilies([.systemLarge])
    }
}

@main
struct FitbitAirWidgets: WidgetBundle {
    var body: some Widget {
        StepsWidget()
        StatWidget()
        OverviewWidget()
    }
}
