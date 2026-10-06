#!/bin/sh
# Build the Fitbit Air widget app and install it to ~/Applications. Run again after changing the
# code or rotating data/widget_secret. Needs Xcode; no Apple ID (signed to run on this Mac only).
set -e
cd "$(dirname "$0")"
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

# A new build number every time, or macOS keeps showing the widget gallery it cached for the old one.
xcodebuild -project FitbitAir.xcodeproj -scheme FitbitAir -configuration Release \
  -derivedDataPath build -destination 'platform=macOS,arch=arm64' -quiet build \
  CURRENT_PROJECT_VERSION="$(date +%Y%m%d%H%M%S)"

BUILT="build/Build/Products/Release/Fitbit Air.app"
APP="$HOME/Applications/Fitbit Air.app"
KEY="Contents/PlugIns/FitbitAirWidget.appex/Contents/Resources/widget_secret"

pkill -x "Fitbit Air" 2>/dev/null || true
mkdir -p "$HOME/Applications"
rm -rf "$APP"
ditto "$BUILT" "$APP"
chmod 600 "$APP/$KEY" "$BUILT/$KEY" build/Build/Products/Release/FitbitAirWidget.appex/Contents/Resources/widget_secret 2>/dev/null || true
codesign --verify --deep --strict "$APP"

# Tell macOS about the installed copy only (not the one in build/), then make the widget service
# reload the list of widgets. Both services restart on their own.
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
pluginkit -r "$BUILT/Contents/PlugIns/FitbitAirWidget.appex" 2>/dev/null || true
"$LSREGISTER" -u "$BUILT" 2>/dev/null || true
"$LSREGISTER" -f "$APP"
pluginkit -a "$APP/Contents/PlugIns/FitbitAirWidget.appex"
pkill -x FitbitAirWidget 2>/dev/null || true
killall chronod 2>/dev/null || true
open "$APP"
echo "Installed $APP"
