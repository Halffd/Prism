#!/usr/bin/env bash
set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info() { echo -e "${CYAN}[llama-run]${NC} $*"; }
ok()   { echo -e "${GREEN}[ok]${NC} $*"; }
warn() { echo -e "${YELLOW}[warn]${NC} $*"; }
err()  { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }

MODEL_DIR="${LLAMA_MODELS_DIR:-$HOME/.llama/models}"
HOST="${LLAMA_HOST:-0.0.0.0}"
PORT="${LLAMA_PORT:-8080}"
CTX_SIZE="${LLAMA_CTX_SIZE:-4096}"
N_GPU_LAYERS="${LLAMA_N_GPU_LAYERS:--1}"
N_THREADS="${LLAMA_THREADS:-$(nproc 2>/dev/null || echo 4)}"
BATCH_SIZE="${LLAMA_BATCH_SIZE:-512}"
UBATCH_SIZE="${LLAMA_UBATCH_SIZE:-128}"
FLASH_ATTN="${LLAMA_FLASH_ATTN:-1}"
ROPE_FREQ_BASE="${LLAMA_ROPE_FREQ_BASE:-0}"
MLOCK="${LLAMA_MLOCK:-0}"
MMAP="${LLAMA_MMAP:-1}"
CONT_BATCHING="${LLAMA_CONT_BATCHING:-1}"

find_server() {
  if command -v llama-server &>/dev/null; then
    echo "llama-server"
    return
  fi
  local bindir="$HOME/.local/bin"
  if [ -f "$bindir/llama-server" ]; then
    echo "$bindir/llama-server"
    return
  fi
  local repodir="${LLAMA_CPP_DIR:-$HOME/.llama.cpp}"
  if [ -f "$repodir/build/bin/llama-server" ]; then
    echo "$repodir/build/bin/llama-server"
    return
  fi
  if [ -f "$repodir/llama-server" ]; then
    echo "$repodir/llama-server"
    return
  fi
  err "llama-server not found. Run ./scripts/llama-setup.sh first."
}

find_model() {
  local input="$1"

  if [ -f "$input" ]; then
    echo "$input"
    return
  fi

  if [ -f "$MODEL_DIR/$input" ]; then
    echo "$MODEL_DIR/$input"
    return
  fi

  local found
  found=$(find "$MODEL_DIR" -name "$input" -type f 2>/dev/null | head -1)
  if [ -n "$found" ]; then
    echo "$found"
    return
  fi

  err "Model file not found: $input
  Searched:
    - $input (as-is)
    - $MODEL_DIR/$input
    - $MODEL_DIR/**/$input (recursive)
  Run ./scripts/llama-download-model.sh to download a model."
}

