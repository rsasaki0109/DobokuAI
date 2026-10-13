import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { citySectionColors } from './citySectionOverlay';
import type { CitySectionOverlayData } from './citySectionOverlay';

export default function CitySectionOverlayView({ data, probePosition }: { data: CitySectionOverlayData; probePosition?: [number, number, number] | null }) {
  const resources = useMemo(() => {
    const items: { object: THREE.Object3D; geometry: THREE.BufferGeometry; material: THREE.Material }[] = [];
    for (const a of data.axes) {
      const color = citySectionColors[a.axis];
      if (a.segments.length) {
        const geometry = new LineSegmentsGeometry().setPositions(a.segments);
        // Keep the fully opaque line in the transparent render queue so its
        // renderOrder places it after the translucent planning marker.
        const material = new LineMaterial({ color, linewidth: 3, worldUnits: false, transparent: true, opacity: 1, depthTest: false, depthWrite: false, toneMapped: false });
        const object = new LineSegments2(geometry, material);
        object.name = `terrain-section-${a.axis}`; object.renderOrder = 6; object.raycast = () => {};
        items.push({ object, geometry, material });
      }
      if (a.points.length) {
        const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(a.points, 3));
        const material = new THREE.PointsMaterial({ color, size: 4, sizeAttenuation: false, transparent: true, opacity: 1, depthTest: false, depthWrite: false, toneMapped: false });
        const object = new THREE.Points(geometry, material);
        object.name = `terrain-section-points-${a.axis}`; object.renderOrder = 7; object.raycast = () => {};
        items.push({ object, geometry, material });
      }
    }
    if (probePosition) {
      const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(probePosition, 3));
      const material = new THREE.PointsMaterial({ color: '#713e9c', size: 13, sizeAttenuation: false, transparent: true, opacity: 1, depthTest: false, depthWrite: false, toneMapped: false });
      const object = new THREE.Points(geometry, material);
      object.name = 'terrain-section-probe'; object.renderOrder = 8; object.raycast = () => {};
      items.push({ object, geometry, material });
    }
    return items;
  }, [data, probePosition]);
  useEffect(() => () => { for (const r of resources) { r.geometry.dispose(); r.material.dispose(); } }, [resources]);
  return <group>{resources.map(r => <primitive key={r.object.uuid} object={r.object} dispose={null} />)}</group>;
}
