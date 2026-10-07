#!/usr/bin/env bash
set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
MAGENTA='\033[0;35m'
NC='\033[0m'

info()    { echo -e "${CYAN}[gguf]${NC} $*"; }
ok()      { echo -e "${GREEN}[ok]${NC} $*"; }
warn()    { echo -e "${YELLOW}[warn]${NC} $*"; }
err()     { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }
section() { echo -e "${MAGENTA}--- $1 ---${NC}"; }

MODEL_DIR="${LLAMA_MODELS_DIR:-$HOME/.llama/models}"
HF_MIRROR="${HF_MIRROR:-https://huggingface.co}"
HF_API="${HF_API:-https://huggingface.co/api}"
HF_TOKEN="${HF_TOKEN:-}"

mkdir -p "$MODEL_DIR"

curl_opts=(-L -C - -# --fail)
if [ -n "$HF_TOKEN" ]; then
  curl_opts+=(-H "Authorization: Bearer $HF_TOKEN")
fi
wget_opts=(--continue --progress=bar:force:noscroll)
if [ -n "$HF_TOKEN" ]; then
  wget_opts+=(--header="Authorization: Bearer $HF_TOKEN")
fi

MODELS_TINY=(
  "bartowski/Qwen2.5-0.5B-Instruct-GGUF:Qwen2.5-0.5B-Instruct-Q8_0.gguf"
  "bartowski/Llama-3.2-1B-Instruct-GGUF:Llama-3.2-1B-Instruct-Q4_K_M.gguf"
  "bartowski/SmolLM2-1.7B-Instruct-GGUF:SmolLM2-1.7B-Instruct-Q6_K.gguf"
  "bartowski/Phi-3.5-mini-instruct-GGUF:Phi-3.5-mini-instruct-Q4_K_M.gguf"
  "bartowski/Llama-3.2-3B-Instruct-GGUF:Llama-3.2-3B-Instruct-Q4_K_M.gguf"
  "bartowski/Gemma-3-1b-it-GGUF:Gemma-3-1b-it-Q4_K_M.gguf"
  "bartowski/Qwen3-1.7B-GGUF:Qwen3-1.7B-Q4_K_M.gguf"
)

MODELS_SMALL=(
  "bartowski/Meta-Llama-3.1-8B-Instruct-GGUF:Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf"
  "bartowski/Mistral-7B-Instruct-v0.3-GGUF:Mistral-7B-Instruct-v0.3-Q4_K_M.gguf"
  "bartowski/Qwen2.5-7B-Instruct-GGUF:Qwen2.5-7B-Instruct-Q4_K_M.gguf"
  "bartowski/Gemma-3-4b-it-GGUF:Gemma-3-4b-it-Q4_K_M.gguf"
  "bartowski/Mistral-Small-24B-Instruct-2501-GGUF:Mistral-Small-24B-Instruct-2501-Q4_K_M.gguf"
  "bartowski/Qwen3-4B-GGUF:Qwen3-4B-Q4_K_M.gguf"
  "bartowski/Llama-3.1-8B-Instruct-GGUF:Llama-3.1-8B-Instruct-Q8_0.gguf"
  "bartowski/Phi-4-mini-instruct-GGUF:Phi-4-mini-instruct-Q4_K_M.gguf"
)

MODELS_MEDIUM=(
  "bartowski/Qwen2.5-14B-Instruct-GGUF:Qwen2.5-14B-Instruct-Q4_K_M.gguf"
  "bartowski/Mistral-Nemo-Instruct-2407-GGUF:Mistral-Nemo-Instruct-2407-Q4_K_M.gguf"
  "bartowski/Llama-3.1-13B-Instruct-GGUF:Llama-3.1-13B-Instruct-Q4_K_M.gguf"
  "bartowski/Qwen3-8B-GGUF:Qwen3-8B-Q4_K_M.gguf"
  "bartowski/Command-R-GGUF:Command-R-Q4_K_M.gguf"
  "bartowski/Gemma-3-12b-it-GGUF:Gemma-3-12b-it-Q4_K_M.gguf"
)

MODELS_LARGE=(
  "bartowski/Qwen2.5-32B-Instruct-GGUF:Qwen2.5-32B-Instruct-Q4_K_M.gguf"
  "bartowski/Command-R-plus-GGUF:Command-R-plus-Q4_K_M.gguf"
  "bartowski/Gemma-3-27b-it-GGUF:Gemma-3-27b-it-Q4_K_M.gguf"
  "bartowski/Llama-3.3-30B-Instruct-GGUF:Llama-3.3-30B-Instruct-Q4_K_M.gguf"
)

MODELS_XL=(
  "bartowski/Meta-Llama-3.1-70B-Instruct-GGUF:Meta-Llama-3.1-70B-Instruct-Q4_K_M.gguf"
  "bartowski/Qwen2.5-72B-Instruct-GGUF:Qwen2.5-72B-Instruct-Q4_K_M.gguf"
  "bartowski/Mixtral-8x22B-Instruct-v0.1-GGUF:Mixtral-8x22B-Instruct-v0.1-Q4_K_M.gguf"
  "bartowski/Llama-3.3-70B-Instruct-GGUF:Llama-3.3-70B-Instruct-Q4_K_M.gguf"
  "bartowski/Qwen3-30B-A3B-GGUF:Qwen3-30B-A3B-Q4_K_M.gguf"
  "bartowski/Qwen3-32B-GGUF:Qwen3-32B-Q4_K_M.gguf"
)

MODELS_CODE=(
  "bartowski/Qwen2.5-Coder-7B-Instruct-GGUF:Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf"
  "bartowski/DeepSeek-Coder-V2-Lite-Instruct-GGUF:DeepSeek-Coder-V2-Lite-Instruct-Q4_K_M.gguf"
  "bartowski/Phi-3-mini-instruct-GGUF:Phi-3-mini-instruct-Q4_K_M.gguf"
  "bartowski/Qwen2.5-Coder-14B-Instruct-GGUF:Qwen2.5-Coder-14B-Instruct-Q4_K_M.gguf"
  "bartowski/Qwen2.5-Coder-32B-Instruct-GGUF:Qwen2.5-Coder-32B-Instruct-Q4_K_M.gguf"
  "bartowski/CodeLlama-13B-Instruct-GGUF:CodeLlama-13B-Instruct-Q4_K_M.gguf"
  "bartowski/Stable-Code-3B-GGUF:Stable-Code-3B-Q4_K_M.gguf"
  "bartowski/StarCoder2-7B-GGUF:StarCoder2-7B-Q4_K_M.gguf"
  "bartowski/Qwen3-Coder-4B-GGUF:Qwen3-Coder-4B-Q4_K_M.gguf"
  "bartowski/Qwen3-Coder-30B-A3B-GGUF:Qwen3-Coder-30B-A3B-Q4_K_M.gguf"
)

MODELS_VISION=(
  "bartowski/LLaVA-1.5-7B-hf-GGUF:LLaVA-1.5-7B-hf-Q4_K_M.gguf"
  "bartowski/llava-v1.6-mistral-7b-GGUF:llava-v1.6-mistral-7b-Q4_K_M.gguf"
  "bartowski/llava-v1.6-vicuna-13b-GGUF:llava-v1.6-vicuna-13b-Q4_K_M.gguf"
  "bartowski/Llama-3.2-11B-Vision-Instruct-GGUF:Llama-3.2-11B-Vision-Instruct-Q4_K_M.gguf"
  "bartowski/Qwen2.5-VL-7B-Instruct-GGUF:Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf"
  "bartowski/Qwen2.5-VL-3B-Instruct-GGUF:Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf"
  "bartowski/InternVL2-4B-GGUF:InternVL2-4B-Q4_K_M.gguf"
  "bartowski/MiniCPM-V-2_6-GGUF:MiniCPM-V-2_6-Q4_K_M.gguf"
  "bartowski/Gemma-3-4b-it-GGUF:Gemma-3-4b-it-Q4_K_M.gguf"
  "bartowski/Qwen2.5-Omni-7B-GGUF:Qwen2.5-Omni-7B-Q4_K_M.gguf"
)

MODELS_MATH=(
  "bartowski/Qwen2.5-Math-7B-Instruct-GGUF:Qwen2.5-Math-7B-Instruct-Q4_K_M.gguf"
  "bartowski/Qwen2.5-Math-1.5B-Instruct-GGUF:Qwen2.5-Math-1.5B-Instruct-Q4_K_M.gguf"
  "bartowski/Phi-4-mini-instruct-GGUF:Phi-4-mini-instruct-Q4_K_M.gguf"
)

MODELS_MULTILINGUAL=(
  "bartowski/Qwen2.5-7B-Instruct-GGUF:Qwen2.5-7B-Instruct-Q4_K_M.gguf"
  "bartowski/Aya-23-8B-GGUF:Aya-23-8B-Q4_K_M.gguf"
  "bartowski/Sailor2-8B-GGUF:Sailor2-8B-Q4_K_M.gguf"
  "bartowski/Llama-3.1-8B-Instruct-GGUF:Llama-3.1-8B-Instruct-Q4_K_M.gguf"
)

MODELS_REASONING=(
  "bartowski/DeepSeek-R1-Distill-Qwen-7B-GGUF:DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf"
  "bartowski/DeepSeek-R1-Distill-Llama-8B-GGUF:DeepSeek-R1-Distill-Llama-8B-Q4_K_M.gguf"
  "bartowski/DeepSeek-R1-Distill-Qwen-14B-GGUF:DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf"
  "bartowski/DeepSeek-R1-Distill-Llama-70B-GGUF:DeepSeek-R1-Distill-Llama-70B-Q4_K_M.gguf"
  "bartowski/QwQ-32B-GGUF:QwQ-32B-Q4_K_M.gguf"
  "bartowski/Qwen3-8B-GGUF:Qwen3-8B-Q4_K_M.gguf"
  "bartowski/Qwen3-30B-A3B-GGUF:Qwen3-30B-A3B-Q4_K_M.gguf"
)

MODELS_EMBEDDING=(
  "bartowski/nomic-embed-text-v2-moe-GGUF:nomic-embed-text-v2-moe-Q8_0.gguf"
  "bartowski/mxbai-embed-large-v1-GGUF:mxbai-embed-large-v1-Q8_0.gguf"
  "bartowski/bge-m3-GGUF:bge-m3-Q8_0.gguf"
  "bartowski/all-MiniLM-L6-v2-GGUF:all-MiniLM-L6-v2-Q8_0.gguf"
  "bartowski/e5-mistral-7b-instruct-GGUF:e5-mistral-7b-instruct-Q4_K_M.gguf"
)

MODELS_TTS_STT=(
  "bartowski/Whisper-Base-GGUF:Whisper-Base-Q5_0.gguf"
  "bartowski/Whisper-Small-GGUF:Whisper-Small-Q5_0.gguf"
  "bartowski/Whisper-Medium-GGUF:Whisper-Medium-Q5_0.gguf"
  "bartowski/CosyVoice-300M-GGUF:CosyVoice-300M-Q8_0.gguf"
  "bartowski/OuteTTS-0.2-500M-GGUF:OuteTTS-0.2-500M-Q8_0.gguf"
)

MODELS_FUN=(
  "bartowski/Dolphin-2.9.3-Llama-3.1-8B-GGUF:Dolphin-2.9.3-Llama-3.1-8B-Q4_K_M.gguf"
  "bartowski/MythoMax-L2-13B-GGUF:MythoMax-L2-13B-Q4_K_M.gguf"
  "bartowski/airoboros-l2-70b-gguf-3.1.2:airoboros-l2-70b-gguf-3.1.2-Q4_K_M.gguf"
  "bartowski/Noromaid-20B-v0.1.1-GGUF:Noromaid-20B-v0.1.1-Q4_K_M.gguf"
  "bartowski/OpenHermes-2.5-Mistral-7B-GGUF:OpenHermes-2.5-Mistral-7B-Q4_K_M.gguf"
  "bartowski/Zephyr-7B-Beta-GGUF:Zephyr-7B-Beta-Q4_K_M.gguf"
  "bartowski/Neural-Chat-7B-v3.3-GGUF:Neural-Chat-7B-v3.3-Q4_K_M.gguf"
)

ALL_GROUPS=(
  "MODELS_TINY:Tiny / 0.5-3B  (~0.5-2 GB RAM)"
  "MODELS_SMALL:Small / 4-8B  (~3-6 GB RAM)"
  "MODELS_MEDIUM:Medium / 12-14B  (~7-10 GB RAM)"
  "MODELS_LARGE:Large / 24-32B  (~14-20 GB RAM)"
  "MODELS_XL:XL / 70B+  (~35-45 GB RAM)"
  "MODELS_CODE:Code  (~2-20 GB RAM)"
  "MODELS_VISION:Vision / Multimodal  (~3-8 GB RAM)"
  "MODELS_MATH:Math  (~1-5 GB RAM)"
  "MODELS_MULTILINGUAL:Multilingual  (~3-6 GB RAM)"
  "MODELS_REASONING:Reasoning / Thinking  (~3-22 GB RAM)"
  "MODELS_EMBEDDING:Embedding / RAG  (~0.1-5 GB RAM)"
  "MODELS_TTS_STT:Speech / TTS / STT  (~0.1-2 GB RAM)"
  "MODELS_FUN:Fine-tuned / Chat  (~3-40 GB RAM)"
)

QUANT_VARIANTS=("Q3_K_S" "Q3_K_M" "Q3_K_L" "Q4_K_S" "Q4_K_M" "Q5_K_S" "Q5_K_M" "Q6_K" "Q8_0" "F16" "BF16")

list_models() {
  echo ""
  echo -e "${CYAN}============================================${NC}"
  echo -e "${CYAN} GGUF Model Catalog for Prism${NC}"
  echo -e "${CYAN}============================================${NC}"
  echo ""

  local idx=1

  for group_def in "${ALL_GROUPS[@]}"; do
    local varname="${group_def%%:*}"
    local label="${group_def##*:}"
    section "$label"
    local -n entries="$varname"
    for entry in "${entries[@]}"; do
      local repo="${entry%%:*}"
      local file="${entry##*:}"
      local name="${repo##*/}"
      name="${name%-GGUF}"
      printf "  %3d) %-42s  %s\n" "$idx" "$name" "$file"
      ((idx++)) || true
    done
    echo ""
  done
}

get_all_entries() {
  for group_def in "${ALL_GROUPS[@]}"; do
    local varname="${group_def%%:*}"
    local -n entries="$varname"
    for entry in "${entries[@]}"; do
      echo "$entry"
    done
  done
}

download_file() {
  local url="$1"
  local dest="$2"

  if [ -f "$dest" ]; then
    ok "Already exists: $dest"
    return 0
  fi

  mkdir -p "$(dirname "$dest")"

  if command -v wget &>/dev/null; then
    wget "${wget_opts[@]}" -O "$dest" "$url"
  elif command -v curl &>/dev/null; then
    curl "${curl_opts[@]}" -o "$dest" "$url"
  else
    err "wget or curl required for downloading."
  fi
}

download_model() {
  local repo="$1"
  local file="$2"
  local repo_flat="${repo//\//_}"
  local dest_dir="$MODEL_DIR/$repo_flat"
  local dest="$dest_dir/$file"
  local url="$HF_MIRROR/$repo/resolve/main/$file"

  info "Downloading $file"
  info "  Repo: $repo"
  info "  URL:  $url"
  info "  Dest: $dest"

  download_file "$url" "$dest"

  local fsize
  fsize=$(stat -f%z "$dest" 2>/dev/null || stat -c%s "$dest" 2>/dev/null || echo "0")
  local fsize_mb=$((fsize / 1024 / 1024))
  ok "Downloaded: $dest ($fsize_mb MB)"
}

download_by_url() {
  local url="$1"
  local filename="${url##*/}"
  local dest="$MODEL_DIR/custom/$filename"
  info "Downloading custom model: $url"
  download_file "$url" "$dest"
  ok "Downloaded: $dest"
}

hf_search() {
  local query="$1"
  local limit="${2:-20}"
  info "Searching HuggingFace for GGUF models: '$query' ..."

  local search_url="${HF_API}/models?search=${query}+gguf&limit=${limit}&sort=downloads&direction=-1&filter=gguf"

  local response
  if command -v curl &>/dev/null; then
    response=$(curl -s -f "${curl_opts[@]}" "$search_url" 2>/dev/null || echo "[]")
  else
    response=$(wget -q -O - "${wget_opts[@]}" "$search_url" 2>/dev/null || echo "[]")
  fi

  if [ "$response" = "[]" ] || [ -z "$response" ]; then
    warn "No results found for '$query'."
    return
  fi

  echo ""
  echo -e "${CYAN}Search results for '$query':${NC}"
  echo ""

  local idx=1
  local results=()

  while IFS= read -r line; do
    local model_id
    model_id=$(echo "$line" | grep -oP '"modelId"\s*:\s*"\K[^"]+' 2>/dev/null || echo "")
    if [ -z "$model_id" ]; then
      model_id=$(echo "$line" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null || echo "")
    fi
    if [ -z "$model_id" ]; then
      continue
    fi

    local downloads
    downloads=$(echo "$line" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('downloads',0))" 2>/dev/null || echo "0")

    results+=("$model_id")
    printf "  %3d) %-60s  (%s downloads)\n" "$idx" "$model_id" "$downloads"
    ((idx++)) || true
  done < <(echo "$response" | python3 -c "
import sys, json
data = json.load(sys.stdin)
if isinstance(data, list):
    for item in data:
        print(json.dumps(item))
" 2>/dev/null)

  if [ ${#results[@]} -eq 0 ]; then
    warn "Could not parse results. Try browsing: $HF_MIRROR/models?search=${query}+gguf"
    return
  fi

  echo ""
  echo -e "${CYAN}Enter number to list GGUF files, or Enter to skip.${NC}"
  read -rp "$(echo -e "${CYAN}Choice: ${NC}")" choice

  if [ -z "$choice" ]; then
    return
  fi

  if ! [[ "$choice" =~ ^[0-9]+$ ]]; then
    warn "Invalid selection."
    return
  fi

  local sel_idx=$((choice - 1))
  if [ "$sel_idx" -lt 0 ] || [ "$sel_idx" -ge "${#results[@]}" ]; then
    warn "Out of range."
    return
  fi

  local selected_repo="${results[$sel_idx]}"
  hf_list_files "$selected_repo"
}

hf_list_files() {
  local repo="$1"
  info "Listing GGUF files in $repo ..."

  local tree_url="${HF_API}/models/${repo}/tree/main"
  local response
  if command -v curl &>/dev/null; then
    response=$(curl -s -f "${curl_opts[@]}" "$tree_url" 2>/dev/null || echo "[]")
  else
    response=$(wget -q -O - "${wget_opts[@]}" "$tree_url" 2>/dev/null || echo "[]")
  fi

  local gguf_files=()
  while IFS= read -r fname; do
    [ -z "$fname" ] && continue
    gguf_files+=("$fname")
  done < <(echo "$response" | python3 -c "
import sys, json
data = json.load(sys.stdin)
if isinstance(data, list):
    for item in data:
        if item.get('rfilename','').endswith('.gguf'):
            print(item['rfilename'])
        elif item.get('path','').endswith('.gguf'):
            print(item['path'])
" 2>/dev/null)

  if [ ${#gguf_files[@]} -eq 0 ]; then
    warn "No GGUF files found in $repo."
    warn "Try a different quant or repo. Browse: $HF_MIRROR/$repo/tree/main"
    return
  fi

  echo ""
  echo -e "${CYAN}GGUF files in ${repo}:${NC}"
  echo ""

  local fidx=1
  for f in "${gguf_files[@]}"; do
    local fsize_info=""
    local fsize_bytes
    fsize_bytes=$(echo "$response" | python3 -c "
import sys, json
data = json.load(sys.stdin)
if isinstance(data, list):
    for item in data:
        rn = item.get('rfilename', item.get('path',''))
        if rn == '$f':
            print(item.get('size', 0))
" 2>/dev/null || echo "0")
    if [ "$fsize_bytes" -gt 0 ] 2>/dev/null; then
      local fsize_gb=$(echo "scale=1; $fsize_bytes / 1024 / 1024 / 1024" | bc 2>/dev/null || echo "?")
      fsize_info="  (${fsize_gb} GB)"
    fi
    printf "  %3d) %s%s\n" "$fidx" "$f" "$fsize_info"
    ((fidx++)) || true
  done

  echo ""
  echo -e "${CYAN}Enter file number(s) to download (comma-separated), or Enter to skip.${NC}"
  read -rp "$(echo -e "${CYAN}Choice: ${NC}")" file_choice

  if [ -z "$file_choice" ]; then
    return
  fi

  IFS=',' read -ra fnums <<< "$file_choice"
  for fnum in "${fnums[@]}"; do
    fnum="${fnum// /}"
    if ! [[ "$fnum" =~ ^[0-9]+$ ]]; then
      warn "Skipping invalid: $fnum"
      continue
    fi
    local fi=$((fnum - 1))
    if [ "$fi" -lt 0 ] || [ "$fi" -ge "${#gguf_files[@]}" ]; then
      warn "Out of range: $fnum"
      continue
    fi
    download_model "$repo" "${gguf_files[$fi]}"
  done
}

hf_browse() {
  echo ""
  echo -e "${CYAN}============================================${NC}"
  echo -e "${CYAN} HuggingFace GGUF Search${NC}"
  echo -e "${CYAN}============================================${NC}"
  echo ""
  echo -e "${CYAN}Search for GGUF models on HuggingFace.${NC}"
  echo -e "${CYAN}Type a search query (e.g. 'llama 3.1', 'qwen coder', 'mistral nemo').${NC}"
  echo -e "${CYAN}Type 'quit' to return to main menu.${NC}"
  echo ""

  while true; do
    read -rp "$(echo -e "${CYAN}HF Search> ${NC}")" query
    query="${query// /}"
    if [ -z "$query" ]; then
      continue
    fi
    if [ "$query" = "quit" ] || [ "$query" = "q" ]; then
      break
    fi
    query="${query//+/ }"
    hf_search "$query"
  done
}

show_quant_info() {
  echo ""
  section "Quantization Reference"
  echo ""
  printf "  %-12s %-10s %s\n" "Quant" "Size" "Quality"
  printf "  %-12s %-10s %s\n" "-------" "------" "-----------"
  printf "  %-12s %-10s %s\n" "Q3_K_S"  "~2 bpw" "Smallest, lowest quality"
  printf "  %-12s %-10s %s\n" "Q3_K_M"  "~2.5 bpw" "Very small, noticeable loss"
  printf "  %-12s %-10s %s\n" "Q3_K_L"  "~3 bpw" "Small, moderate loss"
  printf "  %-12s %-10s %s\n" "Q4_K_S"  "~4 bpw" "Good balance, slight loss"
  printf "  %-12s %-10s %s\n" "Q4_K_M"  "~4.5 bpw" "Recommended default"
  printf "  %-12s %-10s %s\n" "Q5_K_S"  "~5 bpw" "Very good quality"
  printf "  %-12s %-10s %s\n" "Q5_K_M"  "~5.5 bpw" "Near-lossless for most uses"
  printf "  %-12s %-10s %s\n" "Q6_K"    "~6 bpw" "Excellent, nearly lossless"
  printf "  %-12s %-10s %s\n" "Q8_0"    "~8 bpw" "Almost indistinguishable from F16"
  printf "  %-12s %-10s %s\n" "F16"     "~16 bpw" "Full precision, 2x size of Q8"
  printf "  %-12s %-10s %s\n" "BF16"    "~16 bpw" "Bfloat16, same size as F16"
  echo ""
  info "Rule of thumb: Q4_K_M for GPU, Q5_K_M for best quality/size ratio"
  info "bpw = bits per weight. Lower = smaller file, more quality loss."
  echo ""
}

interactive() {
  while true; do
    echo ""
    echo -e "${CYAN}============================================${NC}"
    echo -e "${CYAN} GGUF Model Downloader for Prism${NC}"
    echo -e "${CYAN}============================================${NC}"
    echo ""
    echo "  1) Browse catalog  (curated models by category)"
    echo "  2) Search HuggingFace  (find any GGUF model)"
    echo "  3) Download by URL  (direct GGUF link)"
    echo "  4) List downloaded models"
    echo "  5) Quantization reference"
    echo "  6) Exit"
    echo ""
    read -rp "$(echo -e "${CYAN}Action [1-6]: ${NC}")" action

    case "${action:-1}" in
      1)
        list_models
        echo -e "${CYAN}Enter model numbers (comma-separated), 'all', or Enter for default (1).${NC}"
        read -rp "$(echo -e "${CYAN}Choice: ${NC}")" choice
        choice="${choice// /}"
        [ -z "$choice" ] && choice="1"

        local entries
        entries=$(get_all_entries)

        if [ "$choice" = "all" ]; then
          info "Downloading ALL models... this will take a very long time."
          while IFS= read -r entry; do
            download_model "${entry%%:*}" "${entry##*:}"
          done <<< "$entries"
        elif [[ "$choice" == http* ]]; then
          download_by_url "$choice"
        else
          local all_entries=()
          while IFS= read -r entry; do
            all_entries+=("$entry")
          done <<< "$entries"
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
            download_model "${all_entries[$idx]%%:*}" "${all_entries[$idx]##*:}"
          done
        fi
        ;;
      2)
        hf_browse
        ;;
      3)
        echo -e "${CYAN}Enter direct GGUF URL:${NC}"
        read -rp "$(echo -e "${CYAN}URL: ${NC}")" url
        if [ -n "$url" ]; then
          download_by_url "$url"
        fi
        ;;
      4)
        echo ""
        section "Downloaded Models"
        if [ -d "$MODEL_DIR" ]; then
          find "$MODEL_DIR" -name '*.gguf' -type f -exec ls -lh {} \; 2>/dev/null || warn "No GGUF files found."
        else
          warn "Model directory does not exist yet."
        fi
        echo ""
        ;;
      5)
        show_quant_info
        ;;
      6|q|quit)
        break
        ;;
      *)
        warn "Invalid choice."
        ;;
    esac
  done
}

noninteractive() {
  local model_spec="$1"
  if [[ "$model_spec" == http* ]]; then
    download_by_url "$model_spec"
    return
  fi

  local repo="${model_spec%%:*}"
  local file="${model_spec##*:}"

  if [ "$repo" = "$file" ]; then
    err "Use 'repo/file:filename.gguf' format or a URL."
  fi

  download_model "$repo" "$file"
}

main() {
  echo ""
  echo -e "${CYAN}========================================${NC}"
  echo -e "${CYAN} GGUF Model Downloader for Prism${NC}"
  echo -e "${CYAN}========================================${NC}"
  echo ""
  info "Model directory: $MODEL_DIR"
  info "HF mirror: $HF_MIRROR"
  if [ -n "$HF_TOKEN" ]; then
    info "HF token: configured (gated model access enabled)"
  else
    info "HF token: not set (set HF_TOKEN for gated models)"
  fi

  if [ -n "${1:-}" ]; then
    noninteractive "$1"
  else
    interactive
  fi

  echo ""
  ok "Done! Models stored in: $MODEL_DIR"
  echo ""
  info "Start a server with a model:"
  info "  ./scripts/llama-run.sh $MODEL_DIR/<repo>/<file>.gguf"
}

main "$@"
