#!/usr/bin/env bash
# Mux the silent render with the mix, loudness-normalised to -16 LUFS (two-pass loudnorm).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=${1:-build/giant_steps.mp4}
stats=$(ffmpeg -hide_banner -i build/audio/mix.wav -af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
mi=$(echo "$stats" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['input_i'],d['input_tp'],d['input_lra'],d['input_thresh'],d['target_offset'])")
read I TP LRA TH OFF <<<"$mi"
ffmpeg -y -hide_banner -loglevel error -i build/video/silent.mp4 -i build/audio/mix.wav \
  -af "loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=$I:measured_TP=$TP:measured_LRA=$LRA:measured_thresh=$TH:offset=$OFF:linear=true,aresample=48000" \
  -c:v copy -c:a aac -b:a 256k -shortest -movflags +faststart "$OUT"
# small AAC of the mix for web/preview.html
ffmpeg -y -hide_banner -loglevel error -i build/audio/mix.wav -c:a aac -b:a 160k build/audio/mix.m4a
echo "wrote $OUT"
