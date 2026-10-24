"""Lay out the whole video on one absolute time axis.

Inputs : data/script.json, build/tts/narration.json, data/performances/*.json
Outputs: data/timeline.json            (read by the Canvas renderer and the mixer)
         data/performances/<dyn>.json  (music cues generated to fit the narration)
         build/midi/<dyn>.mid

Rule: narration drives time. Each scene = lead-in + lines (+ music after a line)
+ optional music after the lines + tail. Background cues are generated *after*
layout so that chords land exactly on the clause that names them.
"""
import json
import os
import random
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "music"))

from gs import theory  # noqa: E402
from gs.arrange import pad_chord  # noqa: E402
from gs.midi_io import write_midi  # noqa: E402

FPS = 30
# relative level of each performance cue in the mix (the trio alone needs a lift)
PERF_GAIN = {"band_slow": 1.5, "solo_slow": 1.2, "solo_fast": 1.2, "demo_1235": 1.0, "demo_guide": 1.7}
CHORD_KEY = {"Bmaj7": "B", "Gmaj7": "G", "Ebmaj7": "Eb", "D7": "G", "Bb7": "Eb", "F#7": "B",
             "Dm7": "C", "G7": "C", "Cmaj7": "C"}


def parse_chord(sym):
    for q in ("maj7", "m7", "7"):
        if sym.endswith(q):
            root = sym[: -len(q)].replace("b", "♭").replace("#", "♯")
            return theory.NAME_TO_PC[root], q, root
    raise ValueError(sym)


def display_symbol(sym):
    return sym.replace("b7", "♭7").replace("Eb", "E♭").replace("Bb", "B♭").replace("F#", "F♯")


def load(p):
    return json.load(open(os.path.join(ROOT, p), encoding="utf-8"))


def ep_voicing(root_pc, q, center=62):
    ivs = {"maj7": [4, 7, 11, 14], "7": [4, 9, 10, 14], "m7": [3, 7, 10, 14]}[q]
    best = None
    for k in range(3, 7):
        v = [root_pc + 12 * k + i for i in ivs]
        if best is None or abs(sum(v) / 4 - center) < abs(sum(best) / 4 - center):
            best = v
    return best


def gen_clause_chords(cue, line, start):
    notes_ep, notes_pad, chords = [], [], []
    evs = cue["events"]
    for i, e in enumerate(evs):
        t = line["clauses"][e["clause"]]["start"] + line["start"] - start
        if i + 1 < len(evs):
            t_next = line["clauses"][evs[i + 1]["clause"]]["start"] + line["start"] - start
        else:
            t_next = t + e.get("hold", 2.5)
        d = t_next - t
        rpc, q, rname = parse_chord(e["chord"])
        for j, p in enumerate(ep_voicing(rpc, q)):
            notes_ep.append({"t": t + j * 0.035, "d": d * 0.98, "p": p, "v": 72})
        bass = 36 + (rpc - 36) % 12
        notes_pad.append({"t": t, "d": d * 0.98, "p": bass, "v": 60})
        notes_pad.append({"t": t, "d": d * 0.98, "p": bass + 12, "v": 45})
        chords.append({"t": t, "d": d, "symbol": display_symbol(e["chord"]), "key": CHORD_KEY[e["chord"]],
                       "quality": q, "root_pc": rpc})
    return {"ep": notes_ep, "pad": notes_pad}, chords


def gen_clause_notes(cue, line, start):
    """Notes spread evenly across a span of clauses (one note per spoken name)."""
    out = []
    for e in cue["events"]:
        a, b = e["clauses"]
        t0 = line["clauses"][a]["start"] + line["start"] - start
        t1 = line["clauses"][b]["end"] + line["start"] - start
        k = len(e["notes"])
        for i, p in enumerate(e["notes"]):
            out.append({"t": t0 + (t1 - t0) * i / k, "d": 1.4, "p": p, "v": 92})
    return {"vibes": out}, []


