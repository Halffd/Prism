#!/usr/bin/env bash
set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info() { echo -e "${CYAN}[koboldcpp]${NC} $*"; }
ok()   { echo -e "${GREEN}[ok]${NC} $*"; }
warn() { echo -e "${YELLOW}[warn]${NC} $*"; }
err()  { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }

INSTALL_DIR="${KOBOLDCPP_DIR:-$HOME/.koboldcpp}"
NPROC="${MAKEJOBS:-$(nproc 2>/dev/null || echo 4)}"
PORT="${KOBOLDCPP_PORT:-5001}"
CONTEXT_SIZE="${KOBOLDCPP_CTX_SIZE:-4096}"
GPU_LAYERS="${KOBOLDCPP_N_GPU_LAYERS:--1}"
THREADS="${KOBOLDCPP_THREADS:-$(nproc 2>/dev/null || echo 4)}"
BRANCH="${KOBOLDCPP_BRANCH:-main}"

detect_gpu() {
  if command -v nvidia-smi &>/dev/null && nvidia-smi &>/dev/null; then
    echo "cuda"
  elif command -v rocminfo &>/dev/null 2>/dev/null && rocminfo &>/dev/null; then
    echo "rocm"
  elif [ "$(uname -s)" = "Darwin" ]; then
    echo "metal"
  else
    echo "cpu"
  fi
}

detect_pkg_manager() {
  if command -v pacman &>/dev/null; then echo "pacman"
  elif command -v dnf &>/dev/null; then echo "dnf"
  elif command -v apt-get &>/dev/null; then echo "apt"
  elif command -v zypper &>/dev/null; then echo "zypper"
  elif command -v apk &>/dev/null; then echo "apk"
  else echo "unknown"
  fi
}

install_deps() {
  local gpu="$1"
  local pkg_mgr
  pkg_mgr=$(detect_pkg_manager)

  case "$pkg_mgr" in
    pacman)
      info "Installing build dependencies (pacman)..."
      local pkgs=(base-devel cmake git wget curl python python-pip)
      [ "$gpu" = "cuda" ] && pkgs+=(cuda cudnn)
      sudo pacman -S --needed --noconfirm "${pkgs[@]}" 2>/dev/null || true
      ;;
    dnf)
      info "Installing build dependencies (dnf)..."
      sudo dnf install -y gcc gcc-c++ cmake git wget curl python3 python3-pip
      ;;
    apt)
      info "Installing build dependencies (apt)..."
      sudo apt-get update -qq
      sudo apt-get install -y -qq build-essential cmake git wget curl python3 python3-pip
      ;;
    zypper)
      info "Installing build dependencies (zypper)..."
      sudo zypper install -y gcc gcc-c++ cmake git wget curl python3 python3-pip
      ;;
    apk)
      info "Installing build dependencies (apk)..."
      sudo apk add build-base cmake git wget curl python3 py3-pip
      ;;
    *)
      warn "Unknown package manager. Ensure you have: cmake, git, curl, python3, a C/C++ compiler"
      ;;
  esac
  ok "Dependencies installed."
}

check_cuda() {
  if command -v nvcc &>/dev/null; then
    ok "CUDA toolkit found."
  elif [ -d /opt/cuda ] || [ -d /usr/local/cuda ]; then
    ok "CUDA directory found."
  else
    warn "CUDA toolkit not found. KoboldCpp will fall back to CPU/other backends."
    info "Install CUDA: https://developer.nvidia.com/cuda-downloads"
  fi
}

clone_repo() {
  if [ -d "$INSTALL_DIR/.git" ]; then
    info "Updating existing KoboldCpp at $INSTALL_DIR ..."
    git -C "$INSTALL_DIR" fetch --quiet
    git -C "$INSTALL_DIR" checkout "$BRANCH" --quiet 2>/dev/null || true
    git -C "$INSTALL_DIR" pull --quiet || warn "Pull failed, using existing source."
  else
    info "Cloning KoboldCpp (branch: $BRANCH)..."
    git clone --branch "$BRANCH" --depth 1 \
      https://github.com/LostRuins/koboldcpp.git "$INSTALL_DIR" --quiet
  fi
  ok "Source ready at $INSTALL_DIR"
}

build_koboldcpp() {
  local gpu="$1"
  info "Building KoboldCpp..."

  cd "$INSTALL_DIR"

  case "$gpu" in
    cuda)
      info "Building with CUDA (cuBLAS)..."
      if [ -f "makefiles/Makefile.cuda" ]; then
        make -C makefiles -f Makefile.cuda -j"$NPROC" 2>&1 || {
          warn "CUDA Makefile build failed, trying build script..."
          bash build.sh cuda 2>&1 || err "Build failed."
        }
      elif [ -f "build.sh" ]; then
        bash build.sh cuda 2>&1 || err "CUDA build failed."
      else
        err "No build system found."
      fi
      ;;
    rocm)
      info "Building with ROCm (hipBLAS)..."
      if [ -f "build.sh" ]; then
        bash build.sh rocm 2>&1 || err "ROCm build failed."
      else
        err "No build.sh found for ROCm build."
      fi
      ;;
    metal)
      info "Building with Metal (macOS)..."
      if [ -f "build.sh" ]; then
        bash build.sh metal 2>&1 || err "Metal build failed."
      else
        err "No build.sh found for Metal build."
      fi
      ;;
    *)
      info "Building CPU-only..."
      if [ -f "makefiles/Makefile" ]; then
        make -C makefiles -j"$NPROC" 2>&1 || {
          warn "Makefile build failed, trying build script..."
          bash build.sh 2>&1 || err "Build failed."
        }
      elif [ -f "build.sh" ]; then
        bash build.sh 2>&1 || err "CPU build failed."
      else
        err "No build system found."
      fi
      ;;
  esac

  ok "KoboldCpp built."
}

