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


def inspect(project, geometry, flow, plan=None):
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
                               'coefficient_table_headers': 0, 'native_coefficient_headers': [],
                               'native_coefficient_tables': [], 'ineffective_area_headers': 0}
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
            if not is_points:
                raw_header = line.split('=', 1)[1]
                current['native_coefficient_headers'].append({
                    'line': line_number, 'raw_value': raw_header,
                    'fields': [value.strip() for value in raw_header.split(',')]})
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
                current['native_coefficient_tables'].append({'header_line': line_number, 'rows': rows})
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
    profile_name_fields = values(flows, 'Profile Names=')
    profile_names = None
    if len(profile_name_fields) > 1:
        issue('flow', profile_name_fields[1][0], 'duplicate_profile_names')
    elif len(profile_name_fields) == 1:
        profile_names = [name.strip() for name in profile_name_fields[0][1].split(',')]
        if profile_count is None or len(profile_names) != profile_count or not all(profile_names):
            issue('flow', profile_name_fields[0][0], 'profile_name_count_mismatch')
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

    boundaries = []
    current_boundary = None
    boundary_fields = ('Up Type', 'Dn Type', 'Up Slope', 'Dn Slope', 'Up Known WS', 'Dn Known WS')
    unassociated_boundary_fields = []
    for line_number, line in flows:
        if line.startswith('Boundary for River Rch & Prof#='):
            current_boundary = None
            parts = [s.strip() for s in line.split('=', 1)[1].split(',')]
            if (len(parts) != 3 or not all(parts[:2]) or not re.fullmatch(r'[0-9]{1,3}', parts[2]) or
                    profile_count is None or not 1 <= int(parts[2]) <= profile_count):
                issue('flow', line_number, 'invalid_boundary_identity')
                continue
            current_boundary = {'river': parts[0], 'reach': parts[1], 'profile_index': int(parts[2]),
                                'line': line_number, 'native_fields': {}, 'duplicate_native_fields': [],
                                'uninterpreted_fields': []}
            boundaries.append(current_boundary)
        elif line.startswith(('River Rch & RM=', 'Observed WS=', 'Number of Profiles=')):
            current_boundary = None
        elif any(line.startswith(key + '=') for key in boundary_fields):
            if current_boundary is None:
                issue('flow', line_number, 'boundary_field_without_identity')
                continue
            key, raw = line.split('=', 1)
            try:
                if key.endswith('Type'):
                    if not re.fullmatch(r'\d{1,3}', raw.strip()):
                        raise ValueError('Type must be a nonnegative integer code')
                    value = int(raw)
                else:
                    value = finite(raw.strip())
            except (ValueError, OverflowError):
                issue('flow', line_number, 'invalid_or_nonfinite_boundary_field')
                continue
            if key in current_boundary['native_fields']:
                issue('flow', line_number, 'duplicate_boundary_field')
                current_boundary['duplicate_native_fields'].append({'key': key, 'value': value, 'line': line_number})
            else:
                current_boundary['native_fields'][key] = value
        elif line.startswith(('Up ', 'Dn ')) and '=' in line:
            key, raw = line.split('=', 1)
            entry = {'line': line_number, 'key': key, 'raw_value': raw}
            if current_boundary is None:
                unassociated_boundary_fields.append(entry)
            else:
                current_boundary['uninterpreted_fields'].append(entry)
    boundary_identities = collections.Counter((b['river'], b['reach'], b['profile_index']) for b in boundaries)
    for boundary in boundaries:
        if boundary_identities[(boundary['river'], boundary['reach'], boundary['profile_index'])] != 1:
            issue('flow', boundary['line'], 'duplicate_boundary_identity')
        if not all(key in boundary['native_fields'] for key in ('Up Type', 'Dn Type')):
            issue('flow', boundary['line'], 'missing_boundary_type')

    plan_inventory = None
    if plan is not None:
        plans = structural_lines(plan, 'plan')
        if (Path(plan).stem.casefold() != Path(project).stem.casefold() or
                Path(plan).suffix.lstrip('.').casefold() not in [v.casefold() for _, v in values(proj, 'Plan File=')]):
            issue('project', None, 'supplied_plan_not_listed_in_project')
        for role, path, key in [('geometry', geometry, 'Geom File='), ('flow', flow, 'Flow File=')]:
            references = values(plans, key)
            if len(references) != 1 or references[0][1].casefold() != Path(path).suffix.lstrip('.').casefold():
                issue('plan', None, 'plan_' + role + '_reference_mismatch')
        regimes = [line for _, line in plans if line in ('Subcritical Flow', 'Supercritical Flow', 'Mixed Flow')]
        if len(regimes) != 1:
            issue('plan', None, 'missing_or_conflicting_plan_regime')
        settings = {}
        for key in ('Std Step Tol', 'Critical Tol', 'Max Error Tol', 'Num of Std Step Trials'):
            declarations = values(plans, key + '=')
            if len(declarations) > 1:
                issue('plan', declarations[1][0], 'duplicate_plan_setting')
            if len(declarations) == 1:
                try:
                    value = finite(declarations[0][1])
                    if value < 0 or (key == 'Num of Std Step Trials' and (value < 1 or not value.is_integer())):
                        raise ValueError('Invalid numerical setting')
                    settings[key] = value
                except (ValueError, OverflowError):
                    issue('plan', declarations[0][0], 'invalid_or_nonfinite_plan_setting')
        plan_inventory = {'native_flow_regime_declarations': regimes, 'native_solver_settings': settings,
                          'native_geometry_references': [v for _, v in values(plans, 'Geom File=')],
                          'native_flow_references': [v for _, v in values(plans, 'Flow File=')],
                          'native_program_versions': [v for _, v in values(plans, 'Program Version=')],
                          'is_project_current_plan': [v.casefold() for _, v in values(proj, 'Current Plan=')] ==
                                                     [Path(plan).suffix.lstrip('.').casefold()]}

    limitations = ['data_usage_terms_and_original_survey_metadata_require_review',
                   'common_vertical_reference_and_unit_realization_require_review',
                   'full_HEC_RAS_semantics_and_remaining_geometry_options_not_checked']
    if not boundaries:
        limitations.append('boundary_conditions_not_supplied')
    else:
        limitations.append('native_boundary_codes_and_fields_require_review')
        reaches = {(s['river'], s['reach']) for s in sections}
        if any((b['river'], b['reach']) not in reaches for b in boundaries):
            limitations.append('boundary_reach_identity_requires_review')
        expected_boundaries = {(river, reach, profile) for river, reach in reaches
                               for profile in range(1, (profile_count or 0) + 1)}
        if set(boundary_identities) != expected_boundaries:
            limitations.append('boundary_profile_coverage_requires_review')
    if unassociated_boundary_fields or any(b['uninterpreted_fields'] for b in boundaries):
        limitations.append('uninterpreted_boundary_fields_present')
    if plan is None:
        limitations.append('plan_not_supplied')
    else:
        limitations.append('native_plan_solver_settings_require_review')
        if 'Mixed Flow' in plan_inventory['native_flow_regime_declarations']:
            limitations.append('mixed_flow_plan_outside_current_solver_scope')
    if junction_count:
        limitations.append('junctions_present')
    if any(k != '1' for k in record_types):
        limitations.append('non_cross_section_geometry_records_present')
    if len(flow_locations) > 1:
        limitations.append('multiple_flow_locations_require_review')
    if any(f['matching_geometry_sections'] != 1 for f in flow_locations):
        limitations.append('flow_location_identity_requires_review')
    if any(s['native_coefficient_headers'] for s in sections):
        limitations.append('native_coefficient_mode_requires_review')
    if any(len(s['distinct_native_coefficients']) > 1 for s in sections):
        limitations.append('native_coefficient_variation_present_mode_unconfirmed')
    if any(s['ineffective_area_headers'] for s in sections):
        limitations.append('ineffective_flow_area_headers_present')
    if any(s['vertical_edges'] for s in sections):
        limitations.append('repeated_section_stations_require_review')
    if any(o['location_status'] != 'at_section' for o in observations):
        limitations.append('observed_locations_require_review')
    return {'format': 'doboku-hec-ras-inspection-3',
            'inspected_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'sources': sources, 'native_unit_declarations': unit_lines,
            'native_datum_fields': [line for _, line in geom if line.startswith(('GIS Datum=', 'GIS Vertical Datum='))],
            'geometry_record_types': dict(record_types), 'junctions': junction_count,
            'sections': sections, 'profile_count': profile_count,
            'native_profile_names': profile_names,
            'flow_locations': flow_locations, 'observations': observations,
            'native_boundary_records': boundaries, 'plan_inventory': plan_inventory,
            'unassociated_boundary_fields': unassociated_boundary_fields,
            'observation_location_counts': dict(collections.Counter(o['location_status'] for o in observations)),
            'inventory_complete': issue_count == 0, 'issue_count': issue_count, 'first_issues': issues,
            'requires_review': limitations, 'solver_input_generated': False, 'dataset_adopted': False,
            'scope': 'Selected ASCII records only. No conversion, correction, sorting, observation interpolation, hydraulic solve, calibration, import or adoption.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('project', 'geometry', 'flow', 'output'):
        parser.add_argument('--' + name, required=True, type=Path)
    parser.add_argument('--plan', type=Path, help='Optional explicit plan; never auto-select or execute')
    args = parser.parse_args()
    if args.output.exists():
        parser.error('output already exists; choose a new report file')
    try:
        report = inspect(args.project, args.geometry, args.flow, args.plan)
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
