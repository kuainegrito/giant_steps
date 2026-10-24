// Loads fonts + data and returns a ready renderer. Used by both preview and capture.
import { createRenderer } from './render.js';

export async function boot(canvas, base = '..') {
  const [timeline, song] = await Promise.all([
    fetch(`${base}/data/timeline.json`).then((r) => r.json()),
    fetch(`${base}/data/giant_steps.json`).then((r) => r.json()),
  ]);
  const faces = ['300 20px "Noto Serif SC"', '400 20px "Noto Serif SC"', '600 20px "Noto Serif SC"',
    '300 20px "Cormorant Garamond"', 'italic 300 20px "Cormorant Garamond"', '400 20px "Cormorant Garamond"',
    'italic 400 20px "Cormorant Garamond"', '500 20px "Cormorant Garamond"', 'italic 500 20px "Cormorant Garamond"', '20px "Accidentals"'];
  await Promise.all(faces.map((f) => document.fonts.load(f, '音Ab♭♯∩')));
  return createRenderer(canvas, timeline, song);
}
