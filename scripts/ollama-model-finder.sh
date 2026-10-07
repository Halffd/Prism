#!/usr/bin/env bash
set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
MAGENTA='\033[0;35m'
BLUE='\033[0;34m'
NC='\033[0m'

info()    { echo -e "${CYAN}[ollama]${NC} $*"; }
ok()      { echo -e "${GREEN}[ok]${NC} $*"; }
warn()    { echo -e "${YELLOW}[warn]${NC} $*"; }
err()     { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }
section() { echo -e "${MAGENTA}--- $1 ---${NC}"; }

OLLAMA_URL="${OLLAMA_API_URL:-http://localhost:11434}"

check_server() {
  if curl -sf "$OLLAMA_URL/api/version" &>/dev/null; then
    return 0
  else
    warn "Ollama server not responding at $OLLAMA_URL"
    info "Start it: ollama serve"
    echo -e "${CYAN}Continue anyway? [y/N]: ${NC}"
    read -rp "" cont
    if [[ ! "${cont:-}" =~ ^[Yy]$ ]]; then
      exit 1
    fi
  fi
}

ollama_api() {
  local endpoint="$1"
  shift
  curl -sf "$OLLAMA_URL$endpoint" "$@" 2>/dev/null || echo "{}"
}

list_installed() {
  info "Installed models at $OLLAMA_URL:"
  echo ""
  local response
  response=$(ollama_api "/api/tags")

  echo "$response" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    models = data.get('models', [])
    if not models:
        print('  (no models installed)')
    for m in models:
        name = m.get('name', '?')
        size_bytes = m.get('size', 0)
        size_gb = round(size_bytes / 1024**3, 1) if size_bytes else 0
        modified = m.get('modified_at', '?')[:10] if m.get('modified_at') else '?'
        fam = m.get('details', {}).get('family', '?')
        fmt = m.get('details', {}).get('format', '?')
        params = m.get('details', {}).get('parameter_size', '?')
        quant = m.get('details', {}).get('quantization_level', '?')
        print(f'  {name:<40s}  {size_gb:>5.1f} GB  {params:>10s}  {quant:<6s}  {fam:<12s}  {modified}')
except Exception as e:
    print(f'  Error parsing response: {e}')
" 2>/dev/null || echo "  (could not parse response)"

  echo ""
}

show_model_info() {
  local model_name="$1"
  info "Model info: $model_name"
  echo ""

  local response
  response=$(ollama_api "/api/show" -d "{\"name\":\"$model_name\"}")

  echo "$response" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    details = data.get('details', {})
    print(f'  Family:         {details.get(\"family\", \"?\")}')
    print(f'  Parameters:     {details.get(\"parameter_size\", \"?\")}')
    print(f'  Quantization:   {details.get(\"quantization_level\", \"?\")}')
    print(f'  Format:         {details.get(\"format\", \"?\")}')
    print(f'  Context length: {data.get(\"model_info\", {}).get(\"general.context_length\", \"?\")}')
    print(f'  License:        {details.get(\"license\", \"?\")}')

    modelfile = data.get('modelfile', '')
    if modelfile:
        print()
        print('  Modelfile:')
        for line in modelfile.split('\n')[:20]:
            print(f'    {line}')
        if len(modelfile.split('\n')) > 20:
            print('    ... (truncated)')
except Exception as e:
    print(f'  Error: {e}')
" 2>/dev/null || echo "  (could not parse response)"

  echo ""
}

pull_model() {
  local model_name="$1"
  info "Pulling model: $model_name"
  info "This may take a while depending on model size..."

  if ! command -v ollama &>/dev/null; then
    err "ollama CLI not found. Run ./scripts/ollama-setup.sh first."
  fi

  ollama pull "$model_name"
  ok "Pulled: $model_name"
}

delete_model() {
  local model_name="$1"
  warn "Delete model: $model_name"
  echo -e "${CYAN}Confirm? [y/N]: ${NC}"
  read -rp "" confirm
  if [[ "${confirm:-}" =~ ^[Yy]$ ]]; then
    ollama rm "$model_name" 2>/dev/null
    ok "Deleted: $model_name"
  else
    info "Cancelled."
  fi
}

