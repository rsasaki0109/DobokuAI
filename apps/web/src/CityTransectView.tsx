import CitySectionsView from './CitySectionsView';
import type { TerrainTransect } from './cityTransect';
import { probeTerrainTransect } from './cityTransectSpatial';

export default function CityTransectView({ transect, expanded = false, distance, onSelect }: { transect: TerrainTransect; expanded?: boolean; distance?: number; onSelect?: (distance: number | null) => void }) {
  // The cardinal axis is only a renderer adapter, never exported or sent to
  // the earthwork/hydraulic tools. Those require different reviewed inputs.
  return <CitySectionsView sections={[{ ...transect.profile, axis: 'east_west' }]} expanded={expanded}
    selection={distance === undefined ? null : { axis: 'east_west', distance }} onSelect={onSelect ? s => onSelect(s?.distance ?? null) : undefined}
    probeAt={(_section, d) => { const p = probeTerrainTransect(transect, d); return p ? { ...p, axis: 'east_west' } : null; }}
    names={{ east_west: '指定線', south_north: '指定線' }} directions={{ east_west: '始点 → 終点', south_north: '始点 → 終点' }} context="確認済み指定線" />;
}
