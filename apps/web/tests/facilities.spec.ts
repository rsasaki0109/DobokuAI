import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { buildFacility, disposeFacility, facilities } from '../src/infrastructureScene';
import type { FacilityKind } from '../src/infrastructureScene';

test('facility models remain finite and reservoir surfaces stay at the chosen level behind the dam', () => {
  for (const kind of Object.keys(facilities) as FacilityKind[]) {
    const scene = buildFacility(kind, { height: 72, waterRatio: .83, gate: .6 });
    let meshes = 0;
    scene.root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      meshes++;
      const geometry = object.geometry as THREE.BufferGeometry;
      for (const attr of Object.values(geometry.attributes)) expect(Array.from(attr.array).every(Number.isFinite)).toBe(true);
    });
    expect(meshes).toBeGreaterThan(10);
    const reservoir = scene.root.getObjectByName('reservoir') as THREE.Mesh | undefined;
    if (kind === 'gravity' || kind === 'arch') {
      expect(reservoir).toBeTruthy();
      const points = reservoir!.geometry.getAttribute('position');
      expect(points.count).toBeGreaterThan(100);
      let maxLevelError = 0, maxBoundaryError = -Infinity;
      for (let i = 0; i < points.count; i++) {
        maxLevelError = Math.max(maxLevelError, Math.abs(points.getY(i) - 72 * .83));
        const back = (kind === 'arch' ? -34 * (1 - (points.getX(i) / 110) ** 2) : 0) - 4;
        // Linear clipping of a 5 m cell against the quadratic arch: ≤0.018 m error.
        maxBoundaryError = Math.max(maxBoundaryError, points.getZ(i) - back);
      }
      expect(maxLevelError).toBeLessThan(1e-4);
      expect(maxBoundaryError).toBeLessThanOrEqual(.025);
    } else expect(reservoir).toBeUndefined();
    disposeFacility(scene.root);
  }
  expect(() => buildFacility('gravity', { height: NaN, waterRatio: .83, gate: .6 })).toThrow();
  expect(() => buildFacility('arch', { height: 72, waterRatio: 1, gate: .6 })).toThrow();
});

test('facility gallery works without API and exposes models, geometry controls and fullscreen', async ({ page }) => {
  // Four PBR models, fullscreen and exports use software WebGL on headless CI.
  // Keep each operation checked; allow this combined workflow more wall time.
  test.setTimeout(90_000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/**', route => route.abort());
  await page.goto('/?view=structures');
  await expect(page.getByRole('heading', { name: '3D施設ギャラリー', exact: true })).toBeVisible();
  const stage = page.getByLabel('土木施設の3D形状モデル');
  await expect(stage.locator('canvas')).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: '計算を実行', exact: true })).toHaveCount(0);
  for (const name of ['重力式ダム', 'アーチダム', '斜張橋', '砂防堰堤']) {
    await page.locator('.facility-cards button').filter({ has: page.getByText(name, { exact: true }) }).click();
    await expect(stage.locator('strong')).toHaveText(name);
  }
  await page.locator('.facility-cards button').filter({ has: page.getByText('重力式ダム', { exact: true }) }).click();
  await page.getByLabel('堤高（形状）', { exact: true }).fill('80');
  await page.getByLabel('貯水位（形状）', { exact: true }).fill('70');
  await page.getByLabel('ゲート開度（表示）', { exact: true }).fill('0');
  await expect(page.locator('.facility-settings')).toContainText('80 m');
  await expect(page.locator('.facility-settings')).toContainText('56.0 m');
  for (const name of ['施設詳細', '上流側', '真上', '夕景', '自動回転']) {
    const button = page.getByRole('button', { name, exact: true }); await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
  await page.getByRole('button', { name: '自動回転', exact: true }).click();
  await page.getByLabel('周辺地形・森林', { exact: true }).uncheck();
  await page.getByRole('button', { name: '施設を全画面表示', exact: true }).click();
  await expect(page.getByRole('button', { name: '全画面を終了', exact: true })).toBeVisible();
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  expect(await stage.locator('canvas').evaluate(c => { const gl = (c as HTMLCanvasElement).getContext('webgl2'); return !!gl && !gl.isContextLost(); })).toBe(true);
  await page.getByRole('button', { name: '全画面を終了', exact: true }).click();
  await page.getByLabel('周辺地形・森林', { exact: true }).check();
  const pendingGLB = page.waitForEvent('download');
  await page.getByRole('button', { name: 'モデルGLBを保存', exact: true }).click();
  const binary = await readFile((await (await pendingGLB).path())!);
  expect(binary.toString('ascii', 0, 4)).toBe('glTF');
  expect(binary.readUInt32LE(4)).toBe(2);
  const gltf = JSON.parse(binary.toString('utf8', 20, 20 + binary.readUInt32LE(12)).trim());
  expect(gltf.nodes.some((n: { extras?: { model_type?: string; numerical_solver_linked?: boolean } }) => n.extras?.model_type === 'illustrative' && n.extras.numerical_solver_linked === false)).toBe(true);
  expect(gltf.extensionsUsed).toContain('EXT_mesh_gpu_instancing');
  const pendingJSON = page.waitForEvent('download');
  await page.getByRole('button', { name: '表示条件JSONを保存', exact: true }).click();
  const saved = JSON.parse(await readFile((await (await pendingJSON).path())!, 'utf8'));
  expect(saved.settings).toEqual({ height: 80, waterRatio: .7, gate: 0 });
  expect(saved.numerical_solver_linked).toBe(false);
  expect(errors).toEqual([]);
});

test('facility controls do not edit or recalculate the river project', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '青葉川・河道改修検討' })).toBeVisible();
  await page.getByRole('button', { name: '水理計算', exact: true }).click();
  const value = await page.getByLabel('流量 Q (m³/s)').inputValue();
  const posts: string[] = []; page.on('request', r => { if (r.method() === 'POST') posts.push(r.url()); });
  await page.getByRole('button', { name: '3D施設ギャラリー', exact: true }).click();
  await page.getByLabel('堤高（形状）', { exact: true }).fill('90');
  await page.getByLabel('貯水位（形状）', { exact: true }).fill('60');
  await page.getByRole('button', { name: '水理計算', exact: true }).click();
  await expect(page.getByLabel('流量 Q (m³/s)')).toHaveValue(value);
  expect(posts).toEqual([]);
});