CATALOG_GENERAL=(
  "llama3.2:1b:Llama 3.2 1B  (0.7 GB)  - Smallest Llama, fast on CPU"
  "llama3.2:3b:Llama 3.2 3B  (2 GB)  - Small chat, good for basic tasks"
  "llama3.1:8b:Llama 3.1 8B  (4.7 GB)  - General purpose, most popular"
  "llama3.1:70b:Llama 3.1 70B  (40 GB)  - High quality, needs 2x GPUs"
  "llama3.3:70b:Llama 3.3 70B  (40 GB)  - Latest Llama 3.3"
  "mistral:7b:Mistral 7B  (4.1 GB)  - Fast, efficient general purpose"
  "mistral-nemo:12b:Mistral Nemo 12B  (7.2 GB)  - Mistral mid-size"
  "mistral-large:123b:Mistral Large 123B  (70 GB)  - Flagship Mistral"
  "qwen2.5:0.5b:Qwen 2.5 0.5B  (0.4 GB)  - Tiny multilingual"
  "qwen2.5:1.5b:Qwen 2.5 1.5B  (0.9 GB)  - Small multilingual"
  "qwen2.5:3b:Qwen 2.5 3B  (1.9 GB)  - Compact multilingual"
  "qwen2.5:7b:Qwen 2.5 7B  (4.4 GB)  - Mid multilingual"
  "qwen2.5:14b:Qwen 2.5 14B  (8.4 GB)  - Large multilingual"
  "qwen2.5:32b:Qwen 2.5 32B  (18 GB)  - XL multilingual"
  "qwen2.5:72b:Qwen 2.5 72B  (41 GB)  - XXL multilingual"
  "gemma3:1b:Gemma 3 1B  (0.8 GB)  - Google's smallest"
  "gemma3:4b:Gemma 3 4B  (3.3 GB)  - Google mid-size"
  "gemma3:12b:Gemma 3 12B  (7.5 GB)  - Google large"
  "gemma3:27b:Gemma 3 27B  (16 GB)  - Google XL"
  "phi4-mini:3.8b:Phi-4 Mini 3.8B  (2.3 GB)  - Microsoft small"
  "phi4:14b:Phi-4 14B  (8.4 GB)  - Microsoft reasoning"
  "command-r:35b:Command-R 35B  (19 GB)  - Cohere RAG model"
  "command-r-plus:104b:Command-R+ 104B  (59 GB)  - Cohere flagship"
)

CATALOG_CODE=(
  "qwen2.5-coder:1.5b:Qwen Coder 1.5B  (0.9 GB)  - Tiny code model"
  "qwen2.5-coder:7b:Qwen Coder 7B  (4.4 GB)  - Popular code model"
  "qwen2.5-coder:14b:Qwen Coder 14B  (8.4 GB)  - High quality code"
  "qwen2.5-coder:32b:Qwen Coder 32B  (18 GB)  - XL code model"
  "deepseek-coder-v2:16b:DeepSeek Coder V2 16B  (8.8 GB)  - MoE code"
  "deepseek-coder:6.7b:DeepSeek Coder 6.7B  (3.6 GB)  - Compact code"
  "starcoder2:3b:StarCoder2 3B  (1.7 GB)  - Code completion"
  "starcoder2:7b:StarCoder2 7B  (3.7 GB)  - Code completion"
  "codellama:7b:CodeLlama 7B  (3.8 GB)  - Meta code model"
  "codellama:13b:CodeLlama 13B  (7.0 GB)  - Meta code mid"
  "codellama:34b:CodeLlama 34B  (18 GB)  - Meta code large"
  "codegemma:2b:CodeGemma 2B  (1.4 GB)  - Google code tiny"
  "codegemma:7b:CodeGemma 7B  (4.2 GB)  - Google code mid"
  "qwq:32b:QwQ 32B  (18 GB)  - Thinking/reasoning code"
)

CATALOG_VISION=(
  "llava:7b:LLaVA 7B  (4.1 GB)  - Vision + chat"
  "llava:13b:LLaVA 13B  (7.2 GB)  - Vision + chat larger"
  "llava-llama3:8b:LLaVA Llama3 8B  (4.9 GB)  - Llama3-based vision"
  "llama3.2-vision:11b:Llama 3.2 Vision 11B  (6.4 GB)  - Meta vision"
  "minicpm-v:8b:MiniCPM-V 8B  (4.5 GB)  - Efficient vision"
  "qwen2.5-vl:3b:Qwen 2.5 VL 3B  (2.2 GB)  - Qwen vision small"
  "qwen2.5-vl:7b:Qwen 2.5 VL 7B  (4.8 GB)  - Qwen vision mid"
  "qwen2.5-vl:32b:Qwen 2.5 VL 32B  (18 GB)  - Qwen vision large"
  "gemma3:4b:Gemma 3 4B  (3.3 GB)  - Built-in vision support"
  "gemma3:12b:Gemma 3 12B  (7.5 GB)  - Built-in vision support"
)

