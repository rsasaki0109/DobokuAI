#!/usr/bin/env python3
"""Inspect a complete NCRO point CSV and its index without converting or importing it."""
import argparse
import collections
import datetime
import hashlib
import io
import json
import math
import os
from pathlib import Path
import csv


def fingerprint(path):
    with Path(path).open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def key(name):
    return ''.join(c for c in name.casefold() if c.isalnum())


def feature(name):
    return name.rstrip('/').rsplit('/', 1)[-1].casefold()


def inspect(source, index=None, resource_url=None):
    source = Path(source)
    issues = []
    issue_count = 0
    def issue(code, line=None):
        nonlocal issue_count
        issue_count += 1
        if len(issues) < 20:
            issues.append({'code': code, 'csv_line': line})

    aliases = {
        'source': ['source'], 'feature': ['featureclassname'],
        'equipment': ['dataequipmenttype'], 'reference_date': ['datedatarefersto'],
        'started': ['datefieldworkstarted', 'datestarted'],
        'ended': ['datefieldworkended', 'datecompleted'],
    }
    metadata = {k: collections.Counter() for k in aliases}
    report_rows = 0
    rows = 0
    valid_points = 0
    bounds = {axis: [math.inf, -math.inf] for axis in ['x', 'y', 'z']}
    complete = True
    with source.open('rb') as raw:
        before = os.fstat(raw.fileno())
        sha = hashlib.file_digest(raw, 'sha256').hexdigest()
        raw.seek(0)
        text = io.TextIOWrapper(raw, encoding='utf-8-sig', newline='')
        reader = csv.DictReader(text, strict=True)
        try:
            header = reader.fieldnames or []
            normalized = [key(h) for h in header]
            if any(not h for h in header) or len(set(normalized)) != len(header):
                issue('missing_or_duplicate_header', 1)
                complete = False
            if not all(axis in normalized for axis in bounds):
                issue('missing_xyz_header', 1)
                complete = False
            if header and header[0].startswith('ï»¿'):
                issue('mojibake_header_prefix', 1)
            if complete:
                for row in reader:
                    rows += 1
                    line = reader.line_num
                    if None in row or any(value is None for value in row.values()):
                        issue('column_count_mismatch', line)
                        continue
                    values = {key(h): value.strip() for h, value in row.items()}
                    coords = {}
                    try:
                        coords = {axis: float(values[axis]) for axis in bounds}
                        if not all(math.isfinite(v) for v in coords.values()):
                            raise ValueError('nonfinite')
                    except (ValueError, OverflowError):
                        issue('missing_or_nonfinite_coordinate', line)
                    if coords and all(math.isfinite(v) for v in coords.values()):
                        valid_points += 1
                        for axis, v in coords.items():
                            bounds[axis][0] = min(bounds[axis][0], v)
                            bounds[axis][1] = max(bounds[axis][1], v)
                    for name, options in aliases.items():
                        value = next((values[k] for k in options if values.get(k)), '')
                        metadata[name][value] += 1
                    if values.get('surveyreport'):
                        report_rows += 1
                    dates = {}
                    for name in ['started', 'ended', 'reference_date']:
                        value = next((values[k] for k in aliases[name] if values.get(k)), '')
                        if value:
                            try:
                                dates[name] = datetime.date.fromisoformat(value[:10].replace('/', '-'))
                            except ValueError:
                                issue('invalid_' + name, line)
                    if dates.get('started') and dates.get('ended') and dates['started'] > dates['ended']:
                        issue('fieldwork_dates_reversed', line)
        except (csv.Error, UnicodeError):
            issue('csv_parse_error', reader.line_num)
            complete = False
        after = os.fstat(raw.fileno())
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise ValueError('Source changed during inspection; no report is valid')
    if not rows:
        issue('no_points')
    index_report = None
    if index is not None:
        if not resource_url:
            raise ValueError('resource-url is required when inspecting an index')
        matching = []
        with Path(index).open(encoding='utf-8-sig', newline='') as stream:
            entries = csv.DictReader(stream, strict=True)
            needed = {'feature_class_name', 'data_ca_gov_csv_url'}
            if not needed.issubset(entries.fieldnames or []):
                raise ValueError('Index is missing feature_class_name or data_ca_gov_csv_url')
            for row in entries:
                if row.get('data_ca_gov_csv_url') == resource_url:
                    matching.append({k: row.get(k, '') for k in [
                        'objectid', 'feature_class_name', 'waterway', 'year', 'sonar_type',
                    ]})
        observed = {feature(v) for v in metadata['feature'] if v}
        matched = [r for r in matching if feature(r['feature_class_name']) in observed]
        unmatched = [r for r in matching if feature(r['feature_class_name']) not in observed]
        index_report = {'sha256': fingerprint(index), 'resource_url': resource_url,
                        'rows_with_same_url': len(matching), 'feature_matches': matched,
                        'feature_not_observed': unmatched,
                        'note': 'Exact basename comparison only; matching does not prove survey identity.'}
    counters = {}
    for name, counts in metadata.items():
        counters[name] = {'distinct_nonempty': len([v for v in counts if v]),
                          'empty_rows': counts.get('', 0),
                          'values': [{'value': v, 'rows': n} for v, n in counts.most_common(20)],
                          'omitted_distinct_values': max(0, len(counts) - 20)}
    return {
        'format': 'doboku-ncro-inspection-1',
        'inspected_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'source': {'file_name': source.name, 'bytes': before.st_size, 'sha256': sha},
        'parse_complete': complete, 'rows': rows, 'finite_xyz_rows': valid_points,
        'native_xyz_bounds': {a: (v if valid_points else None) for a, v in bounds.items()},
        'metadata': counters, 'nonempty_survey_report_rows': report_rows,
        'issue_count': issue_count, 'first_issues': issues, 'index': index_report,
        'scope': 'Complete supplied file only. No coordinate/unit/datum conversion, correction, sorting, section extraction, calculation or adoption.',
        'unverified': ['Native coordinate units and reference realization',
                       'Original survey ownership/use terms and survey report',
                       'Bank coverage, section locations, reach direction and hydraulic conditions'],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--csv', required=True, type=Path)
    parser.add_argument('--index', type=Path)
    parser.add_argument('--resource-url')
    parser.add_argument('--output', required=True, type=Path, help='New report file; never overwrite')
    args = parser.parse_args()
    if args.output.exists():
        parser.error('output already exists; choose a new report file')
    try:
        report = inspect(args.csv, args.index, args.resource_url)
        with args.output.open('x', encoding='utf-8') as stream:
            stream.write(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + '\n')
    except (OSError, ValueError, csv.Error) as e:
        parser.error(str(e))
    print(json.dumps({'report': str(args.output), 'rows': report['rows'],
                      'finite_xyz_rows': report['finite_xyz_rows'],
                      'parse_complete': report['parse_complete'], 'issue_count': report['issue_count']}))
    return 0 if report['parse_complete'] and report['rows'] == report['finite_xyz_rows'] and report['rows'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
