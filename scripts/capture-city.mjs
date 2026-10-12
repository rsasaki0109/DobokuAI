// Record the actual browser's synthetic CityGML display; never label it real data.
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(root, 'apps/web/package.json'));
const { chromium } = require('playwright');
const base = process.argv[2];
if (!base) throw new Error('Usage: capture-city.mjs <dedicated-demo-url>');
const work = resolve(root, '.local/city-capture'); await mkdir(work, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
const frames = [], errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/**', r => r.abort());
  const url = new URL(base); url.searchParams.set('view', 'city'); await page.goto(url.href);
  const stage = page.getByLabel('都市と地形の3Dビュー'); const canvas = stage.locator('canvas');
  await canvas.waitFor();
  await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click();
  for (let i = 0; i < 18; i++) {
    if (i === 9) await page.getByRole('button', { name: '都市を真上から', exact: true }).click();
    if (i === 13) await page.getByRole('button', { name: '都市を夕景で表示', exact: true }).click();
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2, { steps: 4 }); await page.mouse.up();
    await page.mouse.move(1, 1);
    const path = resolve(work, `city-${String(i).padStart(3, '0')}.png`);
    const png = await stage.screenshot({ path });
    frames.push({ path, seconds: .18, sha256: createHash('sha256').update(png).digest('hex') });
  }
  if (new Set(frames.map(f => f.sha256)).size < 15 || errors.length) throw new Error('City capture did not produce distinct error-free frames');
  const hashes = {};
  for (const path of ['apps/web/src/cityModel.ts', 'apps/web/src/CityWorkspace.tsx', 'scripts/capture-city.mjs']) hashes[path] = createHash('sha256').update(await readFile(resolve(root, path))).digest('hex');
  await writeFile(resolve(work, 'manifest.json'), JSON.stringify({ captured_at: new Date().toISOString(), synthetic: true, real_city_loaded: false, numerical_solver_linked: false, source_sha256: hashes, frames }, null, 2));
} finally { await browser.close(); }
const concat = resolve(work, 'city.ffconcat');
await writeFile(concat, 'ffconcat version 1.0\n' + frames.map(f => `file '${f.path}'\nduration ${f.seconds}\n`).join('') + `file '${frames.at(-1).path}'\n`);
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-filter_complex_threads', '1', '-f', 'concat', '-safe', '0', '-i', concat, '-filter_complex', 'fps=10,scale=1120:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff:max_colors=192[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle', '-loop', '0', resolve(root, 'docs/assets/hero-city.gif')], { stdio: 'inherit' });
console.log('Captured 18 actual synthetic-city frames and encoded docs/assets/hero-city.gif');