CATALOG_REASONING=(
  "deepseek-r1:1.5b:DeepSeek R1 1.5B  (0.9 GB)  - Smallest R1"
  "deepseek-r1:7b:DeepSeek R1 7B  (4.1 GB)  - Small reasoning"
  "deepseek-r1:8b:DeepSeek R1 8B  (4.7 GB)  - Llama-distill R1"
  "deepseek-r1:14b:DeepSeek R1 14B  (8.4 GB)  - Mid reasoning"
  "deepseek-r1:32b:DeepSeek R1 32B  (18 GB)  - Large reasoning"
  "deepseek-r1:70b:DeepSeek R1 70B  (40 GB)  - XL reasoning"
  "qwq:32b:QwQ 32B  (18 GB)  - Alibaba thinking model"
  "phi4:14b:Phi-4 14B  (8.4 GB)  - Microsoft reasoning"
  "qwen3:0.6b:Qwen3 0.6B  (0.4 GB)  - Thinking tiny"
  "qwen3:1.7b:Qwen3 1.7B  (1.1 GB)  - Thinking small"
  "qwen3:4b:Qwen3 4B  (2.5 GB)  - Thinking mid"
  "qwen3:8b:Qwen3 8B  (4.7 GB)  - Thinking large"
  "qwen3:14b:Qwen3 14B  (8.4 GB)  - Thinking XL"
  "qwen3:30b-a3b:Qwen3 30B MoE  (17 GB)  - MoE thinking"
)

CATALOG_EMBEDDING=(
  "nomic-embed-text:nomic-embed-text  (0.3 GB)  - Best quality/size"
  "mxbai-embed-large:mxbai-embed-large  (0.7 GB)  - MixedBread"
  "all-minilm:all-MiniLM-L6  (0.2 GB)  - Classic small embed"
  "snowflake-arctic-embed:snowflake-arctic-embed  (0.6 GB)  - Snowflake"
  "bge-m3:bge-m3  (1.2 GB)  - Multilingual embed"
  "e5-mistral-7b:e5-mistral-7b  (4.1 GB)  - High quality embed"
)

CATALOG_TOOLS=(
  "llama3.1:8b:Llama 3.1 8B  (4.7 GB)  - Best tool use support"
  "llama3.2:3b:Llama 3.2 3B  (2 GB)  - Small with tools"
  "mistral:7b:Mistral 7B  (4.1 GB)  - Function calling"
  "qwen2.5:7b:Qwen 2.5 7B  (4.4 GB)  - Tool use capable"
  "qwen2.5:14b:Qwen 2.5 14B  (8.4 GB)  - Strong tool use"
  "command-r:35b:Command-R 35B  (19 GB)  - RAG + tools"
  "hermes3:8b:Hermes 3 8B  (4.4 GB)  - Tool-calling fine-tune"
)

CATALOG_SPEECH=(
  "whisper:whisper-base  (0.1 GB)  - English STT"
  "whisper:medium:whisper-medium  (1.5 GB)  - Multilingual STT"
  "faster-whisper:tiny:faster-whisper tiny  (0.04 GB)  - Ultra-fast STT"
)

CATALOG_FUN=(
  "dolphin-mistral:7b:Dolphin Mistral 7B  (4.1 GB)  - Uncensored chat"
  "dolphin-llama3:8b:Dolphin Llama3 8B  (4.7 GB)  - Uncensored Llama3"
  "zephyr:7b:Zephyr 7B  (4.1 GB)  - Friendly chat"
  "openhermes2.5:7b:OpenHermes 2.5 7B  (4.1 GB)  - Creative writing"
  "mythomax:13b:MythoMax 13B  (7.2 GB)  - Storytelling/RP"
  "samantha-mistral:7b:Samantha 7B  (4.1 GB)  - Companion chat"
  "neural-chat:7b:Neural Chat 7B  (4.1 GB)  - Conversational"
  "noromaid:20b:Noromaid 20B  (11 GB)  - Creative/RP"
  "wizard-vicuna:7b:Wizard Vicuna 7B  (3.8 GB)  - Instruction"
)

