// Presentation frames surround unmodified screenshots from a dedicated demo server.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(root, 'apps/web/package.json'));
const { chromium } = require('playwright');
const baseURL = process.argv[2];
const only = process.argv[3];
const features = {
  'hero-river': ['RIVER ENGINEERING', '河川の検討を、ひとつの画面に。', '水位・水深・流速を、同じモデルで見渡す。', '#65dfc6'],
  'hero-editor': ['CROSS SECTION EDITOR', '断面を変える。形が見える。', '底幅・法勾配・断面形式をインタラクティブに編集。', '#79cfff'],
  'hero-construction': ['CONSTRUCTION SCENARIOS', '改修案を、数値と図で比べる。', '同じ基準高で、水面形・掘削断面・概算土量を比較。', '#ffc48c'],
  'hero-assistant': ['PROPOSE → REVIEW → COMPUTE', '次の検討を、自然言語で。', '提案を確認してから、Rustエンジンで再計算。', '#baa7ff'],
  'hero-reports': ['REPRODUCIBLE REPORTS', '検討の根拠を、成果に残す。', '保存した条件・数値・版・日時を、図付きHTMLへ。', '#8be0ec'],
  'hero-spatial': ['SPATIAL REFERENCE VIEW', '断面のつながりを、立体で。', '3Dは空間的な参考表示。定量比較は2D図で。', '#b7e391'],
};
if (!baseURL || (only && !features[only])) {
  throw new Error('Usage: node scripts/capture-heroes.mjs <dedicated-demo-url> [hero-river|hero-editor|hero-construction|hero-assistant|hero-reports|hero-spatial]');
}
const work = resolve(root, '.local/hero-capture');
const assets = resolve(root, 'docs/assets');
await mkdir(work, { recursive: true });
await mkdir(assets, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
});
const issues = [];
const clips = [];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const htmlEscape = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const nav = async (page, name) => page.getByRole('button', { name, exact: true }).click();
const panel = (page, name) => page.locator('section.panel').filter({ has: page.getByRole('heading', { name, exact: true }) }).first();
const run = async page => {
  await page.getByRole('button', { name: '計算を実行', exact: true }).click();
  await page.getByText('数値計算と施工比較が完了しました').waitFor();
};

