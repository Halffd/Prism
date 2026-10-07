#!/usr/bin/env bash
set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info() { echo -e "${CYAN}[ollama]${NC} $*"; }
ok()   { echo -e "${GREEN}[ok]${NC} $*"; }
warn() { echo -e "${YELLOW}[warn]${NC} $*"; }
err()  { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }

INSTALL_DIR="${OLLAMA_INSTALL_DIR:-/usr/local/bin}"
SKIP_SERVICE="${OLLAMA_SKIP_SERVICE:-0}"
DATA_DIR="${OLLAMA_DATA_DIR:-$HOME/.ollama}"

detect_arch() {
  local arch
  arch=$(uname -m)
  case "$arch" in
    x86_64)  echo "amd64" ;;
    aarch64) echo "arm64" ;;
    armv7l)  echo "armv7" ;;
    *)       err "Unsupported architecture: $arch" ;;
  esac
}

detect_os() {
  case "$(uname -s)" in
    Linux)  echo "linux" ;;
    Darwin) echo "darwin" ;;
    *)      err "Unsupported OS: $(uname -s)" ;;
  esac
}

install_linux() {
  info "Installing Ollama for Linux..."

  if command -v ollama &>/dev/null; then
    local current_ver
    current_ver=$(ollama --version 2>/dev/null | grep -oP '[\d.]+' | head -1 || echo "unknown")
    ok "Ollama already installed: v$current_ver"
    echo -e "${CYAN}Reinstall/upgrade? [y/N]: ${NC}"
    read -rp "" reinstall
    if [[ ! "${reinstall:-}" =~ ^[Yy]$ ]]; then
      return 0
    fi
  fi

  info "Downloading Ollama..."
  local tmpdir
  tmpdir=$(mktemp -d)
  trap 'rm -rf "$tmpdir"' EXIT

  if command -v curl &>/dev/null; then
    curl -fsSL https://ollama.com/install.sh -o "$tmpdir/install.sh"
  elif command -v wget &>/dev/null; then
    wget -q https://ollama.com/install.sh -O "$tmpdir/install.sh"
  else
    err "curl or wget required."
  fi

  ok "Downloaded install script."
  info "Running Ollama installer..."

  if [ "$SKIP_SERVICE" = "1" ]; then
    info "Skipping systemd service setup (OLLAMA_SKIP_SERVICE=1)"
    bash "$tmpdir/install.sh" --no-service
  else
    if [ -w /usr/local/bin ] || [ "$(id -u)" = "0" ]; then
      bash "$tmpdir/install.sh"
    else
      info "Running with sudo for system install..."
      sudo bash "$tmpdir/install.sh"
    fi
  fi

  if command -v ollama &>/dev/null; then
    ok "Ollama installed: $(ollama --version 2>/dev/null || echo 'installed')"
  else
    warn "Ollama binary not found in PATH after install."
    warn "You may need to start a new shell or add it to PATH manually."
  fi
}

install_macos() {
  info "Installing Ollama for macOS..."

  if command -v ollama &>/dev/null; then
    local current_ver
    current_ver=$(ollama --version 2>/dev/null | grep -oP '[\d.]+' | head -1 || echo "unknown")
    ok "Ollama already installed: v$current_ver"
    echo -e "${CYAN}Reinstall/upgrade? [y/N]: ${NC}"
    read -rp "" reinstall
    if [[ ! "${reinstall:-}" =~ ^[Yy]$ ]]; then
      return 0
    fi
  fi

  if command -v brew &>/dev/null; then
    info "Installing via Homebrew..."
    brew install ollama
  else
    info "Downloading Ollama.dmg ..."
    local tmpdir
    tmpdir=$(mktemp -d)
    trap 'rm -rf "$tmpdir"' EXIT

    local os arch
    os=$(detect_os)
    arch=$(detect_arch)

    if command -v curl &>/dev/null; then
      curl -fsSL "https://ollama.com/download/Ollama-darwin.zip" -o "$tmpdir/Ollama.zip"
    else
      wget -q "https://ollama.com/download/Ollama-darwin.zip" -O "$tmpdir/Ollama.zip"
    fi

    info "Extracting..."
    cd "$tmpdir" && unzip -q Ollama.zip
    if [ -d "$tmpdir/Ollama.app" ]; then
      cp -r "$tmpdir/Ollama.app" /Applications/ 2>/dev/null || sudo cp -r "$tmpdir/Ollama.app" /Applications/
      ok "Installed to /Applications/Ollama.app"
      info "Launch it from Applications or run: open /Applications/Ollama.app"
    fi
  fi
}