ALL_OALLAMA_GROUPS=(
  "CATALOG_GENERAL:General Chat"
  "CATALOG_CODE:Code / Programming"
  "CATALOG_VISION:Vision / Multimodal"
  "CATALOG_REASONING:Reasoning / Thinking"
  "CATALOG_EMBEDDING:Embedding / RAG"
  "CATALOG_TOOLS:Tool Use / Function Calling"
  "CATALOG_SPEECH:Speech / STT"
  "CATALOG_FUN:Fine-tuned / Creative / RP"
)

list_catalog() {
  echo ""
  echo -e "${CYAN}============================================${NC}"
  echo -e "${CYAN} Ollama Model Catalog for Prism${NC}"
  echo -e "${CYAN}============================================${NC}"
  echo ""

  local idx=1
  for group_def in "${ALL_OALLAMA_GROUPS[@]}"; do
    local varname="${group_def%%:*}"
    local label="${group_def##*:}"
    section "$label"
    local -n entries="$varname"
    for entry in "${entries[@]}"; do
      local model_name="${entry%%:*}"
      local desc="${entry#*:}"
      desc="${desc#*:}"
      printf "  %3d) %-25s  %s\n" "$idx" "$model_name" "$desc"
      ((idx++)) || true
    done
    echo ""
  done
}

get_all_catalog_entries() {
  for group_def in "${ALL_OALLAMA_GROUPS[@]}"; do
    local varname="${group_def%%:*}"
    local -n entries="$varname"
    for entry in "${entries[@]}"; do
      echo "$entry"
    done
  done
}

search_ollama_library() {
  local query="$1"
  info "Searching Ollama library API for: '$query' ..."
  echo ""

  local search_url="https://ollama.com/api/models?q=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$query'))" 2>/dev/null || echo "$query")"

  local response
  response=$(curl -sf "$search_url" 2>/dev/null || echo "[]")

  if [ "$response" = "[]" ] || [ -z "$response" ]; then
    warn "No results from Ollama library API."
    info "Try browsing: https://ollama.com/search?q=${query}"
    return
  fi

  echo "$response" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    models = data if isinstance(data, list) else data.get('models', [])
    if not models:
        print('  No results found.')
    for i, m in enumerate(models[:30], 1):
        name = m.get('name', m.get('id', '?'))
        desc = m.get('description', m.get('meta', {}).get('description', ''))
        pulls = m.get('pulls', m.get('download_count', '?'))
        size = m.get('size', '')
        size_str = f'{round(size/1024**3, 1)} GB' if isinstance(size, int) and size > 0 else ''
        pulls_str = f'{pulls:,}' if isinstance(pulls, int) else str(pulls)
        line = f' {i:>3}) {name:<30s}'
        if size_str:
            line += f' {size_str:<10s}'
        if pulls_str and pulls_str != '?':
            line += f' pulls: {pulls_str}'
        if desc:
            line += f'  {desc[:60]}'
        print(line)
except Exception as e:
    print(f'  Error parsing: {e}')
" 2>/dev/null

  if [ $? -ne 0 ]; then
    warn "Could not parse API response."
    info "Browse online: https://ollama.com/search?q=${query}"
  fi
}

