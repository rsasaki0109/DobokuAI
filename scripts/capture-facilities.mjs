// Capture authored illustrative facilities from the real browser, not calculated designs.
import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(root, 'apps/web/package.json'));
const { chromium } = require('playwright');
const baseURL = process.argv[2], encodeOnly = process.argv[3] === '--encode-only', only = encodeOnly ? undefined : process.argv[3];
const cases = [
  ['gravity', '重力式ダム', 'hero-dam', 'GRAVITY DAM', '堤体・洪水吐・ゲート・取水塔・管理橋・貯水池'],
  ['arch', 'アーチダム', 'hero-arch-dam', 'ARCH DAM', '湾曲する堤体と、山地に囲まれた貯水池'],
  ['bridge', '斜張橋', 'hero-bridge', 'CABLE-STAYED BRIDGE', '主塔・斜材・橋桁・橋脚・防護柵を作り込む'],
  ['sabo', '砂防堰堤', 'hero-sabo', 'SABO CHECK DAM', 'スリット・副堰堤・水叩き・渓流の施設モデル'],
];
if (!baseURL || (only && !cases.some(c => c[0] === only))) throw new Error('Usage: capture-facilities.mjs <dedicated-demo-url> [gravity|arch|bridge|sabo]');
const work = resolve(root, '.local/facility-capture'); await mkdir(work, { recursive: true });
const browser = encodeOnly ? null : await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
const clips = [], errors = [];
const sourceHashes = {};
for (const file of ['apps/web/src/Infrastructure3D.tsx', 'apps/web/src/infrastructureScene.ts', 'scripts/capture-facilities.mjs']) sourceHashes[file] = createHash('sha256').update(await readFile(resolve(root, file))).digest('hex');
function frameHTML(source, name, tag, subtitle) {
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;width:1440px;height:900px;color:#263e35;background:#f0f3e9;font-family:'Noto Sans CJK JP',sans-serif}
header{height:86px;padding:0 42px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #d7e1d2;font-weight:800;font-size:30px;letter-spacing:-1px}header span{font-size:13px;font-weight:500;letter-spacing:3px;color:#6c8374}
.image{position:absolute;top:100px;left:24px;right:24px;height:674px;display:flex;align-items:center;justify-content:center}.image img{width:100%;height:100%;object-fit:contain}
footer{position:absolute;bottom:30px;left:42px;right:42px;display:flex;align-items:end;justify-content:space-between}h1{font-size:30px;margin:0 0 9px}p{margin:0;font-size:16px;color:#677e6d}.note{text-align:right;font-size:12px;color:#7b8c79;line-height:1.8}
</style><header><div>≋ DobokuAI</div><span>INFRASTRUCTURE STUDIO / ${tag}</span></header><div class="image"><img src="${source}" alt="施設の実画面"></div><footer><div><h1>${name}</h1><p>${subtitle}</p></div><div class="note">架空施設・形状参考 / 放流は演出<br>水理・構造解析とは未連携</div></footer></html>`;
}
if (encodeOnly) {
  clips.push(...JSON.parse(await readFile(resolve(work, 'manifest.json'), 'utf8')).clips);
} else {
try {
  for (const [kind, name, asset, tag, subtitle] of cases) {
    if (only && only !== kind) continue;
    const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', reducedMotion: 'reduce' });
    const presentation = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ja-JP' });
    try {
      const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
      const url = new URL(baseURL); url.searchParams.set('view', 'structures');
      await page.goto(url.href); const stage = page.locator('.facility-stage');
      await stage.locator('canvas').waitFor();
      await page.locator('.facility-cards button').filter({ has: page.getByText(name, { exact: true }) }).click();
      await page.waitForTimeout(600);
      const deck = await presentation.newPage(), frames = [];
      const canvas = stage.locator('canvas');
      for (let i = 0; i < 24; i++) {
        await page.bringToFront();
        if (i === 12) await page.getByRole('button', { name: kind === 'arch' ? '上流側' : '施設詳細', exact: true }).click();
        if (i === 20) await page.getByRole('button', { name: '夕景', exact: true }).click();
        await canvas.scrollIntoViewIfNeeded();
        const box = await canvas.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 4, box.y + box.height / 2); await page.mouse.up();
        await page.mouse.move(1, 1);
        const original = resolve(work, `${asset}-${String(i).padStart(3, '0')}-source.png`);
        const source = await stage.screenshot({ path: original });
        await deck.bringToFront();
        await deck.setContent(frameHTML('data:image/png;base64,' + source.toString('base64'), name, tag, subtitle));
        await deck.evaluate(async () => { await document.fonts.ready; await document.images[0].decode(); });
        const path = resolve(work, `${asset}-${String(i).padStart(3, '0')}.png`);
        await deck.screenshot({ path });
        frames.push({ path, seconds: .12, source_sha256: createHash('sha256').update(source).digest('hex'), view: i < 12 ? 'overview' : kind === 'arch' ? 'upstream' : 'detail', sunset: i >= 20 });
      }
      if (new Set(frames.map(f => f.source_sha256)).size < 20) throw new Error(`${name}: camera frames did not change`);
      const active = await canvas.evaluate(c => { const gl = c.getContext('webgl2'); return gl && !gl.isContextLost(); });
      if (!active) throw new Error(`${name}: WebGL is unavailable`);
      clips.push({ name: asset, kind, model_type: 'illustrative', numerical_solver_linked: false, settings: { height: 72, waterRatio: .83, gate: .6 }, frames });
      console.log(`Captured ${name}: 24 actual camera/material frames`);
    } finally { await context.close(); await presentation.close(); }
  }
  if (errors.length) throw new Error(errors.join('\n'));
} finally { await browser.close(); }
if (!only) clips.push({ name: 'hero', model_type: 'illustrative', numerical_solver_linked: false, frames: clips.flatMap(c => [...c.frames.slice(0, 6), ...c.frames.slice(12, 18)]) });
await writeFile(resolve(work, only ? `${only}-manifest.json` : 'manifest.json'), JSON.stringify({ captured_at: new Date().toISOString(), base_commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), source_sha256: sourceHashes, note: 'Authored fictional facility and terrain. Water/discharge are decorative. Actual browser capture; numerical solver is not connected.', clips }, null, 2));
}
for (const { name, frames } of clips) {
  const file = resolve(work, `${name}.ffconcat`);
  await writeFile(file, 'ffconcat version 1.0\n' + frames.map(f => `file '${f.path}'\nduration ${f.seconds}\n`).join('') + `file '${frames.at(-1).path}'\nduration 0.04\n`);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-filter_complex_threads', '1', '-f', 'concat', '-safe', '0', '-i', file,
    '-filter_complex', 'fps=10,scale=1120:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff:max_colors=192[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
    '-loop', '0', resolve(root, 'docs/assets', name + '.gif')], { stdio: 'inherit' });
  console.log(`Encoded docs/assets/${name}.gif`);
}
