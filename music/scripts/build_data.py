"""Build the shared JSON data + fixed music cues (MIDI).

  data/giant_steps.json            chords, keys, guide tones, tonic-cycle facts
  data/performances/<cue>.json     note-level performances (beats-based)
  build/midi/<cue>.mid             same performances as Standard MIDI Files
"""
import json
import os
import random
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "music"))

from gs import arrange, improv, theory  # noqa: E402
from gs.midi_io import write_midi  # noqa: E402

SEED = 1959
SLOW_BPM, FAST_BPM = 140, 286


def perf(cue, bpm, tracks, beats, **extra):
    d = {"id": cue, "bpm": bpm, "beats": beats, "seconds": round(beats * 60 / bpm, 3), "tracks": tracks}
    d.update(extra)
    return d


def main():
    chords = theory.build_chords()
    gl = theory.guide_tone_lines(chords)
    data = {
        "title": "Giant Steps",
        "composer": "John Coltrane",
        "recorded": "1959-05 (Atlantic)",
        "original_bpm": 286,
        "beats_per_bar": theory.BEATS_PER_BAR,
        "bars": 16,
        "form_beats": theory.FORM_BEATS,
        "keys": theory.KEYS,
        "chords": chords,
        "guide_tone_lines": [{"chord": c["index"], "a_pc": a, "b_pc": b} for c, (a, b) in zip(chords, gl)],
        "tonic_cycle": theory.tonic_cycle_summary(),
        "pitch_names": {"sharp": theory.SHARP_NAMES, "flat": theory.FLAT_NAMES},
        "fifths_order_pc": [(i * 7) % 12 for i in range(12)],
    }
    os.makedirs(os.path.join(ROOT, "data", "performances"), exist_ok=True)
    os.makedirs(os.path.join(ROOT, "build", "midi"), exist_ok=True)
    json.dump(data, open(os.path.join(ROOT, "data", "giant_steps.json"), "w"), ensure_ascii=False, indent=1)

    perfs = []
    # 1) rhythm section alone, slow, one chorus + ending
    r = random.Random(SEED)
    perfs.append(perf("band_slow", SLOW_BPM, {
        "bass": arrange.walking_bass(chords, 1, r),
        "piano": arrange.comping(chords, 1, r, swing=0.62),
        "drums": arrange.drums(1, r, swing=0.62),
    }, theory.FORM_BEATS + 4, choruses=1))

    # 2) 1-2-3-5 demo over bars 1-3 with soft bass and drums
    r = random.Random(SEED + 1)
    demo = improv.demo_1235(chords, 4)
    bass = [n for n in arrange.walking_bass(chords, 1, r, ending=False) if n["t"] < 12]
    perfs.append(perf("demo_1235", SLOW_BPM, {
        "sax": demo, "bass": bass,
        "drums": [n for n in arrange.drums(1, r, ending=False) if n["t"] < 12],
    }, 14))

    # 3) guide-tone dyads on electric piano, bars 1-3, slower
    perfs.append(perf("demo_guide", 96, {"ep": improv.demo_guide_tones(chords, gl, 4)}, 13))

    # 4) generated solos
    for cue, bpm, n_ch, style, seed in (("solo_slow", SLOW_BPM, 2, improv.SLOW, SEED),
                                        ("solo_fast", FAST_BPM, 4, improv.FAST, SEED + 7)):
        r = random.Random(seed + 100)
        sax = improv.improvise(chords, n_ch, style, seed=seed)
        perfs.append(perf(cue, bpm, {
            "sax": sax,
            "bass": arrange.walking_bass(chords, n_ch, r),
            "piano": arrange.comping(chords, n_ch, r, swing=style.swing, density=0.8 if bpm > 200 else 1.0),
            "drums": arrange.drums(n_ch, r, swing=style.swing),
        }, n_ch * theory.FORM_BEATS + 4, choruses=n_ch, seed=seed,
            style={k: getattr(style, k) for k in ("swing", "approach_prob", "enclosure_prob")}))

    for p in perfs:
        json.dump(p, open(os.path.join(ROOT, "data", "performances", p["id"] + ".json"), "w"),
                  ensure_ascii=False, separators=(",", ":"))
        write_midi(p, os.path.join(ROOT, "build", "midi", p["id"] + ".mid"))
        counts = {k: len(v) for k, v in p["tracks"].items()}
        print(p["id"], p["seconds"], "s", counts)


if __name__ == "__main__":
    main()