install_bins() {
  local bindir="$HOME/.local/bin"
  mkdir -p "$bindir"

  local main_bin=""
  for candidate in \
    "$INSTALL_DIR/koboldcpp" \
    "$INSTALL_DIR/build/koboldcpp" \
    "$INSTALL_DIR/bin/koboldcpp" \
    "$INSTALL_DIR/koboldcpp.py"; do
    if [ -f "$candidate" ]; then
      main_bin="$candidate"
      break
    fi
  done

  if [ -n "$main_bin" ]; then
    local ext="${main_bin##*.}"
    if [ "$ext" = "py" ]; then
      cat > "$bindir/koboldcpp" << 'WRAPPER'
#!/usr/bin/env bash
exec python3 "$HOME/.koboldcpp/koboldcpp.py" "$@"
WRAPPER
      chmod +x "$bindir/koboldcpp"
      ok "koboldcpp wrapper installed to $bindir/koboldcpp"
    else
      cp "$main_bin" "$bindir/koboldcpp"
      chmod +x "$bindir/koboldcpp"
      ok "koboldcpp installed to $bindir/koboldcpp"
    fi
  else
    warn "Main binary not found at expected paths."
    info "Check $INSTALL_DIR for the built binary."
    info "You may need to run directly: python3 $INSTALL_DIR/koboldcpp.py"
  fi

  echo ""
  info "Ensure $bindir is in your PATH."
  info "  export PATH=\"$bindir:\$PATH\""
}

write_run_script() {
  local bindir="$HOME/.local/bin"
  cat > "$bindir/koboldcpp-server" << SCRIPT
#!/usr/bin/env bash
# Start KoboldCpp server for Prism
# Usage: koboldcpp-server [model.gguf] [additional args...]
set -euo pipefail

MODEL="\${1:-}"
PORT="\${KOBOLDCPP_PORT:-$PORT}"
CTX="\${KOBOLDCPP_CTX_SIZE:-$CONTEXT_SIZE}"
GPULAYERS="\${KOBOLDCPP_N_GPU_LAYERS:-$GPU_LAYERS}"
THREADS="\${KOBOLDCPP_THREADS:-$THREADS}"
DIR="$INSTALL_DIR"

if [ -z "\$MODEL" ]; then
  # Try to find a model
  for d in "\$HOME/.cache/koboldcpp" "\$HOME/.local/share/koboldcpp/models" "\$HOME/models"; do
    if [ -d "\$d" ]; then
      MODEL=\$(find "\$d" -name "*.gguf" -o -name "*.bin" 2>/dev/null | head -1)
      [ -n "\$MODEL" ] && break
    fi
  done
  if [ -z "\$MODEL" ]; then
    echo "Usage: koboldcpp-server <model.gguf> [args]"
    echo "       or place models in ~/.cache/koboldcpp/"
    exit 1
  fi
fi

echo "Starting KoboldCpp on port \$PORT with model: \$MODEL"

if [ -f "\$DIR/koboldcpp.py" ]; then
  exec python3 "\$DIR/koboldcpp.py" \\
    --model "\$MODEL" \\
    --port "\$PORT" \\
    --contextsize "\$CTX" \\
    --gpulayers "\$GPULAYERS" \\
    --threads "\$THREADS" \\
    "\${@:2}"
elif [ -f "\$DIR/koboldcpp" ]; then
  exec "\$DIR/koboldcpp" \\
    --model "\$MODEL" \\
    --port "\$PORT" \\
    --contextsize "\$CTX" \\
    --gpulayers "\$GPULAYERS" \\
    --threads "\$THREADS" \\
    "\${@:2}"
else
  echo "Error: KoboldCpp binary not found in \$DIR"
  exit 1
fi
SCRIPT
  chmod +x "$bindir/koboldcpp-server"
  ok "koboldcpp-server helper installed to $bindir/koboldcpp-server"
}

main() {
  echo ""
  echo -e "${CYAN}========================================${NC}"
  echo -e "${CYAN} KoboldCpp Setup for Prism${NC}"
  echo -e "${CYAN}========================================${NC}"
  echo ""

  local gpu
  gpu=$(detect_gpu)
  info "Detected GPU backend: $gpu"
  info "Install dir: $INSTALL_DIR"
  info "Port: $PORT"
  info "Parallel jobs: $NPROC"
  echo ""

  case "$(uname -s)" in
    Linux)
      install_deps "$gpu"
      check_cuda
      ;;
    Darwin)
      info "macOS detected — will use Metal backend."
      gpu="metal"
      if ! command -v cmake &>/dev/null; then
        if command -v brew &>/dev/null; then
          brew install cmake
        fi
      fi
      ;;
    *)
      warn "Unsupported OS: $(uname -s). Attempting CPU build..."
      gpu="cpu"
      ;;
  esac

  clone_repo
  build_koboldcpp "$gpu"
  install_bins
  write_run_script

  echo ""
  ok "KoboldCpp setup complete!"
  echo ""
  info "Next steps:"
  info "  1. Download a GGUF model:  ./scripts/llama-download-model.sh"
  info "  2. Start the server:       koboldcpp-server <model.gguf>"
  info "     or directly:            python3 $INSTALL_DIR/koboldcpp.py --model <model.gguf> --port $PORT"
  info "  3. Prism connects at:      http://localhost:$PORT"
  echo ""
  info "KoboldCpp features:"
  info "  - OpenAI-compatible API at /v1/chat/completions"
  info "  - KoboldAI API at /api/v1/generate"
  info "  - Built-in RAM estimation and smartcontext"
  info "  - Supports GGUF, GGML, Safetensors formats"
}

main "$@"
