#!/usr/bin/env bash
set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info() { echo -e "${CYAN}[sglang]${NC} $*"; }
ok()   { echo -e "${GREEN}[ok]${NC} $*"; }
warn() { echo -e "${YELLOW}[warn]${NC} $*"; }
err()  { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }

INSTALL_DIR="${SGLANG_DIR:-$HOME/.sglang}"
PORT="${SGLANG_PORT:-30000}"
GPU_BACKEND="${SGLANG_GPU:-auto}"
BRANCH="${SGLANG_BRANCH:-main}"

detect_gpu() {
  if [ "$GPU_BACKEND" != "auto" ]; then
    echo "$GPU_BACKEND"
    return
  fi
  if command -v nvidia-smi &>/dev/null && nvidia-smi &>/dev/null; then
    echo "cuda"
  elif command -v rocminfo &>/dev/null 2>/dev/null && rocminfo &>/dev/null; then
    echo "rocm"
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

install_python_deps() {
  local gpu="$1"
  info "Installing Python dependencies..."

  if ! command -v python3 &>/dev/null; then
    local pkg_mgr
    pkg_mgr=$(detect_pkg_manager)
    case "$pkg_mgr" in
      pacman) sudo pacman -S --needed --noconfirm python python-pip python-venv ;;
      dnf) sudo dnf install -y python3 python3-pip ;;
      apt) sudo apt-get update -qq && sudo apt-get install -y -qq python3 python3-pip python3-venv ;;
      zypper) sudo zypper install -y python3 python3-pip ;;
      apk) sudo apk add python3 py3-pip ;;
      *) warn "Install Python 3.10+ manually: https://www.python.org/downloads/" ;;
    esac
  fi

  local pyver
  pyver=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || echo "0")
  if [[ "$(echo "$pyver" | awk -F. '{print ($1*100)+$2}')" -lt 310 ]]; then
    err "SGLang requires Python 3.10+. You have $pyver. Upgrade Python first."
  fi
  ok "Python $pyver found."
}

create_venv() {
  mkdir -p "$INSTALL_DIR"
  if [ ! -d "$INSTALL_DIR/venv" ]; then
    info "Creating Python virtual environment at $INSTALL_DIR/venv..."
    python3 -m venv "$INSTALL_DIR/venv"
    ok "Virtual environment created."
  else
    info "Using existing virtual environment at $INSTALL_DIR/venv."
  fi
}

install_sglang() {
  local gpu="$1"
  create_venv

  local pip="$INSTALL_DIR/venv/bin/pip"
  local python="$INSTALL_DIR/venv/bin/python"

  info "Upgrading pip..."
  "$python" -m pip install --upgrade pip --quiet 2>/dev/null || true

  case "$gpu" in
    cuda)
      info "Installing SGLang with CUDA support..."
      "$pip" install "sglang[all]" --find-links https://flashinfer.ai/whl/cu121/ --quiet 2>&1 || {
        warn "FlashInfer CUDA install failed, trying default..."
        "$pip" install "sglang[all]" --quiet 2>&1 || err "SGLang install failed."
      }
      ;;
    rocm)
      info "Installing SGLang with ROCm support..."
      warn "ROCm support is experimental. SGLang primarily targets NVIDIA GPUs."
      "$pip" install "sglang[all]" --quiet 2>&1 || err "SGLang install failed."
      ;;
    *)
      info "Installing SGLang (CPU mode — will be very slow)..."
      warn "SGLang is designed for GPU inference. CPU mode has severe limitations."
      "$pip" install sglang --quiet 2>&1 || err "SGLang install failed."
      ;;
  esac

  ok "SGLang installed."
}

check_cuda() {
  if command -v nvcc &>/dev/null; then
    ok "CUDA toolkit found: $(nvcc --version | grep release | grep -oP '[\d.]+' | head -1 || echo 'installed')"
  else
    warn "nvcc not found in PATH. SGLang needs CUDA for GPU inference."
    info "Install CUDA: https://developer.nvidia.com/cuda-downloads"
    echo ""
    echo -e "${CYAN}Continue without CUDA verification? [y/N]: ${NC}"
    read -rp "" cont
    if [[ ! "${cont:-}" =~ ^[Yy]$ ]]; then
      exit 0
    fi
  fi
}

