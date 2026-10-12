#!/usr/bin/env python3
"""Check saved pack hashes and 1D hydraulic balances offline; never solve or import."""
import argparse
import datetime
import hashlib
import json
import math
import os
from pathlib import Path
import zipfile

G = 9.80665
ENERGY_TOL = 1e-7
ABS_TOL = 1e-8
REL_TOL = 1e-8
MAX_BYTES = 65 * 1024 * 1024


def number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError('Expected a finite number')
    return value


def positive(value):
    value = number(value)
    if value <= 0:
        raise ValueError('Expected a positive number')
    return value


def geometry(section, depth):
    """Clip a ground polyline to the water plane and integrate segment trapezia."""
    depth = positive(depth)
    kind = section['kind']
    if kind == 'rectangle':
        w, bank = positive(section['width']), positive(section['bank_height'])
        points = [(0., bank), (0., 0.), (w, 0.), (w, bank)]
    elif kind == 'trapezoid':
        w, bank = positive(section['bottom_width']), positive(section['bank_height'])
        slope = number(section['side_slope'])
        if slope < 0:
            raise ValueError('Negative side slope')
        points = [(-slope * bank, bank), (0., 0.), (w, 0.), (w + slope * bank, bank)]
    elif kind == 'survey':
        points = [(number(p['x']), number(p['z'])) for p in section['points']]
        if len(points) < 3 or any(b[0] <= a[0] for a, b in zip(points, points[1:])):
            raise ValueError('Survey x must increase; at least three vertices required')
        if min(z for _, z in points) < 0 or abs(min(z for _, z in points)) > 1e-9:
            raise ValueError('Survey must use relative height with minimum zero')
    else:
        raise ValueError('Unsupported cross section')
    if depth >= min(points[0][1], points[-1][1]):
        raise ValueError('Water reaches or exceeds a bank')
    area = perimeter = width = 0.
    connected = False
    regions = 0
    for (xa, za), (xb, zb) in zip(points, points[1:]):
        if za >= depth and zb >= depth:
            connected = False
            continue
        if not connected:
            regions += 1
        left_depth, right_depth = max(depth - za, 0.), max(depth - zb, 0.)
        # Compute the wet fraction directly, avoiding 1 - (1 - epsilon).
        fraction = 1. if za < depth and zb < depth else max(left_depth, right_depth) / abs(zb - za)
        wet_width = (xb - xa) * fraction
        area += wet_width * (left_depth + right_depth) / 2
        perimeter += math.hypot(xb - xa, zb - za) * fraction
        width += wet_width
        connected = zb < depth
    if regions != 1:
        raise ValueError('Separated wetted regions are outside this audit')
    return positive(area), positive(perimeter), positive(width)


def hydraulics(section, depth, discharge, roughness):
    area, perimeter, width = geometry(section, depth)
    velocity = positive(discharge) / area
    friction = (positive(roughness) * velocity / (area / perimeter) ** (2 / 3)) ** 2
    froude = velocity / math.sqrt(G * area / width)
    return {'area': area, 'velocity': velocity, 'friction_slope': friction, 'froude': froude,
            'specific_energy': depth + velocity ** 2 / (2 * G)}