pick_model_interactive() {
  local models=()
  while IFS= read -r f; do
    models+=("$f")
  done < <(find "$MODEL_DIR" -name '*.gguf' -type f 2>/dev/null | sort)

  if [ ${#models[@]} -eq 0 ]; then
    err "No GGUF models found in $MODEL_DIR
    Run ./scripts/llama-download-model.sh to download one."
  fi

  echo ""
  echo -e "${CYAN}===== Available Models =====${NC}"
  for i in "${!models[@]}"; do
    local fsize
    fsize=$(stat -f%z "${models[$i]}" 2>/dev/null || stat -c%s "${models[$i]}" 2>/dev/null || echo "0")
    local fsize_gb=$(echo "scale=1; $fsize / 1024 / 1024 / 1024" | bc 2>/dev/null || echo "?")
    local fname="${models[$i]##*/}"
    printf "  %3d) %-40s  %s GB\n" "$((i+1))" "$fname" "$fsize_gb"
  done
  echo ""

  read -rp "$(echo -e "${CYAN}Select model number: ${NC}")" num
  if ! [[ "$num" =~ ^[0-9]+$ ]] || [ "$num" -lt 1 ] || [ "$num" -gt "${#models[@]}" ]; then
    err "Invalid selection."
  fi
  echo "${models[$((num-1))]}"
}

usage() {
  cat << 'EOF'
Usage: llama-run.sh [OPTIONS] [MODEL]

Start llama.cpp OpenAI-compatible server for Prism.

Options:
  -m, --model FILE        GGUF model file path
  -p, --port PORT         Server port (default: 8080)
  -H, --host HOST         Bind host (default: 0.0.0.0)
  -c, --ctx-size N        Context window size (default: 4096)
  -ngl, --n-gpu-layers N  GPU layers, -1=all (default: -1)
  -t, --threads N         CPU threads (default: nproc)
  -b, --batch-size N      Batch size (default: 512)
  -ub, --ubatch-size N    Micro-batch size (default: 128)
  --no-flash-attn         Disable Flash Attention
  --no-mmap               Disable memory mapping
  --mlock                 Lock model in RAM
  --rope-freq-base F      RoPE frequency base (0=auto)
  --no-cont-batching      Disable continuous batching
  -h, --help              Show this help

Environment Variables:
  LLAMA_MODELS_DIR        Model storage directory (default: ~/.llama/models)
  LLAMA_CPP_DIR           llama.cpp source directory (default: ~/.llama.cpp)
  LLAMA_HOST              Bind host (default: 0.0.0.0)
  LLAMA_PORT              Server port (default: 8080)
  LLAMA_CTX_SIZE          Context window size (default: 4096)
  LLAMA_N_GPU_LAYERS      GPU layers, -1=all (default: -1)
  LLAMA_THREADS           CPU threads (default: nproc)
  LLAMA_BATCH_SIZE        Batch size (default: 512)
  LLAMA_UBATCH_SIZE       Micro-batch size (default: 128)
  LLAMA_FLASH_ATTN        Flash Attention 1=on 0=off (default: 1)
  LLAMA_MMAP              Memory mapping 1=on 0=off (default: 1)
  LLAMA_MLOCK             Lock in RAM 1=on 0=off (default: 0)
  LLAMA_CONT_BATCHING     Continuous batching 1=on 0=off (default: 1)

Examples:
  # Interactive model picker
  ./scripts/llama-run.sh

  # Specific model
  ./scripts/llama-run.sh ~/.llama/models/bartowski_Meta-Llama-3.1-8B-Instruct-GGUF/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf

  # Custom port and context
  ./scripts/llama-run.sh -p 9090 -c 8192 -m model.gguf

  # CPU-only mode
  ./scripts/llama-run.sh -ngl 0 -m model.gguf

  # Connect from Prism: set provider to 'llamacpp', API URL to http://localhost:8080
EOF
}

main() {
  local model_arg=""
  local pos_args=()

  while [ $# -gt 0 ]; do
    case "$1" in
      -m|--model)       model_arg="$2"; shift 2 ;;
      -p|--port)        PORT="$2"; shift 2 ;;
      -H|--host)        HOST="$2"; shift 2 ;;
      -c|--ctx-size)    CTX_SIZE="$2"; shift 2 ;;
      -ngl|--n-gpu-layers) N_GPU_LAYERS="$2"; shift 2 ;;
      -t|--threads)     N_THREADS="$2"; shift 2 ;;
      -b|--batch-size)  BATCH_SIZE="$2"; shift 2 ;;
      -ub|--ubatch-size) UBATCH_SIZE="$2"; shift 2 ;;
      --no-flash-attn)  FLASH_ATTN=0; shift ;;
      --no-mmap)        MMAP=0; shift ;;
      --mlock)          MLOCK=1; shift ;;
      --rope-freq-base) ROPE_FREQ_BASE="$2"; shift 2 ;;
      --no-cont-batching) CONT_BATCHING=0; shift ;;
      -h|--help)        usage; exit 0 ;;
      -*)               err "Unknown option: $1. Use --help." ;;
      *)                pos_args+=("$1"); shift ;;
    esac
  done

  if [ -n "$model_arg" ]; then
    model_arg=$(find_model "$model_arg")
  elif [ ${#pos_args[@]} -gt 0 ]; then
    model_arg=$(find_model "${pos_args[0]}")
  else
    model_arg=$(pick_model_interactive)
  fi

  local server_bin
  server_bin=$(find_server)

  echo ""
  echo -e "${CYAN}========================================${NC}"
  echo -e "${CYAN} llama.cpp Server for Prism${NC}"
  echo -e "${CYAN}========================================${NC}"
  echo ""
  info "Binary:   $server_bin"
  info "Model:    $model_arg"
  info "Host:     $HOST"
  info "Port:     $PORT"
  info "Context:  $CTX_SIZE"
  info "GPU:      $N_GPU_LAYERS layers (-1 = all)"
  info "Threads:  $N_THREADS"
  info "Batch:    $BATCH_SIZE / $UBATCH_SIZE"
  info "FlashAttn:$FLASH_ATTN  MMAP: $MMAP  MLock: $MLOCK  ContBatch: $CONT_BATCHING"
  echo ""
  info "Prism endpoint: http://localhost:$PORT"
  info "OpenAI API:     http://localhost:$PORT/v1/chat/completions"
  info "Models list:    http://localhost:$PORT/v1/models"
  info "Server health:  http://localhost:$PORT/health"
  echo ""
  ok "Starting server..."
  echo ""

  local cmd=(
    "$server_bin"
    --model "$model_arg"
    --host "$HOST"
    --port "$PORT"
    --ctx-size "$CTX_SIZE"
    --n-gpu-layers "$N_GPU_LAYERS"
    --threads "$N_THREADS"
    --batch-size "$BATCH_SIZE"
    --ubatch-size "$UBATCH_SIZE"
    --parallel 4
  )

  if [ "$FLASH_ATTN" = "1" ]; then cmd+=(--flash-attn); fi
  if [ "$MMAP" = "0" ]; then cmd+=(--no-mmap); fi
  if [ "$MLOCK" = "1" ]; then cmd+=(--mlock); fi
  if [ "$CONT_BATCHING" = "1" ]; then cmd+=(--cont-batching); fi
  if [ "$ROPE_FREQ_BASE" != "0" ]; then cmd+=(--rope-freq-base "$ROPE_FREQ_BASE"); fi

  exec "${cmd[@]}"
}

main "$@"
