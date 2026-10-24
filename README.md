# Giant Steps · 三颗星的轨道

用代码讲解 John Coltrane《Giant Steps》（1959）背后的和声逻辑 —— **把八度三等分的 Coltrane changes** —— 并生成一段即兴演示。

- 🎬 成片：1080p / 30fps，6 分 50 秒，中文配音 + 中英字幕（视频文件约 111 MB，不放进 Git；发布在 [Releases](https://github.com/kuainegrito/giant_steps/releases)，或运行 `make all` 自行生成）
- 🧠 思考过程：从乐理推导到每一个设计决策，都记录在 `docs/`
- 🧩 可复用：所有音乐内容都是 JSON，画面是纯函数 `render(t)`，为之后的互动网页准备

> 本项目不使用原录音，也不演奏原曲主旋律；只使用和弦进行（不受版权保护）以及程序生成的原创即兴与伴奏。

## 一句话讲完这首曲子

12 个半音 ÷ 3 = 4 个半音（大三度）。B → G → E♭ 在半音圈上是等边三角形，**放回五度圈仍然是等边三角形**——这三个调两两最远（只共享 3 个音阶音）。Coltrane 在每个调前面放上它的属七和弦（D7→G、B♭7→E♭、F♯7→B），用最强的引力把耳朵"接住"。前 7 小节三个调向下旋转，后 9 小节用 ii–V 向上攀升。

## 文档

| 文档 | 内容 |
|---|---|
| [00_PLAN](docs/00_PLAN.md) | 计划、交付物、视频结构、风险 |
| [01_MUSIC_THEORY](docs/01_MUSIC_THEORY.md) | 乐理推导：大三度三等分、五度圈上的等边三角形、属七引力、16 小节结构、即兴工具 |
| [02_DESIGN](docs/02_DESIGN.md) | 视觉与声音设计：颜色系统、字体、音级圆、各场景方案 |
| [03_IMPROV_ENGINE](docs/03_IMPROV_ENGINE.md) | 即兴生成算法：音型词汇、声部进行打分、半音接近、乐句 |
| [04_DATA_SCHEMA](docs/04_DATA_SCHEMA.md) | JSON 数据结构（网页直接复用） |
| [05_PIPELINE](docs/05_PIPELINE.md) | 生成流水线、复现命令、质量检查 |
| [06_WEB_ROADMAP](docs/06_WEB_ROADMAP.md) | 互动网页路线图 |
| [LOG](docs/LOG.md) | 工作日志：决策与踩坑 |

## 目录

```
data/            script.json（讲稿）· giant_steps.json（和弦）· performances/（演奏）· timeline.json（时间轴）
music/gs/        theory.py · arrange.py（贝斯/钢琴/鼓）· improv.py（即兴引擎）· midi_io.py
music/scripts/   build_data · build_narration · build_timeline · mix_audio
audio/           render_midi.mjs（SoundFont 离线渲染）
web/             js/render.js（Canvas 渲染器）· preview.html（可拖动预览）· capture.html
video/           capture.mjs（并行逐帧导出）· encode.sh（混流 + 响度标准化）
tools/           fetch_assets.sh · asr_check.py
```

## 复现

```bash
pip install numpy scipy soundfile mido sherpa-onnx
npm install
make assets && make all
```

详见 [05_PIPELINE](docs/05_PIPELINE.md)。

## 第三方资源

GeneralUser GS SoundFont（S. Christian Collins）· Noto Serif CJK SC、Cormorant Garamond（SIL OFL）· DejaVu Serif · MeloTTS（MIT，经 sherpa-onnx）· spessasynth_core（Apache-2.0）。均在 `make assets` 时下载，不随仓库分发。
