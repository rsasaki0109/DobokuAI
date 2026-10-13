import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { parseCityFiles, syntheticCityXML, localCityCRS } from './cityModel';
import type { CityFeature, CityLayer, CityModel } from './cityModel';
import { footprintGround, sampleGround } from './cityTerrain';
import { NumberField } from './NumberField';
import { saveBlob } from './types';
import publicBuildings from './data/yokohama/buildings.gml?raw';
import publicTerrain from './data/yokohama/terrain.gml?raw';
import publicManifest from './data/yokohama/manifest.json';

const layers: Record<CityLayer, { name: string; color: string }> = {
  building: { name: '建物', color: '#e1d9c2' }, terrain: { name: '地形', color: '#79936c' },
  road: { name: '道路', color: '#596b73' }, bridge: { name: '橋', color: '#d7aa6d' },
  water: { name: '水域', color: '#4ab3cd' }, other: { name: 'その他', color: '#b0bdc3' },
};
type Source = { name: string; bytes: number; sha256: string };
type Loaded = { model: CityModel; sources: Source[]; inspectedAt: string; synthetic: boolean; sourceURL: string; attribution: string; terms: string; dataset?: typeof publicManifest };
const publicCity = (): Loaded => ({
  model: parseCityFiles([{ name: 'buildings.gml', xml: publicBuildings }, { name: 'terrain.gml', xml: publicTerrain }], 1),
  sources: publicManifest.files, inspectedAt: new Date().toISOString(), synthetic: false,
  sourceURL: publicManifest.source_url, attribution: publicManifest.attribution, terms: 'CC BY 4.0 / 原メタデータで確認', dataset: publicManifest,
});
const syntheticCity = (): Loaded => ({
  model: parseCityFiles([{ name: 'synthetic-city.gml', xml: syntheticCityXML() }], 1), sources: [],
  inspectedAt: new Date().toISOString(), synthetic: true, sourceURL: '', attribution: 'DobokuAI合成例', terms: '実在都市・測量データではありません',
});
type Footprint = { east: number; north: number; width: number; length: number; elevation: number };
function Controls({ model, top, rotating }: { model: CityModel; top: boolean; rotating: boolean }) {
  const { camera, gl, invalidate } = useThree();
  const control = useRef<OrbitControls | null>(null);
  const radius = Math.max(Math.hypot(...model.bounds.max.map((v, i) => v - model.bounds.min[i])) / 2, 10);
  useEffect(() => {
    const orbit = new OrbitControls(camera, gl.domElement);
    orbit.target.set(0, (model.bounds.max[1] + model.bounds.min[1]) / 2, 0);
    orbit.minDistance = radius * .15; orbit.maxDistance = radius * 5; orbit.maxPolarAngle = Math.PI * .49;
    orbit.autoRotateSpeed = .7; orbit.addEventListener('change', () => invalidate()); control.current = orbit;
    return () => { orbit.dispose(); control.current = null; };
  }, [camera, gl, invalidate, model, radius]);
  useEffect(() => {
    camera.position.set(radius * (top ? 0 : 1.3), radius * (top ? 2.6 : 1.6), radius * (top ? .001 : 1.3));
    camera.near = .05; camera.far = radius * 15; camera.updateProjectionMatrix();
    control.current?.update(); invalidate();
  }, [camera, invalidate, model, radius, top]);
  useFrame((_, delta) => { if (control.current) { control.current.autoRotate = rotating; if (rotating) control.current.update(delta); } });
  return null;
}
function Feature({ feature, selected, click }: { feature: CityFeature; selected: boolean; click: (point: THREE.Vector3) => void }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(feature.positions, 3)); g.computeVertexNormals(); return g;
  }, [feature]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} onClick={e => { e.stopPropagation(); if (e.button === 0 && e.delta <= 2) click(e.point); }}>
    <meshStandardMaterial color={selected ? '#f2ad45' : layers[feature.layer].color} roughness={feature.layer === 'water' ? .3 : .88} side={THREE.DoubleSide} />
  </mesh>;
}
const defaultFootprint = (m: CityModel): Footprint => ({ east: 0, north: 0, width: 40, length: 30, elevation: Math.round((m.origin[2] + (m.bounds.min[1] + m.bounds.max[1]) / 2) * 100) / 100 });
export default function CityWorkspace() {
  const [loaded, setLoaded] = useState<Loaded>(publicCity);
  const [files, setFiles] = useState<File[]>([]);
  const [lod, setLOD] = useState(1);
  const [sourceURL, setSourceURL] = useState('');
  const [attribution, setAttribution] = useState('');
  const [terms, setTerms] = useState('');
  const [pending, setPending] = useState<Loaded | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const revision = useRef(0);
  const [visible, setVisible] = useState<CityLayer[]>(Object.keys(layers) as CityLayer[]);
  const [selected, setSelected] = useState<string | null>(null);
  const [top, setTop] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [sunset, setSunset] = useState(false);
  const [footprint, setFootprint] = useState<Footprint>(() => defaultFootprint(loaded.model));
  const [draft, setDraft] = useState<Footprint | null>(null);
  const [showFootprint, setShowFootprint] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pickNotice, setPickNotice] = useState('');
  const changeSource = () => { revision.current++; setPending(null); setError(''); setPicking(false); setPickNotice(''); };
  const model = loaded.model;
  const counts = Object.keys(layers).map(k => ({ key: k as CityLayer, count: model.features.filter(f => f.layer === k).length }));
  const feature = model.features.find(f => f.id === selected);
  const validFootprint = (p: Footprint) => Object.values(p).every(Number.isFinite) && p.width > 0 && p.length > 0 && p.width <= 5000 && p.length <= 5000 &&
    p.east - p.width / 2 >= model.bounds.min[0] && p.east + p.width / 2 <= model.bounds.max[0] &&
    -p.north - p.length / 2 >= model.bounds.min[2] && -p.north + p.length / 2 <= model.bounds.max[2] &&
    p.elevation >= model.origin[2] + model.bounds.min[1] && p.elevation <= model.origin[2] + model.bounds.max[1];
  const plan = draft ?? footprint;
  const groundPreview = useMemo(() => footprintGround(model, plan), [model, plan.east, plan.north, plan.width, plan.length]);
  const confirmedGround = useMemo(() => footprintGround(model, footprint), [model, footprint]);
  const centerGround = groundPreview[0];
  const clickFeature = (f: CityFeature, point: THREE.Vector3) => {
    if (!picking) { setSelected(f.id); return; }
    if (f.layer !== 'terrain') { setPickNotice('地形の面をクリックしてください。建物・道路などは施工位置に採用しません。'); return; }
    const sample = sampleGround(model, point.x, -point.z);
    if (sample.status !== 'unique') {
      setPickNotice(sample.status === 'ambiguous' ? 'クリック位置の地形高さが一意に決まりません。入力案を保持しています。' : 'クリック位置に参照できる地形がありません。入力案を保持しています。');
      return;
    }
    setDraft({ ...plan, east: sample.east, north: sample.north, elevation: sample.elevations[0] });
    setPickNotice(`地形から入力候補を選択：東 ${sample.east.toFixed(3)} m・北 ${sample.north.toFixed(3)} m / 高さ ${sample.elevations[0].toFixed(3)} m。確認するまで表示中の施工範囲は変わりません。`);
  };
  const extent = Math.max(model.bounds.max[0] - model.bounds.min[0], model.bounds.max[2] - model.bounds.min[2], 10);
  return <div className="city-workspace">
    <section className="panel city-import">
      <div className="panel-heading"><div><div className="eyebrow">CITYGML / PUBLIC DATA WORKSPACE</div><h2>都市・地形モデルを取り込む</h2></div><span className="badge">小範囲・確認後に反映</span></div>
      <p className="muted">PLATEAUの建物・地形などのCityGMLを選択してください。1ファイル8MiB・合計24MiB、最大8ファイル。テクスチャ・穴のある面・外部参照は未対応です。</p>
      <div className="form-grid">
        <label className="field">CityGMLファイル<input aria-label="CityGMLファイル" type="file" accept=".gml,.xml" multiple onChange={e => { changeSource(); setFiles(Array.from(e.target.files ?? [])); }} /></label>
        <label className="field">表示LOD<select aria-label="表示LOD" value={lod} onChange={e => { changeSource(); setLOD(Number(e.target.value)); }}><option value={0}>LOD0</option><option value={1}>LOD1</option><option value={2}>LOD2</option></select></label>
        <label className="field">原データURL<input aria-label="都市モデルの原データURL" value={sourceURL} onChange={e => { changeSource(); setSourceURL(e.target.value); }} /></label>
        <label className="field">出典・作成者<input aria-label="都市モデルの出典" value={attribution} onChange={e => { changeSource(); setAttribution(e.target.value); }} /></label>
        <label className="field">利用条件・確認状況<input aria-label="都市モデルの利用条件" value={terms} onChange={e => { changeSource(); setTerms(e.target.value); }} /></label>
      </div>
      <div className="city-actions">
        <button type="button" className="secondary" onClick={() => { changeSource(); setLoaded(syntheticCity()); setSelected(null); setDraft(null); setShowFootprint(false); setFootprint(defaultFootprint(syntheticCity().model)); }}>合成都市デモを表示</button>
        <button type="button" className="secondary" onClick={() => { changeSource(); setPending(publicCity()); }}>横浜の公開モデルを確認</button>
        <button type="button" className="secondary" disabled={!files.length || busy} onClick={async () => {
          const version = revision.current; setBusy(true); setError(''); setPending(null);
          try {
            if (files.length > 8 || files.some(f => f.size > 8 * 1024 * 1024) || files.reduce((s, f) => s + f.size, 0) > 24 * 1024 * 1024) throw new Error('最大8ファイル、1ファイル8MiB・合計24MiB以内です');
            const inputs = await Promise.all(files.map(async f => {
              const bytes = await f.arrayBuffer(); const xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
              const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(b => b.toString(16).padStart(2, '0')).join('');
              return { name: f.name, xml, bytes: f.size, sha256 };
            }));
            const candidate = { model: parseCityFiles(inputs, lod), sources: inputs.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })), inspectedAt: new Date().toISOString(), synthetic: false, sourceURL, attribution, terms };
            if (version === revision.current) setPending(candidate);
          } catch (e) { if (version === revision.current) setError((e as Error).message); }
          finally { setBusy(false); }
        }}>{busy ? 'モデルを点検中…' : 'CityGMLを点検・プレビュー'}</button>
        <a href="https://docs.plateauview.mlit.go.jp" target="_blank" rel="noreferrer">PLATEAU配布案内 ↗</a>
      </div>
      {error && <p role="alert" className="inline-error">{error}。表示中のモデルは保持しています。</p>}
      {pending && <div className="city-review" role="region" aria-label="都市モデルの取込み確認">
        <h3>候補：{pending.model.features.length}地物・{pending.model.polygonCount}面 / {pending.model.crs}</h3>
        <p>原点 {pending.model.origin.join(', ')} / LOD {pending.model.lod}。入力した出典・利用条件の正当性は自動確認していません。確認すると表示モデルを置換し、選択地物・施工範囲をクリアします。</p>
        <ul>{pending.sources.map((f, i) => <li key={i}>{f.name} · {f.bytes} bytes · SHA-256 {f.sha256}</li>)}</ul>
        <button type="button" className="primary" onClick={() => { setLoaded(pending); setPending(null); setSelected(null); setDraft(null); setShowFootprint(false); setFootprint(defaultFootprint(pending.model)); setPicking(false); setPickNotice(''); }}>確認して都市モデルを表示</button>
        <button type="button" className="secondary" onClick={() => setPending(null)}>都市モデルの取込みを取消</button>
      </div>}
    </section>
    <section className="panel city-scene-panel">
      <div className="panel-heading"><div><div className="eyebrow">DOBOKUAI / CITY & TERRAIN</div><h2>{loaded.dataset ? loaded.dataset.title : loaded.synthetic ? '合成都市デモ' : '取り込んだ都市・地形'}</h2></div><span className="badge">{loaded.dataset ? '公開都市モデル・表示用抜粋' : loaded.synthetic ? '合成例' : 'ファイル読込み・出典未認証'}</span></div>
      <div className="city-actions">
        <button type="button" className="secondary" aria-pressed={!top} onClick={() => setTop(false)}>都市を斜めから</button>
        <button type="button" className="secondary" aria-pressed={top} onClick={() => setTop(true)}>都市を真上から</button>
        <button type="button" className="secondary" aria-pressed={rotating} disabled={picking} onClick={() => setRotating(!rotating)}>都市を自動回転</button>
        <button type="button" className="secondary" aria-pressed={sunset} onClick={() => setSunset(!sunset)}>都市を夕景で表示</button>
        <button type="button" className="secondary" aria-pressed={picking} onClick={() => { setPicking(!picking); setPickNotice(''); if (!picking) { setRotating(false); setSelected(null); } }}>地形をクリックして施工位置を選ぶ</button>
        <button type="button" className="secondary" onClick={() => saveBlob(new Blob([JSON.stringify({ schema_version: 1, model_type: 'citygml_display', numerical_solver_linked: false, synthetic: loaded.synthetic ? true : loaded.dataset ? false : null, data_kind: loaded.synthetic ? 'synthetic' : loaded.dataset ? 'public_city_model' : 'unspecified', dataset: loaded.dataset ?? null, sources: loaded.sources, source_url: loaded.sourceURL, attribution: loaded.attribution, usage_terms: loaded.terms, inspected_at: loaded.inspectedAt, crs: model.crs, origin: model.origin, bounds: model.bounds, lod: model.lod, feature_count: model.features.length, polygon_count: model.polygonCount, visible_layers: visible, selected_feature: selected, footprint: showFootprint ? footprint : null, terrain_inspection: showFootprint ? { method: 'display_triangle_barycentric_5_points', whole_footprint_coverage_verified: false, samples: confirmedGround } : null, top, rotating, sunset }, null, 2)], { type: 'application/json' }), 'doboku-city-display.json')}>都市の表示条件JSONを保存</button>
      </div>
      {picking && <p role="status">施工位置の選択中：地形をクリックすると東・北・高さを入力候補にします。ドラッグは視点操作です。幅・長さを確認してから反映してください。</p>}
      {pickNotice && <p role="status" aria-label="施工位置の選択結果">{pickNotice}</p>}
      <div className="city-stage" aria-label="都市と地形の3Dビュー" style={{ cursor: picking ? 'crosshair' : undefined }}>
        <div className="city-hud"><span>{loaded.dataset ? 'PLATEAU / YOKOHAMA 2024 · 公開モデル抜粋' : loaded.synthetic ? 'SYNTHETIC CITY · 実在都市ではありません' : 'CITYGML · 読込みモデル'}</span><strong>{model.features.length} 地物 / {model.polygonCount} 面</strong><small>鉛直・水平とも1倍 · m</small></div>
        <Canvas frameloop={rotating ? 'always' : 'demand'} dpr={[1, 1.25]} camera={{ fov: 40 }} onPointerMissed={() => setSelected(null)}>
          <color attach="background" args={[sunset ? '#e4c4ac' : '#bed3de']} />
          <hemisphereLight args={['#e3f0fa', '#71654a', 2]} />
          <directionalLight position={[extent, extent * 2, extent * .6]} intensity={sunset ? 2.8 : 2.2} color={sunset ? '#ffd1a3' : '#fff4de'} />
          <Controls model={model} top={top} rotating={rotating} />
          {model.features.filter(f => visible.includes(f.layer)).map((f, i) => <Feature key={`${loaded.inspectedAt}:${i}`} feature={f} selected={f.id === selected} click={point => clickFeature(f, point)} />)}
          {showFootprint && <mesh position={[footprint.east, footprint.elevation - model.origin[2], -footprint.north]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={5}><planeGeometry args={[footprint.width, footprint.length]} /><meshBasicMaterial color="#f6a841" transparent opacity={.62} side={THREE.DoubleSide} depthTest={false} depthWrite={false} /></mesh>}
          <gridHelper args={[extent * 1.15, 16, '#70858b', '#8fa4a8']} position={[0, model.bounds.min[1] - 1, 0]} />
        </Canvas>
        <div className="city-caption">北は画面の−Z方向 · {picking ? '地形クリックで施工位置の入力候補を選択' : '地物をクリックして選択'} · 施工範囲は表示用マーカー</div>
      </div>
      <div className="city-layers">{counts.filter(c => c.count).map(c => <label key={c.key}><input type="checkbox" checked={visible.includes(c.key)} onChange={e => setVisible(e.target.checked ? [...visible, c.key] : visible.filter(k => k !== c.key))} />{layers[c.key].name} ({c.count})</label>)}</div>
      {feature && <p role="status">選択地物：{feature.id} / {layers[feature.layer].name} / {feature.triangleCount} 三角形</p>}
      <p className="muted city-provenance">{model.crs === localCityCRS ? '局所座標：東・北・高さ（m）。' : 'EPSG:6697：緯度・経度・高さ。GRS80接平面で水平を表示用に近似し、原高さを保持します。測量座標変換・標高基準変換ではありません。'} {loaded.attribution || '出典未入力'} / {loaded.terms || '利用条件未入力'}。元CityGMLは別途保持してください。</p>
      {loaded.dataset && <p className="muted">{loaded.dataset.processing} 建物 {loaded.dataset.building_ids.length} 件 / 地形 {loaded.dataset.terrain_triangles} 三角形。<a href={loaded.dataset.license_url} target="_blank" rel="noreferrer">CC BY 4.0</a></p>}
    </section>
    <section className="panel">
      <div className="panel-heading"><div><div className="eyebrow">PLANNING OVERLAY</div><h2>施工範囲を重ねる</h2></div><span className="badge">計画用マーカー</span></div>
      <p className="muted">表示原点から東・北の距離と原データ基準の高さを指定します。中心・四隅の5点で、地形の三角形から高さを補間して確認できます。5点の確認は範囲全体の地形被覆を保証しません。マーカーは水平面で、地盤への投影・掘削・土量・浸水計算は行いません。</p>
      <div className="form-grid">{([['east', '施工範囲の東方向 (m)'], ['north', '施工範囲の北方向 (m)'], ['width', '施工範囲の幅 (m)'], ['length', '施工範囲の長さ (m)'], ['elevation', '施工範囲の標高 (m / 原データ基準)']] as const).map(([key, label]) => <NumberField key={key} label={label} value={plan[key]} onChange={v => { setDraft({ ...plan, [key]: v }); setPickNotice(''); }} />)}</div>
      <div role="region" aria-label="施工範囲の地形5点確認" className="city-review">
        <h3>編集中の範囲：地形の5点確認</h3>
        <ul>{groundPreview.map(s => <li key={s.label}>{s.label}：{s.status === 'unique' ? `${s.elevations[0].toFixed(3)} m / 原データ基準` : s.status === 'ambiguous' ? '高さが重なる・鉛直面を含むため一意に決められません' : '地形がありません・外挿しません'}（東 {s.east.toFixed(2)}・北 {s.north.toFixed(2)} m）</li>)}</ul>
        {!groundPreview.length && <p>有限値と正の幅・長さを指定してください。</p>}
        <button type="button" className="secondary" disabled={centerGround?.status !== 'unique'} onClick={() => { if (centerGround?.status === 'unique') setDraft({ ...plan, elevation: centerGround.elevations[0] }); }}>中心の地形高さを標高候補にする</button>
        <p className="muted">候補を選んでも、確認するまで表示中のマーカーは変わりません。建物の屋根・道路は高さの参照対象に含めません。レイヤー非表示でも取り込んだ地形を確認します。</p>
      </div>
      <div className="city-actions"><button type="button" className="primary" disabled={!validFootprint(plan)} onClick={() => { setFootprint(plan); setDraft(null); setShowFootprint(true); setPicking(false); setPickNotice(''); }}>確認して施工範囲を表示</button><button type="button" className="secondary" onClick={() => { setDraft(null); setPickNotice(''); }}>施工範囲の編集を取消</button><button type="button" className="secondary" onClick={() => setShowFootprint(false)}>施工範囲を非表示</button></div>
      {!validFootprint(plan) && <p role="alert">有限値・正の幅/長さと、読込みモデルの水平範囲・標高範囲内を指定してください。</p>}
      {showFootprint && <p role="status">反映済み施工範囲：東 {footprint.east} m・北 {footprint.north} m / {footprint.width} × {footprint.length} m / 標高 {footprint.elevation} m</p>}
    </section>
    <p className="muted">都市モデルと施工範囲は表示専用です。河川プロジェクト・Rust計算条件とは未連携です。公開都市モデルの表示確認は、実河川の水理検証・校正とは別です。</p>
  </div>;
}
