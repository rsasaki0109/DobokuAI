import { useEffect, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Analysis } from './types';
import { colors, ground, waterExtent } from './types';

function Controls() {
  const { camera, gl, invalidate } = useThree();
  useEffect(() => {
    const control = new OrbitControls(camera, gl.domElement);
    control.target.set(0, 0, 0);
    control.addEventListener('change', () => invalidate());
    control.update();
    return () => control.dispose();
  }, [camera, gl, invalidate]);
  return null;
}
function Scene({ analysis }: { analysis: Analysis }) {
  const objects = useMemo(() => {
    const items: THREE.Line[] = [];
    const first = analysis.run.river.stations[0].chainage;
    const last = analysis.run.river.stations.at(-1)!.chainage;
    const center = (first + last) / 2;
    const z0 = analysis.run.river.stations[0].bed_elevation;
    const coord = (x: number, stage: number, chainage: number) =>
      new THREE.Vector3(x, (stage - z0) * 3, (chainage - center) * 0.15);
    const add = (points: THREE.Vector3[], color: string) =>
      items.push(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineBasicMaterial({ color }),
        ),
      );
    const rivers = [
      { river: analysis.run.river, profile: analysis.run.profile, color: '#3a92c4' },
      ...analysis.comparisons.map((c, i) => ({ ...c, color: colors[i] })),
    ];
    rivers.forEach((r) => {
      const left: THREE.Vector3[] = [];
      const right: THREE.Vector3[] = [];
      r.river.stations.forEach((s, i) => {
        const g = ground(s.section, s.bed_elevation);
        const stage = r.profile.rows[i].water_elevation;
        add(
          g.map((p) => coord(p.x, p.z, s.chainage)),
          '#93a28b',
        );
        const [lo, hi] = waterExtent(g, stage);
        const a = coord(lo, stage, s.chainage);
        const b = coord(hi, stage, s.chainage);
        left.push(a);
        right.push(b);
        add([a, b], r.color);
      });
      add(left, r.color);
      add(right, r.color);
    });
    return items;
  }, [analysis]);
  useEffect(
    () => () =>
      objects.forEach((o) => {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }),
    [objects],
  );
  return (
    <>
      <Controls />
      {objects.map((o, i) => (
        <primitive key={i} object={o} />
      ))}
      <gridHelper args={[200, 20, '#acb8b1', '#d6dfda']} position={[0, -4, 0]} />
    </>
  );
}
export default function River3D({ analysis }: { analysis: Analysis }) {
  return (
    <>
      <p className="muted">
        空間的な連続性の参考表示。鉛直3倍・縦断0.15倍。ドラッグで回転、スクロールで拡大。定量比較には2D図を使用してください。
      </p>
      <div className="three-view">
        <Canvas frameloop="demand" camera={{ position: [100, 100, 140], near: 0.1, far: 5000 }}>
          <color attach="background" args={['#f3f6f3']} />
          <Scene analysis={analysis} />
        </Canvas>
      </div>
    </>
  );
}
