#!/usr/bin/env bash
set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info() { echo -e "${CYAN}[llama.cpp]${NC} $*"; }
ok()   { echo -e "${GREEN}[ok]${NC} $*"; }
warn() { echo -e "${YELLOW}[warn]${NC} $*"; }
err()  { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }

REPO_DIR="${LLAMA_CPP_DIR:-$HOME/.llama.cpp}"
BUILD_TYPE="${LLAMA_BUILD_TYPE:-Release}"
GPU_BACKEND="${LLAMA_GPU:-auto}"
NPROC="${MAKEJOBS:-$(nproc 2>/dev/null || echo 4)}"
BRANCH="${LLAMA_BRANCH:-master}"

detect_gpu() {
  if [ "$GPU_BACKEND" != "auto" ]; then
    echo "$GPU_BACKEND"
    return
  fi
  if command -v nvidia-smi &>/dev/null && nvidia-smi &>/dev/null; then
    echo "cuda"
  elif command -v rocminfo &>/dev/null 2>/dev/null && rocminfo &>/dev/null; then
    echo "rocm"
  elif [ "$(uname -s)" = "Darwin" ] && [ -d /usr/local/Metal ]; then
    echo "metal"
  elif [ "$(uname -s)" = "Darwin" ]; then
    echo "metal"
  else
    echo "cpu"
  fi
}

detect_pkg_manager() {
  if command -v pacman &>/dev/null; then
    echo "pacman"
  elif command -v dnf &>/dev/null; then
    echo "dnf"
  elif command -v apt-get &>/dev/null; then
    echo "apt"
  elif command -v zypper &>/dev/null; then
    echo "zypper"
  elif command -v apk &>/dev/null; then
    echo "apk"
  elif command -v nix-env &>/dev/null; then
    echo "nix"
  else
    echo "unknown"
  fi
}

check_cuda() {
  if [ "$1" = "cuda" ]; then
    if command -v nvcc &>/dev/null; then
      ok "CUDA toolkit found: $(nvcc --version | grep release | grep -oP '[\d.]+' || echo 'installed')"
    elif [ -d /opt/cuda ] || [ -d /usr/local/cuda ]; then
      ok "CUDA directory found."
    elif [ -f /etc/arch-release ] && pacman -Qs cuda 2>/dev/null | grep -q cuda; then
      ok "CUDA toolkit found (Arch package)."
    else
      warn "CUDA toolkit not found in PATH."
      info "Install it first:"
      info "  Arch:     sudo pacman -S cuda cudnn"
      info "  Fedora:   sudo dnf install cuda"
      info "  Ubuntu:   sudo apt install nvidia-cuda-toolkit"
      info "  Or from:  https://developer.nvidia.com/cuda-downloads"
      echo ""
      echo -e "${CYAN}Continue without CUDA verification? [y/N]: ${NC}"
      read -rp "" cont
      if [[ ! "${cont:-}" =~ ^[Yy]$ ]]; then
        exit 0
      fi
    fi
  fi
}

check_rocm() {
  if [ "$1" = "rocm" ]; then
    if command -v hipcc &>/dev/null; then
      ok "ROCm found: $(hipcc --version 2>/dev/null | head -1 || echo 'installed')"
    else
      warn "ROCm not found."
      info "Install from: https://rocm.docs.amd.com/"
      exit 0
    fi
  fi
}

install_deps_arch() {
  info "Installing build dependencies (pacman)..."
  local pkgs=(base-devel cmake git wget curl glm pkgconf)
  if [ "$1" = "cuda" ]; then
    pkgs+=(cuda cudnn)
  fi
  if ! sudo pacman -Q "${pkgs[@]}" &>/dev/null 2>&1; then
    sudo pacman -S --needed --noconfirm "${pkgs[@]}"
  fi
  ok "Arch dependencies installed."
}

install_deps_ubuntu() {
  info "Installing build dependencies (apt)..."
  sudo apt-get update -qq
  sudo apt-get install -y -qq \
    build-essential cmake git wget curl \
    libcurl4-openssl-dev libglm-dev libgles2-mesa-dev \
    pkg-config
  ok "Ubuntu/Debian dependencies installed."
}

