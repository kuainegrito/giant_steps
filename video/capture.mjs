// Render the Canvas animation frame-by-frame in headless Chromium and encode with ffmpeg.
//
//   node video/capture.mjs stills 12.5 80 200        -> build/stills/t012.50.png ...
//   node video/capture.mjs video [--workers 4]       -> build/video/silent.mp4
//
// Each worker owns a contiguous frame range, pipes JPEG screenshots into its own
// ffmpeg process (chunk_i.mp4); chunks are concatenated losslessly at the end.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { createRequire } from 'module';
// playwright is resolved via require so a globally installed copy (NODE_PATH) also works
const { chromium } = createRequire(import.meta.url)('playwright');

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
  '.otf': 'font/otf', '.woff2': 'font/woff2', '.m4a': 'audio/mp4' };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
      if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

async function openPage(browser, port) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error('console', m.text()); });
  await page.goto(`http://127.0.0.1:${port}/web/capture.html`);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 120000 });
  return page;
}

const [mode, ...rest] = process.argv.slice(2);
const srv = await serve();
const port = srv.address().port;
const browser = await chromium.launch({ args: ['--disable-gpu-vsync', '--force-color-profile=srgb'] });

if (mode === 'stills') {
  fs.mkdirSync(path.join(root, 'build/stills'), { recursive: true });
  const page = await openPage(browser, port);
  for (const ts of rest) {
    const t = parseFloat(ts);
    await page.evaluate((t) => window.renderFrame(t), t);
    const out = path.join(root, 'build/stills', `t${t.toFixed(2).padStart(6, '0')}.png`);
    await page.locator('canvas').screenshot({ path: out });
    console.log(out);
  }
} else if (mode === 'video') {
  const wi = rest.indexOf('--workers');
  const workers = wi >= 0 ? parseInt(rest[wi + 1]) : 4;
  const ri = rest.indexOf('--range');            // optional: --range startSec endSec (for tests)
  const page0 = await openPage(browser, port);
  const { duration, fps } = await page0.evaluate(() => ({ duration: window.renderer.duration, fps: window.renderer.fps }));
  await page0.close();
  let f0 = 0, f1 = Math.ceil(duration * fps);
  if (ri >= 0) { f0 = Math.floor(parseFloat(rest[ri + 1]) * fps); f1 = Math.ceil(parseFloat(rest[ri + 2]) * fps); }
  const outDir = path.join(root, 'build/video');
  fs.mkdirSync(outDir, { recursive: true });
  const per = Math.ceil((f1 - f0) / workers);
  const t0 = Date.now();
  let done = 0;
  const jobs = Array.from({ length: workers }, async (_, w) => {
    const a = f0 + w * per, b = Math.min(f1, a + per);
    if (a >= b) return null;
    const page = await openPage(browser, port);
    const chunk = path.join(outDir, `chunk_${w}.mp4`);
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-tune', 'film', chunk], { stdio: ['pipe', 'inherit', 'inherit'] });
    for (let f = a; f < b; f++) {
      await page.evaluate((t) => window.renderFrame(t), f / fps);
      const buf = await page.screenshot({ type: 'jpeg', quality: 94, clip: { x: 0, y: 0, width: 1920, height: 1080 } });
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      done++;
      if (done % 300 === 0) {
        const el = (Date.now() - t0) / 1000;
        console.log(`${done}/${f1 - f0} frames, ${(done / el).toFixed(1)} fps, eta ${((f1 - f0 - done) / (done / el) / 60).toFixed(1)} min`);
      }
    }
    ff.stdin.end();
    await new Promise((r) => ff.on('close', r));
    await page.close();
    return chunk;
  });
  const chunks = (await Promise.all(jobs)).filter(Boolean);
  fs.writeFileSync(path.join(outDir, 'chunks.txt'), chunks.map((c) => `file '${c}'`).join('\n'));
  await new Promise((r) => spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(outDir, 'chunks.txt'),
    '-c', 'copy', path.join(outDir, 'silent.mp4')], { stdio: 'inherit' }).on('close', r));
  console.log('silent video done in', ((Date.now() - t0) / 60000).toFixed(1), 'min');
}
await browser.close();
srv.close();
