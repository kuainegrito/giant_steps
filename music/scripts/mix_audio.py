"""Mix narration + music cues into one stereo track following data/timeline.json.

Background cues (ambient / clause chords) are ducked while the narrator speaks;
performance cues (band, demos, solos) play at full level.
Output: build/audio/mix.wav (48 kHz float). Loudness normalisation happens in
the final ffmpeg encode (loudnorm, -16 LUFS).
"""
import json
import os

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SR = 48000


def read(path):
    x, sr = sf.read(path, dtype="float32", always_2d=True)
    if x.shape[1] == 1:
        x = np.repeat(x, 2, axis=1)
    if sr != SR:
        x = resample_poly(x, SR, sr, axis=0).astype(np.float32)
    return x


def add(buf, x, t, gain=1.0):
    i = int(round(t * SR))
    n = min(len(x), len(buf) - i)
    if n > 0:
        buf[i:i + n] += x[:n] * gain


def main():
    tl = json.load(open(os.path.join(ROOT, "data", "timeline.json"), encoding="utf-8"))
    N = int((tl["duration"] + 1.0) * SR)
    voice = np.zeros((N, 2), np.float32)
    music_bg = np.zeros((N, 2), np.float32)
    music_fg = np.zeros((N, 2), np.float32)

    speech_mask = np.zeros(N, np.float32)
    for sc in tl["scenes"]:
        for ln in sc["lines"]:
            x = read(os.path.join(ROOT, "build", "tts", ln["id"] + ".wav"))
            add(voice, x, ln["start"], 0.95)
            a, b = int(ln["start"] * SR), int(ln["end"] * SR)
            speech_mask[a:b] = 1.0

    for c in tl["cues"]:
        x = read(os.path.join(ROOT, "build", "wav", c["id"] + ".wav"))
        if c["kind"] == "perf":
            add(music_fg, x, c["start"], c["gain"] * 0.9)
        else:
            add(music_bg, x, c["start"], c["gain"] * 0.9)

    # smooth duck envelope: -7 dB under speech, 250 ms attack / 600 ms release
    duck = 1.0 - speech_mask * (1 - 10 ** (-7 / 20))
    k_a = int(0.25 * SR)
    kernel = np.ones(k_a, np.float32) / k_a
    duck = np.convolve(duck, kernel, mode="same")
    music_bg *= duck[:, None]

    # fade in/out
    fade_in = int(2.5 * SR)
    fade_out = int(5.0 * SR)
    mix = voice + music_bg + music_fg
    mix[:fade_in] *= np.linspace(0, 1, fade_in)[:, None]
    end = int(tl["duration"] * SR)
    mix[end - fade_out:end] *= np.linspace(1, 0, fade_out)[:, None] ** 1.5
    mix[end:] = 0
    peak = np.abs(mix).max()
    if peak > 0.98:
        mix *= 0.98 / peak
    os.makedirs(os.path.join(ROOT, "build", "audio"), exist_ok=True)
    sf.write(os.path.join(ROOT, "build", "audio", "mix.wav"), mix, SR, subtype="FLOAT")
    print("mix", round(len(mix) / SR, 2), "s, peak", round(float(peak), 3))


if __name__ == "__main__":
    main()
