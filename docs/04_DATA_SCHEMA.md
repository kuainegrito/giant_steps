# 04 · 数据结构 Data Schema

所有数据都是 JSON，视频渲染器和未来的互动网页读同一份文件。时间单位：**performance 里用"拍"**（beats，与速度无关，方便改速度），**timeline 里用"秒"**（绝对时间，直接对应音频）。

音高用 MIDI 编号（60 = 中央 C），音级 `pc` 用 0–11（C=0）。

## 1. `data/giant_steps.json` —— 曲子本身（单一事实来源）

由 `music/gs/theory.py` 生成。

```jsonc
{
  "title": "Giant Steps", "composer": "John Coltrane", "original_bpm": 286,
  "beats_per_bar": 4, "bars": 16, "form_beats": 64,
  "keys": {                                   // 三颗"星"
    "B":  {"pc": 11, "prefer": "sharp", "color": "#7fd3ff", "name_zh": "B 大调", "signature": "5♯"},
    "G":  {...}, "Eb": {...}
  },
  "chords": [                                 // 26 个和弦，按时间顺序
    {
      "index": 0, "bar": 1, "beat": 1,
      "start": 0, "beats": 2,                 // 在 16 小节内的位置（拍）
      "root": "B", "root_pc": 11, "quality": "maj7",
      "symbol": "Bmaj7", "symbol_ascii": "Bmaj7",
      "key": "B",                             // 属于哪颗星（决定颜色）
      "function": "I",                        // I / V7 / ii
      "tones_pc": [11, 3, 6, 10], "tones": ["B", "D♯", "F♯", "A♯"],
      "guide_tones_pc": [3, 10],              // 三音、七音
      "scale_pc": [...],                      // 和弦音阶
      "pattern_1235": ["B", "C♯", "D♯", "F♯"]
    }
  ],
  "guide_tone_lines": [{"chord": 0, "a_pc": 3, "b_pc": 10}, ...],  // 两声部导音线
  "tonic_cycle": {"tonics_pc": [11, 7, 3], "interval": 4, "fifths_positions": [5, 1, 9],
                  "dominants_pc": [6, 2, 10], "common_tones": {"B∩G": ["B","E","F♯"], ...}},
  "pitch_names": {"sharp": [...], "flat": [...]},
  "fifths_order_pc": [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5]
}
```

## 2. `data/performances/<cue>.json` —— 一段演奏

```jsonc
{
  "id": "solo_slow", "bpm": 140, "beats": 132, "seconds": 56.571,
  "choruses": 2, "seed": 1959,
  "style": {"swing": 0.62, "approach_prob": 0.45, "enclosure_prob": 0.2},
  "tracks": {
    "sax":   [ {"t": 2.0, "grid": 2.0, "d": 0.57, "p": 50, "v": 76,
                "chord": 1, "chorus": 0, "phrase": 1,
                "cell": "1235", "degree": "1", "role": "chord"} ],
    "bass":  [ {"t": 0.0, "d": 0.92, "p": 47, "v": 98, "chord": 0, "label": "1"} ],
    "piano": [ {"t": 0.0, "d": 0.9,  "p": 51, "v": 54, "chord": 0, "label": "3"} ],
    "drums": [ {"t": 0.0, "d": 0.5,  "p": 51, "v": 72} ]      // GM 鼓键位：51 ride, 44 踩镲, 38 军鼓, 36 底鼓
  }
}
```

- `t` 是从这段演奏开始算起的拍数，已包含摇摆和人性化偏移；乘以 `60 / bpm` 即秒。
- `chord` 指向 `giant_steps.json` 的 `chords[index]`。
- 由时间轴生成的背景段（`ambient_*`、`iiVI_C`、`three_tonics`、`dominants`、`notes_1235`）`bpm = 60`，即 1 拍 = 1 秒，并带 `"generated_for_timeline": true`。
- 同一份数据也被写成 MIDI（`build/midi/<cue>.mid`），轨道/通道/音色见 `music/gs/midi_io.py` 的 `INSTRUMENTS`。

## 3. `data/script.json` —— 讲稿（人工编辑）

```jsonc
{
  "voice": {"engine": "...", "speaker": 0, "speed": 0.85},
  "gap_between_lines": 0.55,
  "clause_split": "，。；：？！、",
  "scenes": [
    {"id": "S3", "name": "三等分八度 Dividing the Octave", "lead_in": 1.0, "tail": 1.2,
     "lines": [
       {"id": "L12",
        "zh":  "从 B 出发，向下走一个大三度，到 G；…",     // 字幕显示
        "tts": "从B出发，向下走一个大三度，到G；…",       // 朗读文本（"降E"、"D七"等读法）
        "en":  "Start on B. Down a major third to G. …",   // 英文字幕
        "music_after": {"cue": "demo_1235", "offset": 0.4}  // 可选：这句之后插入一段演奏
       }],
     "music_after_lines": {"cue": "band_slow", "offset": 0.6}  // 可选：场景末尾的演奏
    }],
  "music_under": [                                       // 讲解下方的背景音乐
    {"cue": "three_tonics", "kind": "clause_chords", "line": "L12", "instrument": "ep", "gain": 0.7,
     "events": [{"clause": 0, "chord": "Bmaj7"}, {"clause": 2, "chord": "Gmaj7"}, ...]},
    {"cue": "ambient_intro", "kind": "ambient", "from": "S0", "to": "S1",
     "chords": ["Bmaj7", "Gmaj7", "Ebmaj7", "Bmaj7"], "chord_seconds": 4.0}
  ]
}
```

`clause` 是按 `clause_split` 切分 `tts` 后的分句序号。

## 4. `data/timeline.json` —— 全片时间轴（生成，渲染器唯一输入）

```jsonc
{
  "fps": 30, "duration": 410.1, "width": 1920, "height": 1080,
  "scenes": [{"id": "S3", "name": "...", "start": 72.0, "end": 118.6,
              "lines": [{"id": "L12", "zh": "...", "en": "...", "start": 86.9, "end": 94.4,
                         "clauses": [{"text": "从B出发", "start": 0.0, "end": 0.84}, ...]}]}],
  "cues":   [{"id": "solo_slow", "start": 266.9, "seconds": 56.57, "bpm": 140, "gain": 1.2, "kind": "perf"}],
  "chords": [{"t": 267.0, "d": 0.857, "symbol": "Bmaj7", "key": "B", "index": 0, "bar": 1,
              "chorus": 0, "cue": "solo_slow", "quality": "maj7", "root_pc": 11}],
  "notes":  [{"t": 267.9, "d": 0.24, "p": 62, "v": 80, "tr": "sax", "cue": "solo_slow",
              "key": "G", "sym": "D7", "deg": "1", "role": "chord", "cell": "1235"}],
  "beats":  [{"t": 267.0, "cue": "solo_slow", "beat": 0}]
}
```

- `clauses[].start` 相对于所在句子的开头。
- `notes` 已按 `t` 排序，渲染器用二分查找取当前帧附近的音。

## 5. 网页复用建议

- 互动网页最少只需 `giant_steps.json` + 若干 `performances/*.json` + 对应 MIDI/音频。
- 想做"随时生成新即兴"：把 `improv.py` 移植到 JS，输出同样的 performance 结构，现有的卷帘/键盘/圆形组件即可直接显示。
- 颜色、调性归属都在数据里（`keys[*].color`、`chords[*].key`），组件不需要写死任何乐理。