search_ollama() {
  local query="$1"
  info "Searching for: '$query' ..."
  echo ""

  if command -v ollama &>/dev/null; then
    info "Installed models matching '$query':"
    ollama list 2>/dev/null | grep -i "$query" || echo "  (none)"
    echo ""
  fi

  info "Local catalog matches:"
  local all_entries
  all_entries=$(get_all_catalog_entries)
  local match_idx=1
  local matches=()

  while IFS= read -r entry; do
    local model_name="${entry%%:*}"
    local rest="${entry#*:}"
    local desc="${rest#*:}"
    if echo "$model_name $desc" | grep -qi "$query"; then
      matches+=("$model_name")
      printf " %3d) %-25s %s\n" "$match_idx" "$model_name" "$desc"
      ((match_idx++)) || true
    fi
  done <<< "$all_entries"

  if [ ${#matches[@]} -eq 0 ]; then
    warn "No local catalog matches."
  fi

  echo ""
  echo -e "${CYAN}Search Ollama library online? [Y/n]: ${NC}"
  read -rp "" do_api
  if [[ ! "${do_api:-y}" =~ ^[Nn]$ ]]; then
    echo ""
    search_ollama_library "$query"
  fi

  echo ""
  info "Also browse: https://ollama.com/search?q=${query}"
  echo ""

  local all_choices=("${matches[@]}")
  if [ ${#all_choices[@]} -eq 0 ]; then
    echo -e "${CYAN}Enter model name to pull, or Enter to skip.${NC}"
    read -rp "$(echo -e "${CYAN}Model: ${NC}")" choice
    if [ -n "$choice" ]; then
      pull_model "$choice"
    fi
    return
  fi

  echo -e "${CYAN}Enter number to pull from catalog, model name to pull, or Enter to skip.${NC}"
  read -rp "$(echo -e "${CYAN}Choice: ${NC}")" choice

  if [ -z "$choice" ]; then
    return
  fi

  if [[ "$choice" =~ ^[0-9]+$ ]]; then
    local sel=$((choice - 1))
    if [ "$sel" -ge 0 ] && [ "$sel" -lt "${#all_choices[@]}" ]; then
      pull_model "${all_choices[$sel]}"
    else
      warn "Out of range."
    fi
  else
    pull_model "$choice"
  fi
}

run_model() {
  local model_name="$1"
  info "Running: ollama run $model_name"
  info "Type /bye to exit chat."
  echo ""
  ollama run "$model_name"
}

interactive() {
  check_server

  while true; do
    echo ""
    echo -e "${CYAN}============================================${NC}"
    echo -e "${CYAN} Ollama Model Finder for Prism${NC}"
    echo -e "${CYAN}============================================${NC}"
    echo ""
    echo " 1) Browse catalog (curated models by category)"
    echo " 2) Search models (local + Ollama library API)"
    echo " 3) List installed (show pulled models)"
    echo " 4) Pull model (download by name, e.g. llama3.2:3b)"
    echo " 5) Model info (details about a model)"
    echo " 6) Run model (start interactive chat)"
    echo " 7) Delete model (remove a pulled model)"
    echo " 8) Size guide (RAM requirements)"
    echo " 9) Search library (Ollama.com API only)"
    echo " 10) Exit"
    echo ""
    read -rp "$(echo -e "${CYAN}Action [1-10]: ${NC}")" action

    case "${action:-1}" in
      1)
        list_catalog
        echo -e "${CYAN}Enter model numbers (comma-separated) to pull, or Enter to skip.${NC}"
        read -rp "$(echo -e "${CYAN}Choice: ${NC}")" choice
        choice="${choice// /}"
        if [ -z "$choice" ]; then
          continue
        fi

        local all_entries=()
        while IFS= read -r entry; do
          all_entries+=("$entry")
        done < <(get_all_catalog_entries)

        IFS=',' read -ra nums <<< "$choice"
        for num in "${nums[@]}"; do
          if ! [[ "$num" =~ ^[0-9]+$ ]]; then
            warn "Skipping invalid: $num"
            continue
          fi
          local idx=$((num - 1))
          if [ "$idx" -lt 0 ] || [ "$idx" -ge "${#all_entries[@]}" ]; then
            warn "Out of range: $num"
            continue
          fi
          local entry="${all_entries[$idx]}"
          local model_name="${entry%%:*}"
          pull_model "$model_name"
        done
        ;;
      2)
        echo -e "${CYAN}Search query (e.g. 'code', 'vision', 'llama', 'small'):${NC}"
        read -rp "$(echo -e "${CYAN}Query: ${NC}")" query
        if [ -n "$query" ]; then
          search_ollama "$query"
        fi
        ;;
      3)
        list_installed
        ;;
      4)
        echo -e "${CYAN}Model name (e.g. llama3.2:3b, qwen2.5-coder:7b):${NC}"
        read -rp "$(echo -e "${CYAN}Model: ${NC}")" model
        if [ -n "$model" ]; then
          pull_model "$model"
        fi
        ;;
      5)
        echo -e "${CYAN}Model name to inspect:${NC}"
        read -rp "$(echo -e "${CYAN}Model: ${NC}")" model
        if [ -n "$model" ]; then
          show_model_info "$model"
        fi
        ;;
      6)
        echo -e "${CYAN}Model name to run:${NC}"
        read -rp "$(echo -e "${CYAN}Model: ${NC}")" model
        if [ -n "$model" ]; then
          run_model "$model"
        fi
        ;;
      7)
        list_installed
        echo -e "${CYAN}Model name to delete:${NC}"
        read -rp "$(echo -e "${CYAN}Model: ${NC}")" model
        if [ -n "$model" ]; then
          delete_model "$model"
        fi
        ;;
  8)
    show_size_guide
    ;;
  9)
    echo -e "${CYAN}Search Ollama library (e.g. 'math', 'japanese', 'medical'):${NC}"
    read -rp "$(echo -e "${CYAN}Query: ${NC}")" query
    if [ -n "$query" ]; then
      search_ollama_library "$query"
      echo ""
      echo -e "${CYAN}Enter model name to pull, or Enter to skip.${NC}"
      read -rp "$(echo -e "${CYAN}Model: ${NC}")" model
      if [ -n "$model" ]; then
        pull_model "$model"
      fi
    fi
    ;;
  10|q|quit)
        break
        ;;
      *)
        warn "Invalid choice."
        ;;
    esac
  done
}

