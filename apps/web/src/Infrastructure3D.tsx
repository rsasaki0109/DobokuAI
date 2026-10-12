import { useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildFacility, disposeFacility, facilities } from './infrastructureScene';
import type { FacilityKind, FacilitySettings } from './infrastructureScene';
import { saveBlob } from './types';

type View = 'overview' | 'detail' | 'upstream' | 'top';
function Camera({ kind, height, view, rotating }: { kind: FacilityKind; height: number; view: View; rotating: boolean }) {
  const { camera, gl, invalidate } = useThree();
  const control = useRef<OrbitControls | null>(null);
  useEffect(() => {
    const orbit = new OrbitControls(camera, gl.domElement); orbit.minDistance = 70; orbit.maxDistance = 700;
    orbit.maxPolarAngle = Math.PI / 2 - .05; orbit.autoRotateSpeed = .55;
    orbit.addEventListener('change', () => invalidate()); control.current = orbit;
    return () => { orbit.dispose(); control.current = null; };
  }, [camera, gl, invalidate]);
  useEffect(() => {
    const target = new THREE.Vector3(0, kind === 'sabo' ? 22 : 40, view === 'upstream' ? -65 : -12);
    const pos = view === 'top' ? [0, 430, 5] : view === 'detail' ? [135, height * 2.1, 170] : view === 'upstream' ? [110, height * 2.8, -255] : [250, height * 3.1, 280];
    camera.position.set(pos[0], pos[1], pos[2]); camera.lookAt(target);
    if (control.current) { control.current.target.copy(target); control.current.update(); }
    invalidate();
  }, [camera, invalidate, kind, height, view]);
  useFrame((_, delta) => { if (control.current) { control.current.autoRotate = rotating; if (rotating) control.current.update(delta); } });
  return null;
}

function Facility({ kind, settings, flow, environment, water, sceneRef }: { kind: FacilityKind; settings: FacilitySettings; flow: boolean; environment: boolean; water: boolean; sceneRef: RefObject<THREE.Group | null> }) {
  const scene = useMemo(() => buildFacility(kind, settings), [kind, settings]);
  const { invalidate } = useThree();
  useEffect(() => { sceneRef.current = scene.root; return () => { if (sceneRef.current === scene.root) sceneRef.current = null; disposeFacility(scene.root); }; }, [scene, sceneRef]);
  useEffect(() => { scene.terrain.visible = environment; scene.water.visible = water; invalidate(); }, [scene, environment, water, invalidate]);
  useFrame((_, delta) => { if (flow && scene.waterMap) { scene.waterMap.offset.y -= delta * .018; scene.waterMap.offset.x += delta * .007; } });
  return <primitive object={scene.root} />;
}

