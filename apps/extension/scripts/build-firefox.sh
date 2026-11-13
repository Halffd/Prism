#!/bin/bash
# apps/extension/scripts/build-firefox.sh
#
# Packages the built extension for Firefox / addons.mozilla.org.
#
# The manifest is already cross-browser: `background` declares both
# `service_worker` (Chrome) and `scripts` (Firefox event page), and
# `browser_specific_settings.gecko` carries the Firefox-specific keys.
# So the Firefox package is the same build with the same manifest — what
# this script adds is the AMO-ready zip and the linter's verdict on it.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
EXT_DIR="$ROOT_DIR/dist/apps/extension"
ARTIFACT_DIR="$ROOT_DIR/dist/apps/extension-firefox"

if [ ! -f "$EXT_DIR/manifest.json" ]; then
  echo "❌ No extension build at $EXT_DIR"
  echo "   Run 'npx nx build @prism/extension' first."
  exit 1
fi

WEB_EXT="$ROOT_DIR/node_modules/.bin/web-ext"
if [ ! -x "$WEB_EXT" ]; then
  echo "❌ web-ext not found. Install it with:"
  echo "   npm install --save-dev web-ext"
  exit 1
fi

echo "🔍 Linting extension for Firefox..."
# --self-hosted suppresses the AMO-hosting notices that are irrelevant for
# a locally loaded build; warnings stay visible but do not fail the build.
"$WEB_EXT" lint --source-dir "$EXT_DIR" --self-hosted

echo ""
echo "📦 Packaging for Firefox..."
rm -rf "$ARTIFACT_DIR"
mkdir -p "$ARTIFACT_DIR"
"$WEB_EXT" build \
  --source-dir "$EXT_DIR" \
  --artifacts-dir "$ARTIFACT_DIR" \
  --overwrite-dest

echo ""
echo "✅ Firefox package built"
echo "📦 Output: $ARTIFACT_DIR"
echo ""
echo "To load it temporarily in Firefox:"
echo "   npx web-ext run --source-dir $EXT_DIR"
echo ""
echo "To submit to addons.mozilla.org:"
echo "   npx web-ext sign --source-dir $EXT_DIR --api-key \$AMO_API_KEY --api-secret \$AMO_API_SECRET"
