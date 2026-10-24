// JS mirror of music/gs/theory.py (only what the renderer / web page needs).
export const PC_LABEL = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
export const fifthsIndex = (pc) => (pc * 7) % 12;
export const isBlack = (p) => [1, 3, 6, 8, 10].includes(((p % 12) + 12) % 12);

export const KEY_COLORS = {
  B: '#7fd3ff',   // ice blue
  G: '#f5c46b',   // amber gold
  Eb: '#f07aa0',  // rose
  C: '#d9dcea',   // neutral (ordinary ii–V–I example)
};
export const KEY_PC = { B: 11, G: 7, Eb: 3, C: 0 };
export const KEY_LABEL = { B: 'B', G: 'G', Eb: 'E♭', C: 'C' };

export function noteName(p, key) {
  const pc = ((p % 12) + 12) % 12;
  const flat = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
  const sharp = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  return (key === 'Eb' ? flat : sharp)[pc];
}

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgba = (hex, a) => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};
