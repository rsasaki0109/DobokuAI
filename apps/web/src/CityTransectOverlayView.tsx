import CitySectionOverlayView from './CitySectionOverlayView';
import type { TransectOverlay } from './cityTransectSpatial';
import { useMemo } from 'react';

export default function CityTransectOverlayView({ data, probePosition }: { data: TransectOverlay; probePosition: [number, number, number] | null }) {
  // Renderer adapter only: all 3D vertices already use the original coordinates.
  const adapted = useMemo(() => ({ axes: [{ ...data, axis: 'east_west' as const }], bounds: data.bounds }), [data]);
  return <CitySectionOverlayView data={adapted} probePosition={probePosition} />;
}
