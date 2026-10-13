#!/usr/bin/env python3
"""Inventory supplied HEC-RAS ASCII inputs without importing or calculating them."""
import argparse
import collections
import datetime
import hashlib
import json
import math
from pathlib import Path
import re

MAX_BYTES = 8 * 1024 * 1024
MAX_RECORDS = 2000
MAX_POINTS = 5000


def read_source(path):
    path = Path(path)
    with path.open('rb') as stream:
        data = stream.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError('Each source must be at most 8 MiB')
    try:
        text = data.decode('utf-8-sig')
    except UnicodeError as error:
        raise ValueError('Source must be ASCII or UTF-8; no automatic encoding conversion') from error
    return text.splitlines(), {'file_name': path.name, 'bytes': len(data),
                              'sha256': hashlib.sha256(data).hexdigest()}


def finite(value):
    number = float(value)
    if not math.isfinite(number):
        raise ValueError('Nonfinite number')
    return number


def inspect(project, geometry, flow):
    sources = {}
    issues = []
    issue_count = 0

    def issue(file, line, code):
        nonlocal issue_count
        issue_count += 1
        if len(issues) < 40:
            issues.append({'file': file, 'line': line, 'code': code})

    def structural_lines(path, role):
        lines, sources[role] = read_source(path)
        active = []
        description = False
        for index, line in enumerate(lines, 1):
            if line == 'BEGIN DESCRIPTION:':
                if description:
                    issue(role, index, 'nested_description')
                description = True
            elif line == 'END DESCRIPTION:':
                if not description:
                    issue(role, index, 'unmatched_description_end')
                description = False
            elif not description:
                active.append((index, line))
        if description:
            issue(role, len(lines), 'unterminated_description')
        return active

    proj = structural_lines(project, 'project')
    geom = structural_lines(geometry, 'geometry')
    flows = structural_lines(flow, 'flow')

    def values(lines, key):
        return [(index, line[len(key):].strip()) for index, line in lines if line.startswith(key)]

    unit_lines = [line for _, line in proj if line in ('English Units', 'SI Units')]
    if len(unit_lines) != 1:
        issue('project', None, 'missing_or_duplicate_unit_declaration')
    for role, path, key in [('geometry', geometry, 'Geom File='), ('flow', flow, 'Flow File=')]:
        references = [value.casefold() for _, value in values(proj, key)]
        if (Path(path).stem.casefold() != Path(project).stem.casefold() or
                Path(path).suffix.lstrip('.').casefold() not in references):
            issue('project', None, 'supplied_' + role + '_not_listed_in_project')

    def table(lines, start, count, fields, per_line, role):
        rows = []
        index = start + 1
        while len(rows) < count:
            if index >= len(lines) or not lines[index][1].strip() or '=' in lines[index][1]:
                issue(role, lines[start][0], 'incomplete_fixed_width_table')
                return rows, index
            line_number, raw = lines[index]
            expected = min(per_line, count - len(rows)) * fields
            # Preserve leading blanks: each native numeric field occupies eight columns.
            if len(raw) < expected * 8 or raw[expected * 8:].strip():
                issue(role, line_number, 'fixed_width_field_count_mismatch')
                return rows, index + 1
            try:
                numbers = [finite(raw[i * 8:(i + 1) * 8].strip()) for i in range(expected)]
            except (ValueError, OverflowError):
                issue(role, line_number, 'invalid_or_nonfinite_fixed_width_number')
                return rows, index + 1
            rows.extend([numbers[i:i + fields] for i in range(0, expected, fields)])
            index += 1
        if index < len(lines) and lines[index][1].strip() and '=' not in lines[index][1]:
            try:
                finite(lines[index][1][:8].strip())
            except (ValueError, OverflowError):
                pass
            else:
                issue(role, lines[index][0], 'extra_fixed_width_table_row')
        return rows, index

    sections = []
    record_types = collections.Counter()
    junction_count = len(values(geom, 'Junct Name='))
    reach = None
    current = None
    index = 0
    while index < len(geom):
        line_number, line = geom[index]
        if line.startswith('River Reach='):
            parts = line.split('=', 1)[1].split(',')
            reach = tuple(part.strip() for part in parts) if len(parts) == 2 and all(part.strip() for part in parts) else None
            if reach is None:
                issue('geometry', line_number, 'invalid_reach_identity')
            current = None
        elif line.startswith('Type RM Length L Ch R ='):
            if sum(record_types.values()) >= MAX_RECORDS:
                raise ValueError('At most 2000 geometry records are supported for inventory')
            parts = [v.strip() for v in line.split('=', 1)[1].split(',')]
            current = None
            if len(parts) != 5 or not parts[0].isdigit() or not parts[1] or reach is None:
                issue('geometry', line_number, 'invalid_geometry_record_identity')
            else:
                record_types[parts[0]] += 1
                if parts[0] == '1':
                    current = {'river': reach[0], 'reach': reach[1], 'station_label': parts[1],
                               'line': line_number, 'native_downstream_lengths': [],
                               'point_count': 0, 'point_table_headers': 0, 'vertical_edges': 0,
                               'native_station_bounds': None, 'native_elevation_bounds': None,
                               'coefficient_record_count': 0, 'distinct_native_coefficients': [],
                               'coefficient_table_headers': 0, 'ineffective_area_headers': 0}
                    for value in parts[2:]:
                        try:
                            length = finite(value)
                            if length < 0:
                                raise ValueError('negative length')
                            current['native_downstream_lengths'].append(length)
                        except (ValueError, OverflowError):
                            issue('geometry', line_number, 'missing_or_invalid_reach_length')
                            current['native_downstream_lengths'].append(None)
                    sections.append(current)
        elif current is not None and (line.startswith('#Sta/Elev=') or line.startswith('#Mann=')):
            is_points = line.startswith('#Sta/Elev=')
            key = 'point_table_headers' if is_points else 'coefficient_table_headers'
            current[key] += 1
            if current[key] > 1:
                issue('geometry', line_number, 'duplicate_' + key)
            try:
                raw_count = line.split('=', 1)[1].split(',')[0].strip()
                if not re.fullmatch(r'\d+', raw_count):
                    raise ValueError('not an integer count')
                count = int(raw_count)
                if not 1 <= count <= MAX_POINTS:
                    raise ValueError('out of range')
            except ValueError:
                issue('geometry', line_number, 'invalid_table_count')
                index += 1
                continue
            rows, index = table(geom, index, count, 2 if is_points else 3, 5 if is_points else 3, 'geometry')
            if is_points:
                current['point_count'] = len(rows)
                if rows:
                    current['native_station_bounds'] = [min(r[0] for r in rows), max(r[0] for r in rows)]
                    current['native_elevation_bounds'] = [min(r[1] for r in rows), max(r[1] for r in rows)]
                if len(rows) < 2:
                    issue('geometry', line_number, 'insufficient_section_points')
                if any(b[0] < a[0] for a, b in zip(rows, rows[1:])):
                    issue('geometry', line_number, 'section_stations_decrease')
                current['vertical_edges'] = sum(a[0] == b[0] for a, b in zip(rows, rows[1:]))
            else:
                current['coefficient_record_count'] = len(rows)
                current['distinct_native_coefficients'] = sorted({r[1] for r in rows})
                if any(r[1] < 0 for r in rows):
                    issue('geometry', line_number, 'negative_native_coefficient')
            continue
        elif current is not None and line.startswith('#XS Ineff='):
            current['ineffective_area_headers'] += 1
        index += 1

    identities = collections.Counter((s['river'], s['reach'], s['station_label']) for s in sections)
    for section in sections:
        if section['point_table_headers'] != 1 or section['coefficient_table_headers'] != 1:
            issue('geometry', section['line'], 'missing_section_table')
        if identities[(section['river'], section['reach'], section['station_label'])] != 1:
            issue('geometry', section['line'], 'duplicate_section_identity')
    if not sections:
        issue('geometry', None, 'no_cross_sections')

    profile_counts = values(flows, 'Number of Profiles=')
    profile_count = None
    if len(profile_counts) == 1 and re.fullmatch(r'\d+', profile_counts[0][1]):
        profile_count = int(profile_counts[0][1])
    if profile_count is None or not 1 <= profile_count <= 50:
        issue('flow', None, 'invalid_profile_count')
        profile_count = None
    flow_locations = []
    observations = []
    for index, (line_number, line) in enumerate(flows):
        if line.startswith('River Rch & RM='):
            parts = [s.strip() for s in line.split('=', 1)[1].split(',')]
            if len(parts) != 3 or not all(parts):
                issue('flow', line_number, 'invalid_flow_location')
                continue
            entry = {'river': parts[0], 'reach': parts[1], 'station_label': parts[2],
                     'line': line_number, 'native_profile_flows': [],
                     'matching_geometry_sections': identities[tuple(parts)]}
            if profile_count:
                rows, _ = table(flows, index, profile_count, 1, 10, 'flow')
                entry['native_profile_flows'] = [r[0] for r in rows]
                if any(r[0] <= 0 for r in rows):
                    issue('flow', line_number, 'nonpositive_flow')
            flow_locations.append(entry)
        elif line.startswith('Observed WS='):
            parts = [s.strip() for s in line.split('=', 1)[1].split(',')]
            if profile_count is None or len(parts) != 4 + profile_count or not all(parts[:3]):
                issue('flow', line_number, 'invalid_observed_column_count_or_identity')
                continue
            try:
                distance = finite(parts[3])
                if distance < 0:
                    raise ValueError('negative distance')
                levels = [finite(v) if v else None for v in parts[4:]]
            except (ValueError, OverflowError):
                issue('flow', line_number, 'invalid_or_nonfinite_observed_number')
                continue
            matches = identities[(parts[0], parts[1], parts[2])]
            state = ('missing_section' if matches == 0 else 'ambiguous_section' if matches > 1 else
                     'at_section' if distance == 0 else 'downstream_offset_requires_review')
            observations.append({'river': parts[0], 'reach': parts[1], 'station_label': parts[2],
                                 'line': line_number, 'native_downstream_distance': distance,
                                 'native_water_levels': levels, 'location_status': state})
    if not flow_locations:
        issue('flow', None, 'no_profile_flows')

    limitations = ['data_usage_terms_and_original_survey_metadata_require_review',
                   'common_vertical_reference_and_unit_realization_require_review',
                   'full_HEC_RAS_semantics_and_remaining_geometry_options_not_checked']
    if junction_count:
        limitations.append('junctions_present')
    if any(k != '1' for k in record_types):
        limitations.append('non_cross_section_geometry_records_present')
    if len(flow_locations) > 1:
        limitations.append('multiple_flow_locations_require_review')
    if any(f['matching_geometry_sections'] != 1 for f in flow_locations):
        limitations.append('flow_location_identity_requires_review')
    if any(len(s['distinct_native_coefficients']) > 1 for s in sections):
        limitations.append('transverse_coefficient_variation_present')
    if any(s['ineffective_area_headers'] for s in sections):
        limitations.append('ineffective_flow_area_headers_present')
    if any(s['vertical_edges'] for s in sections):
        limitations.append('repeated_section_stations_require_review')
    if any(o['location_status'] != 'at_section' for o in observations):
        limitations.append('observed_locations_require_review')
    return {'format': 'doboku-hec-ras-inspection-1',
            'inspected_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'sources': sources, 'native_unit_declarations': unit_lines,
            'native_datum_fields': [line for _, line in geom if line.startswith(('GIS Datum=', 'GIS Vertical Datum='))],
            'geometry_record_types': dict(record_types), 'junctions': junction_count,
            'sections': sections, 'profile_count': profile_count,
            'flow_locations': flow_locations, 'observations': observations,
            'observation_location_counts': dict(collections.Counter(o['location_status'] for o in observations)),
            'inventory_complete': issue_count == 0, 'issue_count': issue_count, 'first_issues': issues,
            'requires_review': limitations, 'solver_input_generated': False, 'dataset_adopted': False,
            'scope': 'Selected ASCII records only. No conversion, correction, sorting, observation interpolation, hydraulic solve, calibration, import or adoption.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('project', 'geometry', 'flow', 'output'):
        parser.add_argument('--' + name, required=True, type=Path)
    args = parser.parse_args()
    if args.output.exists():
        parser.error('output already exists; choose a new report file')
    try:
        report = inspect(args.project, args.geometry, args.flow)
        with args.output.open('x', encoding='utf-8') as stream:
            stream.write(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + '\n')
    except (OSError, ValueError) as error:
        parser.error(str(error))
    print(json.dumps({'report': str(args.output), 'inventory_complete': report['inventory_complete'],
                      'sections': len(report['sections']), 'issue_count': report['issue_count'],
                      'dataset_adopted': False}))
    return 0 if report['inventory_complete'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