def gen_ambient(cue, start, end, rng):
    seconds = end - start
    cs = cue["chord_seconds"]
    names = cue["chords"]
    tracks = {"pad": [], "ep": [], "vibes": []}
    chords = []
    n_blocks = max(1, int(seconds // cs))
    for b in range(n_blocks):
        sym = names[b % len(names)] if b < n_blocks - 1 else names[-1]
        t = b * cs
        d = cs if b < n_blocks - 1 else seconds - t
        rpc, q, rname = parse_chord(sym)
        tracks["pad"] += pad_chord(rpc, q, t, d, lo=50, vel=48)
        tones = ep_voicing(rpc, q, center=68)
        # slow, rubato arpeggio: up through the upper structure, one note every ~0.45 s
        k = 0
        tt = t + 0.1
        while tt < t + d - 0.6:
            p = tones[k % 4] + (12 if (k // 4) % 2 else 0)
            tracks["ep"].append({"t": tt, "d": 1.6, "p": p, "v": 46 + rng.randint(-6, 8)})
            tt += 0.45 + rng.uniform(-0.04, 0.12)
            k += 1
        if rng.random() < 0.7:
            tracks["vibes"].append({"t": t + d * 0.55, "d": 2.0, "p": tones[-1] + 12, "v": 50})
        chords.append({"t": t, "d": d, "symbol": display_symbol(sym), "key": CHORD_KEY[sym],
                       "quality": q, "root_pc": rpc})
    return tracks, chords


def main():
    script = load("data/script.json")
    narr = load("build/tts/narration.json")
    song = load("data/giant_steps.json")
    form_chords = song["chords"]
    perfs = {}
    pdir = os.path.join(ROOT, "data", "performances")
    for f in os.listdir(pdir):
        if f.endswith(".json"):
            perfs[f[:-5]] = load(f"data/performances/{f}")

    gap = script["gap_between_lines"]
    t = 0.0
    scenes, cues, lines_by_id = [], [], {}

    def place_perf(cue_id, at, gain=1.0, kind="perf"):
        p = perfs[cue_id]
        cues.append({"id": cue_id, "start": round(at, 3), "seconds": p["seconds"], "bpm": p["bpm"],
                     "gain": gain, "kind": kind})
        return at + p["seconds"]

    for sc in script["scenes"]:
        s = {"id": sc["id"], "name": sc["name"], "start": round(t, 3), "lines": []}
        t += sc["lead_in"]
        for ln in sc["lines"]:
            m = narr[ln["id"]]
            line = {"id": ln["id"], "zh": ln["zh"], "en": ln["en"], "start": round(t, 3),
                    "end": round(t + m["duration"], 3), "clauses": m["clauses"]}
            s["lines"].append(line)
            lines_by_id[ln["id"]] = line
            t += m["duration"]
            if "music_after" in ln:
                ma = ln["music_after"]
                t = place_perf(ma["cue"], t + ma["offset"], PERF_GAIN.get(ma["cue"], 1.0)) + 0.3
            t += gap
        if "music_after_lines" in sc:
            ma = sc["music_after_lines"]
            t = place_perf(ma["cue"], t - gap + ma["offset"], PERF_GAIN.get(ma["cue"], 1.0))
        t += sc["tail"]
        s["end"] = round(t, 3)
        scenes.append(s)
    duration = t
    scene_by_id = {s["id"]: s for s in scenes}

    # ---- background cues generated to fit the layout
    rng = random.Random(7)
    dyn_chords = {}
    for cue in script["music_under"]:
        if cue["kind"] == "ambient":
            start = scene_by_id[cue["from"]]["start"]
            end = scene_by_id[cue["to"]]["end"]
            tracks, chords = gen_ambient(cue, start, end, rng)
        else:
            line = lines_by_id[cue["line"]]
            first = cue["events"][0]
            first_clause = first["clause"] if "clause" in first else first["clauses"][0]
            start = line["start"] + line["clauses"][first_clause]["start"] - 0.05
            gen = gen_clause_chords if cue["kind"] == "clause_chords" else gen_clause_notes
            tracks, chords = gen(cue, line, start)
        beats = max(n["t"] + n["d"] for tr in tracks.values() for n in tr)
        p = {"id": cue["cue"], "bpm": 60, "beats": round(beats, 3), "seconds": round(beats, 3),
             "tracks": tracks, "generated_for_timeline": True}
        perfs[cue["cue"]] = p
        json.dump(p, open(os.path.join(pdir, cue["cue"] + ".json"), "w"), ensure_ascii=False, separators=(",", ":"))
        write_midi(p, os.path.join(ROOT, "build", "midi", cue["cue"] + ".mid"))
        cues.append({"id": cue["cue"], "start": round(start, 3), "seconds": p["seconds"], "bpm": 60,
                     "gain": cue.get("gain", 1.0), "kind": cue["kind"]})
        dyn_chords[cue["cue"]] = chords

    # ---- absolute-time notes, chords and beats for the renderer
    notes, chord_events, beats = [], [], []
    for c in cues:
        p = perfs[c["id"]]
        spb = 60.0 / p["bpm"]
        form = c["kind"] == "perf"
        for tr, ns in p["tracks"].items():
            if tr == "drums":
                continue
            for n in ns:
                if form:
                    fc = form_chords[n["chord"]] if "chord" in n else theory.chord_at(form_chords, n["t"])
                    key, sym = fc["key"], fc["symbol"]
                else:
                    key, sym = None, None
                notes.append({"t": round(c["start"] + n["t"] * spb, 4), "d": round(n["d"] * spb, 4),
                              "p": n["p"], "v": n["v"], "tr": tr, "cue": c["id"], "key": key, "sym": sym,
                              "deg": n.get("degree"), "role": n.get("role"), "cell": n.get("cell")})
        if form:
            n_ch = p.get("choruses", 1)
            total_beats = p["beats"]
            b = 0
            while b < total_beats - 1e-6:
                if b >= n_ch * theory.FORM_BEATS and p["id"] not in ("demo_1235",):
                    # ending chord (Bmaj7) after the last chorus
                    fc = form_chords[0]
                    chord_events.append({"t": round(c["start"] + b * spb, 4), "d": round((total_beats - b) * spb, 4),
                                         "symbol": fc["symbol"], "key": fc["key"], "index": 0, "bar": 17,
                                         "chorus": n_ch, "cue": c["id"], "quality": fc["quality"], "root_pc": fc["root_pc"]})
                    break
                fc = theory.chord_at(form_chords, b)
                if p["id"] == "demo_1235" and b >= 12:
                    break
                if p["id"] == "demo_guide" and b >= 12:
                    break
                chord_events.append({"t": round(c["start"] + b * spb, 4), "d": round(fc["beats"] * spb, 4),
                                     "symbol": fc["symbol"], "key": fc["key"], "index": fc["index"], "bar": fc["bar"],
                                     "chorus": int(b // theory.FORM_BEATS), "cue": c["id"],
                                     "quality": fc["quality"], "root_pc": fc["root_pc"]})
                b += fc["beats"]
            for k in range(int(total_beats)):
                beats.append({"t": round(c["start"] + k * spb, 4), "cue": c["id"], "beat": k})
        else:
            for ch in dyn_chords.get(c["id"], []):
                chord_events.append({"t": round(c["start"] + ch["t"], 4), "d": round(ch["d"], 4),
                                     "symbol": ch["symbol"], "key": ch["key"], "index": None, "bar": None,
                                     "chorus": None, "cue": c["id"], "quality": ch["quality"], "root_pc": ch["root_pc"]})
    notes.sort(key=lambda n: n["t"])
    chord_events.sort(key=lambda n: n["t"])

    timeline = {"fps": FPS, "duration": round(duration, 3), "width": 1920, "height": 1080,
                "title": script["title"], "title_en": script["title_en"],
                "scenes": scenes, "cues": cues, "chords": chord_events, "notes": notes, "beats": beats}
    json.dump(timeline, open(os.path.join(ROOT, "data", "timeline.json"), "w"), ensure_ascii=False,
              separators=(",", ":"))
    print(f"duration {duration:.1f}s ({duration/60:.2f} min), {len(notes)} notes, {len(chord_events)} chords")
    for s in scenes:
        print(f"  {s['id']} {s['start']:7.2f} -> {s['end']:7.2f}  {s['name']}")
    for c in cues:
        print(f"  cue {c['id']:14s} {c['start']:7.2f} +{c['seconds']:.1f}s")


if __name__ == "__main__":
    main()