def check_profile(label, river, profile, engine):
    result = {'label': label, 'engine_version': engine, 'rows': 0, 'segments': 0,
              'max_energy_residual_m': 0., 'null_normal_depths': 0, 'issue_count': 0, 'first_issues': []}
    def issue(message):
        result['issue_count'] += 1
        if len(result['first_issues']) < 20:
            result['first_issues'].append(message)
    def compare(name, actual, expected, index):
        if not math.isclose(number(actual), number(expected), rel_tol=REL_TOL, abs_tol=ABS_TOL):
            issue(f'row {index}: {name} differs from recomputation')
    try:
        if engine != '0.2.0':
            raise ValueError('This auditor supports saved engine 0.2.0 only')
        stations, rows = river['stations'], profile['rows']
        if len(stations) < 2 or len(stations) != len(rows):
            raise ValueError('Station/result counts differ or fewer than two stations')
        regime = river['boundary']['regime']
        if regime not in ['subcritical', 'supercritical']:
            raise ValueError('Unknown flow regime')
        discharge, slope = positive(river['discharge']), positive(river['normal_slope'])
        computed = []
        for i, (station, row) in enumerate(zip(stations, rows)):
            result['rows'] += 1
            depth = positive(row['depth'])
            h = hydraulics(station['section'], depth, discharge, station['roughness'])
            compare('chainage', row['chainage'], station['chainage'], i)
            compare('bed_elevation', row['bed_elevation'], station['bed_elevation'], i)
            compare('water_elevation', row['water_elevation'], number(station['bed_elevation']) + depth, i)
            for field in ['area', 'velocity', 'friction_slope', 'froude']:
                compare(field, row[field], h[field], i)
            if not (h['froude'] < .98 if regime == 'subcritical' else h['froude'] > 1.02):
                issue(f'row {i}: regime inconsistent or near critical')
            critical = hydraulics(station['section'], positive(row['critical_depth']), discharge, station['roughness'])
            if abs(critical['froude'] - 1) > 1e-7:
                issue(f'row {i}: critical depth does not give Fr=1')
            if row['normal_depth'] is None:
                result['null_normal_depths'] += 1
            else:
                normal = hydraulics(station['section'], positive(row['normal_depth']), discharge, station['roughness'])
                if not math.isclose(normal['friction_slope'], slope, rel_tol=1e-7, abs_tol=1e-9):
                    issue(f'row {i}: normal depth does not match reference slope')
            computed.append(h)
        boundary = len(rows) - 1 if regime == 'subcritical' else 0
        compare('boundary depth', rows[boundary]['depth'], positive(river['boundary']['depth']), boundary)
        if abs(number(rows[boundary]['energy_residual'])) > ENERGY_TOL:
            issue('Boundary row residual is not zero')
        for i in range(len(stations) - 1):
            left, right = stations[i], stations[i + 1]
            dx = positive(number(right['chainage']) - number(left['chainage']))
            loss = .5 * (computed[i]['friction_slope'] + computed[i + 1]['friction_slope']) * dx
            residual = (number(left['bed_elevation']) - number(right['bed_elevation']) +
                        computed[i]['specific_energy'] - computed[i + 1]['specific_energy'] - loss)
            result['segments'] += 1
            result['max_energy_residual_m'] = max(result['max_energy_residual_m'], abs(residual))
            if abs(residual) > ENERGY_TOL:
                issue(f'segment {i}: energy balance exceeds {ENERGY_TOL} m')
            stored_index = i if regime == 'subcritical' else i + 1
            if abs(number(rows[stored_index]['energy_residual']) - residual) > ENERGY_TOL:
                issue(f'segment {i}: stored residual differs from recomputation')
    except (KeyError, TypeError, ValueError, OverflowError, ZeroDivisionError) as e:
        issue(str(e))
    result['passed'] = result['issue_count'] == 0
    return result


def decode(data):
    def invalid(value):
        raise ValueError('Nonfinite JSON number: ' + value)
    def floating(value):
        return number(float(value))
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('Duplicate JSON key')
            result[key] = value
        return result
    return json.loads(data, parse_constant=invalid, parse_float=floating, object_pairs_hook=unique)


