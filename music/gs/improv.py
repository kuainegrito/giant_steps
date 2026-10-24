"""Rule-based improvisation engine for Coltrane changes.

The engine thinks the way a jazz student is taught to practise this tune:

1. **Vocabulary** - small 4-note cells per chord quality (1-2-3-5, 3-5-7-9 ...),
   exactly the "digital patterns" Coltrane drilled.
2. **Voice leading** - for each chord segment, every cell x octave is scored by
   how smoothly it continues from the previous note (prefer steps of 1-3
   semitones), how well it stays in range and whether it repeats itself.
3. **Connection** - at chord boundaries the last eighth is often replaced by a
   chromatic approach note (or a two-note enclosure) into the next chord.
4. **Phrasing** - phrases of 6-24 beats separated by breaths; a phrase ends on a
   long chord tone; a later chorus is denser than an earlier one.

Every note carries analysis labels (degree relative to the chord, role, cell
name) so the visualisation / web page can explain *why* a note was chosen.
See docs/03_IMPROV_ENGINE.md for the full description.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

from .arrange import swing_time
from .theory import FORM_BEATS, QUALITIES, chord_at, degree_label

LO, HI = 50, 79  # concert range used for tenor sax (D3 .. G5)

CELLS = {
    "maj7": {"1235": [0, 2, 4, 7], "5321": [7, 4, 2, 0], "3579": [4, 7, 11, 14],
             "1357": [0, 4, 7, 11], "7531": [11, 7, 4, 0], "9753": [14, 11, 7, 4],
             "3217": [4, 2, 0, -1]},
    "7":    {"1235": [0, 2, 4, 7], "3579": [4, 7, 10, 14], "35b7b9": [4, 7, 10, 13],
             "b9b753": [13, 10, 7, 4], "5321": [7, 4, 2, 0], "8b753": [12, 10, 7, 4]},
    "m7":   {"1235": [0, 2, 3, 7], "b35b79": [3, 7, 10, 14], "1b35b7": [0, 3, 7, 10],
             "5b321": [7, 3, 2, 0], "b75b31": [10, 7, 3, 0]},
}
LANDING = {"maj7": [4, 7, 11, 14], "7": [4, 10, 7, 14], "m7": [3, 10, 7, 14]}  # good long notes


@dataclass
class Style:
    swing: float = 0.62
    guide_prob: list = field(default_factory=lambda: [0.35, 0.1])      # per chorus
    phrase_beats: list = field(default_factory=lambda: [[6, 8, 10], [8, 12, 16]])
    rest_beats: list = field(default_factory=lambda: [[2, 3, 4], [1, 2, 2, 3]])
    approach_prob: float = 0.45
    enclosure_prob: float = 0.2
    pickup_prob: float = 0.5
    legato: float = 0.92


SLOW = Style()
FAST = Style(swing=0.56,
             guide_prob=[0.12, 0.05, 0.0, 0.0, 0.0],
             phrase_beats=[[8, 10, 12], [12, 16], [16, 24], [12, 16, 24], [16, 24]],
             rest_beats=[[2, 3], [2, 3], [1, 2], [1, 2], [1, 2]],
             approach_prob=0.5, enclosure_prob=0.25)


def _per_chorus(lst, i):
    return lst[min(i, len(lst) - 1)]


def _cost_first(d):
    d = abs(d)
    if d == 0:
        return 2.5
    if d <= 3:
        return 0.0
    return (d - 3) * 1.1


def _choose(rng, options):
    """options: list of (cost, payload). Softmax over negative cost."""
    m = min(c for c, _ in options)
    w = [math.exp(-(c - m) * 1.6) for c, _ in options]
    return rng.choices([p for _, p in options], weights=w, k=1)[0]


def _cell_options(chord, prev_p, last_cell, n_cells=1):
    q = chord["quality"]
    out = []
    for name, ivs in CELLS[q].items():
        for k in range(2, 8):
            base = chord["root_pc"] + 12 * k
            ps = [base + i for i in ivs]
            if min(ps) < LO or max(ps) > HI:
                continue
            cost = _cost_first(ps[0] - prev_p) if prev_p is not None else abs(ps[0] - 64) * 0.2
            cost += 0.04 * abs(sum(ps) / 4 - 65)
            if name == last_cell:
                cost += 0.6
            out.append((cost, (name, ps)))
    return out


def _scale_run(chord, prev_p, rng, n=8):
    """Stepwise run through the chord scale starting near prev_p."""
    scale = [(chord["root_pc"] + i) % 12 for i in QUALITIES[chord["quality"]]["scale"]]
    pool = [p for p in range(LO, HI + 1) if p % 12 in scale]
    ref = prev_p or 64
    direction = -1 if ref > 66 else 1
    if rng.random() < 0.3 and LO + 9 < ref < HI - 9:
        direction *= -1
    start_cands = [p for p in pool if p % 12 in chord["tones_pc"]]
    start = min(start_cands, key=lambda p: (_cost_first(p - (prev_p or 64)), rng.random()))
    i = pool.index(start)
    ps = []
    for _ in range(n):
        ps.append(pool[i])
        if not (0 <= i + direction < len(pool)):
            direction *= -1
        i += direction
    return ps


def _landing(chord, prev_p):
    q = chord["quality"]
    cands = []
    for iv in LANDING[q]:
        for k in range(2, 8):
            p = chord["root_pc"] + 12 * k + iv
            if LO <= p <= HI:
                cands.append(p)
    return min(cands, key=lambda p: (_cost_first(p - prev_p) if prev_p else 0) + 0.02 * abs(p - 66))


def _guide(chord, prev_p):
    g = chord["guide_tones_pc"]
    cands = [p for p in range(LO, HI + 1) if p % 12 in g]
    ref = prev_p if prev_p is not None else 64
    return min(cands, key=lambda p: (abs(p - ref) if abs(p - ref) > 0 else 2.5, abs(p - 66)))


def _label(note, chord):
    iv = (note["p"] - chord["root_pc"]) % 12
    note["degree"] = degree_label(iv, chord["quality"])
    if note.get("role") in ("approach", "enclosure"):
        return note
    q = QUALITIES[chord["quality"]]
    if iv in q["tones"]:
        note["role"] = "chord"
    elif iv in q["tensions"] or iv in q["scale"]:
        note["role"] = "tension" if iv in q["tensions"] else "scale"
    else:
        note["role"] = "chromatic"
    return note


def improvise(chords, n_choruses: int, style: Style = SLOW, seed: int = 1959, ending=True):
    rng = random.Random(seed)
    sw = style.swing
    notes = []
    prev_p = None
    last_cell = None
    state = "rest"
    remaining = 2.0  # start with a short breath (beats)
    phrase_id = 0
    segs = [(ch, c) for ch in range(n_choruses) for c in chords]

    def add(t_grid, d, p, chord, **kw):
        t = swing_time(t_grid, sw)
        n = {"t": round(t, 4), "grid": t_grid, "d": d, "p": p, "chord": chord["index"],
             "chorus": kw.pop("chorus"), "phrase": phrase_id}
        n.update(kw)
        notes.append(_label(n, chord))

    for si, (ch, c) in enumerate(segs):
        t0 = ch * FORM_BEATS + c["start"]
        L = c["beats"]
        if state == "rest":
            remaining -= L
            if remaining <= 0:
                state = "phrase"
                phrase_id += 1
                remaining = float(rng.choice(_per_chorus(style.phrase_beats, ch)))
                last_cell = None
            continue

        # ---- inside a phrase
        remaining -= L
        ending_here = remaining <= 0 or si == len(segs) - 1
        guide = rng.random() < _per_chorus(style.guide_prob, ch)
        if guide and not ending_here:
            p = _guide(c, prev_p)
            anticip = rng.random() < 0.3 and notes and notes[-1]["t"] < t0 - 0.6
            ts = t0 - 0.5 if anticip else t0
            add(ts, (t0 + L - ts) * 0.9, p, c, chorus=ch, cell="guide")
            prev_p, last_cell = p, "guide"
            continue

        n_slots = 2 * L
        if ending_here:
            n_slots = 2 if L == 2 else 4           # line, then a long landing note
        ps, cellnames = [], []
        while len(ps) < n_slots:
            if L == 4 and len(ps) == 0 and n_slots == 8 and rng.random() < 0.3:
                ps += _scale_run(c, prev_p, rng, 8)
                cellnames += ["scale"] * 8
                continue
            name, cell = _choose(rng, _cell_options(c, ps[-1] if ps else prev_p, last_cell))
            ps += cell
            cellnames += [name] * 4
            last_cell = name
        ps, cellnames = ps[:n_slots], cellnames[:n_slots]
        for i, (p, cn) in enumerate(zip(ps, cellnames)):
            tg = t0 + i * 0.5
            off = (i % 2 == 1)
            d = ((1 - sw) if off else sw) * style.legato
            add(tg, d, p, c, chorus=ch, cell=cn)
        prev_p = ps[-1]
        if ending_here:
            p = _landing(c, prev_p)
            tg = t0 + n_slots * 0.5
            add(tg, (t0 + L - tg) * 0.95, p, c, chorus=ch, cell="landing")
            prev_p = p
            state = "rest"
            remaining = float(rng.choice(_per_chorus(style.rest_beats, ch)))

    # ---- post-process: chromatic approaches / enclosures across chord changes
    _connect(notes, chords, rng, style)
    _pickups(notes, chords, rng, style)
    notes.sort(key=lambda n: n["t"])
    for n in notes:  # pitches may have changed: recompute degree labels
        _label(n, chords[n["chord"]])

    if ending:
        end_t = n_choruses * FORM_BEATS
        c = chords[0]
        ref = notes[-1]["p"] if notes else 66
        p = min([p for p in range(LO, HI + 1) if p % 12 == (c["root_pc"] + 4) % 12], key=lambda x: abs(x - ref))
        n = {"t": end_t, "grid": end_t, "d": 3.8, "p": p, "chord": 0, "chorus": n_choruses,
             "phrase": phrase_id + 1, "cell": "ending"}
        notes.append(_label(n, c))
    _dynamics(notes, rng)
    return notes


def _connect(notes, chords, rng, style):
    """Replace the eighth before a chord change with a chromatic approach."""
    by_grid = {round(n["grid"], 3): n for n in notes}
    for n in notes:
        g = round(n["grid"], 3)
        prev = by_grid.get(round(g - 0.5, 3))
        if prev is None or prev["chord"] == n["chord"] or prev.get("cell") == "guide":
            continue
        if n.get("cell") in ("guide", "landing"):
            continue
        r = rng.random()
        target = n["p"]
        if r < style.enclosure_prob:
            prev2 = by_grid.get(round(g - 1.0, 3))
            if prev2 is not None and prev2["chord"] == prev["chord"]:
                prev2["p"], prev2["role"] = target + 1, "enclosure"
                prev["p"], prev["role"] = target - 1, "enclosure"
                prev2["cell"] = prev["cell"] = "enclosure"
                continue
        if r < style.enclosure_prob + style.approach_prob:
            step = 1 if prev["p"] > target else -1
            if prev["p"] == target:
                step = 1
            before = by_grid.get(round(g - 1.0, 3))
            if before is not None and before["p"] == target + step:
                step = -step                       # avoid a repeated note
            prev["p"] = target + step
            prev["role"], prev["cell"] = "approach", "approach"


def _pickups(notes, chords, rng, style):
    """Add a two-eighth pickup before some phrase starts."""
    firsts = {}
    for n in notes:
        firsts.setdefault(n["phrase"], n)
    occupied = {round(n["grid"], 3) for n in notes}
    for ph, n in firsts.items():
        g = n["grid"]
        if g < 1 or rng.random() > style.pickup_prob:
            continue
        if round(g - 1, 3) in occupied or round(g - 0.5, 3) in occupied or round(g - 1.5, 3) in occupied:
            continue
        a, b = (n["p"] + 2, n["p"] + 1) if rng.random() < 0.5 else (n["p"] - 2, n["p"] - 1)
        if rng.random() < 0.5:
            a, b = n["p"] + 1, n["p"] - 1  # enclosure
        for gg, p in ((g - 1.0, a), (g - 0.5, b)):
            notes.append({"t": round(swing_time(gg, style.swing), 4), "grid": gg, "d": 0.4, "p": p,
                          "chord": chord_at(chords, gg)["index"], "chorus": n["chorus"], "phrase": ph,
                          "cell": "pickup", "role": "approach"})


def _dynamics(notes, rng):
    notes.sort(key=lambda n: n["t"])
    prev_phrase = None
    for n in notes:
        v = 80 + 0.7 * (n["p"] - 64)
        if abs(n["grid"] % 1 - 0.5) < 1e-6:
            v += 7                                     # accent the off-beats
        if n["phrase"] != prev_phrase:
            v -= 6
        if n.get("cell") in ("landing", "guide", "ending"):
            v += 4
        v += rng.randint(-5, 5)
        n["v"] = int(max(40, min(118, v)))
        n["t"] = round(n["t"] + rng.uniform(-0.008, 0.012), 4)
        prev_phrase = n["phrase"]


# ------------------------------------------------------------------ demos
def demo_1235(chords, upto_index=4):
    """1-2-3-5 on each chord of bars 1-3 (Coltrane's signature digital pattern)."""
    notes, prev = [], 60
    for c in chords[:upto_index + 1]:
        ivs = [0, 2, 4, 7] if c["quality"] != "m7" else [0, 2, 3, 7]
        reps = c["beats"] // 2
        for r in range(reps):
            seq = ivs if r == 0 else [ivs[3], ivs[2], ivs[1], ivs[0]]
            if r == 0:
                base = min((c["root_pc"] + 12 * k for k in range(3, 7)
                            if LO <= c["root_pc"] + 12 * k and c["root_pc"] + 12 * k + 7 <= HI),
                           key=lambda b: abs(b - prev))
            for i, iv in enumerate(seq):
                tg = c["start"] + r * 2 + i * 0.5
                n = {"t": swing_time(tg, 0.6), "grid": tg, "d": 0.42, "p": base + iv, "chord": c["index"],
                     "chorus": 0, "phrase": 1, "cell": "1235" if r == 0 else "5321", "v": 86 + (6 if i % 2 else 0)}
                notes.append(_label(n, c))
            prev = base + seq[-1]
    return notes


def demo_guide_tones(chords, lines, upto_index=4):
    """Two-voice guide-tone dyads (3rds & 7ths) for bars 1-3."""
    out, pa, pb = [], 66, 58
    for c, (a, b) in zip(chords[:upto_index + 1], lines):
        na = min((p for p in range(60, 76) if p % 12 == a), key=lambda p: abs(p - pa))
        nb = min((p for p in range(52, 70) if p % 12 == b), key=lambda p: abs(p - pb))
        if nb >= na:
            nb -= 12
        for p in (na, nb):
            out.append(_label({"t": c["start"], "grid": c["start"], "d": c["beats"] * 0.97, "p": p,
                               "chord": c["index"], "chorus": 0, "phrase": 1, "cell": "guide", "v": 70}, c))
        pa, pb = na, nb
    return out