function frameHTML(feature, images, caption, step, total) {
  const [tag, title, description, accent] = feature;
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;width:1600px;height:1000px;overflow:hidden;font-family:'Noto Sans CJK JP',sans-serif;color:#ecf3f7;background:#101f2b}
body:before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse at 85% 12%,${accent}19,transparent 48%),linear-gradient(115deg,#ffffff03,transparent);pointer-events:none}
header{height:105px;margin:0 68px;border-bottom:1px solid #ffffff14;display:flex;align-items:center;justify-content:space-between}
.brand{font-size:31px;letter-spacing:-1px;font-weight:800;display:flex;align-items:center;gap:16px}.mark{width:43px;height:40px;display:grid;align-content:center;gap:6px}.mark i{height:5px;border-radius:7px;background:${accent};transform:skewY(-10deg)}.mark i:nth-child(2){width:32px}.mark i:nth-child(3){width:21px}
.label{font-size:15px;color:#a6b6c4;letter-spacing:3px}.intro{margin:27px 68px 0;display:flex;justify-content:space-between;align-items:center}.tag{font-size:14px;letter-spacing:3px;color:${accent};font-weight:700}h1{font-size:49px;line-height:1.3;letter-spacing:-1.5px;margin:11px 0 9px}p{font-size:20px;color:#a5b9c7;margin:0}.number{font-size:67px;font-weight:200;color:${accent};opacity:.65}
.window{position:absolute;left:68px;right:68px;top:305px;height:577px;border-radius:18px;overflow:hidden;border:1px solid #ffffff26;background:#edf2f0;box-shadow:0 28px 70px #0006}
.bar{height:36px;background:#f7f9f8;border-bottom:1px solid #d8e2df;display:flex;align-items:center;padding:0 18px;gap:7px}.bar i{width:8px;height:8px;border-radius:50%;background:#bdcdc5}.bar span{flex:1;font-size:12px;letter-spacing:1px;text-align:center;color:#6c8278;margin-right:35px}
.shots{height:540px;display:flex;justify-content:center;align-items:center;gap:18px;padding:18px;background:#f5f6f2}.shots img{display:block;width:100%;height:100%;object-fit:contain;min-width:0}.shots.two img{width:49%}
footer{position:absolute;left:68px;right:68px;bottom:33px;display:flex;justify-content:space-between;align-items:center}.caption{font-size:22px;font-weight:600}.caption b{font-size:15px;color:${accent};margin-right:17px}.disclaimer{font-size:13px;color:#91a8b8;text-align:right;line-height:1.8}.progress{display:flex;gap:6px;margin-top:12px}.progress i{height:3px;width:44px;background:#ffffff20}.progress i.active{background:${accent}}
</style><header><div class="brand"><span class="mark"><i></i><i></i><i></i></span>DobokuAI</div><span class="label">AI-NATIVE CIVIL ENGINEERING</span></header>
<div class="intro"><div><div class="tag">${htmlEscape(tag)}</div><h1>${htmlEscape(title)}</h1><p>${htmlEscape(description)}</p></div><div class="number">${String(step + 1).padStart(2, '0')}</div></div>
<div class="window"><div class="bar"><i></i><i></i><i></i><span>ACTUAL APPLICATION CAPTURE · AOBA RIVER DEMO</span></div><div class="shots ${images.length > 1 ? 'two' : ''}">${images.map(src => `<img src="${src}" alt="実画面">`).join('')}</div></div>
<footer><div><div class="caption"><b>${String(step + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}</b>${htmlEscape(caption)}</div><div class="progress">${Array.from({ length: total }, (_, i) => `<i class="${i <= step ? 'active' : ''}"></i>`).join('')}</div></div><div class="disclaimer">実画面 / 合成サンプル「青葉川」<br>${tag.startsWith('SPATIAL') ? '鉛直3倍・縦断0.15倍 / 参考表示' : '1D定常流 / SI単位 / 設計認証済みではありません'}</div></footer></html>`;
}

async function clip(name, total, actions) {
  if (only && name !== only) return;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 2, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', reducedMotion: 'reduce' });
  const presentation = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'ja-JP', reducedMotion: 'reduce' });
  try {
    const page = await context.newPage();
    page.on('pageerror', e => issues.push(e.message));
    await page.goto(baseURL);
    await page.getByRole('heading', { name: '青葉川・河道改修検討' }).waitFor();
    await page.waitForFunction(() => !document.querySelector('fieldset').disabled);
    await page.evaluate(() => document.fonts.ready);
    const deck = await presentation.newPage();
    const frames = [];
    const shot = async (caption, targets, seconds = 2.5) => {
      await page.mouse.move(5, 5);
      await sleep(180);
      const images = [];
      for (const [i, target] of (Array.isArray(targets) ? targets : [targets]).entries()) {
        const file = resolve(work, `${name}-${frames.length}-source-${i}.png`);
        const bytes = await target.screenshot({ path: file, animations: 'disabled' });
        images.push('data:image/png;base64,' + bytes.toString('base64'));
      }
      const html = frameHTML(features[name], images, caption, frames.length, total);
      await deck.setContent(html);
      await deck.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map(i => i.decode()));
      });
      const file = resolve(work, `${name}-${String(frames.length).padStart(2, '0')}.png`);
      await deck.screenshot({ path: file });
      frames.push({ path: file, seconds, caption });
    };
    await actions(page, shot);
    if (frames.length !== total) throw new Error(`${name}: expected ${total} states, got ${frames.length}`);
    clips.push({ name, frames });
    console.log(`Captured ${name}: ${frames.length} actual UI states`);
  } finally { await context.close(); await presentation.close(); }
}

try {
  await clip('hero-river', 4, async (page, shot) => {
    await shot('共通基準高で、施工前後の水面形を表示', page.locator('.profile-panel'));
    await nav(page, '縦断水面形');
    await shot('水位の分布を、上流から下流へ', panel(page, '縦断方向の分布'));
    await page.getByRole('button', { name: '水深', exact: true }).click();
    await shot('同じ測点で、水深の変化を確認', panel(page, '縦断方向の分布'));
    await page.getByRole('button', { name: '流速', exact: true }).click();
    await shot('流速も、Rustの数値計算から', panel(page, '縦断方向の分布'));
  });
  await clip('hero-editor', 4, async (page, shot) => {
    await nav(page, '横断面エディタ');
    await shot('台形断面の形を、大きな図で確認', panel(page, '断面プレビュー'));
    await page.getByLabel('断面形状の変更を全測点に反映').check();
    await page.getByLabel('底幅 (m)', { exact: true }).fill('28');
    await shot('底幅を28 mへ変更し、図に反映', panel(page, '断面プレビュー'));
    await page.getByLabel('法勾配 (水平 / 鉛直)').fill('2');
    await shot('法勾配を2へ変更し、断面形状を確認', panel(page, '断面プレビュー'));
    await page.getByLabel('断面形式', { exact: true }).selectOption('rectangle');
    await page.getByLabel('幅 (m)', { exact: true }).fill('28');
    await shot('矩形断面へ切り替えて比較', panel(page, '断面プレビュー'));
  });
  await clip('hero-construction', 4, async (page, shot) => {
    await nav(page, '施工シナリオ比較');
    await page.getByLabel('掘削深 (m)', { exact: true }).fill('0.5');
    await run(page);
    await shot('0.5 m掘削後の横断と水位を比較', panel(page, '施工前後の横断図'));
    await page.getByLabel('掘削深 (m)', { exact: true }).fill('1');
    await run(page);
    await shot('1 m掘削案を再計算して比較', panel(page, '施工前後の横断図'));
    await page.getByLabel('横断図の測点').selectOption('5');
    await shot('中央測点の河床・水位を同じ座標で', panel(page, '施工前後の横断図'));
    await shot('水位差と概算土量を、数値で確認', page.locator('.scenario-summary'));
  });
  await clip('hero-assistant', 4, async (page, shot) => {
    await nav(page, 'AI アシスタント');
    await page.getByRole('button', { name: '粗度係数を0.035に変更した場合の水位を比較して', exact: true }).click();
    await shot('検討したい条件を、日本語で入力', page.getByLabel('検討したい条件を入力').locator('..'));
    await page.getByRole('button', { name: '操作を提案', exact: true }).click();
    await page.getByText('粗度: 現在の各断面 → 0.035 の比較案を追加').waitFor();
    await shot('提案を確認。まだ条件は変更しない', page.locator('.proposal'));
    await page.getByRole('button', { name: '条件を確認して適用・再計算', exact: true }).click();
    await page.getByText('確認済みツールを適用し、Rust エンジンで計算しました').waitFor();
    await shot('確認後にRustで計算し、比較案を追加', page.locator('.agent-result'));
    await nav(page, '縦断水面形');
    await shot('粗度変更案の水面形を重ねて表示', panel(page, '縦断方向の分布'));
  });
  await clip('hero-reports', 4, async (page, shot) => {
    const response = page.waitForResponse(r => r.url().endsWith('/api/runs') && r.request().method() === 'POST');
    await run(page);
    const saved = await (await response).json();
    const report = await contextReport(page, `/api/runs/${saved.id}/reports/html`);
    await writeFile(resolve(work, 'hero-saved-report.html'), await report.content());
    await shot('保存結果から、図付きHTMLを生成', report.locator('section').filter({ has: report.getByRole('heading', { name: '縦断水面形', exact: true }) }));
    await shot('各測点の施工前後横断を成果に収録', report.locator('section').filter({ has: report.getByRole('heading', { name: '距離 0.0 m', exact: true }) }));
    await report.close();
    await nav(page, '水理計算');
    await page.getByRole('button', { name: '基本条件を保持して感度比較', exact: true }).click();
    await page.getByText('感度比較完了: 成功 3 / 失敗 0。基本条件は変更していません。').waitFor();
    await shot('流量の感度比較も、専用履歴へ保存', page.locator('.sensitivity-panel .chart').first());
    await page.getByLabel('測点間を線形補間する前提を確認しました').check();
    await page.getByRole('button', { name: '基本条件を保持して測点間隔を比較', exact: true }).click();
    await page.getByText('測点間隔の比較完了: 成功 2 / 失敗 0。基本条件は変更していません。').waitFor();
    await shot('測点間隔の影響を、元測点で照査', page.locator('.resolution-panel .chart').first());
  });
  await clip('hero-spatial', 8, async (page, shot) => {
    await nav(page, '縦断水面形');
    await page.getByLabel('3D 参考表示（断面の空間的な連続性）').check();
    const canvas = page.locator('.three-view canvas');
    await canvas.waitFor();
    await canvas.scrollIntoViewIfNeeded();
    await sleep(1500);
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const region = page.locator('.three-view');
    for (let i = 0; i < 8; i++) {
      if (i) {
        await page.mouse.move(box.x + box.width * .55, box.y + box.height * .5);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * .55 + 35, box.y + box.height * .5 + (i < 4 ? 6 : -6), { steps: 8 });
        await page.mouse.up();
        await sleep(100);
      }
      await shot('ドラッグで視点を変え、断面の連続性を確認', region, .7);
    }
    // Fail rather than publish an empty/failed WebGL demo.
    const rendered = await canvas.evaluate(el => {
      const gl = el.getContext('webgl2');
      return gl && !gl.isContextLost();
    });
    if (!rendered) throw new Error('3D capture requires an active WebGL2 context');
  });
  if (issues.length) throw new Error(issues.join('\n'));
} finally { await browser.close(); }

if (!only) clips.push({ name: 'hero-workflows', frames: clips.flatMap(c => [c.frames[0], c.frames.at(-1)]).map(f => ({ ...f, seconds: 1.6 })) });
for (const { name, frames } of clips) {
  const manifest = resolve(work, `${name}.ffconcat`);
  await writeFile(manifest, 'ffconcat version 1.0\n' + frames.map(f => `file '${f.path}'\nduration ${f.seconds}\n`).join('') + `file '${frames.at(-1).path}'\n`);
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-filter_complex_threads', '1', '-f', 'concat', '-safe', '0', '-i', manifest,
    '-filter_complex', 'fps=6,scale=1280:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle',
    '-loop', '0', resolve(assets, `${name}.gif`)], { stdio: 'inherit' });
  console.log(`Encoded ${name}.gif`);
}
const evidence = { captured_at: new Date().toISOString(), source_commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), presentation: 'Unmodified application screenshots in a decorative README frame. Synthetic Aoba sample; local agent rules.', clips };
await writeFile(resolve(work, only ? `${only}-manifest.json` : 'manifest.json'), JSON.stringify(evidence, null, 2));

async function contextReport(page, path) {
  const report = await page.context().newPage();
  await report.goto(new URL(path, baseURL).href);
  await report.evaluate(() => document.fonts.ready);
  return report;
}
