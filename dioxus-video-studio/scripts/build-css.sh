#!/bin/sh
# Builds the Tailwind CSS bundle from src/tailwind.css into public/tailwind.css.
# Prefers the locally installed @tailwindcss/cli, falls back to npx,
# and keeps the previously generated file if the CLI is unavailable.
set -e
cd "$(dirname "$0")/.."

if [ -x node_modules/.bin/tailwindcss ]; then
  node_modules/.bin/tailwindcss -i src/tailwind.css -o public/tailwind.css --minify
elif command -v npx >/dev/null 2>&1; then
  npx -y @tailwindcss/cli -i src/tailwind.css -o public/tailwind.css --minify
else
  echo "tailwindcss CLI not found — keeping existing public/tailwind.css" >&2
  exit 0
fi
