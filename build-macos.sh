#!/bin/bash

# Task Assistant - macOS Build Script
# This script builds the Electron app for macOS

set -e  # Exit on error

echo "🚀 Task Assistant - macOS Build Script"
echo "========================================"
echo ""

# Check if we're on macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo "⚠️  Warning: This script is designed for macOS"
    echo "   Building on $OSTYPE may have issues"
    echo ""
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo "✅ Dependencies installed"
    echo ""
else
    echo "✅ Dependencies already installed"
    echo ""
fi

# Clean previous builds
echo "🧹 Cleaning previous builds..."
rm -rf out/
rm -rf release/
echo "✅ Clean complete"
echo ""

# Build the application
echo "🔨 Building application with electron-vite..."
npm run build
echo "✅ Build complete"
echo ""

# Build macOS app
echo "📦 Building macOS application..."
npm run electron:build
echo "✅ macOS build complete"
echo ""

# Show build output
echo "📁 Build artifacts:"
if [ -d "release" ]; then
    ls -lh release/
    echo ""
    echo "✅ Build successful!"
    echo ""
    echo "📍 Your app is in: release/"
    
    # Find the .dmg file
    DMG_FILE=$(find release -name "*.dmg" -type f | head -n 1)
    if [ -n "$DMG_FILE" ]; then
        echo "💿 DMG installer: $DMG_FILE"
    fi
    
    # Find the .app file
    APP_FILE=$(find release -name "*.app" -type d | head -n 1)
    if [ -n "$APP_FILE" ]; then
        echo "📱 App bundle: $APP_FILE"
    fi
else
    echo "❌ Build failed - no release directory found"
    exit 1
fi

echo ""
echo "🎉 Done! You can now:"
echo "   1. Open the DMG file to install"
echo "   2. Or run the app directly from release/"

# Made with Bob