install_deps_fedora() {
  info "Installing build dependencies (dnf)..."
  sudo dnf install -y gcc gcc-c++ cmake git wget curl \
    libcurl-devel glm-devel mesa-libGLES-devel pkgconfig
  ok "Fedora dependencies installed."
}

install_deps_opensuse() {
  info "Installing build dependencies (zypper)..."
  sudo zypper install -y gcc gcc-c++ cmake git wget curl \
    libcurl-devel glm-devel Mesa-libGLESv2-devel pkg-config
  ok "openSUSE dependencies installed."
}

install_deps_alpine() {
  info "Installing build dependencies (apk)..."
  sudo apk add build-base cmake git wget curl-dev glm-dev \
    mesa-dev pkgconf
  ok "Alpine dependencies installed."
}

install_deps_nix() {
  info "NixOS detected. Using nix-shell..."
  warn "Please run inside: nix-shell -p cmake git wget curl glm pkg-config"
  warn "Or add to your configuration.flake / profile."
}

install_deps_macos() {
  info "Checking macOS dependencies..."
  if ! xcode-select -p &>/dev/null; then
    info "Installing Xcode command line tools..."
    xcode-select --install
    err "Re-run this script after Xcode CLT installs."
  fi
  if ! command -v cmake &>/dev/null; then
    if command -v brew &>/dev/null; then
      info "Installing cmake via Homebrew..."
      brew install cmake
    else
      err "cmake not found. Install Xcode CLT or Homebrew."
    fi
  fi
  ok "macOS dependencies satisfied."
}

install_deps() {
  local gpu="$1"
  local pkg_mgr
  pkg_mgr=$(detect_pkg_manager)

  case "$pkg_mgr" in
    pacman)
      install_deps_arch "$gpu"
      ;;
    dnf)
      install_deps_fedora "$gpu"
      ;;
    apt)
      install_deps_ubuntu "$gpu"
      ;;
    zypper)
      install_deps_opensuse "$gpu"
      ;;
    apk)
      install_deps_alpine "$gpu"
      ;;
    nix)
      install_deps_nix
      ;;
    *)
      warn "Unknown package manager. Attempting build without auto-installing deps."
      info "You need: cmake, git, curl, a C/C++ compiler, glm"
      echo ""
      echo -e "${CYAN}Continue anyway? [y/N]: ${NC}"
      read -rp "" cont
      if [[ ! "${cont:-}" =~ ^[Yy]$ ]]; then
        exit 0
      fi
      ;;
  esac

  check_cuda "$gpu"
  check_rocm "$gpu"
}

clone_repo() {
  if [ -d "$REPO_DIR/.git" ]; then
    info "Updating existing llama.cpp at $REPO_DIR ..."
    git -C "$REPO_DIR" fetch --quiet
    git -C "$REPO_DIR" checkout "$BRANCH" --quiet 2>/dev/null || true
    git -C "$REPO_DIR" pull --quiet || warn "Pull failed, using existing source."
  else
    info "Cloning llama.cpp (branch: $BRANCH)..."
    git clone --branch "$BRANCH" --depth 1 \
      https://github.com/ggerganov/llama.cpp.git "$REPO_DIR" --quiet
  fi
  ok "Source ready at $REPO_DIR"
}

build_cuda() {
  info "Building with CUDA support..."
  cmake -S "$REPO_DIR" -B "$REPO_DIR/build" \
    -DGGML_CUDA=ON \
    -DCMAKE_BUILD_TYPE="$BUILD_TYPE"
  cmake --build "$REPO_DIR/build" -j"$NPROC" --config "$BUILD_TYPE"
}

build_rocm() {
  info "Building with ROCm support..."
  cmake -S "$REPO_DIR" -B "$REPO_DIR/build" \
    -DGGML_HIPBLAS=ON \
    -Damd_comgr_DIR=/opt/rocm/lib/cmake/amd_comgr \
    -DCMAKE_BUILD_TYPE="$BUILD_TYPE"
  cmake --build "$REPO_DIR/build" -j"$NPROC" --config "$BUILD_TYPE"
}