install_bins() {
  local bindir="$HOME/.local/bin"
  mkdir -p "$bindir"

  local python="$INSTALL_DIR/venv/bin/python"

  cat > "$bindir/sglang-server" << SCRIPT
#!/usr/bin/env bash
# Start SGLang server for Prism (OpenAI-compatible API)
# Usage: sglang-server <model> [additional args...]
set -euo pipefail

SGLANG_PYTHON="$INSTALL_DIR/venv/bin/python"
PORT="\${SGLANG_PORT:-$PORT}"
GPU_BACKEND="\${SGLANG_GPU:-auto}"
HOST="\${SGLANG_HOST:-0.0.0.0}"

MODEL="\${1:-}"
if [ -z "\$MODEL" ]; then
  echo "Usage: sglang-server <model_name_or_path> [args]"
  echo ""
  echo "Examples:"
  echo "  sglang-server meta-llama/Meta-Llama-3.1-8B-Instruct"
  echo "  sglang-server ./local/model-directory"
  echo "  sglang-server --model-path meta-llama/Meta-Llama-3.1-8B-Instruct --tp 2"
  exit 1
fi

echo "Starting SGLang server on port \$PORT with model: \$MODEL"

exec "\$SGLANG_PYTHON" -m sglang.launch_server \\
  --model-path "\$MODEL" \\
  --port "\$PORT" \\
  --host "\$HOST" \\
  "\${@:2}"
SCRIPT
  chmod +x "$bindir/sglang-server"
  ok "sglang-server helper installed to $bindir/sglang-server"

  cat > "$bindir/sglang-worker" << 'SCRIPT'
#!/usr/bin/env bash
# Start SGLang worker (for multi-node setups)
# Usage: sglang-worker <model> --gpu-id <id> [additional args...]
set -euo pipefail

SGLANG_PYTHON="$HOME/.sglang/venv/bin/python"

MODEL="${1:-}"
if [ -z "$MODEL" ]; then
  echo "Usage: sglang-worker <model_name_or_path> --gpu-id <id> [args]"
  exit 1
fi

exec "$SGLANG_PYTHON" -m sglang.launch_server \
  --model-path "$MODEL" \
  --worker-only \
  "${@:2}"
SCRIPT
  chmod +x "$bindir/sglang-worker"
  ok "sglang-worker helper installed to $bindir/sglang-worker"
}

show_model_suggestions() {
  echo ""
  info "Popular models for SGLang (HuggingFace format, auto-downloaded):"
  echo ""
  echo -e "  ${CYAN}General Chat:${NC}"
  echo "    meta-llama/Meta-Llama-3.1-8B-Instruct"
  echo "    meta-llama/Meta-Llama-3.1-70B-Instruct"
  echo "    Qwen/Qwen2.5-7B-Instruct"
  echo "    Qwen/Qwen2.5-32B-Instruct"
  echo "    mistralai/Mistral-7B-Instruct-v0.3"
  echo "    mistralai/Mixtral-8x7B-Instruct-v0.1"
  echo ""
  echo -e "  ${CYAN}Code:${NC}"
  echo "    Qwen/Qwen2.5-Coder-7B-Instruct"
  echo "    Qwen/Qwen2.5-Coder-32B-Instruct"
  echo "    deepseek-ai/DeepSeek-Coder-V2-Lite-Instruct"
  echo ""
  echo -e "  ${CYAN}Vision-Language:${NC}"
  echo "    Qwen/Qwen2-VL-7B-Instruct"
  echo "    meta-llama/Llama-3.2-11B-Vision-Instruct"
  echo ""
  echo -e "  ${CYAN}Reasoning:${NC}"
  echo "    deepseek-ai/DeepSeek-R1-Distill-Llama-8B"
  echo "    Qwen/QwQ-32B-Preview"
  echo ""
  echo -e "  ${CYAN}Multi-GPU (tensor parallel):${NC}"
  echo "    sglang-server meta-llama/Meta-Llama-3.1-70B-Instruct --tp 2"
  echo "    sglang-server meta-llama/Meta-Llama-3.1-70B-Instruct --tp 4"
  echo ""
  info "Set HF_TOKEN for gated models: export HF_TOKEN=hf_..."
  info "Models are cached at: ~/.cache/huggingface/hub/"
}

main() {
  echo ""
  echo -e "${CYAN}========================================${NC}"
  echo -e "${CYAN} SGLang Setup for Prism${NC}"
  echo -e "${CYAN}========================================${NC}"
  echo ""

  local gpu
  gpu=$(detect_gpu)
  info "Detected GPU backend: $gpu"
  info "Install dir: $INSTALL_DIR"
  info "Server port: $PORT"
  echo ""

  if [ "$gpu" != "cuda" ] && [ "$gpu" != "rocm" ]; then
    warn "SGLang is designed for NVIDIA GPUs (CUDA). CPU/other backends have severe limitations."
    echo -e "${CYAN}Continue anyway? [y/N]: ${NC}"
    read -rp "" cont
    if [[ ! "${cont:-}" =~ ^[Yy]$ ]]; then
      exit 0
    fi
  fi

  install_python_deps "$gpu"

  if [ "$gpu" = "cuda" ]; then
    check_cuda
  fi

  install_sglang "$gpu"
  install_bins

  echo ""
  ok "SGLang setup complete!"
  show_model_suggestions

  echo ""
  info "Next steps:"
  info "  1. Start the server:  sglang-server meta-llama/Meta-Llama-3.1-8B-Instruct"
  info "  2. Prism connects at:  http://localhost:$PORT"
  info "  3. OpenAI-compatible API:  http://localhost:$PORT/v1/chat/completions"
  echo ""
  info "SGLang features:"
  info "  - Fast inference with RadixAttention and continuous batching"
  info "  - OpenAI-compatible API at /v1/*"
  info "  - Multi-GPU support via --tp (tensor parallelism)"
  info "  - Automatic model download from HuggingFace"
  info "  - Vision-language model support"
  info "  - Streaming responses"
}

main "$@"
