// Fitbit Air — the app that carries the desktop widget. Opened normally, it shows how to add the
// widget. Opened by clicking the widget (fitbitair://open), it opens the dashboard and quits.
import AppKit
import SwiftUI
import WidgetKit

let dashboard = URL(string: "http://127.0.0.1:8787/")!

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var launched = false
    private var openedForWidget = false
    private var window: NSWindow?

    func application(_ application: NSApplication, open urls: [URL]) {
        NSWorkspace.shared.open(dashboard)
        if !launched { openedForWidget = true }  // a widget click started us: don't stay around
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        launched = true
        if openedForWidget {
            NSApp.terminate(nil)
            return
        }
        WidgetCenter.shared.reloadAllTimelines()
        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 440, height: 260),
                         styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        w.title = "Fitbit Air"
        w.isReleasedWhenClosed = false
        w.contentView = NSHostingView(rootView: SetupView())
        w.center()
        w.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        window = w
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

struct SetupView: View {
    @State private var refreshed = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Fitbit Air widget").font(.title2.weight(.semibold))
            Text("Add it to your desktop: right-click the desktop → **Edit Widgets…** → search **Fitbit Air**, then drag the small or medium size where you want it.")
                .fixedSize(horizontal: false, vertical: true)
            Text("It reads from your dashboard at 127.0.0.1:8787, so keep the dashboard running. Click the widget to open the dashboard.")
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            HStack {
                Button("Open dashboard") { NSWorkspace.shared.open(dashboard) }
                Button(refreshed ? "Refreshed" : "Refresh widget") {
                    WidgetCenter.shared.reloadAllTimelines()
                    refreshed = true
                }
            }
        }
        .padding(24)
        .frame(width: 440, alignment: .leading)
    }
}

let delegate = AppDelegate()
NSApplication.shared.delegate = delegate
NSApplication.shared.setActivationPolicy(.regular)
NSApplication.shared.run()
