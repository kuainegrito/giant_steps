# Full pipeline. `make all` regenerates everything from data/script.json + code.
PY := python3

all: video

assets:
	./tools/fetch_assets.sh

data:                     ## chords JSON + fixed performances + MIDI
	$(PY) music/scripts/build_data.py

narration:                ## offline TTS, one wav per line
	$(PY) music/scripts/build_narration.py

timeline: data            ## lay out the film on one time axis (needs narration)
	$(PY) music/scripts/build_timeline.py

audio: timeline           ## render MIDI -> wav, then mix with narration
	node audio/render_midi.mjs build/midi/*.mid
	$(PY) music/scripts/mix_audio.py

frames: timeline          ## headless Chromium -> silent mp4
	node video/capture.mjs video --workers 4

video: audio frames
	./video/encode.sh build/giant_steps.mp4

stills:                   ## quick visual check, e.g. make stills T="12 95 300"
	node video/capture.mjs stills $(T)

.PHONY: all assets data narration timeline audio frames video stills
