// Record actual WebGL geometry and camera operations, not rendered concept art.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(root, 'apps/web/package.json'));
const { chromium } = require('playwright');
const url = process.argv[2], only = process.argv[3];
const names = ['hero', 'hero-spatial', 'hero-construction-3d', 'hero-section-3d'];
if (!url || (only && !names.includes(only))) throw new Error('Usage: capture-river-3d.mjs <dedicated-demo-url> [hero|hero-spatial|hero-construction-3d|hero-section-3d]');
const work = resolve(root, '.local/hero3d-capture');
await mkdir(work, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
const clips = [], errors = [];
const esc = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function frameHTML(image, title, subtitle, progress) {
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;width:1600px;height:900px;background:#0a1c28;color:#e5f3f7;font-family:'Noto Sans CJK JP',sans-serif;overflow:hidden}
header{height:82px;margin:0 48px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #25404b;font-size:28px;font-weight:800;letter-spacing:-1px}
header b{color:#51d4d5}header span{font-size:13px;font-weight:500;letter-spacing:3px;color:#8db5c5}.model{position:absolute;top:92px;left:24px;width:1552px;height:700px;display:flex;justify-content:center;align-items:center}.model img{width:100%;height:100%;object-fit:contain}
footer{position:absolute;left:48px;right:48px;bottom:27px;display:flex;justify-content:space-between;align-items:end}h1{font-size:29px;margin:0 0 7px;font-weight:700;letter-spacing:-.5px}p{margin:0;font-size:15px;color:#8fb4c5}.note{text-align:right;font-size:12px;line-height:1.8;color:#83a5b6}
.progress{position:absolute;bottom:0;left:0;height:3px;width:${progress}%;background:#51d4d5}
</style><header><div><b>≋</b> DobokuAI</div><span>RIVER ENGINEERING / RUST × THREE.JS</span></header>
<div class="model"><img src="${image}" alt="実際の河床・水面3Dモデル"></div><footer><div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><div class="note">実画面 / 合成サンプル「青葉川」<br>鉛直3倍・縦断0.15倍 / 1D結果の参考表示</div></footer><div class="progress"></div></html>`;
}

async function capture(name, mode) {
  if (only && only !== name) return;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', reducedMotion: 'reduce' });
  const presentation = await browser.newContext({ viewport: { width: 1600, height: 900 }, locale: 'ja-JP' });
  try {
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    const pending = page.waitForResponse(r => r.url().endsWith('/api/compare') && r.ok());
    await page.goto(url);
    const analysis = await (await pending).json();
    await writeFile(resolve(work, `${name}-analysis.json`), JSON.stringify(analysis, null, 2));
    await page.getByRole('heading', { name: '青葉川・河道改修検討' }).waitFor();
    await page.getByRole('button', { name: '縦断水面形', exact: true }).click();
    await page.getByLabel('3D 参考表示（断面の空間的な連続性）').check();
    const canvas = page.locator('.three-view canvas');
    await canvas.waitFor(); await canvas.scrollIntoViewIfNeeded();
    await page.waitForTimeout(700);
    if (mode === 'section') await page.getByRole('button', { name: '断面', exact: true }).click();
    const region = page.locator('.three-view');
    const box = await canvas.boundingBox();
    const deck = await presentation.newPage();
    const frames = [], count = mode === 'compare' ? 32 : 48;
    const seconds = mode === 'compare' ? .17 : 1 / 12;
    // A complete turn uses a total horizontal drag equal to canvas height.
    const dx = (mode === 'section' ? .42 : 1) * box.height / count;
    const selected = page.getByLabel('3D表示モデル');
    let lastModel = 0;
    const step = async () => {
      await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * .5 + dx, box.y + box.height * .5, { steps: 1 });
      await page.mouse.up(); await page.mouse.move(1, 1);
    };
    for (let i = 0; i < count; i++) {
      const after = mode === 'compare' ? i >= count / 2 : mode === 'overview' ? i >= 16 : mode === 'section';
      if (Number(after) !== lastModel) { await selected.selectOption(String(Number(after))); lastModel = Number(after); }
      if (mode === 'overview' && i === 32) await page.getByRole('button', { name: '断面', exact: true }).click();
      if (mode === 'compare' && i === count / 2) {
        await page.getByRole('button', { name: '俯瞰', exact: true }).click();
        await page.getByRole('button', { name: '斜め', exact: true }).click();
      }
      await page.waitForTimeout(25);
      const original = resolve(work, `${name}-${String(i).padStart(3, '0')}-source.png`);
      const source = await region.screenshot({ path: original });
      const c = analysis.comparisons[0];
      const title = mode === 'overview' ? (i < 16 ? '河床と水面、立体で。' : i < 32 ? '掘削案へ切り替え、同じ基準高で比較。' : '断面の形を、奥行きとともに。')
        : mode === 'compare' ? (after ? '河道掘削後。水面形と河床を、同じ座標で。' : '施工前。地形と水面を、立体で見渡す。')
        : mode === 'section' ? '横断面を、厚みのあるモデルで。' : '河床と水面、立体で。';
      const subtitle = mode === 'compare' && after ? `この合成例の最大水位変化 ${c.max_water_change.toFixed(3)} m / 掘削 ${c.cut_volume.toLocaleString('ja-JP')} m³`
        : mode === 'section' ? '実際の断面から生成した地形と、Rustで計算した水位。' : '断面・河床・計算水位を、インタラクティブな3Dモデルへ。';
      await deck.setContent(frameHTML('data:image/png;base64,' + source.toString('base64'), title, subtitle, i / (count - 1) * 100));
      await deck.evaluate(async () => { await document.fonts.ready; await document.images[0].decode(); });
      const path = resolve(work, `${name}-${String(i).padStart(3, '0')}.png`);
      await deck.screenshot({ path });
      frames.push({ path, source_sha256: createHash('sha256').update(source).digest('hex'), seconds, model: after ? c.scenario.name : '施工前' });
      await step();
    }
    const glOK = await canvas.evaluate(c => { const gl = c.getContext('webgl2'); return gl && !gl.isContextLost(); });
    if (!glOK || new Set(frames.map(f => f.source_sha256)).size < count * .9) throw new Error(`${name}: missing WebGL or stationary camera`);
    const manifest = resolve(work, `${name}.ffconcat`);
    // Explicit short duration for the final repeated input avoids an extra long hold.
    await writeFile(manifest, 'ffconcat version 1.0\n' + frames.map(f => `file '${f.path}'\nduration ${f.seconds}\n`).join('') + `file '${frames.at(-1).path}'\nduration 0.04\n`);
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-filter_complex_threads', '1', '-f', 'concat', '-safe', '0', '-i', manifest,
      '-filter_complex', 'fps=12,scale=1280:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle',
      '-loop', '0', resolve(root, 'docs/assets', `${name}.gif`)], { stdio: 'inherit' });
    clips.push({ name, frames });
    console.log(`Encoded ${name}: ${count} real 3D camera frames`);
  } finally { await context.close(); await presentation.close(); }
}
try {
  await capture('hero', 'overview');
  await capture('hero-spatial', 'orbit');
  await capture('hero-construction-3d', 'compare');
  await capture('hero-section-3d', 'section');
  if (errors.length) throw new Error(errors.join('\n'));
} finally { await browser.close(); }
await writeFile(resolve(work, only ? `${only}-manifest.json` : 'manifest.json'), JSON.stringify({ captured_at: new Date().toISOString(), source_commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), notes: 'Actual WebGL meshes from original cross sections and 1D water levels. Display-only interpolation and cut faces; synthetic sample.', clips }, null, 2));