build_metal() {
  info "Building with Metal support (macOS)..."
  cmake -S "$REPO_DIR" -B "$REPO_DIR/build" \
    -DGGML_METAL=ON \
    -DCMAKE_BUILD_TYPE="$BUILD_TYPE"
  cmake --build "$REPO_DIR/build" -j"$NPROC" --config "$BUILD_TYPE"
}

build_cpu() {
  warn "No GPU detected — building CPU-only. Performance will be limited."
  cmake -S "$REPO_DIR" -B "$REPO_DIR/build" \
    -DCMAKE_BUILD_TYPE="$BUILD_TYPE"
  cmake --build "$REPO_DIR/build" -j"$NPROC" --config "$BUILD_TYPE"
}

install_bins() {
  local bindir="$HOME/.local/bin"
  mkdir -p "$bindir"

  local server_bin=""
  for candidate in \
    "$REPO_DIR/build/bin/llama-server" \
    "$REPO_DIR/build/bin/Release/llama-server" \
    "$REPO_DIR/build/llama-server" \
    "$REPO_DIR/llama-server"; do
    if [ -f "$candidate" ]; then
      server_bin="$candidate"
      break
    fi
  done

  if [ -n "$server_bin" ]; then
    cp "$server_bin" "$bindir/llama-server"
    chmod +x "$bindir/llama-server"
    ok "llama-server installed to $bindir/llama-server"
  else
    warn "llama-server binary not found at expected paths."
    info "Check $REPO_DIR/build/bin/ for the built binary."
    info "You may need to manually copy it to $bindir/"
  fi

  local cli_bin=""
  for candidate in \
    "$REPO_DIR/build/bin/llama-cli" \
    "$REPO_DIR/build/bin/Release/llama-cli" \
    "$REPO_DIR/build/llama-cli" \
    "$REPO_DIR/llama-cli"; do
    if [ -f "$candidate" ]; then
      cli_bin="$candidate"
      break
    fi
  done

  if [ -n "$cli_bin" ]; then
    cp "$cli_bin" "$bindir/llama-cli"
    chmod +x "$bindir/llama-cli"
    ok "llama-cli installed to $bindir/llama-cli"
  fi

  local gating_bin=""
  for candidate in \
    "$REPO_DIR/build/bin/llama-gguf" \
    "$REPO_DIR/build/bin/llama-gguf-hash" \
    "$REPO_DIR/build/bin/llama-quantize"; do
    if [ -f "$candidate" ]; then
      local fname="${candidate##*/}"
      cp "$candidate" "$bindir/$fname"
      chmod +x "$bindir/$fname"
      ok "$fname installed to $bindir/$fname"
    fi
  done

  echo ""
  info "Ensure $bindir is in your PATH."
  info "  export PATH=\"$bindir:\$PATH\""
  info "  # or add to ~/.bashrc / ~/.zshrc"
}

main() {
  echo ""
  echo -e "${CYAN}========================================${NC}"
  echo -e "${CYAN} llama.cpp Setup for Prism${NC}"
  echo -e "${CYAN}========================================${NC}"
  echo ""

  local gpu
  gpu=$(detect_gpu)
  info "Detected GPU backend: $gpu"
  info "Build type: $BUILD_TYPE"
  info "Parallel jobs: $NPROC"
  info "Target dir: $REPO_DIR"
  info "Branch: $BRANCH"
  echo ""

  case "$(uname -s)" in
    Linux)
      install_deps "$gpu"
      ;;
    Darwin)
      install_deps_macos
      gpu="metal"
      ;;
    *)
      warn "Unsupported OS: $(uname -s). Attempting CPU build..."
      gpu="cpu"
      ;;
  esac

  clone_repo

  case "$gpu" in
    cuda) build_cuda ;;
    rocm) build_rocm ;;
    metal) build_metal ;;
    *) build_cpu ;;
  esac

  install_bins

  echo ""
  ok "llama.cpp setup complete!"
  echo ""
  info "Next steps:"
  info "  1. Download a model:  ./scripts/llama-download-model.sh"
  info "  2. Start the server:  ./scripts/llama-run.sh"
  info "  3. Prism will connect to: http://localhost:8080"
}

main "$@"
