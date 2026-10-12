import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Analysis } from './types';
import { riverSurfaces } from './riverMesh';

type View = 'orbit' | 'top' | 'section';
function Controls({ center, radius, view, rotating }: { center: THREE.Vector3; radius: number; view: View; rotating: boolean }) {
  const { camera, gl, invalidate } = useThree();
  const controls = useRef<OrbitControls | null>(null);
  useEffect(() => {
    const control = new OrbitControls(camera, gl.domElement);
    control.target.copy(center); control.autoRotateSpeed = .9;
    control.minDistance = radius * .25; control.maxDistance = radius * 6;
    control.maxPolarAngle = Math.PI * .88;
    control.addEventListener('change', () => invalidate()); controls.current = control;
    return () => { control.dispose(); controls.current = null; };
  }, [camera, gl, invalidate, center, radius]);
  useEffect(() => {
    const offset = view === 'top' ? [0, 3, .001] : view === 'section' ? [.25, 1.05, -2.7] : [1.35, 2, 1.55];
    camera.position.copy(center).add(new THREE.Vector3(offset[0], offset[1], offset[2]).multiplyScalar(radius));
    camera.lookAt(center); controls.current?.update(); invalidate();
  }, [camera, center, radius, view, invalidate]);
  useFrame((_, delta) => {
    if (controls.current) { controls.current.autoRotate = rotating; if (rotating) controls.current.update(delta); }
  });
  return null;
}
export default function River3D({ analysis }: { analysis: Analysis }) {
  const [selected, setSelected] = useState(0);
  const [view, setView] = useState<View>('orbit');
  const [rotating, setRotating] = useState(false);
  const [wire, setWire] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const shell = useRef<HTMLDivElement>(null);
  const scene = useMemo(() => {
    const rivers = [{ river: analysis.run.river, profile: analysis.run.profile, name: '施工前' },
      ...analysis.comparisons.map(c => ({ river: c.river, profile: c.profile, name: c.scenario.name }))];
    const original = analysis.run.river.stations;
    const elevationOrigin = original[0].bed_elevation;
    const chainageCenter = (original[0].chainage + original.at(-1)!.chainage) / 2;
    const floor = Math.min(...rivers.flatMap(r => r.river.stations.map(s => (s.bed_elevation - elevationOrigin) * 3))) - 7;
    const models = rivers.map(r => ({ ...r, ...riverSurfaces(r.river, r.profile, { chainageCenter, elevationOrigin, floor }) }));
    const bounds = new THREE.Box3();
    models.forEach(m => { m.terrain.computeBoundingBox(); bounds.union(m.terrain.boundingBox!); });
    const center = bounds.getCenter(new THREE.Vector3());
    const radius = Math.max(bounds.getSize(new THREE.Vector3()).length() / 2, 1);
    return { models, center, radius, floor };
  }, [analysis]);
  useEffect(() => () => scene.models.forEach(m => [m.terrain, m.sides, m.water, m.sections].forEach(g => g.dispose())), [scene]);
  useEffect(() => { const sync = () => setFullscreen(document.fullscreenElement === shell.current); document.addEventListener('fullscreenchange', sync); return () => document.removeEventListener('fullscreenchange', sync); }, []);
  const model = scene.models[Math.min(selected, scene.models.length - 1)];
  return (
    <div className="river-3d" ref={shell}>
      <div className="river-3d-toolbar">
        <label>表示モデル <select aria-label="3D表示モデル" value={Math.min(selected, scene.models.length - 1)} onChange={e => setSelected(Number(e.target.value))}>
          {scene.models.map((m, i) => <option key={i} value={i}>{m.name}</option>)}
        </select></label>
        <div className="river-3d-actions">
          {([['orbit', '斜め'], ['top', '俯瞰'], ['section', '断面']] as const).map(([v, label]) => <button type="button" key={v} aria-pressed={view === v} onClick={() => setView(v)}>{label}</button>)}
          <button type="button" aria-pressed={rotating} onClick={() => setRotating(!rotating)}>自動回転</button>
          <button type="button" aria-pressed={wire} onClick={() => setWire(!wire)}>断面線</button>
          <button type="button" onClick={async () => { if (fullscreen) await document.exitFullscreen(); else await shell.current?.requestFullscreen(); }}>{fullscreen ? '全画面を終了' : '3Dを全画面表示'}</button>
        </div>
      </div>
      <div className="three-view" aria-label="河床と水面の3Dモデル">
        <div className="river-3d-hud"><div><span>DOBOKU AI / RIVER MODEL</span><strong>{model.name}</strong></div><div><b>{model.river.discharge}</b> m³/s<span>1D計算結果の立体表示</span></div></div>
        <Canvas frameloop={rotating ? 'always' : 'demand'} dpr={[1, 1.5]} camera={{ fov: 42, near: .01, far: 1e8 }}>
          <color attach="background" args={['#0a1c28']} />
          <ambientLight intensity={1.2} />
          <directionalLight position={[80, 160, -60]} intensity={3} color="#fff0d9" />
          <directionalLight position={[-80, 60, 100]} intensity={1.8} color="#7ac8ff" />
          <Controls center={scene.center} radius={scene.radius} view={view} rotating={rotating} />
          <mesh geometry={model.terrain}><meshStandardMaterial color="#8fbd8c" roughness={.88} side={THREE.DoubleSide} /></mesh>
          <mesh geometry={model.sides}><meshStandardMaterial color="#b19a70" roughness={.95} side={THREE.DoubleSide} /></mesh>
          <mesh geometry={model.water} renderOrder={1}><meshStandardMaterial color="#1ab6df" emissive="#063c59" emissiveIntensity={.5} metalness={.25} roughness={.28} transparent opacity={.83} depthWrite={false} side={THREE.DoubleSide} /></mesh>
          {wire && <lineSegments geometry={model.sections} renderOrder={2}><lineBasicMaterial color="#d7f6de" transparent opacity={.5} depthTest={false} /></lineSegments>}
          <gridHelper args={[scene.radius * 3, 24, '#254652', '#18323e']} position={[scene.center.x, scene.floor - .3, scene.center.z]} />
        </Canvas>
        <div className="river-3d-legend"><span><i className="land" />河床・堤岸</span><span><i className="water" />計算水面</span><span>上流 → 下流 / ドラッグで回転</span></div>
      </div>
      <p className="river-3d-note">鉛直3倍・縦断0.15倍。断面間は表示用補間、側面・底面は表示用の切断面です。3D水理解析ではありません。定量比較には2D図を使用してください。</p>
    </div>
  );
}
