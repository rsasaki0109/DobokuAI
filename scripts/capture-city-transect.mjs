// Capture the actual licensed city model, confirmed transect and query point.
import { createRequire } from 'node:module';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(root, 'apps/web/package.json'));
const { chromium } = require('playwright');
const url = process.argv[2];
if (!url) throw new Error('Usage: capture-city-transect.mjs <dedicated-demo-url>');
const capturedAt = new Date().toISOString(), work = resolve(root, '.local/city-transect-capture', capturedAt.replaceAll(':', '-'));
await mkdir(work, { recursive: true });
const hash = value => createHash('sha256').update(value).digest('hex');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
const frames = [], errors = [], blockedRequests = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, locale: 'ja-JP' });
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/**', route => { blockedRequests.push({ method: route.request().method(), path: new URL(route.request().url()).pathname }); return route.abort(); });
  const download = async () => { const event = page.waitForEvent('download'); await page.getByRole('button', { name: '指定線の断面JSONを保存', exact: true }).click(); return readFile(await (await event).path(), 'utf8'); };
  await page.goto(new URL('/?view=city', url).href);
  await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click();
  for (const [i, label] of ['始点の東 (m)', '始点の北 (m)', '終点の東 (m)', '終点の北 (m)'].entries()) await page.getByLabel(`指定線 ${label}`, { exact: true }).fill(String([-100, -100, 100, 100][i]));
  await page.getByRole('button', { name: '指定線を点検・プレビュー', exact: true }).click();
  await page.getByRole('button', { name: '確認して任意方向の断面を表示', exact: true }).click();
  const original = await download(), report = JSON.parse(original);
  if (report.data_kind !== 'public_city_model' || !report.attribution.includes('PLATEAU') || !report.usage_terms.includes('CC BY') || report.numerical_solver_linked !== false) throw new Error('Unexpected source or solver linkage');
  const distance = page.getByRole('spinbutton', { name: '指定線の照会距離 (m)', exact: true });
  for (const [i, [view, d]] of [['global', 0], ['close', 50], ['close', 100], ['close', 150], ['close', 200], ['close', 250], ['top', 50], ['top', 150], ['top', 250], ['close', 150], ['global', 150]].entries()) {
    await distance.fill(String(d));
    await page.getByRole('button', { name: view === 'top' ? '都市を真上から' : '都市を斜めから', exact: true }).click();
    const focus = page.getByRole('button', { name: view === 'global' ? '都市全体を表示' : '指定線を近くから見る', exact: true });
    if (await focus.isEnabled()) await focus.click();
    await page.getByRole('status', { name: '指定線照会位置の3D表示', exact: true }).waitFor();
    await page.locator('.city-scene-panel').scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    const webgl = await page.locator('.city-stage canvas').evaluate(c => !!c.getContext('webgl2'));
    if (!webgl) throw new Error('WebGL context unavailable');
    const name = `frame-${String(i).padStart(3, '0')}.png`;
    const png = await page.locator('.city-stage').screenshot({ path: resolve(work, name) });
    if (i === 9) await page.locator('.city-scene-panel').screenshot({ path: resolve(root, '.local/city-transect-spatial-yokohama-20261013.png') });
    frames.push({ name, view, distance_m: d, sha256: hash(png), bytes: png.length, probe: await page.getByRole('status', { name: '指定線照会位置の3D表示', exact: true }).textContent() });
  }
  if (await download() !== original || errors.length || new Set(frames.map(f => f.sha256)).size < 6) throw new Error(`Capture validation failed: ${JSON.stringify({ errors })}`);
  await writeFile(resolve(work, 'report.json'), original);
  const sourceFiles = ['apps/web/src/CityWorkspace.tsx', 'apps/web/src/CityTransect.tsx', 'apps/web/src/CityTransectView.tsx', 'apps/web/src/CityTransectOverlayView.tsx', 'apps/web/src/cityTransectSpatial.ts', 'apps/web/src/CitySectionsView.tsx', 'apps/web/src/CitySectionOverlayView.tsx', 'scripts/capture-city-transect.mjs'];
  const sourceHashes = await Promise.all(sourceFiles.map(async name => ({ name, sha256: hash(await readFile(resolve(root, name))) })));
  const assets = (await readdir(resolve(root, 'apps/web/dist/assets'))).filter(n => /^CityWorkspace-.*\.js$/.test(n));
  const buildHashes = await Promise.all(assets.map(async name => ({ name, sha256: hash(await readFile(resolve(root, 'apps/web/dist/assets', name))) })));
  await writeFile(resolve(work, 'manifest.json'), JSON.stringify({ captured_at: capturedAt, base_commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), source_hashes: sourceHashes, build_hashes: buildHashes, attribution: report.attribution, usage_terms: report.usage_terms, original_files: report.sources, snapshot_sha256: hash(original), numerical_solver_linked: false, api_requests_blocked: blockedRequests, frames }, null, 2) + '\n');
  await writeFile(resolve(work, 'frames.ffconcat'), 'ffconcat version 1.0\n' + frames.map(f => `file '${f.name}'\nduration 1.1`).join('\n') + `\nfile '${frames.at(-1).name}'\n`);
} finally { await browser.close(); }
execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', resolve(work, 'frames.ffconcat'), '-filter_complex', '[0:v]fps=5,scale=1120:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3', '-loop', '0', resolve(root, 'docs/assets/hero-city-transect.gif')]);
console.log(JSON.stringify({ captured_at: capturedAt, frames: frames.length, work, gif: 'docs/assets/hero-city-transect.gif' }));