export default function Infrastructure3D({ onOpenDam }: { onOpenDam?: () => void }) {
  const [kind, setKind] = useState<FacilityKind>('gravity');
  const [settings, setSettings] = useState<FacilitySettings>({ height: 72, waterRatio: .83, gate: .6 });
  const [view, setView] = useState<View>('overview');
  const [rotating, setRotating] = useState(false);
  const [flow, setFlow] = useState(false);
  const [environment, setEnvironment] = useState(true);
  const [water, setWater] = useState(true);
  const [sunset, setSunset] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Group | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  useEffect(() => { const update = () => setFullscreen(document.fullscreenElement === host.current); document.addEventListener('fullscreenchange', update); return () => document.removeEventListener('fullscreenchange', update); }, []);
  const dam = kind === 'gravity' || kind === 'arch';
  return (
    <div className="facility-gallery" ref={host}>
      <div className="facility-cards">
        {(Object.keys(facilities) as FacilityKind[]).map(key => <button key={key} type="button" aria-pressed={kind === key} onClick={() => { setKind(key); setView('overview'); }}>
          <span>{facilities[key].en}</span><strong>{facilities[key].name}</strong>
          <small>{key === 'gravity' ? '堤体・洪水吐・貯水池' : key === 'arch' ? '曲面堤体・取水塔' : key === 'bridge' ? '主塔・斜材・橋桁' : 'スリット・副堰堤・渓流'}</small>
        </button>)}
      </div>
      <div className="facility-tools">
        {kind === 'gravity' && onOpenDam && <button type="button" onClick={onOpenDam}>別条件で重力式ダムの予備照査を開く</button>}
        <div className="facility-view-buttons">{([['overview', '全景'], ['detail', '施設詳細'], ['upstream', '上流側'], ['top', '真上']] as const).map(([v, title]) => <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>{title}</button>)}</div>
        <div className="facility-view-buttons">
          <button type="button" aria-pressed={rotating} onClick={() => setRotating(!rotating)}>自動回転</button>
          <button type="button" aria-pressed={sunset} onClick={() => setSunset(!sunset)}>夕景</button>
          <button type="button" disabled={exporting} onClick={async () => {
            setExporting(true); setExportError('');
            try {
              const model = sceneRef.current;
              if (!model) throw new Error('モデルの描画完了後に保存してください');
              const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
              const output = await new GLTFExporter().parseAsync(model, { binary: true });
              saveBlob(new Blob([output as ArrayBuffer], { type: 'model/gltf-binary' }), `doboku-${kind}-illustrative.glb`);
            } catch (e) { setExportError((e as Error).message); }
            finally { setExporting(false); }
          }}>{exporting ? 'モデルを書き出し中…' : 'モデルGLBを保存'}</button>
          <button type="button" onClick={() => saveBlob(new Blob([JSON.stringify({ schema_version: 1, model_type: 'illustrative', numerical_solver_linked: false, kind, settings, view, water, environment, sunset, flow, rotating }, null, 2)], { type: 'application/json' }), `doboku-${kind}-scene.json`)}>表示条件JSONを保存</button>
          <button type="button" onClick={async () => { if (fullscreen) await document.exitFullscreen(); else await host.current?.requestFullscreen(); }}>{fullscreen ? '全画面を終了' : '施設を全画面表示'}</button>
        </div>
      </div>
      <div className="facility-stage" aria-label="土木施設の3D形状モデル">
        <div className="facility-hud"><div><span>DOBOKUAI / INFRASTRUCTURE STUDIO</span><strong>{facilities[kind].name}</strong></div><div className="concept-badge">架空施設 · 形状参考</div></div>
        <Canvas shadows frameloop={rotating || flow ? 'always' : 'demand'} dpr={[1, 1.25]} camera={{ fov: 42, near: .5, far: 1600 }}>
          <color attach="background" args={[sunset ? '#e6c8b6' : '#c5dadd']} />
          <fog attach="fog" args={[sunset ? '#e6c8b6' : '#c5dadd', 430, 900]} />
          <hemisphereLight args={[sunset ? '#f4c0a0' : '#d3e5f4', '#596957', 1.5]} />
          <directionalLight position={sunset ? [-200, 100, 160] : [-140, 240, 120]} intensity={sunset ? 3.2 : 2.7} color={sunset ? '#ffd2a5' : '#fff2d9'} castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-260} shadow-camera-right={260} shadow-camera-top={260} shadow-camera-bottom={-260} shadow-camera-near={1} shadow-camera-far={650} shadow-bias={-.0006} />
          <directionalLight position={[150, 100, -170]} intensity={.65} color="#b8d8ec" />
          <Camera kind={kind} height={settings.height} view={view} rotating={rotating} />
          <Facility kind={kind} settings={settings} flow={flow} environment={environment} water={water} sceneRef={sceneRef} />
        </Canvas>
        <div className="facility-caption"><span>{facilities[kind].components}</span><b>ドラッグで回転 · スクロールで拡大</b></div>
      </div>
      <div className="facility-settings">
        {dam && <>
          <label>堤高（形状） <strong>{settings.height} m</strong><input aria-label="堤高（形状）" type="range" min={40} max={100} value={settings.height} onChange={e => setSettings({ ...settings, height: Number(e.target.value) })} /></label>
          <label>貯水位（形状） <strong>{(settings.height * settings.waterRatio).toFixed(1)} m</strong><input aria-label="貯水位（形状）" type="range" min={30} max={92} value={Math.round(settings.waterRatio * 100)} onChange={e => setSettings({ ...settings, waterRatio: Number(e.target.value) / 100 })} /></label>
          <label>ゲート開度（表示） <strong>{Math.round(settings.gate * 100)} %</strong><input aria-label="ゲート開度（表示）" type="range" min={0} max={100} value={settings.gate * 100} onChange={e => setSettings({ ...settings, gate: Number(e.target.value) / 100 })} /></label>
        </>}
        <div className="facility-layer-options">
          <label><input type="checkbox" checked={environment} onChange={e => setEnvironment(e.target.checked)} />周辺地形・森林</label>
          <label><input type="checkbox" checked={water} onChange={e => setWater(e.target.checked)} />水面を表示</label>
          <label><input type="checkbox" checked={flow} onChange={e => setFlow(e.target.checked)} />水面・放流の演出</label>
        </div>
      </div>
      <p className="facility-note">架空の土木施設を形状検討用に制作したモデルです。寸法・地形は作例、放流は装飾表現です。この形状・水位は計算条件ではありません。重力式ダムの予備照査は別画面・別条件で行います。耐震・FEM・設計基準の安全判定は未対応です。</p>
      {exportError && <p role="alert">モデルを書き出せませんでした: {exportError}</p>}
    </div>
  );
}