show_size_guide() {
  echo ""
  section "RAM Requirements Guide"
  echo ""
  printf "  %-20s %-12s %s\n" "Model" "Model Size" "Min RAM"
  printf "  %-20s %-12s %s\n" "--------------------" "-----------" "--------"
  printf "  %-20s %-12s %s\n" "0.5-1B"  "0.3-0.6 GB" "1 GB"
  printf "  %-20s %-12s %s\n" "1.5-3B"  "0.8-2 GB"   "4 GB"
  printf "  %-20s %-12s %s\n" "7-8B"    "4-5 GB"     "8 GB"
  printf "  %-20s %-12s %s\n" "12-14B"  "7-9 GB"     "16 GB"
  printf "  %-20s %-12s %s\n" "24-32B"  "14-20 GB"   "32 GB"
  printf "  %-20s %-12s %s\n" "70B+"    "38-45 GB"   "48+ GB (multi-GPU)"
  echo ""
  info "Tips:"
  info "  - Q4_K_M quantization is ~60% of F16 size"
  info "  - Add ~1-2 GB overhead for context/KV cache"
  info "  - macOS: unified memory (M1/M2/M3) shares GPU+CPU"
  info "  - NVIDIA: GPU VRAM must hold model + context"
  info "  - Use --n-gpu-layers 0 for CPU-only (slow but works)"
  echo ""
}

noninteractive() {
  local cmd="${1:-pull}"
  local model="${2:-}"

  case "$cmd" in
    pull)
      [ -z "$model" ] && err "Usage: $0 pull <model-name>"
      pull_model "$model"
      ;;
    list)
      list_installed
      ;;
    info)
      [ -z "$model" ] && err "Usage: $0 info <model-name>"
      show_model_info "$model"
      ;;
    search)
      [ -z "$model" ] && err "Usage: $0 search <query>"
      search_ollama "$model"
      ;;
    run)
      [ -z "$model" ] && err "Usage: $0 run <model-name>"
      run_model "$model"
      ;;
    delete|rm)
      [ -z "$model" ] && err "Usage: $0 delete <model-name>"
      delete_model "$model"
      ;;
    *)
      err "Unknown command: $cmd. Use: pull, list, info, search, run, delete"
      ;;
  esac
}

usage() {
  cat << 'EOF'
Usage: ollama-model-finder.sh [COMMAND] [ARG]

Interactive model browser and manager for Ollama.

Commands:
  (no args)     Interactive menu
  pull MODEL    Pull a model by name
  list          List installed models
  info MODEL    Show model details
  search QUERY  Search catalog by keyword
  run MODEL     Run interactive chat
  delete MODEL  Delete a model

Examples:
  # Interactive
  ./scripts/ollama-model-finder.sh

  # Pull a specific model
  ./scripts/ollama-model-finder.sh pull llama3.2:3b

  # Search for coding models
  ./scripts/ollama-model-finder.sh search code

  # List what's installed
  ./scripts/ollama-model-finder.sh list
EOF
}

main() {
  if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
    usage
    exit 0
  fi

  if [ -n "${1:-}" ]; then
    noninteractive "$@"
  else
    interactive
  fi
}

main "$@"