def load_pack(path):
    allowed = {'manifest.json', 'conditions.json', 'README.txt', 'index.html'}
    allowed.update(f'{kind}.{ext}' for kind in ['construction', 'sensitivity', 'resolution'] for ext in ['json', 'csv', 'html'])
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        names = [f.filename for f in entries]
        if len(names) != len(set(names)) or not set(names).issubset(allowed):
            raise ValueError('Duplicate or unexpected ZIP entry')
        if not {'manifest.json', 'conditions.json', 'construction.json', 'construction.csv', 'construction.html', 'index.html', 'README.txt'}.issubset(names):
            raise ValueError('Required files missing')
        if any(e.flag_bits & 1 for e in entries) or sum(e.file_size for e in entries) > MAX_BYTES:
            raise ValueError('Encrypted or oversized ZIP')
        files = {}
        for entry in entries:
            with archive.open(entry) as stream:
                content = stream.read(MAX_BYTES + 1)
            if len(content) != entry.file_size or len(content) > MAX_BYTES:
                raise ValueError('Incorrect or excessive entry size')
            files[entry.filename] = content
    manifest = decode(files['manifest.json'])
    if manifest['format_version'] != 'doboku-review-pack-1':
        raise ValueError('Unsupported pack format')
    listed = [f['path'] for f in manifest['files']]
    if len(listed) != len(set(listed)) or set(listed) != set(files) - {'manifest.json'}:
        raise ValueError('Manifest file list differs from archive')
    for info in manifest['files']:
        data = files[info['path']]
        if len(data) != info['bytes'] or hashlib.sha256(data).hexdigest() != info['sha256']:
            raise ValueError('File size/hash mismatch: ' + info['path'])
    if hashlib.sha256(files['conditions.json']).hexdigest() != manifest['conditions_sha256']:
        raise ValueError('Conditions file hash differs')
    for kind in ['sensitivity', 'resolution']:
        if sum(f'{kind}.{ext}' in files for ext in ['json', 'csv', 'html']) not in [0, 3]:
            raise ValueError('Incomplete optional study')
    return manifest, files


