"""Rhythm-section arranger: walking bass, rootless piano comping, swing drums.

All event times are in *beats* from the start of the performance and already
include swing and humanisation, so a renderer only has to multiply by 60/bpm.
"""
from __future__ import annotations

import random

from .theory import FORM_BEATS, QUALITIES, chord_at, degree_label

# rootless voicings (intervals above the root), two inversions each
VOICINGS = {
    "maj7": [[4, 7, 11, 14], [11, 14, 16, 19]],      # 3 5 7 9  /  7 9 3 5
    "7":    [[4, 9, 10, 14], [10, 14, 16, 21]],      # 3 13 b7 9 /  b7 9 3 13
    "m7":   [[3, 7, 10, 14], [10, 14, 15, 19]],      # b3 5 b7 9 /  b7 9 b3 5
}

BASS_LO, BASS_HI = 31, 52
PIANO_LO, PIANO_TOP = 50, 75


def swing_time(beat_pos: float, swing: float) -> float:
    """Map a straight-eighth grid position to a swung position."""
    whole = int(beat_pos // 1)
    frac = beat_pos - whole
    if abs(frac - 0.5) < 1e-6:
        return whole + swing
    return beat_pos


def _nearest(pc: int, ref: int, lo: int, hi: int) -> int:
    cands = [p for p in range(lo, hi + 1) if p % 12 == pc]
    return min(cands, key=lambda p: abs(p - ref))


def walking_bass(chords, n_choruses, rng: random.Random, start_beat=0.0, ending=True):
    notes = []
    prev = 47  # B2
    total = n_choruses * FORM_BEATS
    for b in range(total):
        c = chord_at(chords, b)
        pos = (b % FORM_BEATS) - c["start"]
        nxt = chord_at(chords, b + 1)  # wraps to bar 1 at the end of the form
        root = c["root_pc"]
        if pos == 0:
            p = _nearest(root, prev, BASS_LO, BASS_HI)
            label = "1"
        elif pos == c["beats"] - 1:
            target = _nearest(nxt["root_pc"], prev, BASS_LO, BASS_HI)
            r = rng.random()
            if r < 0.55:
                p = target + (1 if rng.random() < 0.5 else -1)
                label = "approach"
            elif r < 0.85:
                p = _nearest((nxt["root_pc"] + 7) % 12, prev, BASS_LO, BASS_HI)
                label = "V of next"
            else:
                p = _nearest((root + 7) % 12, prev, BASS_LO, BASS_HI)
                label = "5"
        else:
            # middle of a 4-beat chord: walk through chord / scale tones
            tones = [3 if c["quality"] == "m7" else 4, 7, 2, 9 if c["quality"] != "7" else 10]
            iv = rng.choice(tones)
            p = _nearest((root + iv) % 12, prev + rng.choice([-2, 2, 3]), BASS_LO, BASS_HI)
            label = degree_label(iv, c["quality"])
        p = max(BASS_LO, min(BASS_HI, p))
        notes.append({"t": start_beat + b + rng.uniform(-0.01, 0.01), "d": 0.92, "p": p,
                      "v": 92 + (6 if pos == 0 else 0) + rng.randint(-5, 5),
                      "chord": c["index"], "label": label})
        prev = p
    if ending:
        notes.append({"t": start_beat + total, "d": 3.5, "p": _nearest(11, prev, BASS_LO, BASS_HI),
                      "v": 95, "chord": 0, "label": "1"})
    return notes


def _voice(chord, prev_voicing):
    best, best_cost = None, 1e9
    for inv in VOICINGS[chord["quality"]]:
        for octv in range(3, 7):
            base = chord["root_pc"] + 12 * octv
            v = [base + i for i in inv]
            if v[0] < PIANO_LO or v[-1] > PIANO_TOP:
                continue
            cost = sum(abs(a - b) for a, b in zip(v, prev_voicing)) if prev_voicing else abs(v[0] - 55)
            if cost < best_cost:
                best, best_cost = v, cost
    return best


def comping(chords, n_choruses, rng: random.Random, swing=0.62, density=1.0,
            start_beat=0.0, ending=True):
    """Rootless voicings; rhythm = on-beat hits, anticipations, Charleston."""
    notes = []
    prev = None
    for ch in range(n_choruses):
        for c in chords:
            v = _voice(c, prev)
            prev = v
            t0 = ch * FORM_BEATS + c["start"]
            hits = []
            r = rng.random()
            first_chord = ch == 0 and c["index"] == 0
            if c["beats"] == 2:
                if r < 0.45 and not first_chord:
                    hits.append((t0 - 0.5, 1.0 if rng.random() < 0.5 else 0.45))  # anticipation
                elif r < 0.85 * density:
                    hits.append((t0, 0.9 if rng.random() < 0.5 else 0.4))
                elif not first_chord:
                    hits.append((t0 + 0.5, 0.4))
                if first_chord and not hits:
                    hits.append((t0, 0.9))
            else:
                if r < 0.5:
                    hits += [(t0, 0.6), (t0 + 1.5, 1.2)]                      # Charleston
                elif r < 0.8:
                    hits += [(t0 - 0.5 if not first_chord else t0, 1.4), (t0 + 2.5, 0.5)]
                else:
                    hits += [(t0, 2.8)]
            for (t, d) in hits:
                tt = swing_time(t, swing) if (t % 1) else t
                vel = 58 + rng.randint(-6, 8)
                for i, p in enumerate(v):
                    notes.append({"t": start_beat + tt + rng.uniform(0, 0.015) + i * 0.004,
                                  "d": d, "p": p, "v": vel - (4 if i == 0 else 0),
                                  "chord": c["index"],
                                  "label": degree_label(p - c["root_pc"], c["quality"])})
    if ending:
        c = chords[0]
        v = _voice(c, prev)
        end_t = start_beat + n_choruses * FORM_BEATS
        for i, p in enumerate(v):
            notes.append({"t": end_t + i * 0.03, "d": 4.0, "p": p, "v": 60, "chord": 0,
                          "label": degree_label(p - c["root_pc"], c["quality"])})
    return notes


# GM drum keys
RIDE, RIDE_BELL, HH_FOOT, SNARE, KICK, CRASH = 51, 53, 44, 38, 36, 49


def drums(n_choruses, rng: random.Random, swing=0.62, start_beat=0.0, ending=True, brushes=False):
    notes = []
    total = n_choruses * FORM_BEATS
    for b in range(total):
        beat_in_bar = b % 4
        # ride: every beat + swung skip note on 2 and 4
        notes.append({"t": start_beat + b, "d": 0.5, "p": RIDE, "v": 70 + (8 if beat_in_bar in (1, 3) else 0) + rng.randint(-6, 6)})
        if beat_in_bar in (1, 3):
            notes.append({"t": start_beat + b + swing, "d": 0.3, "p": RIDE, "v": 52 + rng.randint(-6, 6)})
            notes.append({"t": start_beat + b, "d": 0.3, "p": HH_FOOT, "v": 66 + rng.randint(-5, 5)})
        notes.append({"t": start_beat + b, "d": 0.3, "p": KICK, "v": 26 + rng.randint(-4, 4)})  # feathered
        if rng.random() < 0.18:
            off = rng.choice([0.0, swing])
            notes.append({"t": start_beat + b + off, "d": 0.2, "p": SNARE, "v": 34 + rng.randint(-8, 14)})
        if b % FORM_BEATS == 0 and b > 0 and rng.random() < 0.6:
            notes.append({"t": start_beat + b, "d": 1.0, "p": CRASH, "v": 62})
    if ending:
        notes.append({"t": start_beat + total, "d": 4.0, "p": CRASH, "v": 70})
        notes.append({"t": start_beat + total, "d": 1.0, "p": KICK, "v": 60})
    return notes


def pad_chord(root_pc: int, quality: str, t: float, d: float, lo=52, vel=55):
    """Wide, open voicing for ambient pad cues: root low + upper structure."""
    ivs = {"maj7": [0, 7, 16, 23, 26], "7": [0, 10, 16, 21, 26], "m7": [0, 10, 15, 19, 26]}[quality]
    base = lo - ((lo - root_pc) % 12) - 12
    return [{"t": t, "d": d, "p": base + i, "v": vel} for i in ivs]
