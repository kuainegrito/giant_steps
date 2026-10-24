# 05 · 生成流水线 Pipeline

```
data/script.json ──► build_narration.py ──► build/tts/*.wav + narration.json
                                                    │
music/gs/theory.py ─► build_data.py ──► data/giant_steps.json
music/gs/arrange.py        │            data/performances/{band_slow,demo_*,solo_*}.json
music/gs/improv.py         ▼            build/midi/*.mid
                    build_timeline.py ──► data/timeline.json  (+ 背景音乐 performances / MIDI)
                           │
          ┌────────────────┴──────────────────┐
          ▼                                   ▼
audio/render_midi.mjs (spessasynth)    video/capture.mjs (Chromium + web/js/render.js)
build/wav/*.wav                        build/video/silent.mp4（4 进程并行，分段编码后无损拼接）
          ▼                                   │
mix_audio.py ──► build/audio/mix.wav          │
          └──────────────► video/encode.sh ◄──┘
                           build/giant_steps.mp4（loudnorm −16 LUFS，AAC 256k，H.264 CRF 17）
```

## 复现

```bash
# 依赖：Python 3.11+（numpy scipy soundfile mido sherpa-onnx），Node 22，ffmpeg，playwright + chromium
pip install numpy scipy soundfile mido sherpa-onnx
npm install
make assets      # 下载 SoundFont、字体、TTS 模型（均为开源/免费许可）
make all         # 约 15 分钟（4 核），其中逐帧渲染约 12 分钟
make stills T="60 112 300"   # 只看几帧
```

开发预览：在仓库根目录起一个静态服务器（如 `python3 -m http.server`），打开 `/web/preview.html?t=112`，可拖动时间轴、播放混音。

## 质量检查手段

| 检查 | 方法 |
|---|---|
| 画面 | `make stills` 抽帧拼图，逐场景检查排版、字形（例如 ♭ 过宽的问题就是这样发现的） |
| 配音发音 | `tools/asr_check.py`：用离线 ASR（sherpa-onnx paraformer）把配音转写回文字，与讲稿对照 |
| 乐器平衡 | 单独渲染各声部，比较 RMS，再调整 `midi_io.INSTRUMENTS` 的音量 |
| 响度 | 每 20 秒窗口的 RMS；最终两遍 loudnorm |

## 环境里遇到的限制（记录，便于复现）

- 在线 TTS（edge-tts）、Hugging Face、jsDelivr 被网络策略拦截；GitHub Releases、npm、PyPI 可用。所以 TTS 模型、ASR 模型、字体都从 GitHub Releases 下载，Cormorant/DejaVu 字体从 npm 获取。
- `spessasynth_core` 的 `audioToWav` 默认会把每个文件归一化，必须传 `normalizeAudio: false` 并用固定增益，否则各段音量不可比。
- `SpessaSynthSequencer` 默认会跳过开头的静音，必须设 `skipToFirstNoteOn = false`，否则以休止开头的即兴会整体提前。
