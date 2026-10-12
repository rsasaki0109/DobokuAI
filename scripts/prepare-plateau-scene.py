#!/usr/bin/env python3
"""Extract whole LOD1 building members and unchanged terrain triangles for display."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET
import urllib.request

G = '{http://www.opengis.net/gml}'
C = '{http://www.opengis.net/citygml/2.0}'
B = '{http://www.opengis.net/citygml/building/2.0}'
D = '{http://www.opengis.net/citygml/relief/2.0}'
BOX = [35.4527, 139.6289, 35.4567, 139.6339]
TERRAIN_BOX = BOX
SRS = 'http://www.opengis.net/def/crs/EPSG/0/6697'
SOURCE = 'https://assets.cms.plateau.reearth.io/assets/04/96d45a-a30b-4c9f-88c0-c1323b5a0f86/14100_yokohama-shi_city_2024_citygml_2_op/udx/'
PINS = {
    'buildings': 'f9906d114834bb58b316b583cb91725da76fbf5b4839ab06aed55aa6720b3202',
    'terrain': '421f2e5b24877718295fbe26df523b38e336fc3b3a4af4fff5cd5c9407f14193',
    'metadata': 'e638f32e7b6a7bef81b719fb5da02fcb55257ae6549c4e53abcf8b2171060856',
}

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

def points(element):
    result = []
    for pos in element.iter(G + 'posList'):
        values = list(map(float, pos.text.split()))
        assert len(values) % 3 == 0
        result.extend(tuple(values[i:i + 3]) for i in range(0, len(values), 3))
    return result

def model():
    return ET.Element(C + 'CityModel', {'srsName': SRS, 'srsDimension': '3'})

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--buildings', type=Path, required=True)
    terrain_input = parser.add_mutually_exclusive_group(required=True)
    terrain_input.add_argument('--terrain', type=Path)
    terrain_input.add_argument('--stream-terrain', action='store_true')
    parser.add_argument('--metadata', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    assert digest(args.buildings) == PINS['buildings'], 'Original building file hash mismatch'
    assert digest(args.metadata) == PINS['metadata'], 'Original metadata hash mismatch'
    meta = ET.parse(args.metadata).getroot()
    assert any(e.tag.split('}')[-1] == 'useLimitation' and (e.text or '').strip() == 'Licensed under CC BY 4.0' for e in meta.iter()), 'Dataset licence declaration missing'
    original = ET.parse(args.buildings).getroot()
    assert next(original.iter(G + 'Envelope')).get('srsName') == SRS
    selected = model()
    selected_ids, excluded = [], []
    for member in original.findall(C + 'cityObjectMember'):
        geometry = [p for solid in member.iter(B + 'lod1Solid') for p in points(solid)]
        if not geometry:
            continue
        if not (min(p[0] for p in geometry) <= BOX[2] and max(p[0] for p in geometry) >= BOX[0] and min(p[1] for p in geometry) <= BOX[3] and max(p[1] for p in geometry) >= BOX[1]):
            continue
        member_id = member[0].get(G + 'id')
        candidate = copy.deepcopy(member)
        for parent in list(candidate.iter()):
            for child in list(parent):
                name = child.tag.split('}')[-1]
                if name.startswith(('lod0', 'lod2', 'lod3', 'lod4')) or name == 'Appearance':
                    parent.remove(child)
        reason = None
        for polygon in candidate.iter(G + 'Polygon'):
            if any(True for _ in polygon.iter(G + 'interior')):
                reason = 'LOD1 contains polygon holes unsupported by viewer'
            if any(len((p.text or '').split()) // 3 > 129 for p in polygon.iter(G + 'posList')):
                reason = 'LOD1 ring exceeds viewer 128-vertex limit'
        if reason:
            excluded.append({'id': member_id, 'reason': reason})
            continue
        selected.append(candidate)
        selected_ids.append(member_id)
    assert selected_ids, 'No buildings in requested area'
    terrain = model()
    feature = ET.SubElement(ET.SubElement(terrain, C + 'cityObjectMember'), D + 'ReliefFeature', {G + 'id': 'yokohama-terrain-subset'})
    ET.SubElement(feature, D + 'lod').text = '1'
    tin = ET.SubElement(ET.SubElement(feature, D + 'reliefComponent'), D + 'TINRelief', {G + 'id': 'yokohama-tin-subset'})
    ET.SubElement(tin, D + 'lod').text = '1'
    patches = ET.SubElement(ET.SubElement(ET.SubElement(tin, D + 'tin'), G + 'TriangulatedSurface'), G + 'trianglePatches')
    triangle_count = 0
    terrain_url = SOURCE + 'dem/533915_dem_6697_00_op.gml'
    terrain_digest = hashlib.sha256(); terrain_bytes = 0
    stream = urllib.request.urlopen(urllib.request.Request(terrain_url, headers={'User-Agent': 'DobokuAI-data-extraction'}), timeout=40) if args.stream_terrain else args.terrain.open('rb')
    xml = ET.XMLPullParser(events=['start', 'end']); stack = []
    with stream:
        while True:
            chunk = stream.read(65536)
            if not chunk: break
            terrain_bytes += len(chunk)
            if terrain_bytes > 1024 * 1024 * 1024: raise RuntimeError('Streaming source exceeds 1GiB network limit; no original file is saved')
            terrain_digest.update(chunk); xml.feed(chunk)
            for event, element in xml.read_events():
                if event == 'start': stack.append(element); continue
                if element.tag == G + 'Envelope':
                    assert element.get('srsName') == SRS
                    low = list(map(float, element.findtext(G + 'lowerCorner').split()))
                    high = list(map(float, element.findtext(G + 'upperCorner').split()))
                    assert low[0] <= TERRAIN_BOX[0] <= TERRAIN_BOX[2] <= high[0] and low[1] <= TERRAIN_BOX[1] <= TERRAIN_BOX[3] <= high[1], 'Source envelope does not contain selected terrain area'
                    print(json.dumps({'source_envelope': [low, high]}), flush=True)
                if element.tag == G + 'Triangle':
                    vertices = points(element)
                    if vertices and all(TERRAIN_BOX[0] <= p[0] <= TERRAIN_BOX[2] and TERRAIN_BOX[1] <= p[1] <= TERRAIN_BOX[3] for p in vertices):
                        patches.append(copy.deepcopy(element)); triangle_count += 1
                        if triangle_count >= 16000: raise RuntimeError('Selected terrain exceeds bounded display budget; no resampling performed')
                    stack[-2].remove(element); element.clear()
                stack.pop()
    xml.close()
    assert terrain_digest.hexdigest() == PINS['terrain'], 'Original terrain stream hash mismatch'
    assert 0 < triangle_count < 16000, 'Terrain count exceeds display budget or is empty'
    args.output.mkdir(parents=True, exist_ok=True)
    records = []
    for name, tree in [('buildings.gml', selected), ('terrain.gml', terrain)]:
        path = args.output / name
        ET.ElementTree(tree).write(path, encoding='utf-8', xml_declaration=True)
        assert path.stat().st_size < 8 * 1024 * 1024, 'Subset exceeds importer limit'
        records.append({'name': name, 'bytes': path.stat().st_size, 'sha256': digest(path)})
    manifest = {
        'dataset_id': 'plateau-yokohama-2024-minatomirai', 'title': '横浜・みなとみらい（PLATEAU 2024）',
        'data_kind': 'public_city_model', 'license': 'CC BY 4.0', 'license_url': 'https://creativecommons.org/licenses/by/4.0/',
        'attribution': '出典：国土交通省 Project PLATEAU（横浜市2024年度）。表示用に加工して作成',
        'source_url': 'https://api.plateauview.mlit.go.jp/datacatalog/citygml/r:139.6314,35.4547?types=bldg',
        'processing': '指定矩形と交差する建物を丸ごと選択しLOD1以外・テクスチャを除外。対応外の建物はIDと理由を記録。地形は指定矩形内に全頂点がある原Triangleを抽出。座標の変更・補間・平滑化なし。表示用抜粋で完全な市街地モデルではありません。',
        'selection_bbox_lat_lon': BOX, 'terrain_bbox_lat_lon': TERRAIN_BOX, 'building_ids': selected_ids, 'excluded_buildings': excluded,
        'terrain_triangles': triangle_count, 'crs': 'EPSG:6697', 'files': records,
        'original_sources': [
            {'kind': 'buildings', 'url': SOURCE + 'bldg/53391540_bldg_6697_op.gml', 'bytes': args.buildings.stat().st_size, 'sha256': digest(args.buildings)},
            {'kind': 'terrain', 'url': terrain_url, 'bytes': terrain_bytes, 'sha256': terrain_digest.hexdigest()},
            {'kind': 'metadata', 'url': 'https://assets.cms.plateau.reearth.io/assets/fe/6feefc-3312-4aa2-83ee-ebaaaa248684/14100_yokohama-shi_city_2024_citygml_2_op_metadata.zip', 'member': 'metadata/udx_14100_city_2024_op.xml', 'bytes': args.metadata.stat().st_size, 'sha256': digest(args.metadata)},
        ],
    }
    (args.output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'buildings': len(selected_ids), 'excluded_buildings': len(excluded), 'terrain_triangles': triangle_count, 'files': records}, ensure_ascii=False))

if __name__ == '__main__':
    main()
