#!/bin/sh

set -e

echo "=== Xcode Cloud Post-Clone Script Started ==="

# Set Homebrew PATH
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# 1. Ensure Node.js is available
if ! command -v node >/dev/null 2>&1; then
    echo "Installing Node.js via Homebrew..."
    brew install node@20 || brew install node
fi

echo "Node version: $(node -v 2>&1 || true)"
echo "NPM version: $(npm -v 2>&1 || true)"

# 2. Determine repository path
if [ -z "$CI_PRIMARY_REPOSITORY_PATH" ]; then
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    CI_PRIMARY_REPOSITORY_PATH="$(cd "$SCRIPT_DIR/.." && pwd)"
fi

echo "Repository root: $CI_PRIMARY_REPOSITORY_PATH"

# 3. Install NPM dependencies in fitme-ui
cd "$CI_PRIMARY_REPOSITORY_PATH/fitme-ui"
echo "Installing npm dependencies..."
npm install --legacy-peer-deps

# 4. Install CocoaPods dependencies
cd ios
echo "Installing CocoaPods dependencies..."
if ! command -v pod >/dev/null 2>&1; then
    echo "Installing CocoaPods..."
    brew install cocoapods
fi

pod install

echo "=== Xcode Cloud Post-Clone Script Completed ==="
