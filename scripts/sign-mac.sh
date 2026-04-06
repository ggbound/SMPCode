#!/bin/bash
set -e

APP_PATH="/Users/ggbound/data/new_version/AI/Clude-Code/claw-code-web/dist/mac-arm64/SMP Code.app"
ENTITLEMENTS="/Users/ggbound/data/new_version/AI/Clude-Code/claw-code-web/build/entitlements.mac.plist"

if [ ! -d "$APP_PATH" ]; then
    echo "Error: App not found at $APP_PATH"
    exit 1
fi

if [ ! -f "$ENTITLEMENTS" ]; then
    echo "Error: Entitlements file not found at $ENTITLEMENTS"
    exit 1
fi

echo "Signing app with entitlements..."

# Sign the main app
codesign --force --deep --sign - \
    --entitlements "$ENTITLEMENTS" \
    "$APP_PATH"

echo "Verifying signature..."
codesign -dv "$APP_PATH" 2>&1 | grep -E "(Identifier|Format|Signature|Entitlements)"

echo "Done!"
