// Capture real UI states, then encode looping GIFs. Use a dedicated sample database.
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
if (!baseURL) throw new Error('Pass the URL of a dedicated demo server; see docs/readme-demos.md.');
if (only && !['workflow','cross-section','water-profile','construction','sensitivity','ai-assistant','station-spacing','survey-provenance'].includes(only)) throw new Error(`Unknown clip: ${only}; use capture-heroes.mjs for the hero gallery`);
const work = resolve(root, '.local/readme-capture');
const assets = resolve(root, 'docs/assets');
await mkdir(work, { recursive: true });
await mkdir(assets, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--no-sandbox'],
});
const errors = [];
const manifests = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nav = async (page, name) => {
  await page.getByRole('button', { name, exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
};
const focus = async (page, locator) => {
  await locator.evaluate((element) => {
    window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - 90);
  });
};
const run = async (page) => {
  await page.getByRole('button', { name: '計算を実行', exact: true }).click();
  await page.getByText('数値計算と施工比較が完了しました').waitFor();
};
async function clip(name, actions) {
  if (only && only !== name) return;
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: 'ja-JP', timezoneId: 'Asia/Tokyo', reducedMotion: 'reduce',
  });
  try {
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(baseURL);
    await page.getByRole('heading', { name: '青葉川・河道改修検討' }).waitFor();
    await page.waitForFunction(() => !document.querySelector('fieldset').disabled);
    await page.evaluate(() => document.fonts.ready);
    const frames = [];
    const shot = async (seconds = 2, target = page) => {
      await target.mouse.move(10, 10);
      await delay(250);
      const path = resolve(work, `${name}-${String(frames.length).padStart(2, '0')}.png`);
      await target.screenshot({ path });
      frames.push({ path, seconds });
    };
    await actions(page, shot);
    const manifest = resolve(work, `${name}.ffconcat`);
    await writeFile(manifest, 'ffconcat version 1.0\n' + frames.map((f) =>
      `file '${f.path}'\nduration ${f.seconds}\n`).join('') + `file '${frames.at(-1).path}'\n`);
    manifests.push({ name, manifest, frames: frames.length });
    console.log(`Captured ${name}: ${frames.length} real UI states`);
  } finally {
    await context.close();
  }
}
try {
  await clip('workflow', async (page, shot) => {
    await shot(2.5);
    await nav(page, '横断面エディタ');
    await focus(page, page.locator('.editor-layout'));
    await shot();
    await nav(page, '縦断水面形');
    await shot();
    await nav(page, '施工シナリオ比較');
    await focus(page, page.getByRole('heading', { name: '施工前後の横断図' }));
    await shot();
    await nav(page, '水理計算');
    await page.getByRole('button', { name: '基本条件を保持して感度比較' }).click();
    await page.getByText('感度比較完了: 成功 3 / 失敗 0。基本条件は変更していません。').waitFor();
    await focus(page, page.locator('.sensitivity-panel'));
    await shot(2.5);
    await nav(page, 'AI アシスタント');
    await shot();
  });
  await clip('cross-section', async (page, shot) => {
    await nav(page, '横断面エディタ');
    await focus(page, page.locator('.editor-layout'));
    await shot();
    await page.getByLabel('断面形状の変更を全測点に反映').check();
    await page.getByLabel('底幅 (m)', { exact: true }).fill('28');
    await focus(page, page.locator('.editor-layout'));
    await shot();
    await page.getByLabel('法勾配 (水平 / 鉛直)').fill('2');
    await shot();
    await page.getByLabel('断面形式', { exact: true }).selectOption('rectangle');
    await page.getByLabel('幅 (m)', { exact: true }).fill('28');
    await shot();
    await page.getByLabel('断面形式', { exact: true }).selectOption('trapezoid');
    await shot();
  });
  await clip('water-profile', async (page, shot) => {
    await nav(page, '縦断水面形');
    await shot();
    await page.getByRole('button', { name: '水深', exact: true }).click();
    await shot();
    await page.getByRole('button', { name: '流速', exact: true }).click();
    await shot();
    await page.getByRole('button', { name: '水位', exact: true }).click();
    await focus(page, page.getByRole('heading', { name: '施工前後の横断図' }));
    await shot();
    await page.getByLabel('横断図の測点').selectOption('5');
    await shot();
  });
  await clip('construction', async (page, shot) => {
    await nav(page, '施工シナリオ比較');
    await shot();
    await page.getByLabel('掘削深 (m)', { exact: true }).fill('0.5');
    await run(page);
    await focus(page, page.getByRole('heading', { name: '施工前後の横断図' }));
    await shot(2.5);
    await page.getByLabel('掘削深 (m)', { exact: true }).fill('1');
    await run(page);
    await focus(page, page.getByRole('heading', { name: '施工前後の横断図' }));
    await shot(2.5);
    await page.getByLabel('横断図の測点').selectOption('5');
    await shot();
    await focus(page, page.getByRole('heading', { name: '施工比較の数値結果' }));
    await shot(2.5);
  });
  await clip('sensitivity', async (page, shot) => {
    await nav(page, '水理計算');
    await shot();
    await page.getByRole('button', { name: '基本条件を保持して感度比較' }).click();
    await page.getByText('感度比較完了: 成功 3 / 失敗 0。基本条件は変更していません。').waitFor();
    await focus(page, page.locator('.sensitivity-panel'));
    await shot(2.5);
    await focus(page, page.getByRole('heading', { name: '感度比較の履歴' }));
    await shot();
    await page.getByLabel('感度比較パラメータ').selectOption('roughness');
    const savedResponse = page.waitForResponse((response) =>
      response.url().endsWith('/api/sensitivity/runs') && response.request().method() === 'POST');
    await page.getByRole('button', { name: '基本条件を保持して感度比較' }).click();
    const stored = await (await savedResponse).json();
    await page.getByText('感度比較完了: 成功 3 / 失敗 0。基本条件は変更していません。').waitFor();
    await focus(page, page.locator('.sensitivity-panel'));
    await shot(2.5);
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: '感度比較HTMLを保存', exact: true }).click();
    const report = await pending;
    await report.saveAs(resolve(work, 'sensitivity-report.html'));
    const reportPage = await contextReport(page, stored.id);
    await shot(2.5, reportPage);
    await reportPage.close();
  });
  await clip('ai-assistant', async (page, shot) => {
    await nav(page, 'AI アシスタント');
    await page.getByRole('button', { name: '粗度係数を0.035に変更した場合の水位を比較して' }).click();
    await shot();
    await page.getByRole('button', { name: '操作を提案', exact: true }).click();
    await page.getByText('粗度: 現在の各断面 → 0.035 の比較案を追加').waitFor();
    await focus(page, page.locator('.proposal'));
    await shot(3);
    await page.getByRole('button', { name: '条件を確認して適用・再計算' }).click();
    await page.getByText('確認済みツールを適用し、Rust エンジンで計算しました').waitFor();
    await shot();
    await nav(page, '縦断水面形');
    await shot(3);
  });
  await clip('station-spacing', async (page, shot) => {
    await nav(page, '水理計算');
    await focus(page, page.locator('.resolution-panel'));
    await shot();
    await page.getByLabel('測点間を線形補間する前提を確認しました').check();
    await shot(1.5);
    const pending = page.waitForResponse(r => r.url().endsWith('/api/resolution/runs') && r.request().method() === 'POST');
    await page.getByRole('button', {name:'基本条件を保持して測点間隔を比較',exact:true}).click();
    const stored = await (await pending).json();
    await page.getByText('測点間隔の比較完了: 成功 2 / 失敗 0。基本条件は変更していません。').waitFor();
    await focus(page, page.locator('.resolution-panel'));
    await shot(3);
    await focus(page, page.locator('.resolution-panel .table-scroll'));
    await shot(3);
    await page.reload();
    await page.getByRole('heading', {name:'青葉川・河道改修検討'}).waitFor();
    await nav(page, '水理計算');
    await page.getByRole('button', {name:`測点間隔履歴 #${stored.id} を開く`,exact:true}).click();
    await page.getByText('測点間隔の比較完了: 成功 2 / 失敗 0。基本条件は変更していません。').waitFor();
    await focus(page, page.locator('.resolution-history'));
    await shot(3);
    const reportPage = await page.context().newPage();
    await reportPage.goto(new URL(`/api/resolution/runs/${stored.id}/reports/html`, baseURL).href);
    await focus(reportPage, reportPage.getByRole('heading', {name:'元測点の水位差',exact:true}));
    await shot(4, reportPage);
    await reportPage.close();
  });
  await clip('survey-provenance', async (page, shot) => {
    await nav(page, '横断面エディタ');
    await page.getByLabel('横断測量CSV', {exact:true}).setInputFiles(resolve(root, 'examples/survey-absolute.csv'));
    await page.getByLabel('取込みデータの標高系').fill('同梱合成サンプルの仮想基準高');
    await page.getByText('出典・利用条件を記録', {exact:true}).click();
    await page.getByLabel('データ種別', {exact:true}).selectOption('synthetic');
    await page.getByLabel('出典URL', {exact:true}).fill('https://github.com/rsasaki0109/DobokuAI/blob/b5c3c8843248ac9e349fa8ba54abc7cf9fbe40f7/examples/survey-absolute.csv');
    await page.getByLabel('出典・著作者', {exact:true}).fill('DobokuAI 同梱合成サンプル（現地測量ではありません）');
    await page.getByLabel('利用条件', {exact:true}).fill('製品のOSSライセンスは未設定。外部公開データの採用許可を示しません。');
    await page.getByLabel('変換・処理手順', {exact:true}).fill('青葉川の台形を測量点形式で記述。座標変換・並べ替え・補間なし。');
    await focus(page, page.locator('.survey-import'));
    await shot(3);
    await page.getByRole('button', {name:'CSVを検証・プレビュー',exact:true}).click();
    await page.getByText('取込みプレビュー: 11 断面。確認前の条件は変更されていません。').waitFor();
    await focus(page, page.locator('.import-preview'));
    await shot(3);
    await page.getByRole('button', {name:'内容を確認して全測点を置換・施工案をクリア'}).click();
    await page.locator('.saved-source summary').click();
    await focus(page, page.locator('.saved-source'));
    await shot(3);
    const response = page.waitForResponse(r => r.url().endsWith('/api/runs') && r.request().method() === 'POST');
    await run(page);
    const stored = await (await response).json();
    const reportPage = await page.context().newPage();
    await reportPage.goto(new URL(`/api/runs/${stored.id}/reports/html`, baseURL).href);
    await focus(reportPage, reportPage.getByRole('heading', {name:'データ出典（利用者申告）'}));
    await shot(4, reportPage);
    await reportPage.close();
  });
  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  await browser.close();
}
for (const { name, manifest } of manifests) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-filter_complex_threads', '1', '-f', 'concat', '-safe', '0', '-i', manifest,
    '-filter_complex', 'fps=4,scale=1200:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle',
    '-loop', '0', resolve(assets, `${name}.gif`)], { stdio: 'inherit' });
  console.log(`Encoded docs/assets/${name}.gif`);
}
await writeFile(resolve(work, 'manifest.json'), JSON.stringify(manifests, null, 2));

async function contextReport(page, id) {
  const reportPage = await page.context().newPage();
  await reportPage.goto(new URL(`/api/sensitivity/runs/${id}/reports/html`, baseURL).href);
  return reportPage;
}
