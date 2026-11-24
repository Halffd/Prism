#!/bin/bash
# apps/extension/scripts/build-targets.sh
#
# Package the built extension into three browser-specific distributions:
#
#   chrome           Chromium/Chrome, store-ready (MV3 service worker)
#   firefox          Firefox desktop, addons.mozilla.org-ready (event page)
#   firefox-android  Firefox for Android (Fenix), self-hosted
#
# One vite build feeds all three: the JS is identical, and each browser
# ignores the manifest key it does not use. What differs is the manifest:
#
#   chrome           background carries only service_worker; the gecko
#                    block is dropped.
#   firefox          background keeps the scripts fallback and the gecko
#                    block, and drops gecko_android.
#   firefox-android  same background as Firefox desktop plus gecko_android,
#                    which Fenix reads for its minimum-API check.
#
# Firefox for Android approves wasm only where the CSP says so, so the
# Android package verifies `wasm-unsafe-eval` before shipping instead of
# failing later at load time.
#
# Each target lands as an unpacked directory plus a zip with a stable
# name, so a job can upload it without a discovery step.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
EXT_DIR="$ROOT_DIR/dist/apps/extension"
OUT_DIR="$ROOT_DIR/dist/extension-packages"

TARGETS=(chrome firefox firefox-android)

if [ ! -f "$EXT_DIR/manifest.json" ]; then
  echo "No extension build at $EXT_DIR"
  echo "Run: (cd apps/extension && npx vite build --mode production)"
  exit 1
fi

command -v zip >/dev/null || { echo "zip not found"; exit 1; }

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

stage() {
  local target="$1" dest="$OUT_DIR/$target"
  mkdir -p "$dest"
  (cd "$EXT_DIR" && cp -r . "$dest/")
  rm -f "$dest/manifest.json"
}

emit_manifest() {
  local target="$1" dest="$OUT_DIR/$target"
  local source="$EXT_DIR/manifest.json"
  case "$target" in
    chrome)
      python3 - "$source" "$dest/manifest.json" << 'PY'
import json, sys
src, dst = sys.argv[1], sys.argv[2]
m = json.load(open(src))
m['background'] = {'service_worker': 'background.js', 'type': 'module'}
m.pop('browser_specific_settings', None)
json.dump(m, open(dst, 'w'), indent=2)
PY
      ;;
    firefox)
      python3 - "$source" "$dest/manifest.json" << 'PY'
import json, sys
src, dst = sys.argv[1], sys.argv[2]
m = json.load(open(src))
m['browser_specific_settings'].pop('gecko_android', None)
json.dump(m, open(dst, 'w'), indent=2)
PY
      ;;
    firefox-android)
      python3 - "$source" "$dest/manifest.json" << 'PY'
import json, sys
src, dst = sys.argv[1], sys.argv[2]
m = json.load(open(src))
csp = m.get('content_security_policy', {}).get('extension_pages', '')
if "wasm-unsafe-eval" not in csp:
    sys.exit("firefox-android requires wasm-unsafe-eval in the extension CSP")
json.dump(m, open(dst, 'w'), indent=2)
PY
      ;;
  esac
}

for target in "${TARGETS[@]}"; do
  echo "Packaging $target ..."
  stage "$target"
  emit_manifest "$target"
  # A raw Unicode noncharacter is valid UTF-8 and V8 accepts it, but
  # Chromium's extension loader rejects the file: "Could not load file
  # 'content.js' for content script. It isn't UTF-8 encoded." Vite's own
  # pass escapes these (see vite.config.mjs), and this is the gate that
  # keeps a future dependency from re-introducing them.
  python3 - "$OUT_DIR/$target" << 'PY' || exit 1
import os, sys
NONCHARS = ('\ufffe', '\uffff', '\ufffd')
for root, _dirs, files in os.walk(sys.argv[1]):
    for f in files:
        if not f.endswith('.js'):
            continue
        text = open(os.path.join(root, f), encoding='utf-8').read()
        for c in NONCHARS:
            if c in text:
                sys.exit(f'{os.path.join(root, f)}: raw noncharacter U+{ord(c):04X}')
PY
  # Zip the *contents* of the staged dir, not the dir itself: a nested
  # top-level folder ("firefox/manifest.json") is a corrupt add-on to
  # every browser — Firefox reports "This addon could not be installed
  # because it appears to be corrupt" and Chrome's unpacked-load path
  # fails to find the manifest. `zip -r . .` prefixes entries with ./
  # so they land at the archive root.
  (cd "$OUT_DIR/$target" && zip -qr "$OUT_DIR/prism-extension-$target.zip" .)
  echo "  -> $OUT_DIR/prism-extension-$target.zip"
done

echo ""
echo "Done:"
for target in "${TARGETS[@]}"; do
  echo "  $target: $OUT_DIR/prism-extension-$target.zip"
done
