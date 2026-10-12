import * as THREE from 'three';

export type FacilityKind = 'gravity' | 'arch' | 'bridge' | 'sabo';
export type FacilitySettings = { height: number; waterRatio: number; gate: number };
export const facilities = {
  gravity: { name: '重力式ダム', en: 'GRAVITY DAM', components: '堤体・洪水吐・ゲート・管理橋・減勢工・貯水池' },
  arch: { name: 'アーチダム', en: 'ARCH DAM', components: '湾曲した堤体・天端・放流設備・取水塔・貯水池' },
  bridge: { name: '斜張橋', en: 'CABLE-STAYED BRIDGE', components: '主塔・斜材・橋桁・橋脚・舗装・防護柵・河川' },
  sabo: { name: '砂防堰堤', en: 'SABO CHECK DAM', components: 'スリット堰堤・副堰堤・水叩き・側壁・渓流' },
} as const;
type V = [number, number, number];
const noise = (n: number) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };

export function terrainHeight(x: number, z: number, height: number, kind: FacilityKind) {
  const center = Math.sin(z / 115) * 13;
  const gain = kind === 'bridge' ? .45 : kind === 'sabo' ? .65 : .94;
  const rawValley = height * gain * Math.pow(Math.abs(x - center) / 110, 1.7);
  const valley = Math.min(rawValley, height * 1.7 + Math.max(rawValley - height * 1.7, 0) * .2, height * 1.9);
  const ridges = (Math.sin(z / 55 + x / 90) + Math.sin(x / 31 - z / 83)) * 4 * Math.min(Math.abs(x) / 90, 1);
  return 4 + valley + ridges + (kind === 'sabo' ? (160 - z) * .06 : 0);
}

function texture(water: boolean): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!; const image = ctx.createImageData(128, 128);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const value = water ? 128 + 44 * Math.sin(x * .25 + 3 * Math.sin(y * .12)) + 20 * Math.cos(y * .37)
      : 177 + 25 * noise(x + y * 128) + (y % 32 === 0 ? -18 : 0);
    const i = (x + y * 128) * 4; image.data[i] = image.data[i + 1] = image.data[i + 2] = value; image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const map = new THREE.CanvasTexture(canvas); map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(water ? 16 : 8, water ? 16 : 8);
  return map;
}

