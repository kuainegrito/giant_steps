"""Core music theory for Giant Steps.

Everything here is pure data / pure functions so the same logic can be ported
1:1 to JavaScript for the interactive web page (see web/js/theory.js).

Pitch classes: C=0 ... B=11, arithmetic mod 12.
"""
from __future__ import annotations

# ---------------------------------------------------------------- spelling
# Spelling is chosen per key so that B major uses sharps and E-flat uses flats.
SHARP_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"]
FLAT_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"]
ASCII = {"♯": "#", "♭": "b"}

NAME_TO_PC = {n: i for i, n in enumerate(SHARP_NAMES)}
NAME_TO_PC.update({n: i for i, n in enumerate(FLAT_NAMES)})


def pc_name(pc: int, prefer: str = "sharp") -> str:
    return (SHARP_NAMES if prefer == "sharp" else FLAT_NAMES)[pc % 12]


def to_ascii(s: str) -> str:
    for k, v in ASCII.items():
        s = s.replace(k, v)
    return s


def fifths_index(pc: int) -> int:
    """Position on the circle of fifths (C=0, G=1, D=2 ...)."""
    return (pc * 7) % 12


# ---------------------------------------------------------------- chords
# Intervals in semitones above the root.
QUALITIES = {
    "maj7": {"tones": [0, 4, 7, 11], "scale": [0, 2, 4, 5, 7, 9, 11], "tensions": [2, 6, 9], "symbol": "maj7"},
    "7":    {"tones": [0, 4, 7, 10], "scale": [0, 2, 4, 5, 7, 9, 10], "tensions": [1, 2, 3, 9], "symbol": "7"},
    "m7":   {"tones": [0, 3, 7, 10], "scale": [0, 2, 3, 5, 7, 9, 10], "tensions": [2, 5], "symbol": "m7"},
}
DEGREE_LABEL = {0: "1", 1: "b9", 2: "9", 3: "#9", 4: "3", 5: "11", 6: "#11",
                7: "5", 8: "b13", 9: "13", 10: "b7", 11: "7"}
MINOR_LABEL = {3: "b3", 10: "b7"}


def degree_label(interval: int, quality: str) -> str:
    interval %= 12
    if quality == "m7" and interval in MINOR_LABEL:
        return MINOR_LABEL[interval]
    if quality == "7" and interval == 3:
        return "#9"
    return DEGREE_LABEL[interval]


# The three tonal centres ("stars") and their colours (shared with the web).
KEYS = {
    "B":  {"pc": 11, "prefer": "sharp", "color": "#7fd3ff", "name_zh": "B 大调", "signature": "5♯"},
    "G":  {"pc": 7,  "prefer": "sharp", "color": "#f5c46b", "name_zh": "G 大调", "signature": "1♯"},
    "Eb": {"pc": 3,  "prefer": "flat",  "color": "#f07aa0", "name_zh": "E♭ 大调", "signature": "3♭"},
}

# ---------------------------------------------------------------- the tune
# (bar, beat, beats, root name, quality, key centre, function)
CHANGES = [
    (1, 1, 2, "B", "maj7", "B", "I"),   (1, 3, 2, "D", "7", "G", "V7"),
    (2, 1, 2, "G", "maj7", "G", "I"),   (2, 3, 2, "B♭", "7", "Eb", "V7"),
    (3, 1, 4, "E♭", "maj7", "Eb", "I"),
    (4, 1, 2, "A", "m7", "G", "ii"),    (4, 3, 2, "D", "7", "G", "V7"),
    (5, 1, 2, "G", "maj7", "G", "I"),   (5, 3, 2, "B♭", "7", "Eb", "V7"),
    (6, 1, 2, "E♭", "maj7", "Eb", "I"), (6, 3, 2, "F♯", "7", "B", "V7"),
    (7, 1, 4, "B", "maj7", "B", "I"),
    (8, 1, 2, "F", "m7", "Eb", "ii"),   (8, 3, 2, "B♭", "7", "Eb", "V7"),
    (9, 1, 4, "E♭", "maj7", "Eb", "I"),
    (10, 1, 2, "A", "m7", "G", "ii"),   (10, 3, 2, "D", "7", "G", "V7"),
    (11, 1, 4, "G", "maj7", "G", "I"),
    (12, 1, 2, "C♯", "m7", "B", "ii"),  (12, 3, 2, "F♯", "7", "B", "V7"),
    (13, 1, 4, "B", "maj7", "B", "I"),
    (14, 1, 2, "F", "m7", "Eb", "ii"),  (14, 3, 2, "B♭", "7", "Eb", "V7"),
    (15, 1, 4, "E♭", "maj7", "Eb", "I"),
    (16, 1, 2, "C♯", "m7", "B", "ii"),  (16, 3, 2, "F♯", "7", "B", "V7"),
]
BEATS_PER_BAR = 4
FORM_BEATS = 16 * BEATS_PER_BAR


