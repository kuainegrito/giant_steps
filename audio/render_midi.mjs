// Offline-render MIDI files to 44.1 kHz stereo WAV with spessasynth_core + GeneralUser GS.
// The browser version of the interactive page can use spessasynth_lib with the same
// SoundFont, so what you hear in the video is what you will hear on the web.
//
// usage: node audio/render_midi.mjs build/midi/a.mid [b.mid ...]   -> build/wav/a.wav ...
import fs from 'fs';
import path from 'path';
import { SpessaSynthProcessor, SpessaSynthSequencer, SoundBankLoader, BasicMIDI, audioToWav } from 'spessasynth_core';

const SR = 44100;
const TAIL = 3.0; // seconds of reverb tail after the last event
const GAIN = 3.0; // fixed gain (no per-file normalisation, so cue levels stay comparable)
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ab = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const sfBuf = fs.readFileSync(path.join(root, 'assets/soundfonts/GeneralUser-GS.sf2'));
const bank = SoundBankLoader.fromArrayBuffer(ab(sfBuf));
fs.mkdirSync(path.join(root, 'build/wav'), { recursive: true });

for (const file of process.argv.slice(2)) {
  const synth = new SpessaSynthProcessor(SR, { enableEventSystem: false });
  synth.soundBankManager.addSoundBank(bank, 'main');
  await synth.processorInitialized;
  const seq = new SpessaSynthSequencer(synth);
  seq.skipToFirstNoteOn = false; // keep leading silence: timing must match the JSON
  seq.loopCount = 0;
  const mid = BasicMIDI.fromArrayBuffer(ab(fs.readFileSync(file)));
  seq.loadNewSongList([mid]);
  seq.play();
  const N = Math.ceil((mid.duration + TAIL) * SR);
  const L = new Float32Array(N), R = new Float32Array(N);
  const B = 128;
  for (let i = 0; i < N; i += B) {
    seq.processTick();
    synth.process(L, R, i, Math.min(B, N - i));
  }
  const out = path.join(root, 'build/wav', path.basename(file).replace(/\.mid$/, '.wav'));
  for (let i = 0; i < N; i++) { L[i] *= GAIN; R[i] *= GAIN; }
  const wav = audioToWav([L, R], SR, { normalizeAudio: false });
  fs.writeFileSync(out, Buffer.from(wav));
  let peak = 0; for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  console.log(path.basename(out), (N / SR).toFixed(2) + 's', 'peak', peak.toFixed(3));
}
