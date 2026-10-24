// Giant Steps — time-driven Canvas renderer.
//
//   const r = createRenderer(canvas, timeline, song);
//   r.render(t);          // draws the frame at time t (seconds). Pure: no hidden state.
//
// The video pipeline calls render(t) for t = frame / fps; an interactive page can
// call it from requestAnimationFrame with audio.currentTime. Every visual is a
// function of t + timeline data (data/timeline.json), see docs/02_DESIGN.md.

import { PC_LABEL, fifthsIndex, isBlack, KEY_COLORS, KEY_PC, KEY_LABEL, noteName, rgba } from './theory.js';

const W = 1920, H = 1080;
const SERIF_ZH = '"Accidentals", "Noto Serif SC", "Noto Serif CJK SC", serif';
const SERIF_EN = '"Accidentals", "Cormorant Garamond", "Noto Serif SC", serif';
const INK = '#f3efe6';
const INK_DIM = 'rgba(243,239,230,0.55)';
const INK_FAINT = 'rgba(243,239,230,0.18)';

// ------------------------------------------------------------------ math helpers
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, x) => a + (b - a) * x;
const ease = (x) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3);
const prog = (t, a, b) => clamp((t - a) / (b - a));
const windowA = (t, a, b, fi = 0.6, fo = 0.6) => Math.min(prog(t, a, a + fi), 1 - prog(t, b - fo, b));
function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

function lowerBound(arr, t, key = 't') {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m][key] < t) lo = m + 1; else hi = m; }
  return lo;
}

