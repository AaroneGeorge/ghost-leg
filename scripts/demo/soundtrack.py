"""Rebuild the demo soundtrack from the music calls the page logged (scripts/demo/record.ts).

    python3 scripts/demo/soundtrack.py demo/raw/timeline.json public/audio demo/raw/edit.json demo/raw/music.wav

Mirrors src/audio.ts: levels are beat-aligned loops that keep their phase when they switch (60 ms fade in,
40 ms fade out), stop() is a hard 12 ms cut, sting() starts the end song as a loop. Times are mapped through the
kept segments in edit.json ([[start, end], ...] in raw-video seconds).
"""
import json
import sys
import wave

import numpy as np

SR = 44100


def load(path):
    with wave.open(path) as w:
        assert w.getframerate() == SR and w.getnchannels() == 2 and w.getsampwidth() == 2
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    return x.reshape(-1, 2)


def main(timeline_path, audio_dir, edit_path, out_path):
    tl = json.load(open(timeline_path))
    keep = json.load(open(edit_path))
    loops = {n: load(f"{audio_dir}/level{n}.wav") for n in range(1, 6)}
    end_song = load(f"{audio_dir}/end.wav")

    def to_edit(t):
        acc = 0.0
        for a, b in keep:
            if t < a:
                return acc
            if t <= b:
                return acc + (t - a)
            acc += b - a
        return acc

    total = sum(b - a for a, b in keep)
    n = int(total * SR)
    out = np.zeros((n + SR, 2), dtype=np.float32)

    # source spans: (start_s, kind, buffer, phase_anchor_s)
    spans = []
    anchor = 0.0  # level loops share one beat grid (same length), like playLoop's phase carry-over
    for e in tl["music"]:
        t = to_edit(e["t"])
        if e["k"] == "setLevel":
            spans.append((t, loops[e["a"]], anchor) if e["a"] else (t, None, 0.0))
        elif e["k"] == "stop":
            spans.append((t, None, 0.0))
        elif e["k"] == "sting":
            spans.append((t, end_song, t))
    spans.sort(key=lambda s: s[0])

    fade_in, fade_out = int(0.06 * SR), int(0.04 * SR)
    for i, (start, buf, anc) in enumerate(spans):
        if buf is None:
            continue
        stop = spans[i + 1][0] if i + 1 < len(spans) else total
        hard = i + 1 < len(spans) and spans[i + 1][1] is None  # next is a stop: 12 ms cut, no tail
        s0 = int(start * SR)
        s1 = min(n, int(stop * SR) + (int(0.012 * SR) if hard else fade_out))
        if s1 <= s0:
            continue
        idx = (np.arange(s0, s1) - int(anc * SR)) % len(buf)
        seg = buf[idx].copy()
        k = min(fade_in, len(seg))
        seg[:k] *= np.linspace(0, 1, k)[:, None]
        tail = int(0.012 * SR) if hard else fade_out
        if s1 - s0 > tail and i + 1 < len(spans):
            seg[-tail:] *= np.linspace(1, 0, tail)[:, None]
        out[s0:s1] += seg

    out = out[:n]
    peak = float(np.max(np.abs(out))) or 1.0
    out *= min(1.0, 0.95 / peak)
    with wave.open(out_path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((out * 32767).astype(np.int16).tobytes())
    print(f"{out_path}: {total:.2f}s, {len(spans)} music events")


if __name__ == "__main__":
    main(*sys.argv[1:5])