def chord_tones(root_pc: int, quality: str) -> list[int]:
    return [(root_pc + i) % 12 for i in QUALITIES[quality]["tones"]]


def chord_scale(root_pc: int, quality: str) -> list[int]:
    return [(root_pc + i) % 12 for i in QUALITIES[quality]["scale"]]


def build_chords() -> list[dict]:
    chords = []
    for idx, (bar, beat, beats, root, q, key, fn) in enumerate(CHANGES):
        rpc = NAME_TO_PC[root]
        prefer = KEYS[key]["prefer"]
        tones = chord_tones(rpc, q)
        chords.append({
            "index": idx,
            "bar": bar,
            "beat": beat,
            "start": (bar - 1) * BEATS_PER_BAR + (beat - 1),  # in beats from form start
            "beats": beats,
            "root": root,
            "root_pc": rpc,
            "quality": q,
            "symbol": root + QUALITIES[q]["symbol"],
            "symbol_ascii": to_ascii(root + QUALITIES[q]["symbol"]),
            "key": key,
            "function": fn,
            "tones_pc": tones,
            "tones": [pc_name(p, prefer) for p in tones],
            "guide_tones_pc": [tones[1], tones[3]],  # 3rd and 7th
            "scale_pc": chord_scale(rpc, q),
            "pattern_1235": [pc_name((rpc + i) % 12, prefer)
                             for i in ([0, 2, 4, 7] if q != "m7" else [0, 2, 3, 7])],
        })
    return chords


def chord_at(chords: list[dict], beat: float) -> dict:
    b = beat % FORM_BEATS
    for c in chords:
        if c["start"] <= b < c["start"] + c["beats"]:
            return c
    raise ValueError(beat)


def common_tones(key_a: int, key_b: int) -> list[int]:
    a = set(chord_scale(key_a, "maj7"))
    return sorted(a & set(chord_scale(key_b, "maj7")))


def guide_tone_lines(chords: list[dict], start_pair: tuple[int, int] | None = None):
    """Two voices moving between 3rds and 7ths with minimal motion.

    Returns a list of (voiceA_pc, voiceB_pc) per chord.
    """
    def dist(a, b):
        d = abs(a - b) % 12
        return min(d, 12 - d)

    first = chords[0]["guide_tones_pc"]
    pair = start_pair or (first[0], first[1])
    out = [pair]
    for c in chords[1:]:
        g3, g7 = c["guide_tones_pc"]
        a, b = pair
        if dist(a, g3) + dist(b, g7) <= dist(a, g7) + dist(b, g3):
            pair = (g3, g7)
        else:
            pair = (g7, g3)
        out.append(pair)
    return out


def tonic_cycle_summary() -> dict:
    tonics = [KEYS[k]["pc"] for k in ("B", "G", "Eb")]
    return {
        "tonics_pc": tonics,
        "interval": 4,
        "fifths_positions": [fifths_index(p) for p in tonics],
        "dominants_pc": [(t + 7) % 12 for t in tonics],
        "common_tones": {
            "B∩G": [pc_name(p) for p in common_tones(11, 7)],
            "G∩Eb": [pc_name(p, "flat") for p in common_tones(7, 3)],
            "Eb∩B": [pc_name(p, "flat") for p in common_tones(3, 11)],
        },
    }