export function createRenderer(canvas, timeline, song) {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const TL = timeline;
  const scenes = Object.fromEntries(TL.scenes.map((s) => [s.id, s]));
  const lines = {};
  TL.scenes.forEach((s) => s.lines.forEach((l) => { lines[l.id] = l; }));
  const cues = Object.fromEntries(TL.cues.map((c) => [c.id, c]));
  const L = (id) => lines[id].start;
  const LE = (id) => lines[id].end;
  const C = (id, k) => lines[id].start + lines[id].clauses[Math.min(k, lines[id].clauses.length - 1)].start;
  const cueStart = (id) => cues[id].start;
  const cueEnd = (id) => cues[id].start + cues[id].seconds;
  const notes = TL.notes;
  const chords = TL.chords;
  const formChords = song.chords;

  // ---------------------------------------------------------------- sprites
  const spriteCache = {};
  function glow(color) {
    if (spriteCache[color]) return spriteCache[color];
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, rgba(color, 1)); gr.addColorStop(0.18, rgba(color, 0.55));
    gr.addColorStop(0.45, rgba(color, 0.14)); gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    spriteCache[color] = c; return c;
  }
  function drawGlow(x, y, size, color, alpha = 1) {
    if (alpha <= 0.002 || size <= 0) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp(alpha);
    ctx.drawImage(glow(color), x - size / 2, y - size / 2, size, size); ctx.restore();
  }

  // stars (deterministic)
  const stars = Array.from({ length: 280 }, (_, i) => ({
    x: hash(i * 3.1) * W, y: hash(i * 7.7 + 1) * H, r: 0.4 + Math.pow(hash(i * 1.3 + 2), 3) * 1.8,
    f: 0.3 + hash(i * 9.1) * 1.4, ph: hash(i * 5.3) * 6.28, a: 0.25 + hash(i * 2.9) * 0.6,
  }));

  // ---------------------------------------------------------------- lookups
  function chordAt(t) {
    const i = lowerBound(chords, t + 1e-6) - 1;
    if (i >= 0 && t < chords[i].t + chords[i].d) return { ev: chords[i], i };
    return null;
  }
  function keyEnergy(t) {
    const e = { B: 0, G: 0, Eb: 0, C: 0 };
    const ws = [0.32, 0.24, 0.18, 0.14, 0.12];
    ws.forEach((w, k) => { const c = chordAt(t - k * 0.35); if (c) e[c.ev.key] += w; });
    return e;
  }
  function activeNotes(t, filter, lookback = 8) {
    const out = [];
    for (let i = lowerBound(notes, t - lookback); i < notes.length && notes[i].t <= t; i++) {
      const n = notes[i];
      if (t < n.t + n.d && (!filter || filter(n))) out.push(n);
    }
    return out;
  }
  const sceneAt = (t) => TL.scenes.find((s) => t >= s.start && t < s.end) || TL.scenes[TL.scenes.length - 1];

  // ---------------------------------------------------------------- text
  function text(str, x, y, { font = SERIF_ZH, size = 32, weight = 400, color = INK, align = 'center', alpha = 1, italic = false, spacing = 0, baseline = 'alphabetic' } = {}) {
    if (alpha <= 0.002) return;
    ctx.save();
    ctx.globalAlpha = clamp(alpha);
    ctx.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${font}`;
    ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = baseline;
    if (spacing) ctx.letterSpacing = `${spacing}px`;
    ctx.fillText(str, x, y);
    ctx.restore();
  }
  function wrap(str, font, maxW) {
    ctx.save(); ctx.font = font;
    const out = []; let cur = '';
    const tokens = str.match(/[A-Za-z0-9\-–'’".,!?()♭♯]+\s*|\s+|./gu) || [];
    for (const tk of tokens) {
      if (ctx.measureText(cur + tk).width > maxW && cur.trim()) { out.push(cur.trim()); cur = tk.trimStart(); } else cur += tk;
    }
    if (cur.trim()) out.push(cur.trim());
    ctx.restore();
    // avoid a lonely punctuation mark at the start of a line
    for (let i = 1; i < out.length; i++) if (/^[，。、；：！？」）]/.test(out[i])) { out[i - 1] += out[i][0]; out[i] = out[i].slice(1); }
    return out.filter(Boolean);
  }

  // ---------------------------------------------------------------- background
  function background(t) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#04060d'); g.addColorStop(0.55, '#080c1e'); g.addColorStop(1, '#0c0f24');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const e = keyEnergy(t);
    const blobs = [
      { k: 'B', x: 0.22 + 0.05 * Math.sin(t * 0.05), y: 0.35 + 0.04 * Math.cos(t * 0.04), s: 1100 },
      { k: 'G', x: 0.78 + 0.04 * Math.cos(t * 0.045), y: 0.30 + 0.05 * Math.sin(t * 0.035), s: 1000 },
      { k: 'Eb', x: 0.55 + 0.06 * Math.sin(t * 0.03 + 2), y: 0.82 + 0.03 * Math.cos(t * 0.05), s: 1200 },
    ];
    for (const b of blobs) drawGlow(b.x * W, b.y * H, b.s, KEY_COLORS[b.k], 0.07 + 0.22 * e[b.k]);
    for (const s of stars) {
      const a = s.a * (0.55 + 0.45 * Math.sin(t * s.f + s.ph));
      ctx.globalAlpha = a; ctx.fillStyle = '#e8ecff';
      ctx.beginPath(); ctx.arc(s.x, (s.y + t * 2 * s.r) % H, s.r, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  function vignette() {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }

  // ---------------------------------------------------------------- the pitch circle
  // keyframes: {t, cx, cy, R, a(alpha), m(0 chromatic .. 1 fifths), rot}
  const S = scenes;
  const KF = [
    { t: 0, cx: 960, cy: 465, R: 305, a: 0, m: 1, rot: 0 },
    { t: S.S2.start + 0.2, cx: 960, cy: 465, R: 305, a: 0, m: 1, rot: 0 },
    { t: S.S2.start + 1.6, cx: 960, cy: 465, R: 305, a: 1, m: 1, rot: 0 },
    { t: L('L10') + 0.3, cx: 960, cy: 465, R: 305, a: 1, m: 1, rot: 0 },
    { t: L('L10') + 3.3, cx: 960, cy: 465, R: 305, a: 1, m: 0, rot: 0 },
    { t: C('L14', 0) + 0.6, cx: 960, cy: 465, R: 305, a: 1, m: 0, rot: 0 },
    { t: C('L14', 0) + 4.2, cx: 960, cy: 465, R: 305, a: 1, m: 1, rot: 0 },
    { t: L('L15') - 0.2, cx: 960, cy: 465, R: 305, a: 1, m: 1, rot: 0 },
    { t: L('L15') + 1.2, cx: 800, cy: 465, R: 300, a: 1, m: 1, rot: 0 },
    { t: S.S4.start + 0.2, cx: 800, cy: 465, R: 300, a: 1, m: 1, rot: 0 },
    { t: S.S4.start + 1.8, cx: 960, cy: 465, R: 305, a: 1, m: 1, rot: 0 },
    { t: S.S5.start + 0.2, cx: 960, cy: 465, R: 305, a: 1, m: 1, rot: 0 },
    { t: S.S5.start + 1.8, cx: 520, cy: 480, R: 300, a: 1, m: 1, rot: 0 },
    { t: S.S6.start - 0.6, cx: 520, cy: 480, R: 300, a: 1, m: 1, rot: 0 },
    { t: S.S6.start + 0.6, cx: 520, cy: 480, R: 300, a: 0, m: 1, rot: 0 },
    { t: S.S7.start + 0.2, cx: 190, cy: 185, R: 110, a: 0, m: 1, rot: 0 },
    { t: S.S7.start + 1.4, cx: 190, cy: 185, R: 110, a: 1, m: 1, rot: 0 },
    { t: S.S8.start - 0.4, cx: 190, cy: 185, R: 110, a: 1, m: 1, rot: 0 },
    { t: S.S8.start + 1.4, cx: 960, cy: 500, R: 400, a: 0.42, m: 1, rot: 0 },
    { t: S.S9.start, cx: 960, cy: 500, R: 400, a: 0.42, m: 1, rot: 0 },
    { t: S.S9.start + 2.0, cx: 960, cy: 470, R: 300, a: 1, m: 1, rot: 0 },
    { t: TL.duration, cx: 960, cy: 470, R: 300, a: 1, m: 1, rot: 40 },
  ];
  function circleState(t) {
    let i = 0; while (i < KF.length - 2 && KF[i + 1].t <= t) i++;
    const a = KF[i], b = KF[i + 1];
    const x = b.t > a.t ? ease((t - a.t) / (b.t - a.t)) : 1;
    const o = {}; for (const k of ['cx', 'cy', 'R', 'a', 'm', 'rot']) o[k] = lerp(a[k], b[k], t >= b.t ? 1 : x);
    if (KF[KF.length - 1].t > a.t && i === KF.length - 2) o.rot = lerp(a.rot, b.rot, clamp((t - a.t) / (b.t - a.t)));
    return o;
  }
  function nodeAngle(pc, m, rot) {
    const ac = pc * 30, af = fifthsIndex(pc) * 30;
    const diff = ((af - ac + 540) % 360) - 180;
    return ((ac + diff * m + rot - 90) * Math.PI) / 180;
  }
  function nodePos(st, pc, rr = 1) {
    const a = nodeAngle(pc, st.m, st.rot);
    return [st.cx + Math.cos(a) * st.R * rr, st.cy + Math.sin(a) * st.R * rr];
  }

  function drawCircle(t, st, hl = {}, opts = {}) {
    if (st.a <= 0.01) return;
    ctx.save(); ctx.globalAlpha = st.a;
    // ring
    ctx.strokeStyle = 'rgba(220,226,255,0.16)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(st.cx, st.cy, st.R, 0, 6.283); ctx.stroke();
    ctx.strokeStyle = 'rgba(220,226,255,0.06)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(st.cx, st.cy, st.R * 0.82, 0, 6.283); ctx.stroke();
    ctx.restore();
    const small = st.R < 200;
    for (let pc = 0; pc < 12; pc++) {
      const appear = opts.appear ? opts.appear(pc) : 1;
      if (appear <= 0) continue;
      const [x, y] = nodePos(st, pc);
      const h = hl[pc];
      const amt = h ? h[0] : 0;
      const col = h ? h[1] : '#dfe4ff';
      if (amt > 0) drawGlow(x, y, (small ? 70 : 150) * (0.6 + 0.6 * amt), col, st.a * amt * 0.9);
      ctx.save(); ctx.globalAlpha = st.a * appear;
      ctx.fillStyle = amt > 0 ? col : 'rgba(225,230,255,0.55)';
      ctx.beginPath(); ctx.arc(x, y, (small ? 3 : 5) + amt * (small ? 3 : 5), 0, 6.283); ctx.fill();
      ctx.restore();
      const [lx, ly] = nodePos(st, pc, small ? 1.28 : 1.17);
      text(PC_LABEL[pc], lx, ly, { font: SERIF_EN, size: small ? 20 : 34, weight: amt > 0.3 ? 600 : 400,
        color: amt > 0.3 ? col : INK_DIM, alpha: st.a * appear * (0.65 + 0.35 * amt), baseline: 'middle' });
    }
  }

  function drawEdge(st, pcA, pcB, colA, colB, p = 1, width = 3, alpha = 1) {
    if (p <= 0 || st.a <= 0.01) return;
    const [x1, y1] = nodePos(st, pcA), [x2, y2] = nodePos(st, pcB);
    const x = lerp(x1, x2, p), y = lerp(y1, y2, p);
    ctx.save(); ctx.globalAlpha = st.a * alpha; ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createLinearGradient(x1, y1, x2, y2);
    g.addColorStop(0, colA); g.addColorStop(1, colB);
    for (const [w, a] of [[width * 5, 0.10], [width * 2.2, 0.25], [width, 0.95]]) {
      ctx.strokeStyle = g; ctx.globalAlpha = st.a * alpha * a; ctx.lineWidth = w; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x, y); ctx.stroke();
    }
    ctx.restore();
    if (p < 1) drawGlow(x, y, 60, colB, st.a * alpha);
  }

  function drawArrow(st, pcA, pcB, col, p = 1, alpha = 1, bend = 0.35) {
    if (p <= 0 || st.a <= 0.01) return;
    const [x1, y1] = nodePos(st, pcA, 0.9), [x2, y2] = nodePos(st, pcB, 0.9);
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const cx = lerp(mx, st.cx, bend), cy = lerp(my, st.cy, bend);
    const N = 40, n = Math.max(2, Math.round(N * p));
    ctx.save(); ctx.globalAlpha = st.a * alpha; ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    ctx.beginPath();
    let px = x1, py = y1, qx = x1, qy = y1;
    for (let i = 0; i <= n; i++) {
      const u = (i / N);
      const x = (1 - u) * (1 - u) * x1 + 2 * (1 - u) * u * cx + u * u * x2;
      const y = (1 - u) * (1 - u) * y1 + 2 * (1 - u) * u * cy + u * u * y2;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      qx = px; qy = py; px = x; py = y;
    }
    ctx.stroke();
    if (p > 0.9) {
      const ang = Math.atan2(py - qy, px - qx);
      ctx.fillStyle = col; ctx.beginPath();
      ctx.moveTo(px + Math.cos(ang) * 6, py + Math.sin(ang) * 6);
      ctx.lineTo(px + Math.cos(ang + 2.5) * 14, py + Math.sin(ang + 2.5) * 14);
      ctx.lineTo(px + Math.cos(ang - 2.5) * 14, py + Math.sin(ang - 2.5) * 14);
      ctx.fill();
    }
    ctx.restore();
  }

  function triangle(st, p = 3, alpha = 1, pcs = [11, 7, 3], keys = ['B', 'G', 'Eb'], width = 3) {
    for (let i = 0; i < 3; i++) {
      drawEdge(st, pcs[i], pcs[(i + 1) % 3], KEY_COLORS[keys[i]], KEY_COLORS[keys[(i + 1) % 3]], clamp(p - i), width, alpha);
    }
  }
  function triangleFill(st, alpha) {
    if (alpha <= 0) return;
    const pts = [11, 7, 3].map((pc) => nodePos(st, pc));
    ctx.save(); ctx.globalAlpha = alpha * st.a; ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(st.cx, st.cy, 0, st.cx, st.cy, st.R);
    g.addColorStop(0, 'rgba(255,255,255,0.10)'); g.addColorStop(1, 'rgba(160,180,255,0.02)');
    ctx.fillStyle = g; ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // comet that follows the active key centre
  function cometPos(t, st) {
    const c = chordAt(t);
    if (!c) return null;
    const ev = c.ev;
    const prev = chords[c.i - 1];
    const to = nodePos(st, KEY_PC[ev.key], 0.86);
    if (!prev || prev.cue !== ev.cue || prev.key === ev.key) return to;
    const from = nodePos(st, KEY_PC[prev.key], 0.86);
    const dur = Math.min(0.35, ev.d * 0.5);
    const u = easeOut((t - ev.t) / dur);
    const mx = lerp((from[0] + to[0]) / 2, st.cx, 0.25), my = lerp((from[1] + to[1]) / 2, st.cy, 0.25);
    return [(1 - u) * (1 - u) * from[0] + 2 * (1 - u) * u * mx + u * u * to[0],
      (1 - u) * (1 - u) * from[1] + 2 * (1 - u) * u * my + u * u * to[1]];
  }
  function drawComet(t, st, cueId, alpha = 1) {
    if (t < cueStart(cueId) || t > cueEnd(cueId) + 1.5) return;
    const fade = alpha * windowA(t, cueStart(cueId), cueEnd(cueId) + 1.5, 0.3, 1.2);
    for (let k = 14; k >= 0; k--) {
      const tt = t - k * 0.025;
      if (tt < cueStart(cueId)) continue;
      const p = cometPos(tt, st); if (!p) continue;
      const c = chordAt(tt);
      const col = KEY_COLORS[c.ev.key];
      drawGlow(p[0], p[1], (st.R < 200 ? 50 : 110) * (1 - k / 18), col, fade * (1 - k / 15) * (k === 0 ? 1 : 0.35));
    }
  }
  function keyHighlights(t, base = {}, strength = 1) {
    const hl = { ...base };
    const c = chordAt(t);
    if (c) {
      const col = KEY_COLORS[c.ev.key];
      const pulse = 1 - 0.4 * prog(t, c.ev.t, c.ev.t + c.ev.d);
      hl[KEY_PC[c.ev.key]] = [strength * pulse, col];
      if (c.ev.root_pc !== KEY_PC[c.ev.key]) hl[c.ev.root_pc] = [0.55 * strength * pulse, col];
    }
    return hl;
  }

  // ---------------------------------------------------------------- bar grid
  function drawGrid(t, x0, y0, bw, bh, gap, alpha, { emph = null, cueIds = [], showBars = true, small = false } = {}) {
    if (alpha <= 0.01) return;
    const act = chordAt(t);
    const activeIdx = act && cueIds.includes(act.ev.cue) ? act.ev.index : -1;
    for (const c of formChords) {
      const bar = c.bar - 1;
      const row = Math.floor(bar / 4), col = bar % 4;
      const bx = x0 + col * (bw + gap) + ((c.beat - 1) / 4) * bw;
      const by = y0 + row * (bh + gap);
      const w = (c.beats / 4) * bw - (c.beats === 2 && c.beat === 1 ? 3 : 0);
      const color = KEY_COLORS[c.key];
      let e = emph ? emph(c) : 0.25;
      const isAct = c.index === activeIdx;
      if (isAct) e = 1;
      ctx.save(); ctx.globalAlpha = alpha;
      ctx.fillStyle = rgba(color, 0.05 + 0.32 * e);
      ctx.strokeStyle = rgba(color, 0.25 + 0.6 * e); ctx.lineWidth = isAct ? 2.5 : 1.2;
      roundRect(bx + (c.beat === 3 ? 3 : 0), by, w, bh, small ? 4 : 8); ctx.fill(); ctx.stroke();
      ctx.restore();
      if (isAct) drawGlow(bx + w / 2, by + bh / 2, small ? 120 : 260, color, 0.55 * alpha);
      text(c.symbol, bx + w / 2 + (c.beat === 3 ? 1.5 : 0), by + bh / 2 + (small ? 1 : 2),
        { font: SERIF_EN, size: small ? 15 : (c.beats === 2 ? 27 : 31), weight: 600, color: isAct ? '#ffffff' : rgba(color, 0.55 + 0.45 * e), alpha, baseline: 'middle' });
      if (showBars && c.beat === 1)
        text(String(c.bar), bx + 8, by + 18, { font: SERIF_EN, size: 15, color: INK_FAINT, align: 'left', alpha });
    }
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // ---------------------------------------------------------------- keyboard
  function drawKeyboard(t, x0, y0, wkw, wkh, lo, hi, alpha, lit = [], { labels = true } = {}) {
    if (alpha <= 0.01) return;
    const whites = []; for (let p = lo; p <= hi; p++) if (!isBlack(p)) whites.push(p);
    const pos = {};
    whites.forEach((p, i) => { pos[p] = x0 + i * wkw; });
    const litMap = new Map(lit.map((n) => [n.p, n]));
    ctx.save(); ctx.globalAlpha = alpha;
    for (const p of whites) {
      const n = litMap.get(p);
      ctx.fillStyle = n ? rgba(n.color, 0.85) : 'rgba(235,238,250,0.10)';
      ctx.strokeStyle = 'rgba(235,238,250,0.25)'; ctx.lineWidth = 1;
      roundRect(pos[p] + 2, y0, wkw - 4, wkh, 6); ctx.fill(); ctx.stroke();
    }
    for (let p = lo; p <= hi; p++) {
      if (!isBlack(p)) continue;
      const x = pos[p - 1] + wkw * 0.68;
      const n = litMap.get(p);
      ctx.fillStyle = n ? rgba(n.color, 0.95) : 'rgba(10,12,26,0.95)';
      ctx.strokeStyle = 'rgba(235,238,250,0.3)';
      roundRect(x, y0 - 1, wkw * 0.64, wkh * 0.62, 4); ctx.fill(); ctx.stroke();
      pos[p] = x - wkw * 0.18;
    }
    ctx.restore();
    for (const n of lit) {
      if (pos[n.p] === undefined) continue;
      const cx = isBlack(n.p) ? pos[n.p] + wkw * 0.5 : pos[n.p] + wkw / 2;
      drawGlow(cx, y0 + (isBlack(n.p) ? wkh * 0.3 : wkh * 0.7), wkw * 3, n.color, alpha * 0.6 * (n.a ?? 1));
      if (labels && n.label) {
        text(n.label, cx, y0 - 46, { font: SERIF_EN, size: 30, weight: 600, color: n.color, alpha: alpha * (n.a ?? 1) });
        if (n.sub) text(n.sub, cx, y0 - 18, { font: SERIF_EN, size: 21, color: INK_DIM, alpha: alpha * (n.a ?? 1) });
      }
    }
    return pos;
  }

  // ---------------------------------------------------------------- piano roll
  function drawRoll(t, { cueId, x0 = 0, x1 = W, yTop, yBot, playX, pps, lo = 48, hi = 82, alpha = 1, labels = false, particles = false }) {
    if (alpha <= 0.01) return;
    const yOf = (p) => lerp(yBot, yTop, (p - lo) / (hi - lo));
    const tMin = t - (playX - x0) / pps, tMax = t + (x1 - playX) / pps;
    // faint pitch lines for the tonics
    ctx.save(); ctx.globalAlpha = alpha * 0.5;
    for (let p = lo; p <= hi; p++) {
      const pc = p % 12;
      const k = pc === 11 ? 'B' : pc === 7 ? 'G' : pc === 3 ? 'Eb' : null;
      if (!k) continue;
      ctx.strokeStyle = rgba(KEY_COLORS[k], 0.13); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0, yOf(p)); ctx.lineTo(x1, yOf(p)); ctx.stroke();
    }
    ctx.restore();
    // chord-change ticks on the time axis
    for (let i = lowerBound(chords, tMin); i < chords.length && chords[i].t < tMax; i++) {
      const ev = chords[i]; if (ev.cue !== cueId) continue;
      const x = playX + (ev.t - t) * pps;
      ctx.save(); ctx.globalAlpha = alpha * 0.35 * edgeFade(x); ctx.strokeStyle = rgba(KEY_COLORS[ev.key], 0.6);
      ctx.setLineDash([3, 6]); ctx.beginPath(); ctx.moveTo(x, yTop - 20); ctx.lineTo(x, yBot + 10); ctx.stroke(); ctx.restore();
      if (labels) text(ev.symbol, x + 6, yTop - 26, { font: SERIF_EN, size: 22, color: KEY_COLORS[ev.key], align: 'left', alpha: alpha * 0.8 * edgeFade(x) });
    }
    function edgeFade(x) { return clamp((x - x0) / 260) * clamp((x1 - x) / 160); }
    const i0 = lowerBound(notes, tMin - 4);
    for (let i = i0; i < notes.length && notes[i].t < tMax; i++) {
      const n = notes[i];
      if (n.cue !== cueId || (n.tr !== 'sax' && n.tr !== 'bass')) continue;
      if (n.t + n.d < tMin) continue;
      const xa = playX + (n.t - t) * pps, xb = playX + (n.t + n.d - t) * pps;
      const col = KEY_COLORS[n.key] || '#ffffff';
      if (n.tr === 'bass') {
        const y = yOf(n.p + 12) + 0;
        ctx.save(); ctx.globalAlpha = alpha * 0.22 * edgeFade(xa); ctx.fillStyle = col;
        roundRect(xa, y - 2, Math.max(4, xb - xa - 2), 4, 2); ctx.fill(); ctx.restore();
        continue;
      }
      const y = yOf(n.p);
      const on = t >= n.t && t < n.t + n.d;
      const past = t >= n.t + n.d;
      const ef = edgeFade(xa);
      const a = alpha * ef * (on ? 1 : past ? 0.55 : 0.32);
      ctx.save(); ctx.globalAlpha = a;
      ctx.fillStyle = on ? '#ffffff' : col;
      roundRect(xa, y - 6, Math.max(6, xb - xa - 2), 12, 6); ctx.fill();
      ctx.restore();
      if (on) drawGlow(playX, y, 120, col, alpha * 0.9);
      else if (past) drawGlow((xa + xb) / 2, y, 50, col, a * 0.35);
      if (labels && n.deg && ef > 0.05) {
        const app = n.role === 'approach' || n.role === 'enclosure';
        text(app ? '·' + n.deg : n.deg, xa + 2, y - 14, { font: SERIF_EN, size: 19, italic: app, color: app ? INK_DIM : col, align: 'left', alpha: a * 0.95 });
      }
      if (particles && t >= n.t && t < n.t + 1.4) {
        const age = t - n.t;
        for (let k = 0; k < 7; k++) {
          const ang = hash(i * 13 + k) * 6.283, sp = 60 + hash(i * 7 + k) * 160;
          const px = playX + Math.cos(ang) * sp * age - age * pps * 0.5, py = y + Math.sin(ang) * sp * age;
          drawGlow(px, py, 22, col, alpha * (1 - age / 1.4) * 0.8);
        }
      }
    }
    // playhead
    ctx.save(); ctx.globalAlpha = alpha * 0.5;
    const g = ctx.createLinearGradient(0, yTop - 40, 0, yBot + 40);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = g; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(playX, yTop - 40); ctx.lineTo(playX, yBot + 40); ctx.stroke();
    ctx.restore();
  }

  // ---------------------------------------------------------------- shared overlays
  function subtitles(t) {
    let line = null;
    for (const s of TL.scenes) for (const l of s.lines) if (t >= l.start - 0.25 && t <= l.end + 0.7) line = l;
    if (!line) return;
    const a = windowA(t, line.start - 0.25, line.end + 0.7, 0.3, 0.45);
    const zhFont = `400 40px ${SERIF_ZH}`;
    let zh = wrap(line.zh, zhFont, 1500);
    if (zh.length === 2) {                     // two lines: split at the punctuation nearest the middle
      const mid = line.zh.length / 2;
      let best = -1;
      for (let i = 0; i < line.zh.length - 1; i++) if ('，。；：'.includes(line.zh[i]) && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
      if (best > 0 && Math.abs(best - mid) < line.zh.length * 0.3) zh = [line.zh.slice(0, best + 1), line.zh.slice(best + 1)];
    }
    const en = wrap(line.en, `italic 400 29px ${SERIF_EN}`, 1500);
    const nLines = zh.length + en.length;
    let y = H - 70 - (en.length * 36) - (zh.length - 1) * 54;
    // soft backing
    const g = ctx.createLinearGradient(0, H - 90 - nLines * 52, 0, H);
    g.addColorStop(0, 'rgba(4,6,14,0)'); g.addColorStop(1, 'rgba(4,6,14,0.6)');
    ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = g; ctx.fillRect(0, H - 90 - nLines * 52, W, 90 + nLines * 52); ctx.restore();
    for (const s of zh) { text(s, W / 2, y, { size: 40, alpha: a, spacing: 2 }); y += 54; }
    y -= 8;
    for (const s of en) { text(s, W / 2, y, { font: SERIF_EN, size: 29, italic: true, color: 'rgba(243,239,230,0.66)', alpha: a }); y += 36; }
  }
  function sceneChip(t) {
    const s = sceneAt(t);
    if (s.id === 'S0') return;
    const a = windowA(t, s.start, s.end, 1.0, 0.8) * 0.85;
    const num = s.id.slice(1).padStart(2, '0');
    const [zh, ...en] = s.name.split(' ');
    const x = s.id === 'S7' ? 1500 : 90; // S7 keeps the top-left for the mini circle
    text(num, x, 92, { font: SERIF_EN, size: 30, color: INK_DIM, align: 'left', alpha: a, italic: true });
    ctx.save(); ctx.globalAlpha = a * 0.5; ctx.strokeStyle = INK_DIM; ctx.beginPath(); ctx.moveTo(x + 44, 82); ctx.lineTo(x + 84, 82); ctx.stroke(); ctx.restore();
    text(zh, x + 98, 92, { size: 26, color: INK, align: 'left', alpha: a, spacing: 3 });
    ctx.save(); ctx.font = `400 26px ${SERIF_ZH}`; ctx.letterSpacing = '3px'; const wz = ctx.measureText(zh).width; ctx.restore();
    text(en.join(' '), x + 112 + wz, 92, { font: SERIF_EN, size: 24, italic: true, color: INK_DIM, align: 'left', alpha: a });
  }

  // ================================================================ scenes
  function sceneS0(t) {
    const s = S.S0;
    const a = windowA(t, 0.8, s.end + 0.6, 2.4, 1.6);
    // three faint stars foreshadow the triangle
    const st = { cx: 960, cy: 470, R: 300, m: 1, rot: 0, a: 1 };
    ['B', 'G', 'Eb'].forEach((k, i) => {
      const [x, y] = nodePos(st, KEY_PC[k]);
      drawGlow(x, y, 160 + 30 * Math.sin(t * 0.8 + i * 2), KEY_COLORS[k], a * 0.55 * prog(t, 2 + i * 0.8, 5 + i * 0.8));
    });
    triangle(st, 3, 0.12 * a * prog(t, 6, 10), undefined, undefined, 1.5);
    const rise = ease(prog(t, L('L01'), L('L02')));
    const yT = 470 - 20 * rise;
    text('Giant Steps', W / 2, yT, { font: SERIF_EN, size: 168, weight: 300, italic: true, alpha: a, spacing: lerp(30, 6, easeOut(prog(t, 0.8, 5))) });
    text('三 颗 星 的 轨 道', W / 2, yT + 92, { size: 38, weight: 300, color: INK_DIM, alpha: a * prog(t, 2.2, 4.2), spacing: 10 });
    text('John Coltrane · 1959', W / 2, yT + 150, { font: SERIF_EN, size: 30, italic: true, color: 'rgba(243,239,230,0.45)', alpha: a * prog(t, 3, 5) });
    if (t > L('L02') - 0.3) drawGlow(W / 2, yT - 50, 900, '#ffe9c4', 0.18 * windowA(t, L('L02') - 0.3, s.end, 0.8, 1.5));
  }

  function sceneS1(t) {
    const s = S.S1;
    const a = windowA(t, s.start, s.end, 0.8, 0.9);
    const cards = [
      { at: C('L03', 0), big: '≈ 286', unit: 'BPM', cap: '每分钟近 290 拍' },
      { at: C('L03', 1), big: '0.42', unit: '秒', cap: '两拍就换一个和弦' },
      { at: C('L03', 2), big: '3', unit: '个调', cap: '在遥远的调之间跳跃' },
    ];
    cards.forEach((c, i) => {
      const ca = a * easeOut(prog(t, c.at, c.at + 0.8)) * (1 - prog(t, L('L05') + 1.5, L('L05') + 3));
      const x = 460 + i * 500, y = 420 + 14 * (1 - easeOut(prog(t, c.at, c.at + 0.8)));
      text(c.big, x, y, { font: SERIF_EN, size: 120, weight: 300, alpha: ca });
      text(c.unit, x, y + 50, { font: SERIF_EN, size: 30, italic: true, color: INK_DIM, alpha: ca });
      text(c.cap, x, y + 102, { size: 28, color: INK_DIM, alpha: ca, spacing: 2 });
    });
    // key names flicker in their colours on "distant key"
    const fk = a * windowA(t, C('L03', 3), L('L05') + 2.5, 0.4, 1);
    ['B', 'G', 'Eb'].forEach((k, i) => {
      const on = prog(t, C('L03', 3) + i * 0.35, C('L03', 3) + i * 0.35 + 0.3);
      text(KEY_LABEL[k], 960 + (i - 1) * 140, 250, { font: SERIF_EN, size: 64, weight: 500, color: KEY_COLORS[k], alpha: fk * on });
      drawGlow(960 + (i - 1) * 140, 230, 200, KEY_COLORS[k], fk * on * 0.4);
    });
    // Flanagan: sparse falling notes
    const fa = a * windowA(t, L('L04'), LE('L04') + 0.8, 0.6, 0.8);
    if (fa > 0) {
      text('Tommy Flanagan', 960, 700, { font: SERIF_EN, size: 40, italic: true, alpha: fa });
      text('piano', 960, 738, { font: SERIF_EN, size: 24, italic: true, color: INK_DIM, alpha: fa });
      for (let k = 0; k < 9; k++) {
        const t0 = L('L04') + k * 0.55, age = t - t0;
        if (age < 0 || age > 2.5) continue;
        drawGlow(600 + hash(k) * 720, 620 + age * 30, 40, '#e8ecff', fa * (1 - age / 2.5) * 0.8);
      }
    }
    // order hint
    const oa = a * prog(t, C('L05', 1), C('L05', 2) + 1);
    if (oa > 0) {
      const st = { cx: 960, cy: 470, R: 220, m: 1, rot: t * 4, a: oa };
      triangle(st, 3, 0.8, undefined, undefined, 2);
      ['B', 'G', 'Eb'].forEach((k) => { const [x, y] = nodePos(st, KEY_PC[k]); drawGlow(x, y, 120, KEY_COLORS[k], oa * 0.8); });
    }
  }

  function sceneS2(t, st) {
    const C0 = KEY_COLORS.C;
    const appear = (pc) => prog(t, L('L06') + 0.6 + fifthsIndex(pc) * 0.22, L('L06') + 1.2 + fifthsIndex(pc) * 0.22) || (t > S.S2.end ? 1 : 0);
    const hl = {};
    const dA = prog(t, C('L07', 3), C('L07', 3) + 0.4), gA = prog(t, C('L07', 4), C('L07', 4) + 0.4), cA = prog(t, C('L07', 5), C('L07', 5) + 0.4);
    if (dA) hl[2] = [dA * 0.8, C0];
    if (gA) hl[7] = [gA * 0.9, C0];
    if (cA) hl[0] = [cA, '#ffe9c4'];
    // a light walking home during L08
    const walkA = windowA(t, L('L08'), LE('L09') + 0.5, 0.4, 0.6);
    drawCircle(t, st, hl, { appear: (pc) => (t < L('L06') + 4 ? appear(pc) : 1) });
    const ar = windowA(t, C('L07', 4), S.S2.end, 0.3, 0.8);
    drawArrow(st, 2, 7, rgba(C0, 0.8), prog(t, C('L07', 4), C('L07', 4) + 0.6), ar);
    drawArrow(st, 7, 0, rgba('#ffe9c4', 0.9), prog(t, C('L07', 5), C('L07', 5) + 0.6), ar);
    const labA = windowA(t, C('L07', 3), S.S2.end, 0.4, 0.8);
    [[2, 'Dm7', 'ii', dA], [7, 'G7', 'V', gA], [0, 'Cmaj7', 'I', cA]].forEach(([pc, sym, fn, v]) => {
      const [x, y] = nodePos(st, pc, 0.66);
      text(sym, x, y, { font: SERIF_EN, size: 30, weight: 600, color: pc === 0 ? '#ffe9c4' : C0, alpha: labA * v, baseline: 'middle' });
      text(fn, x, y + 30, { font: SERIF_EN, size: 22, italic: true, color: INK_DIM, alpha: labA * v, baseline: 'middle' });
    });
    if (walkA > 0) {
      const cyc = ((t - L('L08')) % 3) / 3;
      const seq = [2, 7, 0];
      const k = Math.min(1.999, cyc * 2);
      const a0 = nodePos(st, seq[Math.floor(k)]), a1 = nodePos(st, seq[Math.floor(k) + 1]);
      const u = ease(k % 1);
      drawGlow(lerp(a0[0], a1[0], u), lerp(a0[1], a1[1], u), 70, '#ffe9c4', walkA * 0.9);
      const [hx, hy] = nodePos(st, 0, 1.17);
      text('家 · home', hx - 46, hy, { size: 26, color: '#ffe9c4', alpha: walkA * 0.9, align: 'right', baseline: 'middle' });
    }
    // neighbours of C during L09
    const nb = windowA(t, L('L09'), S.S2.end, 0.6, 0.8);
    if (nb > 0) {
      const a0 = nodeAngle(5, st.m, st.rot), a1 = nodeAngle(7, st.m, st.rot);
      ctx.save(); ctx.globalAlpha = nb * 0.5 * st.a; ctx.strokeStyle = '#ffe9c4'; ctx.lineWidth = 16; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(st.cx, st.cy, st.R, a0 - 0.08, a1 + 0.08 + (a1 < a0 ? 6.283 : 0)); ctx.stroke(); ctx.restore();
      text('相邻的调：只差一个升降号', st.cx, st.cy + 10, { size: 28, color: INK_DIM, alpha: nb, spacing: 2 });
    }
    text('五度圈  Circle of Fifths', W - 90, 92, { align: 'right', size: 24, color: INK_DIM, alpha: st.a * windowA(t, L('L06'), S.S2.end, 1, 0.8), spacing: 3 });
  }

  function sceneS3(t, st) {
    const hl = {};
    const bOn = prog(t, C('L12', 0), C('L12', 0) + 0.3), gOn = prog(t, C('L12', 2), C('L12', 2) + 0.3), eOn = prog(t, C('L12', 4), C('L12', 4) + 0.3);
    const triA = 1;
    if (bOn) hl[11] = [bOn, KEY_COLORS.B];
    if (gOn) hl[7] = [gOn, KEY_COLORS.G];
    if (eOn) hl[3] = [eOn, KEY_COLORS.Eb];
    // semitone arc B -> G during L11 (four steps)
    const arcA = windowA(t, C('L11', 3), C('L12', 1), 0.4, 0.6);
    if (arcA > 0) {
      const steps = Math.floor(clamp((t - C('L11', 3)) / 0.35, 0, 4));
      for (let k = 1; k <= steps; k++) hl[11 - k] = [0.45 * arcA, '#cfe8ff'];
      const a0 = nodeAngle(7, st.m, st.rot), a1 = nodeAngle(11, st.m, st.rot);
      ctx.save(); ctx.globalAlpha = arcA * 0.45; ctx.strokeStyle = '#cfe8ff'; ctx.lineWidth = 10; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(st.cx, st.cy, st.R, a0, a1); ctx.stroke(); ctx.restore();
    }
    drawCircle(t, st, hl);
    // edges B->G->Eb->B
    const p1 = prog(t, C('L12', 1), C('L12', 2) + 0.2), p2 = prog(t, C('L12', 3), C('L12', 4) + 0.2), p3 = prog(t, C('L12', 5), C('L12', 6) + 0.3);
    drawEdge(st, 11, 7, KEY_COLORS.B, KEY_COLORS.G, p1, 3, triA);
    drawEdge(st, 7, 3, KEY_COLORS.G, KEY_COLORS.Eb, p2, 3, triA);
    drawEdge(st, 3, 11, KEY_COLORS.Eb, KEY_COLORS.B, p3, 3, triA);
    const fillA = 0.7 + 0.3 * Math.sin((t - L('L13')) * 2.2);
    triangleFill(st, prog(t, L('L13'), L('L13') + 1.2) * fillA);
    // centre text
    const eq = windowA(t, C('L11', 1), C('L12', 0) + 0.3, 0.5, 0.6);
    text('12 ÷ 3 = 4', st.cx, st.cy - 6, { font: SERIF_EN, size: 76, weight: 300, alpha: eq * prog(t, C('L11', 1), C('L11', 2)) });
    text('4 个半音 = 大三度', st.cx, st.cy + 52, { size: 30, color: INK_DIM, alpha: eq * prog(t, C('L11', 3), C('L11', 4)), spacing: 3 });
    // caption: which circle
    const capC = 1 - st.m;
    const capA = windowA(t, S.S3.start, S.S3.end, 0.8, 0.8);
    text('半音圈  Chromatic Circle', W - 90, 92, { align: 'right', size: 24, color: INK_DIM, alpha: capA * capC, spacing: 3 });
    text('五度圈  Circle of Fifths', W - 90, 92, { align: 'right', size: 24, color: INK_DIM, alpha: capA * st.m * (t > L('L14') ? 1 : 0), spacing: 3 });
    // L14: "farthest apart"
    const far = windowA(t, C('L14', 2), L('L15') + 0.3, 0.5, 0.5);
    text('彼此最远的三个调', st.cx, st.cy + 10, { size: 32, color: INK, alpha: far, spacing: 4 });
    // L15: key signatures + shared notes
    const sigs = [['B', '5 ♯', 0], ['G', '1 ♯', 1], ['Eb', '3 ♭', 2]];
    for (const [k, sig, i] of sigs) {
      const sa = windowA(t, C('L15', i), S.S3.end, 0.4, 0.8);
      const [x, y] = nodePos(st, KEY_PC[k], 1.36);
      text(sig, x, y, { font: SERIF_EN, size: 34, weight: 600, color: KEY_COLORS[k], alpha: sa, baseline: 'middle' });
    }
    const ct = windowA(t, C('L15', 3), S.S3.end, 0.5, 0.8);
    const rows = [['B', 'G', 'B  E  F♯'], ['G', 'Eb', 'G  C  D'], ['Eb', 'B', 'E♭  A♭  B♭']];
    rows.forEach(([a, b, notesStr], i) => {
      const y = 360 + i * 92;
      const ra = ct * prog(t, C('L15', 3) + i * 0.4, C('L15', 3) + i * 0.4 + 0.5);
      const parts = [[KEY_LABEL[a], KEY_COLORS[a], 600], [' ∩ ', INK_DIM, 400], [KEY_LABEL[b], KEY_COLORS[b], 600], ['  =  ', INK_DIM, 400], [notesStr, INK, 400]];
      let x = 1300;
      for (const [str, col, wt] of parts) {
        text(str, x, y, { font: SERIF_EN, size: 40, weight: wt, color: col, align: 'left', alpha: ra });
        ctx.save(); ctx.font = `${wt} 40px ${SERIF_EN}`; x += ctx.measureText(str).width; ctx.restore();
      }
    });
    text('只有 3 个共同音（共 7 个）', 1300, 360 + 3 * 92 - 10, { size: 26, color: INK_DIM, align: 'left', alpha: ct * prog(t, C('L15', 4), C('L15', 4) + 0.6), spacing: 2 });
  }

  function sceneS4(t, st) {
    const hl = { 11: [0.8, KEY_COLORS.B], 7: [0.8, KEY_COLORS.G], 3: [0.8, KEY_COLORS.Eb] };
    const dom = [[2, 7, 'G', 'D7', 0], [10, 3, 'Eb', 'B♭7', 2], [6, 11, 'B', 'F♯7', 4]];
    for (const [dpc, tpc, k, sym, ci] of dom) {
      const on = prog(t, C('L17', ci), C('L17', ci) + 0.3);
      if (on) hl[dpc] = [on * 0.65, KEY_COLORS[k]];
      const land = prog(t, C('L17', ci + 1), C('L17', ci + 1) + 0.25);
      if (land) hl[tpc] = [0.8 + 0.4 * land * (1 - prog(t, C('L17', ci + 1) + 0.3, C('L17', ci + 1) + 1.2)), KEY_COLORS[k]];
    }
    // dominant triangle appears in L19 (symmetry: a second augmented triad)
    const domTri = windowA(t, C('L19', 1), S.S4.end + 0.5, 1.0, 0.8);
    triangle(st, 3, 0.25 + 0.75 * (1 - domTri * 0.4), undefined, undefined, 3);
    triangle(st, 3 * domTri, 0.35 * domTri, [2, 6, 10], ['G', 'B', 'Eb'], 1.5);
    drawCircle(t, st, hl);
    for (const [dpc, tpc, k, sym, ci] of dom) {
      const p = prog(t, C('L17', ci + 1) - 0.35, C('L17', ci + 1) + 0.25);
      const aa = windowA(t, C('L17', ci), S.S4.end, 0.3, 0.8) * (1 - 0.85 * windowA(t, C('L19', 0), S.S4.end + 1, 0.8, 0.1));
      drawArrow(st, dpc, tpc, rgba(KEY_COLORS[k], 0.9), p, aa, -0.45);
      const [x, y] = nodePos(st, dpc, 0.7);
      text(sym, x, y, { font: SERIF_EN, size: 34, weight: 600, color: KEY_COLORS[k], alpha: aa, baseline: 'middle' });
    }
    // centre: V7 -> I
    const v = windowA(t, C('L16', 2), C('L17', 0), 0.6, 0.4);
    text('V7  →  I', st.cx, st.cy + 10, { font: SERIF_EN, size: 64, weight: 300, alpha: v });
    text('属七和弦  →  主和弦', st.cx, st.cy + 62, { size: 26, color: INK_DIM, alpha: v, spacing: 3 });
    // gravity: orbiting particles around tonics in L18
    const ga = windowA(t, L('L18'), S.S4.end, 0.8, 0.8);
    if (ga > 0) for (const k of ['B', 'G', 'Eb']) {
      const [x, y] = nodePos(st, KEY_PC[k]);
      for (let j = 0; j < 3; j++) {
        const ang = t * (1.6 + j * 0.3) + j * 2.1 + KEY_PC[k];
        drawGlow(x + Math.cos(ang) * (34 + j * 10), y + Math.sin(ang) * (34 + j * 10), 26, KEY_COLORS[k], ga * 0.9);
      }
    }
    const ct = windowA(t, C('L19', 0), S.S4.end, 0.8, 0.8);
    text('Coltrane Changes', st.cx, st.cy, { font: SERIF_EN, size: 62, italic: true, weight: 400, alpha: ct });
    text('三个等距主音 + 通往它们的属七和弦', st.cx, st.cy + 50, { size: 26, color: INK_DIM, alpha: ct * prog(t, C('L19', 1), C('L19', 2)), spacing: 2 });
  }

  function sceneS5(t, st) {
    const s = S.S5;
    const ga = windowA(t, s.start + 0.8, s.end + 0.3, 1.2, 0.9);
    const band = t >= cueStart('band_slow') - 0.2 && t <= cueEnd('band_slow') + 1;
    const hl = band ? keyHighlights(t) : { 11: [0.6, KEY_COLORS.B], 7: [0.6, KEY_COLORS.G], 3: [0.6, KEY_COLORS.Eb] };
    // emphasis per narration
    const firstHalf = windowA(t, C('L20', 2), L('L21'), 0.5, 0.3);
    const secondHalf = windowA(t, L('L21'), L('L22') + 0.5, 0.5, 0.4);
    const spot = { B: C('L20', 4), G: C('L20', 5), Eb: C('L20', 6) };
    const emph = (c) => {
      let e = 0.22;
      if (firstHalf > 0 && c.bar <= 7) e = 0.25 + 0.45 * firstHalf * (c.function === 'I' ? prog(t, spot[c.key], spot[c.key] + 0.4) : 0.3);
      if (secondHalf > 0 && c.bar >= 8) e = Math.max(e, 0.25 + 0.5 * secondHalf * (c.function !== 'I' ? prog(t, C('L21', 1), C('L21', 1) + 0.6) : 0.4));
      return e;
    };
    for (const k of ['B', 'G', 'Eb']) {
      const v = prog(t, spot[k], spot[k] + 0.3) * windowA(t, spot[k], L('L21'), 0.2, 0.4);
      if (v) hl[KEY_PC[k]] = [1, KEY_COLORS[k]];
    }
    triangle(st, 3, band ? 0.35 : 0.6);
    drawCircle(t, st, hl);
    drawComet(t, st, 'band_slow');
    drawGrid(t, 1000, 250, 192, 86, 14, ga, { emph, cueIds: ['band_slow'] });
    // annotations
    text('前半  B → G → E♭  大三度下行 ↓', 1000, 222, { size: 26, align: 'left', color: INK, alpha: ga * windowA(t, C('L20', 3), L('L21'), 0.5, 0.4), spacing: 2 });
    text('后半  ii–V 引入  大三度上行 ↑', 1000, 222, { size: 26, align: 'left', color: INK, alpha: ga * windowA(t, L('L21') + 0.4, cueStart('band_slow'), 0.5, 0.6), spacing: 2 });
    if (band) {
      const c = chordAt(t);
      const ba = windowA(t, cueStart('band_slow'), cueEnd('band_slow') + 1, 0.6, 1);
      if (c && c.ev.cue === 'band_slow') {
        text(c.ev.symbol, st.cx, st.cy + 14, { font: SERIF_EN, size: 70, weight: 500, color: KEY_COLORS[c.ev.key], alpha: ba, baseline: 'middle' });
        text(c.ev.bar <= 16 ? `bar ${c.ev.bar}` : 'fine', st.cx, st.cy + 64, { font: SERIF_EN, size: 24, italic: true, color: INK_DIM, alpha: ba });
      }
      text('140 BPM  ·  原速约 286', 1000 + 2 * (192 + 14) - 7, 250 + 4 * 100 + 40, { font: SERIF_EN, size: 26, italic: true, color: INK_DIM, alpha: ba });
    }
  }

  function sceneS6(t) {
    const s = S.S6;
    const a = windowA(t, s.start, s.end, 0.8, 0.8);
    const kbX = 300, kbY = 640, wkw = 60, wkh = 170;
    // lit keys
    let lit = [];
    // L25 spoken notes (vibes) accumulate per chord group
    const vib = notes.filter((n) => n.cue === 'notes_1235');
    if (t >= L('L25') && t < cueStart('demo_1235')) {
      const group = t < C('L25', 5) ? 0 : 1;
      const key = group === 0 ? 'B' : 'G';
      vib.forEach((n, i) => {
        if ((i < 4) === (group === 0) && t >= n.t) {
          const deg = ['1', '2', '3', '5'][i % 4];
          lit.push({ p: n.p - 12, color: KEY_COLORS[key], label: noteName(n.p, key), sub: deg, a: 1 });
        }
      });
    }
    const playing = (id) => t >= cueStart(id) - 0.05 && t <= cueEnd(id) + 0.4;
    if (playing('demo_1235')) {
      activeNotes(t, (n) => n.cue === 'demo_1235' && n.tr === 'sax').forEach((n) => lit.push({ p: n.p, color: KEY_COLORS[n.key], label: noteName(n.p, n.key), sub: n.deg }));
    }
    if (playing('demo_guide')) {
      activeNotes(t, (n) => n.cue === 'demo_guide').forEach((n) => lit.push({ p: n.p, color: KEY_COLORS[n.key], label: noteName(n.p, n.key), sub: n.deg }));
    }
    drawKeyboard(t, kbX, kbY, wkw, wkh, 48, 84, a, lit);
    // chord strip (bars 1-3)
    const stripA = a * windowA(t, L('L25'), LE('L26') + 9, 0.6, 0.8) * (1 - windowA(t, L('L26'), LE('L26') + 9, 0.5, 0.5) * 0);
    const strip = formChords.slice(0, 5);
    const act = chordAt(t);
    strip.forEach((c, i) => {
      const x = 560 + i * 200, y = 560;
      const isAct = act && (act.ev.cue === 'demo_1235' || act.ev.cue === 'demo_guide') && act.ev.index === c.index;
      const spoken = (i === 0 && t >= C('L25', 0) && t < C('L25', 5)) || (i === 1 && t >= C('L25', 5) && t < cueStart('demo_1235'));
      const e = isAct || spoken ? 1 : 0.35;
      text(c.symbol, x, y, { font: SERIF_EN, size: 38, weight: 600, color: rgba(KEY_COLORS[c.key], e), alpha: stripA * (t < L('L26') || t > cueStart('demo_guide') - 2 ? 1 : 1) });
      if (isAct || spoken) drawGlow(x, y - 12, 160, KEY_COLORS[c.key], stripA * 0.5);
    });
    // big 1-2-3-5
    const big = windowA(t, L('L24'), LE('L25') + 0.2, 0.6, 0.6) * a;
    const nums = ['1', '2', '3', '5'];
    nums.forEach((nm, i) => {
      const on = prog(t, C('L24', 2 + i), C('L24', 2 + i) + 0.3);
      text(nm, 960 + (i - 1.5) * 150, 330, { font: SERIF_EN, size: 130, weight: 300, color: on > 0 ? '#ffffff' : INK_FAINT, alpha: big * (0.4 + 0.6 * on) });
      if (on) drawGlow(960 + (i - 1.5) * 150, 290, 200, '#ffe9c4', big * on * 0.35 * (1 - prog(t, C('L24', 2 + i) + 0.3, C('L24', 2 + i) + 1.5)));
    });
    text('根 · 二 · 三 · 五', 960, 410, { size: 28, color: INK_DIM, alpha: big * prog(t, C('L24', 2), C('L24', 5)), spacing: 6 });
    text('Patterns · 音型', 960, 330, { font: SERIF_EN, size: 72, italic: true, weight: 300, alpha: a * windowA(t, L('L23') + 0.6, L('L24') + 0.2, 0.8, 0.6) });
    // guide-tone diagram
    const gd = a * windowA(t, L('L26'), cueEnd('demo_guide') + 0.8, 0.8, 0.8);
    if (gd > 0) {
      const gl = song.guide_tone_lines.slice(0, 5);
      const ptsA = [], ptsB = [];
      const pitchOf = { A: [], B: [] };
      // reconstruct pitches from the demo notes for exact placement
      const gn = notes.filter((n) => n.cue === 'demo_guide');
      for (let i = 0; i < 5; i++) {
        const pair = gn.filter((n) => Math.abs(n.t - (cueStart('demo_guide') + formChords[i].start * 60 / cues.demo_guide.bpm)) < 0.05).sort((x, y) => y.p - x.p);
        pitchOf.A.push(pair[0]); pitchOf.B.push(pair[1]);
      }
      const yOf = (p) => 500 - (p - 57) * 20;
      for (let i = 0; i < 5; i++) {
        const x = 560 + i * 200;
        for (const [arr, pts] of [[pitchOf.A, ptsA], [pitchOf.B, ptsB]]) {
          const n = arr[i]; if (!n) continue;
          pts.push([x, yOf(n.p), n]);
        }
      }
      for (const pts of [ptsA, ptsB]) {
        ctx.save(); ctx.globalAlpha = gd * 0.6; ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2;
        ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); ctx.restore();
        pts.forEach(([x, y, n], i) => {
          const on = t >= n.t && t < n.t + n.d;
          drawGlow(x, y, on ? 110 : 50, KEY_COLORS[n.key], gd * (on ? 1 : 0.5));
          ctx.save(); ctx.globalAlpha = gd; ctx.fillStyle = KEY_COLORS[n.key]; ctx.beginPath(); ctx.arc(x, y, 7, 0, 6.283); ctx.fill(); ctx.restore();
          text(`${noteName(n.p, n.key)}`, x + 18, y + 10, { font: SERIF_EN, size: 32, weight: 600, color: KEY_COLORS[n.key], align: 'left', alpha: gd });
          text(`(${n.deg})`, x + 18, y + 36, { font: SERIF_EN, size: 22, italic: true, color: INK_DIM, align: 'left', alpha: gd });
        });
      }
      text('三音 · 七音  Guide Tones', 960, 200, { size: 30, alpha: gd, spacing: 3 });
    }
    // enclosure diagram during L27
    const en = a * windowA(t, L('L27'), s.end, 0.6, 0.8);
    if (en > 0) {
      const tx = 960, ty = 330;
      drawGlow(tx, ty, 140, KEY_COLORS.G, en);
      text('G', tx, ty + 14, { font: SERIF_EN, size: 46, weight: 600, color: '#ffffff', alpha: en, baseline: 'middle' });
      text('目标音（Gmaj7 的根音）', tx, ty + 80, { size: 24, color: KEY_COLORS.G, alpha: en, spacing: 2 });
      const a1 = prog(t, L('L27') + 0.6, L('L27') + 1.6), a2 = prog(t, L('L27') + 1.6, L('L27') + 2.6);
      text('A♭', tx - 300, ty - 88, { font: SERIF_EN, size: 36, weight: 600, alpha: en * a1, baseline: 'middle' });
      text('上方半音', tx - 300, ty - 40, { size: 22, color: INK_DIM, alpha: en * a1 });
      text('F♯', tx - 300, ty + 52, { font: SERIF_EN, size: 36, weight: 600, alpha: en * a2, baseline: 'middle' });
      text('下方半音', tx - 300, ty + 100, { size: 22, color: INK_DIM, alpha: en * a2 });
      drawGlow(tx - 300, ty - 100, 60, '#ffffff', en * a1 * 0.7);
      drawGlow(tx - 300, ty + 40, 60, '#ffffff', en * a2 * 0.7);
      ctx.save(); ctx.globalAlpha = en * 0.6; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 6]);
      if (a1) { ctx.beginPath(); ctx.moveTo(tx - 270, ty - 95); ctx.quadraticCurveTo(tx - 120, ty - 90, tx - 40, ty - 10); ctx.stroke(); }
      if (a2) { ctx.beginPath(); ctx.moveTo(tx - 270, ty + 38); ctx.quadraticCurveTo(tx - 120, ty + 30, tx - 40, ty + 6); ctx.stroke(); }
      ctx.restore();
      text('包围 enclosure  ·  半音接近 approach', tx, ty + 175, { size: 28, alpha: en * prog(t, L('L27') + 2.6, L('L27') + 3.4), spacing: 2 });
    }
  }

  function sceneS7(t, st) {
    const s = S.S7;
    const a = windowA(t, s.start, s.end, 0.8, 0.8);
    const id = 'solo_slow';
    const mA = a * windowA(t, cueStart(id) - 1.5, cueEnd(id) + 1.5, 1.0, 1.0);
    // legend before the music starts
    const lg = a * windowA(t, L('L28') + 3, cueStart(id) + 2, 0.8, 0.8);
    ['B', 'G', 'Eb'].forEach((k, i) => {
      const x = 760 + i * 200;
      drawGlow(x, 420, 90, KEY_COLORS[k], lg);
      text(KEY_LABEL[k] + ' 大调', x, 490, { size: 28, color: KEY_COLORS[k], alpha: lg, spacing: 2 });
    });
    drawCircle(t, st, keyHighlights(t));
    triangle(st, 3, 0.45, undefined, undefined, 1.5);
    drawComet(t, st, id);
    drawRoll(t, { cueId: id, x0: 0, x1: W, yTop: 300, yBot: 690, playX: 1180, pps: 230, lo: 49, hi: 80, alpha: mA, labels: true });
    const lit = activeNotes(t, (n) => n.cue === id && n.tr === 'sax').map((n) => ({ p: n.p, color: KEY_COLORS[n.key], label: noteName(n.p, n.key), sub: n.deg }));
    drawKeyboard(t, 300, 850, 60, 150, 48, 84, mA, lit);
    drawGrid(t, 1480, 140, 92, 36, 6, mA * 0.9, { cueIds: [id], showBars: false, small: true });
    const c = chordAt(t);
    if (c && c.ev.cue === id) {
      text(c.ev.symbol, 960, 150, { font: SERIF_EN, size: 76, weight: 500, color: KEY_COLORS[c.ev.key], alpha: mA, baseline: 'middle' });
      text(c.ev.bar <= 16 ? `chorus ${c.ev.chorus + 1}  ·  bar ${c.ev.bar}` : 'fine', 960, 205, { font: SERIF_EN, size: 24, italic: true, color: INK_DIM, alpha: mA });
    }
    text('140 BPM', 300, 830, { font: SERIF_EN, size: 22, italic: true, color: INK_DIM, align: 'left', alpha: mA * 0.8 });
  }

  function sceneS8(t, st) {
    const s = S.S8;
    const a = windowA(t, s.start, s.end + 0.5, 0.8, 1.2);
    const id = 'solo_fast';
    const mA = a * windowA(t, cueStart(id) - 1.0, cueEnd(id) + 1.8, 0.8, 1.2);
    const c = chordAt(t);
    // pulse the triangle on chord changes
    const pulse = c && c.ev.cue === id ? 1 - prog(t, c.ev.t, c.ev.t + 0.4) : 0;
    triangle(st, 3, 0.35 + 0.4 * pulse, undefined, undefined, 2.5);
    drawCircle(t, st, keyHighlights(t, {}, 1));
    drawComet(t, st, id, 0.9);
    drawRoll(t, { cueId: id, x0: 0, x1: W, yTop: 250, yBot: 800, playX: 1240, pps: 330, lo: 49, hi: 80, alpha: mA, labels: false, particles: true });
    if (c && c.ev.cue === id) {
      text(c.ev.symbol, 960, 150, { font: SERIF_EN, size: 64, weight: 500, color: KEY_COLORS[c.ev.key], alpha: mA * 0.9, baseline: 'middle' });
      text(c.ev.bar <= 16 ? `chorus ${c.ev.chorus + 1}` : 'fine', 960, 200, { font: SERIF_EN, size: 22, italic: true, color: INK_DIM, alpha: mA * 0.8 });
    }
    text('286 BPM', 960, 1010, { font: SERIF_EN, size: 26, italic: true, color: INK_DIM, alpha: mA * 0.8 });
  }

  function sceneS9(t, st) {
    const s = S.S9;
    const a = windowA(t, s.start, s.end + 1, 1.2, 0.1);
    const hl = { 11: [0.9, KEY_COLORS.B], 7: [0.9, KEY_COLORS.G], 3: [0.9, KEY_COLORS.Eb] };
    const dA = prog(t, s.start + 2, s.start + 5);
    hl[2] = [0.5 * dA, KEY_COLORS.G]; hl[10] = [0.5 * dA, KEY_COLORS.Eb]; hl[6] = [0.5 * dA, KEY_COLORS.B];
    const endCard = prog(t, LE('L31') + 0.8, LE('L31') + 2.6);
    const stE = { ...st, a: st.a * (1 - 0.65 * endCard) };
    triangle(stE, 3, 0.9);
    triangle(stE, 3 * dA, 0.45, [2, 6, 10], ['G', 'B', 'Eb'], 1.8);
    triangleFill(stE, 0.6);
    drawCircle(t, stE, hl);
    // tunes
    const tunes = [['Countdown', '1959', C('L30', 2)], ['26-2', '1960', C('L30', 3)], ['A Love Supreme', '1964', C('L30', 5)]];
    tunes.forEach(([nm, yr, at], i) => {
      const ta = a * windowA(t, at, L('L31') + 0.5, 0.6, 0.8);
      text(nm, 1560, 380 + i * 110, { font: SERIF_EN, size: 44, italic: true, alpha: ta });
      text(yr, 1560, 418 + i * 110, { font: SERIF_EN, size: 24, color: INK_DIM, alpha: ta });
    });
    // end card
    if (endCard > 0) {
      text('Giant Steps', W / 2, 455, { font: SERIF_EN, size: 128, weight: 300, italic: true, alpha: endCard, spacing: 6 });
      text('三 颗 星 的 轨 道', W / 2, 535, { size: 34, weight: 300, color: INK_DIM, alpha: endCard, spacing: 10 });
      const cr = prog(t, LE('L31') + 2.2, LE('L31') + 3.6);
      text('和弦进行  John Coltrane, 1959   ·   即兴、伴奏与画面由程序生成', W / 2, 700, { size: 24, color: INK_DIM, alpha: cr, spacing: 2 });
      text('github.com/kuainegrito/giant_steps', W / 2, 745, { font: SERIF_EN, size: 28, italic: true, color: INK_DIM, alpha: cr });
    }
  }

  // ================================================================ frame
  function render(t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    background(t);
    const st = circleState(t);
    const sc = sceneAt(t);
    const id = sc.id;
    // neighbouring scenes overlap during transitions
    const near = (sid) => t >= S[sid].start - 1 && t <= S[sid].end + 1;
    if (near('S0')) sceneS0(t);
    if (near('S1')) sceneS1(t);
    if (id === 'S2') sceneS2(t, st);
    if (id === 'S3') sceneS3(t, st);
    if (id === 'S4') sceneS4(t, st);
    if (id === 'S5') sceneS5(t, st);
    if (near('S6')) sceneS6(t);
    if (id === 'S7') sceneS7(t, st);
    if (id === 'S8') sceneS8(t, st);
    if (id === 'S9') sceneS9(t, st);
    vignette();
    sceneChip(t);
    subtitles(t);
    // global fade from / to black
    const fade = Math.min(prog(t, 0, 1.5), 1 - prog(t, TL.duration - 1.5, TL.duration));
    if (fade < 1) { ctx.fillStyle = `rgba(0,0,0,${1 - fade})`; ctx.fillRect(0, 0, W, H); }
  }

  return { render, width: W, height: H, duration: TL.duration, fps: TL.fps };
}
