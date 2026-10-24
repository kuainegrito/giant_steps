"""Synthesise narration line by line with offline TTS (sherpa-onnx MeloTTS).

Each line is synthesised whole (better prosody); clause start times are then
recovered from the pauses at punctuation, so the timeline can sync music and
visuals to individual words ("... to G; ... to E-flat") without forced alignment.

Output:
  build/tts/<line>.wav           whole line (clauses + natural pauses), 44.1 kHz mono
  build/tts/narration.json       per-line duration and clause offsets
"""
import json
import os
import re
import sys

import numpy as np
import soundfile as sf

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "music"))

PAUSE = {"，": 0.16, "、": 0.12, "；": 0.28, "：": 0.26, "。": 0.40, "？": 0.40, "！": 0.40}


def split_clauses(text, seps):
    parts = re.split("([" + re.escape(seps) + "])", text)
    out = []
    for i in range(0, len(parts), 2):
        s = parts[i].strip()
        sep = parts[i + 1] if i + 1 < len(parts) else "。"
        if s:
            out.append((s, sep))
    return out


def trim(x, thr=0.006, pad=0.03, sr=44100):
    idx = np.where(np.abs(x) > thr)[0]
    if len(idx) == 0:
        return x[:0]
    a = max(0, idx[0] - int(pad * sr))
    b = min(len(x), idx[-1] + int(pad * sr))
    return x[a:b]


def clause_times(y, sr, clauses):
    """Locate clause boundaries in a whole-line synthesis.

    The TTS pauses at punctuation, so the (n-1) longest silent runs, in time
    order, are the clause boundaries. Falls back to character-proportional
    timing if the line has too few pauses.
    """
    hop = int(0.01 * sr)
    env = np.array([np.sqrt(np.mean(y[i:i + hop] ** 2)) for i in range(0, len(y) - hop, hop)])
    silent = env < max(0.004, 0.06 * np.percentile(env, 90))
    runs, i = [], 0
    while i < len(silent):
        if silent[i]:
            j = i
            while j < len(silent) and silent[j]:
                j += 1
            if j - i >= 6 and i > 0 and j < len(silent):  # >= 60 ms, interior only
                runs.append((j - i, i, j))
            i = j
        else:
            i += 1
    n = len(clauses)
    dur = len(y) / sr
    if len(runs) >= n - 1:
        cuts = sorted(sorted(runs, reverse=True)[: n - 1], key=lambda r: r[1])
        starts = [0.0] + [r[2] * 0.01 for r in cuts]
        ends = [r[1] * 0.01 for r in cuts] + [dur]
    else:
        w = np.cumsum([0] + [len(c[0]) for c in clauses])
        starts = [dur * w[k] / w[-1] for k in range(n)]
        ends = [dur * w[k + 1] / w[-1] for k in range(n)]
    return [{"text": c[0], "start": round(a, 3), "end": round(b, 3)} for c, a, b in zip(clauses, starts, ends)]


def main():
    import sherpa_onnx

    script = json.load(open(os.path.join(ROOT, "data", "script.json"), encoding="utf-8"))
    d = os.path.join(ROOT, "assets", "tts", "vits-melo-tts-zh_en")
    cfg = sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            vits=sherpa_onnx.OfflineTtsVitsModelConfig(
                model=f"{d}/model.onnx", lexicon=f"{d}/lexicon.txt",
                tokens=f"{d}/tokens.txt", dict_dir=f"{d}/dict"),
            num_threads=4),
        rule_fsts=f"{d}/date.fst,{d}/phone.fst,{d}/number.fst")
    tts = sherpa_onnx.OfflineTts(cfg)
    voice = script["voice"]
    out_dir = os.path.join(ROOT, "build", "tts")
    os.makedirs(out_dir, exist_ok=True)
    meta = {}
    for scene in script["scenes"]:
        for line in scene["lines"]:
            clauses = split_clauses(line["tts"], script["clause_split"])
            a = tts.generate(line["tts"], sid=voice["speaker"], speed=voice["speed"])
            sr = a.sample_rate
            y = trim(np.asarray(a.samples, dtype=np.float32), sr=sr)
            offsets = clause_times(y, sr, clauses)
            peak = np.max(np.abs(y)) or 1
            y = y / peak * 0.9
            sf.write(os.path.join(out_dir, f"{line['id']}.wav"), y, sr)
            meta[line["id"]] = {"duration": round(len(y) / sr, 3), "clauses": offsets, "sample_rate": sr}
            print(line["id"], meta[line["id"]]["duration"], len(clauses), "clauses")
    json.dump(meta, open(os.path.join(out_dir, "narration.json"), "w"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