export function buildFacility(kind: FacilityKind, settings: FacilitySettings) {
  if (!Number.isFinite(settings.height) || settings.height < 40 || settings.height > 100 ||
      !Number.isFinite(settings.waterRatio) || settings.waterRatio < .3 || settings.waterRatio > .92 ||
      !Number.isFinite(settings.gate) || settings.gate < 0 || settings.gate > 1) throw new Error('施設表示パラメータが範囲外です');
  const root = new THREE.Group(); root.name = facilities[kind].name;
  const land = new THREE.Group(); land.name = 'landscape'; root.add(land);
  const structure = new THREE.Group(); structure.name = 'structure'; root.add(structure);
  const waterGroup = new THREE.Group(); waterGroup.name = 'water'; root.add(waterGroup);
  const h = settings.height, level = h * settings.waterRatio;
  const concreteMap = texture(false), waterMap = texture(true);
  const concrete = new THREE.MeshStandardMaterial({ color: '#b6b3a7', roughness: .88, map: concreteMap, bumpMap: concreteMap, bumpScale: .08, side: THREE.DoubleSide });
  const darkConcrete = new THREE.MeshStandardMaterial({ color: '#8e9694', roughness: .88, map: concreteMap, side: THREE.DoubleSide });
  const steel = new THREE.MeshStandardMaterial({ color: '#435f67', metalness: .55, roughness: .4 });
  const paleSteel = new THREE.MeshStandardMaterial({ color: '#d1dad9', metalness: .45, roughness: .35 });
  const asphalt = new THREE.MeshStandardMaterial({ color: '#454d4e', roughness: .95 });
  const white = new THREE.MeshStandardMaterial({ color: '#ecede1', roughness: .7 });
  const water = new THREE.MeshStandardMaterial({ color: '#247e91', metalness: .28, roughness: .24, transparent: true, opacity: .91, bumpMap: waterMap, bumpScale: .65, side: THREE.DoubleSide });
  const foam = new THREE.MeshStandardMaterial({ color: '#e4f6f8', emissive: '#79aeb7', emissiveIntensity: .18, transparent: true, opacity: .87, roughness: .4, bumpMap: waterMap, bumpScale: .3, side: THREE.DoubleSide });
  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, parent = structure) => {
    const m = new THREE.Mesh(geometry, material); m.castShadow = parent !== waterGroup; m.receiveShadow = true; parent.add(m); return m;
  };
  const box = (size: V, position: V, material = concrete, parent = structure) => {
    const m = mesh(new THREE.BoxGeometry(...size), material, parent); m.position.set(...position); return m;
  };
  const tube = (a: V, b: V, radius: number, material = paleSteel) =>
    mesh(new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(...a), new THREE.Vector3(...b)), 1, radius, 6, false), material);
  const surface = (positions: number[], material: THREE.Material, parent = structure) => {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const uv: number[] = []; for (let i = 0; i < positions.length; i += 3) uv.push(positions[i] / 40, (positions[i + 1] + positions[i + 2]) / 40);
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals(); return mesh(g, material, parent);
  };
  const quad = (out: number[], a: V, b: V, c: V, d: V) => out.push(...a, ...b, ...c, ...a, ...c, ...d);
  const arc = (x: number) => kind === 'arch' ? -34 * (1 - (x / 110) ** 2) : 0;
  const back = (x: number) => arc(x) - 4;

  // Procedural terrain and vegetation are authored examples, not surveyed data.
  const terrain = new THREE.PlaneGeometry(440, 500, 100, 112); terrain.rotateX(-Math.PI / 2);
  const p = terrain.getAttribute('position'), terrainColors: number[] = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), y = terrainHeight(x, z, h, kind); p.setY(i, y);
    const slope = Math.abs(terrainHeight(x + 1, z, h, kind) - y);
    const color = new THREE.Color(Math.abs(y - level) < 2.5 ? '#a89d79' : slope > 1.5 ? '#7d8d7b' : '#547b50');
    color.multiplyScalar(.82 + noise(i + 7) * .28); terrainColors.push(color.r, color.g, color.b);
  }
  terrain.setAttribute('color', new THREE.Float32BufferAttribute(terrainColors, 3)); terrain.computeVertexNormals();
  mesh(terrain, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }), land);

  const treePositions: V[] = [];
  for (let i = 0; i < 420; i++) {
    const x = (noise(i * 3 + 12) - .5) * 420, z = (noise(i * 3 + 13) - .5) * 470;
    const y = terrainHeight(x, z, h, kind);
    if (Math.abs(x) < 70 || y > h * 2.6 || (z < 0 && y < level + 3) || (Math.abs(z) < 50 && Math.abs(x) < 130)) continue;
    treePositions.push([x, y, z]);
  }
  const trees = new THREE.InstancedMesh(new THREE.ConeGeometry(3.4, 11, 9), new THREE.MeshStandardMaterial({ color: '#8ba174', roughness: 1 }), treePositions.length);
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(.35, .55, 4, 5), new THREE.MeshStandardMaterial({ color: '#685947', roughness: 1 }), treePositions.length);
  const transform = new THREE.Object3D();
  treePositions.forEach(([x, y, z], i) => {
    const scale = .7 + noise(i + 122) * .7;
    transform.position.set(x, y + 7 * scale, z); transform.scale.setScalar(scale); transform.updateMatrix(); trees.setMatrixAt(i, transform.matrix);
    trees.setColorAt(i, new THREE.Color().setHSL(.29 + noise(i) * .035, .27, .24 + noise(i + 9) * .12));
    transform.position.y = y + 2 * scale; transform.updateMatrix(); trunks.setMatrixAt(i, transform.matrix);
  });
  trees.castShadow = true; land.add(trees, trunks);

  function clip(poly: V[], signed: (v: V) => number) {
    const out: V[] = [];
    poly.forEach((b, i) => {
      const a = poly[(i + poly.length - 1) % poly.length], da = signed(a), db = signed(b);
      if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); }
      if (db >= 0) out.push(b);
    }); return out;
  }
  if (kind === 'gravity' || kind === 'arch') {
    const lake: number[] = [];
    for (let z = -245; z < 0; z += 5) for (let x = -160; x < 160; x += 5) {
      const v = (xx: number, zz: number): V => [xx, terrainHeight(xx, zz, h, kind), zz];
      const a = v(x, z), b = v(x + 5, z), c = v(x + 5, z + 5), d = v(x, z + 5);
      for (const triangle of [[a, b, c], [a, c, d]]) {
        const polygon = clip(clip(triangle, q => level - q[1]), q => back(q[0]) - q[2]).map(q => [q[0], level, q[2]] as V);
        for (let i = 1; i < polygon.length - 1; i++) lake.push(...polygon[0], ...polygon[i], ...polygon[i + 1]);
      }
    }
    const lakeMesh = surface(lake, water, waterGroup); lakeMesh.name = 'reservoir';
    // Trapezoidal gravity profile or thinner curved arch shell, with joints.
    const front = (x: number, y: number) => arc(x) + 4 + (kind === 'arch' ? .13 : .54) * (h - y);
    const body: number[] = [];
    for (let i = 0; i < 44; i++) {
      const x = -110 + i * 5, xx = x + 5;
      const bl: V = [x, 0, back(x)], br: V = [xx, 0, back(xx)], tl: V = [x, h, back(x)], tr: V = [xx, h, back(xx)];
      const fl: V = [x, 0, front(x, 0)], fr: V = [xx, 0, front(xx, 0)], ul: V = [x, h, front(x, h)], ur: V = [xx, h, front(xx, h)];
      quad(body, bl, br, tr, tl); quad(body, fl, ul, ur, fr); quad(body, tl, tr, ur, ul);
      if (i === 0) quad(body, bl, tl, ul, fl);
      if (i === 43) quad(body, br, fr, ur, tr);
    }
    const dam = surface(body, concrete); dam.name = 'dam-body';
    for (let x = -105; x < 110; x += 15) {
      tube([x, .5, front(x, .5) + .08], [x, h, front(x, h) + .08], .12, darkConcrete);
      for (const side of [-3.6, 3.6]) {
        box([.22, 1.7, .22], [x, h + 1.1, arc(x) + side], paleSteel);
        const next = Math.min(x + 15, 110); tube([x, h + 1.8, arc(x) + side], [next, h + 1.8, arc(next) + side], .12);
      }
      const slab = box([15.2, .6, 6.8], [x + 7.5, h + .35, arc(x + 7.5)], asphalt); slab.rotation.y = Math.atan((arc(x + 15) - arc(x)) / 15) * -1;
    }
    for (const x of [-24, 0, 24]) {
      const cz = front(x, h - 12);
      box([13, 16, 8], [x, h - 8, cz], darkConcrete);
      const gate = box([9.2, 10, .9], [x, h - 11 + settings.gate * 8, cz + 4.7], steel); gate.name = 'spillway-gate';
      for (const sign of [-1, 1]) box([1.4, 17, 1.4], [x + sign * 5.7, h - 5, cz + 4], concrete);
      box([14, 1.7, 3], [x, h + 3.8, cz + 4], steel);
      box([3.5, 2.2, 4], [x, h + 5.4, cz + 4], paleSteel);
      const chute: number[] = [], discharge: number[] = [];
      for (let j = 0; j < 12; j++) {
        const y1 = h - 17 - j * (h - 23) / 12, y2 = h - 17 - (j + 1) * (h - 23) / 12;
        const z1 = front(x, y1) + 2, z2 = front(x, y2) + 2;
        quad(chute, [x - 6, y1, z1], [x + 6, y1, z1], [x + 6, y2, z2], [x - 6, y2, z2]);
        quad(discharge, [x - 4, y1 + .2, z1 + .2], [x + 4, y1 + .2, z1 + .2], [x + 4, y2 + .2, z2 + .2], [x - 4, y2 + .2, z2 + .2]);
      }
      surface(chute, darkConcrete);
      if (settings.gate > 0 && settings.waterRatio > .62) { const sheet = surface(discharge, foam, waterGroup); sheet.name = 'decorative-discharge'; }
    }
    const basinZ = front(0, 0) + 25;
    box([82, 2, 46], [0, 4, basinZ], darkConcrete);
    for (const x of [-42, 42]) box([2, 7, 48], [x, 7, basinZ], concrete);
    box([78, .35, 43], [0, 5.25, basinZ], foam, waterGroup);
    // Intake tower, connecting walkway, powerhouse and access road.
    const tower = mesh(new THREE.CylinderGeometry(5, 7, h - 4, 20), concrete); tower.position.set(49, h / 2 + 2, -65);
    box([13, 4, 13], [49, h + 2, -65], steel);
    tube([49, h - 1, -65], [64, h - 1, back(64)], 1.2, paleSteel);
    box([31, 15, 18], [66, terrainHeight(66, 105, h, kind) + 7, 105], darkConcrete);
    box([34, 2, 21], [66, terrainHeight(66, 105, h, kind) + 15.5, 105], steel);
    for (let i = 0; i < 5; i++) box([4, 4, .2], [55 + i * 5.5, terrainHeight(66, 105, h, kind) + 10, 114.1], paleSteel);
    for (let i = 0; i < 24; i++) { const z = -160 + i * 15, x = 126 + 9 * Math.sin(z / 85); box([9, .7, 16], [x, terrainHeight(x, z, h, kind) + .5, z], asphalt); }
  } else if (kind === 'bridge') {
    const deck = 55;
    box([310, 3, 18], [0, deck, 0], darkConcrete);
    box([310, .4, 17.5], [0, deck + 1.7, 0], asphalt);
    for (let x = -150; x <= 150; x += 12) box([5, .03, .24], [x, deck + 1.93, 0], white);
    for (const z of [-8.3, 8.3]) {
      tube([-155, deck + 3.2, z], [155, deck + 3.2, z], .22);
      for (let x = -150; x < 155; x += 10) box([.2, 1.3, .2], [x, deck + 2.7, z], paleSteel);
    }
    for (const x of [-58, 58]) {
      for (const z of [-6, 6]) {
        box([5, 99, 5], [x, 49.5, z], concrete);
        for (const sign of [-1, 1]) for (let j = 1; j <= 7; j++) tube([x, 92 - j * 1.15, z], [x + sign * j * 12.5, deck + 1.7, z], .27);
      }
      box([6, 5, 18], [x, 83, 0], concrete); box([6, 4, 18], [x, 45, 0], concrete);
    }
    for (const x of [-126, 126]) box([5, deck - 10, 12], [x, (deck - 10) / 2, 0], concrete);
    for (const x of [-90, -20, 32, 106]) {
      const car = box([5, 1.6, 2.5], [x, deck + 2.8, x < 0 ? 4 : -4], new THREE.MeshStandardMaterial({ color: x < 0 ? '#b46c47' : '#e0e6df', roughness: .6 }));
      box([2.7, 1, 2.2], [x, car.position.y + 1.1, car.position.z], steel);
    }
  } else {
    for (const z of [-35, 45, 105]) {
      const y = terrainHeight(0, z, h, kind);
      box([85, 5, 20], [0, y + 2, z], darkConcrete);
      if (z < 0) {
        for (const x of [-36, -24, -12, 12, 24, 36]) box([8, 24, 8], [x, y + 14, z], concrete);
        box([85, 4, 13], [0, y + 27, z], concrete);
      } else { box([85, 9, 10], [0, y + 7, z], concrete); }
      box([72, 1, 38], [0, y + .7, z + 20], darkConcrete);
      for (const x of [-40, 40]) box([3, 10, 52], [x, y + 5, z + 18], concrete);
    }
    for (let i = 0; i < 60; i++) {
      const x = (noise(i + 41) - .5) * 64, z = noise(i + 45) * 170 - 190;
      const rock = mesh(new THREE.IcosahedronGeometry(1 + noise(i) * 2.5, 1), new THREE.MeshStandardMaterial({ color: '#9a9b87', roughness: 1 }), land);
      rock.position.set(x, terrainHeight(x, z, h, kind) + 1, z); rock.scale.set(1.5, .7, 1);
    }
  }
  // Decorative downstream stream follows the synthetic valley; no flow solver.
  const river: number[] = [];
  const start = kind === 'gravity' || kind === 'arch' ? 90 : -245;
  for (let z = start; z < 245; z += 5) {
    const x1 = Math.sin(z / 115) * 13, x2 = Math.sin((z + 5) / 115) * 13;
    const y1 = terrainHeight(x1, z, h, kind) + .5, y2 = terrainHeight(x2, z + 5, h, kind) + .5;
    quad(river, [x1 - 7, y1, z], [x1 + 7, y1, z], [x2 + 7, y2, z + 5], [x2 - 7, y2, z + 5]);
  }
  surface(river, water, waterGroup);
  root.updateMatrixWorld(true);
  root.userData = { kind, settings: { ...settings }, units: 'metre', model_type: 'illustrative', numerical_solver_linked: false };
  return { root, waterMap, level, terrain: land, structure, water: waterGroup };
}

export function disposeFacility(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  root.traverse(o => { if (o instanceof THREE.Mesh) { geometries.add(o.geometry); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => materials.add(m)); } });
  materials.forEach(m => Object.values(m).forEach(v => { if (v instanceof THREE.Texture) textures.add(v); }));
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
}
