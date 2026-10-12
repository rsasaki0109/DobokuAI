"""Independent analytic profiles and corrupted archive cases; no field trial claim."""
import copy
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/audit-review-pack.py'
spec = importlib.util.spec_from_file_location('review_audit', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def known_profile(supercritical=False):
    width, depth, n = 10., (.2 if supercritical else 2.), .03
    slope = .05 if supercritical else .001
    area, perimeter = width * depth, width + 2 * depth
    discharge = area * (area / perimeter) ** (2 / 3) * math.sqrt(slope) / n
    velocity = discharge / area
    river = {'discharge': discharge, 'normal_slope': slope,
             'boundary': {'regime': 'supercritical' if supercritical else 'subcritical', 'depth': depth},
             'stations': [{'chainage': x, 'bed_elevation': 1 - slope * x, 'roughness': n,
                           'section': {'kind': 'rectangle', 'width': width, 'bank_height': 8.}} for x in [0., 10.]]}
    rows = [{'chainage': s['chainage'], 'bed_elevation': s['bed_elevation'],
             'water_elevation': s['bed_elevation'] + depth, 'depth': depth, 'area': area,
             'velocity': velocity, 'froude': velocity / math.sqrt(9.80665 * depth),
             'friction_slope': slope, 'critical_depth': (discharge ** 2 / (9.80665 * width ** 2)) ** (1 / 3),
             'normal_depth': depth, 'energy_residual': 0.} for s in river['stations']]
    return river, {'rows': rows, 'warnings': []}


def evidence(supercritical=False):
    river, profile = known_profile(supercritical)
    project = {'id': 'synthetic-audit', 'name': 'Analytic audit', 'river': river, 'reference': {'vertical_datum': 'synthetic'}}
    run = {'engine_version': '0.2.0', 'executed_at': '2026-10-12T00:00:00+00:00', 'river': river, 'profile': profile}
    stored = {'id': 1, 'analysis': {'project': project, 'run': run, 'comparisons': [], 'staged': False}}
    conditions = {'river': river, 'reference': project['reference']}
    return stored, conditions


class AuditTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)

    def pack(self, stored=None, conditions=None, hash_mismatch=False, extra=None):
        if stored is None:
            stored, conditions = evidence()
        run = stored['analysis']['run']
        files = {'conditions.json': json.dumps(conditions).encode(), 'construction.json': json.dumps(stored).encode(),
                 'construction.csv': b'archived CSV', 'construction.html': b'archived HTML', 'index.html': b'index', 'README.txt': b'notes'}
        manifest = {'format_version': 'doboku-review-pack-1',
                    'selection': {'run_id': 1, 'sensitivity_id': None, 'resolution_id': None},
                    'project_id': stored['analysis']['project']['id'], 'reference': stored['analysis']['project']['reference'],
                    'project_name': stored['analysis']['project']['name'], 'discharge_m3_s': run['river']['discharge'],
                    'station_count': len(run['river']['stations']), 'scenario_count': 0, 'staged': False,
                    'conditions_sha256': hashlib.sha256(files['conditions.json']).hexdigest(),
                    'records': [{'kind': 'construction', 'id': 1, 'engine_version': run['engine_version'],
                                 'executed_at': run['executed_at'], 'case_count': 0, 'failed_count': 0}],
                    'files': [{'path': k, 'bytes': len(v), 'sha256': hashlib.sha256(v).hexdigest()} for k, v in files.items()]}
        if hash_mismatch:
            files['construction.csv'] += b'tampered'
        files['manifest.json'] = json.dumps(manifest).encode()
        if extra:
            files[extra] = b'no extraction'
        path = self.root / 'sample.zip'
        with zipfile.ZipFile(path, 'w') as z:
            for k, v in files.items():
                z.writestr(k, v)
        return path

    def test_analytic_uniform_flows_on_both_boundary_directions(self):
        for supercritical in [False, True]:
            with self.subTest(supercritical=supercritical):
                stored, conditions = evidence(supercritical)
                report = module.audit(self.pack(stored, conditions))
                self.assertTrue(report['passed'], report)
                self.assertEqual(report['profiles'][0]['segments'], 1)
                self.assertLess(report['profiles'][0]['max_energy_residual_m'], 1e-12)

    def test_polyline_integrals_match_closed_geometry_and_reject_separation(self):
        area, perimeter, width = module.geometry({'kind': 'trapezoid', 'bottom_width': 4., 'side_slope': 2., 'bank_height': 5.}, 1.)
        self.assertAlmostEqual(area, 6.)
        self.assertAlmostEqual(perimeter, 4 + 2 * math.sqrt(5))
        self.assertAlmostEqual(width, 8.)
        survey = {'kind': 'survey', 'points': [{'x': -10., 'z': 5.}, {'x': 0., 'z': 0.}, {'x': 4., 'z': 0.}, {'x': 14., 'z': 5.}]}
        self.assertEqual(module.geometry(survey, 1.), (area, perimeter, width))
        split = {'kind': 'survey', 'points': [{'x': 0., 'z': 3.}, {'x': 1., 'z': 0.}, {'x': 2., 'z': 2.}, {'x': 3., 'z': 0.}, {'x': 4., 'z': 3.}]}
        with self.assertRaisesRegex(ValueError, 'Separated'):
            module.geometry(split, 1.)

    def test_hash_corruption_and_unsafe_entry_are_rejected(self):
        self.assertFalse(module.audit(self.pack(hash_mismatch=True))['integrity_passed'])
        self.assertFalse(module.audit(self.pack(extra='../outside'))['integrity_passed'])
        self.assertFalse((self.root.parent / 'outside').exists())

    def test_irregular_ground_integrates_every_vertex_and_rejects_dry_ridge(self):
        ground = {'kind': 'survey', 'points': [{'x': x, 'z': z} for x, z in [
            (0., 6.), (1., 2.), (2., 2.5), (3., 0.), (4., 1.), (5., 6.)]]}
        area, perimeter, width = module.geometry(ground, 4.)
        self.assertAlmostEqual(area, 9.4)
        self.assertAlmostEqual(perimeter, .5 * math.sqrt(17) + math.sqrt(1.25) +
                               math.sqrt(7.25) + math.sqrt(2) + .6 * math.sqrt(26))
        self.assertAlmostEqual(width, 4.1)
        with self.assertRaisesRegex(ValueError, 'Separated'):
            module.geometry(ground, 2.5)

    def test_large_finite_bank_height_does_not_erase_wetted_walls(self):
        area, perimeter, width = module.geometry({'kind': 'rectangle', 'width': 10., 'bank_height': 1e20}, 2.)
        self.assertAlmostEqual(area, 20.)
        self.assertAlmostEqual(perimeter, 14.)
        self.assertAlmostEqual(width, 10.)

    def test_correctly_rehashed_bad_numerics_still_fail(self):
        for field, value in [('velocity', 999.), ('depth', 2.1), ('critical_depth', 1.), ('normal_depth', 1.)]:
            with self.subTest(field=field):
                stored, conditions = evidence()
                stored['analysis']['run']['profile']['rows'][0][field] = value
                report = module.audit(self.pack(stored, conditions))
                self.assertTrue(report['integrity_passed'], report)
                self.assertFalse(report['passed'])

    def test_energy_balance_is_independent_of_stored_residual(self):
        river, profile = known_profile()
        river['stations'][0]['bed_elevation'] += .01
        profile['rows'][0]['bed_elevation'] += .01
        profile['rows'][0]['water_elevation'] += .01
        report = module.check_profile('modified-bed', river, profile, '0.2.0')
        self.assertFalse(report['passed'])
        self.assertAlmostEqual(report['max_energy_residual_m'], .01)
        self.assertTrue(any('energy balance' in m for m in report['first_issues']))

    def test_conditions_mismatch_unknown_engine_and_nonfinite_json(self):
        stored, conditions = evidence()
        wrong = copy.deepcopy(conditions)
        wrong['reference']['vertical_datum'] = 'different'
        self.assertFalse(module.audit(self.pack(stored, wrong))['passed'])
        river, profile = known_profile()
        self.assertFalse(module.check_profile('unknown', river, profile, '99.0')['passed'])
        for encoded in [b'{"a":NaN}', b'{"a":1e400}', b'{"a":1,"a":2}']:
            with self.assertRaises(ValueError):
                module.decode(encoded)

    def test_cli_persists_failures_and_refuses_overwrite(self):
        path = self.pack(hash_mismatch=True)
        output = self.root / 'audit.json'
        cmd = [sys.executable, str(SCRIPT), '--pack', str(path), '--output', str(output)]
        first = subprocess.run(cmd, capture_output=True)
        self.assertEqual(first.returncode, 2)
        self.assertFalse(json.loads(output.read_text())['passed'])
        before = output.read_bytes()
        second = subprocess.run(cmd, capture_output=True)
        self.assertEqual(second.returncode, 2)
        self.assertEqual(output.read_bytes(), before)

    def test_optional_studies_preserve_failures_and_reject_baseline_change(self):
        stored, conditions = evidence()
        path = self.pack(stored, conditions)
        with zipfile.ZipFile(path) as z:
            files = {n: z.read(n) for n in z.namelist()}
        manifest = json.loads(files.pop('manifest.json'))
        baseline = stored['analysis']['run']
        comparison = {'project': stored['analysis']['project'], 'baseline': baseline,
                      'cases': [{'status': 'failed', 'change': {'parameter': 'discharge', 'value': 99999},
                                 'error': 'No supported steady solution'}]}
        manifest['selection']['sensitivity_id'] = 2
        manifest['records'].append({'kind': 'sensitivity', 'id': 2, 'engine_version': '0.2.0',
                                    'executed_at': baseline['executed_at'], 'case_count': 1, 'failed_count': 1})
        def write():
            files['sensitivity.json'] = json.dumps({'id': 2, 'comparison': comparison}).encode()
            files['sensitivity.csv'], files['sensitivity.html'] = b'failure CSV', b'failure HTML'
            manifest['files'] = [{'path': k, 'bytes': len(v), 'sha256': hashlib.sha256(v).hexdigest()} for k, v in files.items()]
            with zipfile.ZipFile(path, 'w') as z:
                for k, v in files.items():
                    z.writestr(k, v)
                z.writestr('manifest.json', json.dumps(manifest))
        write()
        report = module.audit(path)
        self.assertTrue(report['passed'], report)
        self.assertEqual(report['failed_cases'][0]['error'], 'No supported steady solution')
        comparison['cases'][0]['profile'] = baseline['profile']
        write()
        self.assertFalse(module.audit(path)['passed'])
        comparison['cases'][0].pop('profile')
        comparison['baseline'] = copy.deepcopy(baseline)
        comparison['baseline']['profile']['rows'][0]['depth'] += .1
        write()
        self.assertFalse(module.audit(path)['passed'])


if __name__ == '__main__':
    unittest.main()
