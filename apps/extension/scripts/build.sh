#!/bin/bash
# apps/extension/scripts/build.sh

echo "🔨 Building Prism Extension..."

# Build with Vite
npx vite build

# Copy manifest and icons
cp apps/extension/public/manifest.json dist/apps/extension/
cp apps/extension/public/*.png dist/apps/extension/ 2>/dev/null || true

echo "✅ Extension built successfully!"
echo "📦 Output: dist/apps/extension"
echo ""
echo "To load in Chrome:"
echo "1. Open chrome://extensions"
echo "2. Enable 'Developer mode'"
echo "3. Click 'Load unpacked'"
echo "4. Select: dist/apps/extension"