setup_service() {
  if [ "$(uname -s)" != "Linux" ]; then
    return
  fi

  if [ "$SKIP_SERVICE" = "1" ]; then
    info "Service setup skipped (OLLAMA_SKIP_SERVICE=1)"
    info "Start manually: OLLAMA_HOST=0.0.0.0 ollama serve"
    return
  fi

  if ! command -v systemctl &>/dev/null; then
    warn "systemctl not found. Ollama may not run as a service."
    info "Start manually: OLLAMA_HOST=0.0.0.0 ollama serve &"
    return
  fi

  info "Configuring Ollama systemd service..."

  local service_dir="/etc/systemd/system"
  local service_file="$service_dir/ollama.service"

  if [ -f "$service_file" ]; then
    ok "Service file already exists at $service_file"
  else
    local service_content="[Unit]
Description=Ollama Service
After=network-online.target

[Service]
ExecStart=$(command -v ollama || echo /usr/local/bin/ollama) serve
User=$(whoami)
Environment=OLLAMA_HOST=0.0.0.0
Environment=OLLAMA_MODELS=$DATA_DIR/models
Restart=always
RestartSec=3

[Install]
WantedBy=default.target"

    if [ -w "$service_dir" ]; then
      echo "$service_content" > "$service_file"
    else
      echo "$service_content" | sudo tee "$service_file" > /dev/null
    fi
    ok "Service file created."
  fi

  sudo systemctl daemon-reload 2>/dev/null || true
  sudo systemctl enable ollama 2>/dev/null || true
  sudo systemctl start ollama 2>/dev/null || true

  sleep 2
  if sudo systemctl is-active --quiet ollama 2>/dev/null; then
    ok "Ollama service is running."
  else
    warn "Service not active. Start manually: ollama serve &"
  fi
}

configure_prism() {
  info "Ollama configuration for Prism:"
  echo ""
  echo "  API URL:    http://localhost:11434"
  echo "  Provider:   ollama"
  echo "  Mode:       local"
  echo ""
  info "In Prism Settings, set:"
  info "  - LLM Provider: ollama"
  info "  - Local API URL: http://localhost:11434"
  info "  - Adapter Mode: local (for llm capability)"
  echo ""
  info "Or add to .env:"
  info "  OLLAMA_API_URL=http://localhost:11434"
  info "  LLM_PROVIDER=ollama"
}

verify_install() {
  if ! command -v ollama &>/dev/null; then
    warn "ollama not in PATH. Try starting a new shell."
    return
  fi

  ok "Ollama CLI: $(ollama --version 2>/dev/null || echo 'installed')"

  if curl -sf http://localhost:11434/api/version &>/dev/null; then
    local server_ver
    server_ver=$(curl -sf http://localhost:11434/api/version 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('version','unknown'))" 2>/dev/null || echo "running")
    ok "Ollama server: v$server_ver"
  else
    warn "Ollama server not responding on port 11434."
    info "Start it: ollama serve"
  fi
}

main() {
  echo ""
  echo -e "${CYAN}========================================${NC}"
  echo -e "${CYAN} Ollama Setup for Prism${NC}"
  echo -e "${CYAN}========================================${NC}"
  echo ""

  case "$(uname -s)" in
    Linux)
      install_linux
      setup_service
      ;;
    Darwin)
      install_macos
      ;;
    *)
      err "Unsupported OS: $(uname -s). Install Ollama manually from https://ollama.com"
      ;;
  esac

  verify_install
  configure_prism

  echo ""
  ok "Ollama setup complete!"
  echo ""
  info "Next steps:"
  info "  1. Browse/pull models:  ./scripts/ollama-model-finder.sh"
  info "  2. Or pull directly:    ollama pull llama3.2"
  info "  3. List models:         ollama list"
  info "  4. Test:                ollama run llama3.2"
}

main "$@"
