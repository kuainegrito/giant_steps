"""QA: transcribe every narration line with an offline ASR model and print it next
to the intended text, to catch TTS mispronunciations (chord names, numbers ...).
usage: python3 tools/asr_check.py /path/to/sherpa-onnx-paraformer-zh-small-2024-03-09
"""
import json, os, sys
import numpy as np, soundfile as sf, sherpa_onnx
from scipy.signal import resample_poly

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
d = sys.argv[1]
rec = sherpa_onnx.OfflineRecognizer.from_paraformer(paraformer=f"{d}/model.int8.onnx", tokens=f"{d}/tokens.txt", num_threads=4)
script = json.load(open(os.path.join(ROOT, "data", "script.json"), encoding="utf-8"))
for sc in script["scenes"]:
    for ln in sc["lines"]:
        x, sr = sf.read(os.path.join(ROOT, "build", "tts", ln["id"] + ".wav"), dtype="float32")
        x = resample_poly(x, 16000, sr).astype(np.float32)
        s = rec.create_stream(); s.accept_waveform(16000, x); rec.decode_stream(s)
        print(ln["id"], "TTS:", ln["tts"]); print("     ASR:", s.result.text)
