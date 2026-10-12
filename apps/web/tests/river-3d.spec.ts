import { test, expect } from '@playwright/test';
import { riverSurfaces, displayPoint } from '../src/riverMesh';
import { ground, waterExtent } from '../src/types';
import type { River, Profile, Row } from '../src/types';

test('3D loft retains rectangle/survey corners and uses computed water elevations without mutating conditions', () => {
  const river: River = { discharge: 100, normal_slope: .001, boundary: { regime: 'subcritical', depth: 3 }, stations: [
    { chainage: 0, bed_elevation: 10, roughness: .03, section: { kind: 'rectangle', width: 20, bank_height: 8 } },
    { chainage: 100, bed_elevation: 9, roughness: .03, section: { kind: 'survey', points: [{ x: -15, z: 8 }, { x: -7, z: 2 }, { x: 0, z: 0 }, { x: 9, z: 3 }, { x: 18, z: 8 }] } },
  ] };
  const profile: Profile = { warnings: [], rows: river.stations.map(s => ({ chainage: s.chainage, water_elevation: s.bed_elevation + 3 } as Row)) };
  const ref = { elevationOrigin: 10, chainageCenter: 50, floor: -10 };
  const original = JSON.stringify({ river, profile });
  const mesh = riverSurfaces(river, profile, ref);
  const hasVertex = (kind: 'terrain' | 'water', p: number[]) => {
    const vertices = mesh[kind].getAttribute('position');
    return Array.from({ length: vertices.count }, (_, i) => [vertices.getX(i), vertices.getY(i), vertices.getZ(i)])
      .some(v => v.every((n, j) => Math.abs(n - p[j]) < 1e-4));
  };
  river.stations.forEach((s, i) => {
    ground(s.section, s.bed_elevation).forEach(p => expect(hasVertex('terrain', displayPoint(p, s.chainage, ref))).toBe(true));
    const stage = profile.rows[i].water_elevation;
    waterExtent(ground(s.section, s.bed_elevation), stage).forEach(x => expect(hasVertex('water', displayPoint({ x, z: stage }, s.chainage, ref))).toBe(true));
  });
  for (const geometry of Object.values(mesh)) {
    for (const attribute of Object.values(geometry.attributes)) expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
    geometry.dispose();
  }
  expect(JSON.stringify({ river, profile })).toBe(original);
});

test('3D model comparison and camera controls render without recalculating or changing the project', async ({ page }) => {
  const errors: string[] = [], posts: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '青葉川・河道改修検討' })).toBeVisible();
  await page.getByRole('button', { name: '縦断水面形', exact: true }).click();
  const before = await page.getByLabel('縦断計算結果グラフ').textContent();
  page.on('request', r => { if (r.method() === 'POST') posts.push(r.url()); });
  await page.getByLabel('3D 参考表示（断面の空間的な連続性）').check();
  const region = page.getByLabel('河床と水面の3Dモデル');
  await expect(region.locator('canvas')).toBeVisible();
  await expect(region.locator('strong')).toHaveText('施工前');
  await page.getByLabel('3D表示モデル').selectOption('1');
  await expect(region.locator('strong')).toHaveText('河道掘削 1.0 m');
  for (const name of ['俯瞰', '断面', '斜め', '自動回転']) {
    const button = page.getByRole('button', { name, exact: true });
    await button.click(); await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: '自動回転', exact: true }).click();
  await page.getByRole('button', { name: '断面線', exact: true }).click();
  await page.getByRole('button', { name: '3Dを全画面表示', exact: true }).click();
  await expect(page.getByRole('button', { name: '全画面を終了', exact: true })).toBeVisible();
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  expect(await region.locator('canvas').evaluate(c => { const gl = (c as HTMLCanvasElement).getContext('webgl2'); return !!gl && !gl.isContextLost(); })).toBe(true);
  await page.getByRole('button', { name: '全画面を終了', exact: true }).click();
  expect(await page.getByLabel('縦断計算結果グラフ').textContent()).toBe(before);
  expect(posts).toEqual([]); expect(errors).toEqual([]);
});
