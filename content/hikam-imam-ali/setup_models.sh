#!/usr/bin/env bash
# Downloads the offline models used by the pipeline (no API keys needed).
#   - Piper Arabic voice "ar_JO-kareem-medium" (sherpa-onnx packaging, ~80 MB)
#   - optional: Whisper large-v3-turbo int8 (~560 MB) used only by verify.py to
#     transcribe the narration back and check pronunciation:  ./setup_models.sh --with-asr
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p models
BASE=https://github.com/k2-fsa/sherpa-onnx/releases/download
fetch() {  # $1 = release tag, $2 = archive name
  if [ ! -d "models/$2" ]; then
    echo "Downloading $2 ..."
    curl -fL --retry 4 -o "models/$2.tar.bz2" "$BASE/$1/$2.tar.bz2"
    tar xjf "models/$2.tar.bz2" -C models && rm "models/$2.tar.bz2"
  else
    echo "models/$2 already present"
  fi
}
fetch tts-models vits-piper-ar_JO-kareem-medium
if [ "${1:-}" = "--with-asr" ]; then
  fetch asr-models sherpa-onnx-whisper-turbo
fi
