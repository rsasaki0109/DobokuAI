import * as THREE from 'three';
import { ground, waterExtent } from './types';
import type { Point, Profile, River } from './types';

export type DisplayReference = { chainageCenter: number; elevationOrigin: number; floor: number };
type Vertex = [number, number, number];
export const displayPoint = (p: Point, chainage: number, ref: DisplayReference): Vertex =>
  [p.x, (p.z - ref.elevationOrigin) * 3, (chainage - ref.chainageCenter) * .15];

// A display loft retaining original corners, never a hydraulic computational mesh.
function parameterize(points: Point[]) {
  const distances = [0];
  points.slice(1).forEach((p, i) => distances.push(distances.at(-1)! + Math.hypot(p.x - points[i].x, p.z - points[i].z)));
  const knots = distances.map(d => d / distances.at(-1)!);
  return { knots, at(t: number): Point {
    const end = knots.findIndex((k, i) => i > 0 && k >= t);
    if (end < 0) return points.at(-1)!;
    const a = points[end - 1], b = points[end];
    const f = (t - knots[end - 1]) / (knots[end] - knots[end - 1]);
    return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
  } };
}

export function riverSurfaces(river: River, profile: Profile, ref: DisplayReference) {
  const terrain: number[] = [], sides: number[] = [], water: number[] = [], sections: number[] = [];
  const points = river.stations.map(s => ground(s.section, s.bed_elevation));
  const tri = (out: number[], a: Vertex, b: Vertex, c: Vertex) => out.push(...a, ...b, ...c);
  const quad = (out: number[], a: Vertex, b: Vertex, c: Vertex, d: Vertex) => { tri(out, a, b, c); tri(out, a, c, d); };
  const bottom = (v: Vertex): Vertex => [v[0], ref.floor, v[2]];
  const cap = (out: number[], polygon: Point[], chainage: number, reverse: boolean) => {
    const vertices = polygon.map(p => displayPoint(p, chainage, ref));
    THREE.ShapeUtils.triangulateShape(polygon.map(p => new THREE.Vector2(p.x, p.z)), []).forEach(([a, b, c]) =>
      tri(out, vertices[a], vertices[reverse ? c : b], vertices[reverse ? b : c]));
  };
  river.stations.forEach((s, i) => {
    const g = points[i], stage = profile.rows[i].water_elevation;
    const [lo, hi] = waterExtent(g, stage);
    const left = displayPoint({ x: lo, z: stage }, s.chainage, ref);
    const right = displayPoint({ x: hi, z: stage }, s.chainage, ref);
    g.slice(1).forEach((p, j) => sections.push(...displayPoint(g[j], s.chainage, ref), ...displayPoint(p, s.chainage, ref)));
    if (i === 0 || i === river.stations.length - 1) {
      const floorElevation = ref.elevationOrigin + ref.floor / 3;
      cap(sides, [...g, { x: g.at(-1)!.x, z: floorElevation }, { x: g[0].x, z: floorElevation }], s.chainage, i === 0);
      const wet = g.filter(p => p.z < stage && p.x >= lo && p.x <= hi);
      cap(water, [{ x: lo, z: stage }, ...wet, { x: hi, z: stage }], s.chainage, i === 0);
    }
    if (i === river.stations.length - 1) return;
    const next = river.stations[i + 1], nextGround = points[i + 1];
    const a = parameterize(g), b = parameterize(nextGround);
    const knots = [...new Set([...a.knots, ...b.knots])].sort((x, y) => x - y);
    knots.slice(1).forEach((t, j) => quad(terrain,
      displayPoint(a.at(knots[j]), s.chainage, ref), displayPoint(a.at(t), s.chainage, ref),
      displayPoint(b.at(t), next.chainage, ref), displayPoint(b.at(knots[j]), next.chainage, ref)));
    for (const end of [0, -1]) {
      const p = displayPoint(g.at(end)!, s.chainage, ref), q = displayPoint(nextGround.at(end)!, next.chainage, ref);
      quad(sides, p, q, bottom(q), bottom(p));
    }
    const nextStage = profile.rows[i + 1].water_elevation;
    const [nlo, nhi] = waterExtent(nextGround, nextStage);
    quad(water, left, right, displayPoint({ x: nhi, z: nextStage }, next.chainage, ref), displayPoint({ x: nlo, z: nextStage }, next.chainage, ref));
  });
  const geometry = (values: number[], normals = true) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(values, 3));
    if (normals) geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  };
  return { terrain: geometry(terrain), sides: geometry(sides), water: geometry(water), sections: geometry(sections, false) };
}
