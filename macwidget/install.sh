#!/bin/sh
# Build the Fitbit Air widget app and install it to ~/Applications. Run again after changing the
# code or rotating data/widget_secret. Needs Xcode; no Apple ID (signed to run on this Mac only).
set -e
cd "$(dirname "$0")"
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

xcodebuild -project FitbitAir.xcodeproj -scheme FitbitAir -configuration Release \
  -derivedDataPath build -destination 'platform=macOS' -quiet build

BUILT="build/Build/Products/Release/Fitbit Air.app"
APP="$HOME/Applications/Fitbit Air.app"
KEY="Contents/PlugIns/FitbitAirWidget.appex/Contents/Resources/widget_secret"

pkill -x "Fitbit Air" 2>/dev/null || true
mkdir -p "$HOME/Applications"
rm -rf "$APP"
ditto "$BUILT" "$APP"
chmod 600 "$APP/$KEY" "$BUILT/$KEY" build/Build/Products/Release/FitbitAirWidget.appex/Contents/Resources/widget_secret 2>/dev/null || true
codesign --verify --deep --strict "$APP"

# Tell macOS about the app and its widget, then refresh any copies already on the desktop.
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP"
pluginkit -a "$APP/Contents/PlugIns/FitbitAirWidget.appex"
open "$APP"
echo "Installed $APP"