def audit(path):
    report = {'format': 'doboku-review-audit-1', 'audited_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'integrity_passed': False, 'profiles': [], 'failed_cases': [], 'errors': [],
              'tolerances': {'absolute': ABS_TOL, 'relative': REL_TOL, 'energy_m': ENERGY_TOL, 'g_m_s2': G,
                             'critical_fr_absolute': 1e-7, 'normal_slope_absolute': 1e-9, 'normal_slope_relative': 1e-7},
              'limits': ['Hashes are identifiers, not signatures or authentication of the original survey.',
                         'Hydraulic checks use saved JSON in SI. CSV/HTML bytes are hashed, not numerically parsed.',
                         'Balance consistency is not an independent water-surface solution, field calibration, error bound or design approval.',
                         'Case difference summaries, excavation volumes, critical-root uniqueness, original survey metadata and hosted CI are not verified.',
                         'baseline_profile_sha256 is not re-encoded; saved baseline objects are compared directly.']}
    try:
        with Path(path).open('rb') as stream:
            before = os.fstat(stream.fileno())
            report['zip_sha256'] = hashlib.file_digest(stream, 'sha256').hexdigest()
            stream.seek(0)
            manifest, files = load_pack(stream)
            after = os.fstat(stream.fileno())
            if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                raise ValueError('Pack changed during inspection')
        report['files_verified'] = len(files)
        conditions = decode(files['conditions.json'])
        stored = decode(files['construction.json'])
        base = stored['analysis']
        project = base['project']
        if conditions != {'river': project['river'], 'reference': project['reference']} or base['run']['river'] != project['river']:
            raise ValueError('Construction conditions differ from conditions.json')
        records = {r['kind']: r for r in manifest['records']}
        expected = {'construction'} | {kind for kind in ['sensitivity', 'resolution'] if f'{kind}.json' in files}
        if len(records) != len(manifest['records']) or set(records) != expected:
            raise ValueError('Manifest record kinds differ from files')
        selection = manifest['selection']
        def record(kind, id_value, engine, executed, case_count, failed_count):
            r = records[kind]
            selection_key = 'run_id' if kind == 'construction' else kind + '_id'
            if any(type(v) is not int or v <= 0 for v in [id_value, r['id'], selection[selection_key]]):
                raise ValueError('Record ID is not a positive integer')
            if (r['id'], r['engine_version'], r['executed_at'], r['case_count'], r['failed_count']) != (id_value, engine, executed, case_count, failed_count) or selection[selection_key] != id_value:
                raise ValueError('Record metadata differs: ' + kind)
        def profile(label, river, rows, engine):
            report['profiles'].append(check_profile(label, river, rows, engine))
        def baseline(other_project, other_rows, engine):
            if other_project['id'] != project['id'] or other_project['river'] != project['river'] or other_project['reference'] != project['reference'] or other_rows != base['run']['profile'] or engine != base['run']['engine_version']:
                raise ValueError('Study baseline differs from construction')
        record('construction', stored['id'], base['run']['engine_version'], base['run']['executed_at'], len(base['comparisons']), 0)
        profile('construction/baseline', base['run']['river'], base['run']['profile'], base['run']['engine_version'])
        for i, comparison in enumerate(base['comparisons']):
            profile(f'construction/case/{i}', comparison['river'], comparison['profile'], base['run']['engine_version'])
        for kind in ['sensitivity', 'resolution']:
            if f'{kind}.json' not in files:
                if selection.get(kind + '_id') is not None:
                    raise ValueError('Selected study is missing')
                continue
            saved = decode(files[f'{kind}.json'])
            comparison = saved['comparison']
            if kind == 'sensitivity':
                run = comparison['baseline']
                river, rows, engine, executed = run['river'], run['profile'], run['engine_version'], run['executed_at']
                cases = comparison['cases']
                if river != comparison['project']['river']:
                    raise ValueError('Sensitivity baseline river differs')
            else:
                river, rows = comparison['project']['river'], comparison['study']['baseline']
                engine, executed, cases = comparison['engine_version'], comparison['executed_at'], comparison['study']['cases']
            baseline(comparison['project'], rows, engine)
            record(kind, saved['id'], engine, executed, len(cases), sum(c['status'] == 'failed' for c in cases))
            profile(kind + '/baseline', river, rows, engine)
            for i, case in enumerate(cases):
                label = f'{kind}/case/{i}'
                if case['status'] == 'failed':
                    allowed_failure = {'status', 'error', 'change' if kind == 'sensitivity' else 'subdivisions'}
                    if set(case) != allowed_failure or not isinstance(case['error'], str) or not case['error']:
                        raise ValueError('Failure has missing diagnostic or invented numeric result')
                    report['failed_cases'].append({'label': label, 'error': case['error']})
                elif case['status'] == 'ok':
                    run = case['run'] if kind == 'sensitivity' else case
                    profile(label, run['river'], run['profile'], run.get('engine_version', engine))
                else:
                    raise ValueError('Unknown case status')
        if manifest['project_id'] != project['id'] or manifest['reference'] != project['reference']:
            raise ValueError('Manifest project/reference differs')
        if (manifest['project_name'], manifest['discharge_m3_s'], manifest['station_count'],
            manifest['scenario_count'], manifest['staged']) != (project['name'], project['river']['discharge'],
            len(project['river']['stations']), len(base['comparisons']), base['staged']):
            raise ValueError('Manifest summary differs from saved construction')
        report['integrity_passed'] = True
        report['selection'] = selection
    except (OSError, zipfile.BadZipFile, KeyError, TypeError, ValueError, OverflowError, NotImplementedError) as e:
        report['errors'].append(str(e))
    report['passed'] = report['integrity_passed'] and bool(report['profiles']) and all(p['passed'] for p in report['profiles'])
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pack', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path, help='New JSON file; never overwrite')
    args = parser.parse_args()
    if args.output.exists():
        parser.error('output already exists')
    report = audit(args.pack)
    try:
        with args.output.open('x', encoding='utf-8') as stream:
            stream.write(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + '\n')
    except (OSError, ValueError) as e:
        parser.error(str(e))
    print(json.dumps({'passed': report['passed'], 'integrity_passed': report['integrity_passed'],
                      'profiles': len(report['profiles']), 'failed_cases_retained': len(report['failed_cases']),
                      'report': str(args.output)}))
    return 0 if report['passed'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
