import CitySectionsView from './CitySectionsView';
import type { TerrainTransect } from './cityTransect';

export default function CityTransectView({ transect, expanded = false }: { transect: TerrainTransect; expanded?: boolean }) {
  // The cardinal axis is only a renderer adapter, never exported or sent to
  // the earthwork/hydraulic tools. Those require different reviewed inputs.
  return <CitySectionsView sections={[{ ...transect.profile, axis: 'east_west' }]} expanded={expanded}
    names={{ east_west: '指定線', south_north: '指定線' }} directions={{ east_west: '始点 → 終点', south_north: '始点 → 終点' }} context="確認済み指定線" />;
}
