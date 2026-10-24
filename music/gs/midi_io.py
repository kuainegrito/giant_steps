"""Write performance dicts (beats-based note lists) to Standard MIDI Files.

A *performance* is the shared exchange format (see docs/04_DATA_SCHEMA.md):

    {"id": ..., "bpm": 140, "beats": 132, "tracks": {"sax": [note...], ...}}

note = {"t": beat, "d": beats, "p": midi pitch, "v": velocity, ...labels}
"""
from __future__ import annotations

import mido

TPB = 960
# track name -> (channel, GM program, volume, pan, reverb, chorus)
INSTRUMENTS = {
    "sax":    (0, 66, 118, 70, 50, 0),    # Tenor Sax
    "piano":  (1, 0, 86, 50, 45, 0),      # Acoustic Grand
    "bass":   (2, 32, 84, 64, 25, 0),    # Acoustic Bass
    "ep":     (3, 4, 110, 64, 70, 40),     # Electric Piano 1 (Rhodes-like)
    "pad":    (4, 89, 70, 64, 90, 60),    # Warm Pad
    "drums":  (9, 32, 110, 72, 40, 0),     # GS Jazz kit
    "vibes":  (5, 11, 80, 64, 70, 20),    # Vibraphone
}


def write_midi(perf: dict, path: str):
    mid = mido.MidiFile(ticks_per_beat=TPB)
    meta = mido.MidiTrack()
    mid.tracks.append(meta)
    meta.append(mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(perf["bpm"]), time=0))
    meta.append(mido.MetaMessage("track_name", name=perf.get("id", "performance"), time=0))
    for name, notes in perf["tracks"].items():
        ch, prog, vol, pan, rev, cho = INSTRUMENTS[name]
        tr = mido.MidiTrack()
        mid.tracks.append(tr)
        tr.append(mido.MetaMessage("track_name", name=name, time=0))
        # on channel 10 a GS program change selects the drum kit (32 = Jazz)
        tr.append(mido.Message("program_change", channel=ch, program=prog, time=0))
        for cc, val in ((7, vol), (10, pan), (91, rev), (93, cho), (11, 120)):
            tr.append(mido.Message("control_change", channel=ch, control=cc, value=val, time=0))
        evs = []
        for n in notes:
            on = max(0, int(round(n["t"] * TPB)))
            off = on + max(1, int(round(n["d"] * TPB)))
            evs.append((on, 1, n["p"], int(n["v"])))
            evs.append((off, 0, n["p"], 0))
            for (dt, cc, val) in n.get("cc", []):
                evs.append((on + int(dt * TPB), 2, cc, val))
        evs.sort(key=lambda e: (e[0], e[1]))
        now = 0
        for tick, kind, a, b in evs:
            dt = tick - now
            now = tick
            if kind == 1:
                tr.append(mido.Message("note_on", channel=ch, note=a, velocity=max(1, min(127, b)), time=dt))
            elif kind == 0:
                tr.append(mido.Message("note_off", channel=ch, note=a, velocity=0, time=dt))
            else:
                tr.append(mido.Message("control_change", channel=ch, control=a, value=b, time=dt))
    mid.save(path)

