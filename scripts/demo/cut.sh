#!/bin/sh
# Cut the raw demo recording (skip the wait while bots are seated), rebuild the soundtrack, mux to MP4.
#   sh scripts/demo/cut.sh demo/raw demo/ghost-leg-demo.mp4      (PY=python with numpy, default python3)
set -e
RAW=$1
OUT=$2
PY=${PY:-python3}
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$RAW/raw.webm")

# kept segments in raw seconds: everything except the bot-seating wait
"$PY" - "$RAW/timeline.json" "$DUR" > "$RAW/edit.json" <<'EOF'
import json, sys
m = json.load(open(sys.argv[1]))["marks"]
print(json.dumps([[0, m["bots-click"] + 1.0], [m["bots-ready"] - 0.4, float(sys.argv[2])]]))
EOF

"$PY" scripts/demo/soundtrack.py "$RAW/timeline.json" public/audio "$RAW/edit.json" "$RAW/music.wav"

FILTER=$("$PY" - "$RAW/edit.json" <<'EOF'
import json, sys
keep = json.load(open(sys.argv[1]))
parts = [f"[0:v]trim={a:.3f}:{b:.3f},setpts=PTS-STARTPTS[v{i}]" for i, (a, b) in enumerate(keep)]
print(";".join(parts) + ";" + "".join(f"[v{i}]" for i in range(len(keep))) +
      f"concat=n={len(keep)}:v=1:a=0,fps=30,format=yuv420p[v];[1:a]loudnorm=I=-15:TP=-1.5[a]")
EOF
)
ffmpeg -v error -y -i "$RAW/raw.webm" -i "$RAW/music.wav" -filter_complex "$FILTER" \
  -map "[v]" -map "[a]" -c:v libx264 -crf 18 -preset slow -movflags +faststart -c:a aac -b:a 192k -shortest "$OUT"
echo "wrote $OUT"
