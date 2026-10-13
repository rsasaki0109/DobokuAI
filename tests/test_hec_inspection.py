"""Synthetic source-inspection tests; no real-river adoption is implied."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/inspect-hec-ras.py'
spec = importlib.util.spec_from_file_location('hec_inspection', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fixed(values):
    return ''.join(f'{value:>8}' for value in values) + '\n'


def section(label='A', reach='R,Up', points=None):
    return (f'River Reach={reach}\nType RM Length L Ch R =1,{label},100,100,100\n'
            '#Sta/Elev=3\n' + fixed(points or [0, 10, 5, 0, 10, 10]) +
            '#Mann=1,0,0\n' + fixed([0, .03, 0]))


class InspectionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.project = self.root / 'demo.prj'
        self.geometry = self.root / 'demo.g01'
        self.flow = self.root / 'demo.f01'
        self.project.write_text('Proj Title=Synthetic\nEnglish Units\nGeom File=g01\nFlow File=f01\n')
        self.geometry.write_text(section() + 'GIS Datum=NAD83\nGIS Vertical Datum=\n')
        self.flow.write_text('Number of Profiles=2\nRiver Rch & RM=R,Up,A\n' + fixed([10, 20]) +
                             'Observed WS=R,Up,A,0,5,\n')

    def inspect(self):
        return module.inspect(self.project, self.geometry, self.flow)

    def test_hashes_native_values_and_no_adoption_or_mutation(self):
        before = [p.read_bytes() for p in (self.project, self.geometry, self.flow)]
        report = self.inspect()
        self.assertTrue(report['inventory_complete'], report['first_issues'])
        self.assertEqual(report['sections'][0]['native_elevation_bounds'], [0, 10])
        self.assertEqual(report['flow_locations'][0]['native_profile_flows'], [10, 20])
        self.assertEqual(report['observations'][0]['native_water_levels'], [5, None])
        self.assertEqual(report['observation_location_counts'], {'at_section': 1})
        self.assertEqual(report['native_datum_fields'], ['GIS Datum=NAD83', 'GIS Vertical Datum='])
        for role, raw in zip(['project', 'geometry', 'flow'], before):
            self.assertEqual(report['sources'][role]['sha256'], hashlib.sha256(raw).hexdigest())
        self.assertFalse(report['dataset_adopted'])
        self.assertFalse(report['solver_input_generated'])
        self.assertIn('common_vertical_reference_and_unit_realization_require_review', report['requires_review'])
        self.assertEqual(before, [p.read_bytes() for p in (self.project, self.geometry, self.flow)])
        json.dumps(report, allow_nan=False)

    def test_packed_fields_are_not_split_at_whitespace(self):
        self.geometry.write_text(section(points=['.0000001', 10, '.0000002', 0, '.0000003', 10]))
        report = self.inspect()
        self.assertTrue(report['inventory_complete'], report['first_issues'])
        self.assertEqual(report['sections'][0]['native_station_bounds'], [1e-7, 3e-7])

    def test_malformed_counts_nonfinite_and_extra_points_are_not_repaired(self):
        valid = section()
        variants = [valid.replace('#Sta/Elev=3', '#Sta/Elev=999999'),
                    valid.replace('#Sta/Elev=3', '#Sta/Elev=2'),
                    valid.replace(fixed([0, 10, 5, 0, 10, 10]), fixed([0, 10, 5, 'NaN', 10, 10])),
                    valid.replace('#Mann=1', fixed([30, 40]) + '#Mann=1'),
                    valid.replace(fixed([0, 10, 5, 0, 10, 10]), fixed([0, 10, 5, 0, 10]))]
        for data in variants:
            with self.subTest(data=data):
                self.geometry.write_text(data)
                report = self.inspect()
                self.assertFalse(report['inventory_complete'])
                self.assertGreater(report['issue_count'], 0)
                json.dumps(report, allow_nan=False)

    def test_reversed_stations_and_vertical_banks_are_distinguished(self):
        self.geometry.write_text(section(points=[0, 10, -1, 0, 10, 10]))
        self.assertIn('section_stations_decrease', [i['code'] for i in self.inspect()['first_issues']])
        self.geometry.write_text(section(points=[0, 10, 0, 0, 10, 10]))
        report = self.inspect()
        self.assertTrue(report['inventory_complete'])
        self.assertEqual(report['sections'][0]['vertical_edges'], 1)
        self.assertIn('repeated_section_stations_require_review', report['requires_review'])

    def test_observation_identity_includes_reach_and_downstream_offset(self):
        self.geometry.write_text(section() + section('A', 'R,Down'))
        self.flow.write_text('Number of Profiles=1\nRiver Rch & RM=R,Up,A\n' + fixed([10]) +
                             'Observed WS=R,Up,A,10,5\nObserved WS=R,Else,A,0,5\n'
                             'Observed WS=R,Down,A,0,4\nObserved WS=R,Up,A,0,NaN\n')
        report = self.inspect()
        self.assertEqual(report['observation_location_counts'], {
            'downstream_offset_requires_review': 1, 'missing_section': 1, 'at_section': 1})
        self.assertFalse(report['inventory_complete'])
        self.assertIn('invalid_or_nonfinite_observed_number', [i['code'] for i in report['first_issues']])
        self.geometry.write_text(section() + section())
        self.assertEqual(self.inspect()['observation_location_counts'], {'ambiguous_section': 1, 'missing_section': 2})

    def test_model_features_and_changed_flows_are_retained(self):
        self.geometry.write_text(section().replace('#Mann=1,0,0\n' + fixed([0, .03, 0]),
                                                  '#Mann=2,-1,0\n' + fixed([0, .03, 0, 5, .05, 0])) +
                                 '#XS Ineff=1\nJunct Name=J\nType RM Length L Ch R =3,Bridge,,,\n')
        self.flow.write_text('Number of Profiles=2\nRiver Rch & RM=R,Up,A\n' + fixed([10, 20]) +
                             'River Rch & RM=R,Up,B\n' + fixed([15, 25]))
        report = self.inspect()
        self.assertTrue(report['inventory_complete'], report['first_issues'])
        for flag in ['junctions_present', 'non_cross_section_geometry_records_present',
                     'multiple_flow_locations_require_review', 'flow_location_identity_requires_review',
                     'transverse_coefficient_variation_present', 'ineffective_flow_area_headers_present']:
            self.assertIn(flag, report['requires_review'])
        self.assertEqual(report['flow_locations'][1]['native_profile_flows'], [15, 25])

    def test_descriptions_cannot_supply_metadata_and_cross_model_files_fail(self):
        self.geometry.write_text(section() + 'BEGIN DESCRIPTION:\nGIS Vertical Datum=NAVD88\n'
                                 'Type RM Length L Ch R =1,Fake,1,1,1\nEND DESCRIPTION:\nGIS Vertical Datum=\n')
        report = self.inspect()
        self.assertEqual(len(report['sections']), 1)
        self.assertEqual(report['native_datum_fields'], ['GIS Vertical Datum='])
        other = self.root / 'other.g01'
        other.write_bytes(self.geometry.read_bytes())
        report = module.inspect(self.project, other, self.flow)
        self.assertFalse(report['inventory_complete'])
        self.assertIn('supplied_geometry_not_listed_in_project', [i['code'] for i in report['first_issues']])
        self.project.write_text(self.project.read_text() + 'SI Units\n')
        self.assertFalse(self.inspect()['inventory_complete'])

    def test_input_bound_and_cli_rejection_report_cannot_overwrite_source(self):
        oversized = self.root / 'large.g01'
        oversized.write_bytes(b' ' * (module.MAX_BYTES + 1))
        with self.assertRaisesRegex(ValueError, '8 MiB'):
            module.inspect(self.project, oversized, self.flow)
        self.geometry.write_text(section(points=[0, 10, 5, 'Inf', 10, 10]))
        output = self.root / 'report.json'
        cmd = [sys.executable, str(SCRIPT), '--project', str(self.project), '--geometry', str(self.geometry),
               '--flow', str(self.flow), '--output', str(output)]
        result = subprocess.run(cmd, capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        saved = output.read_bytes()
        self.assertFalse(json.loads(saved)['inventory_complete'])
        self.assertEqual(subprocess.run(cmd, capture_output=True).returncode, 2)
        self.assertEqual(output.read_bytes(), saved)
        cmd[-1] = str(self.geometry)
        before = self.geometry.read_bytes()
        self.assertEqual(subprocess.run(cmd, capture_output=True).returncode, 2)
        self.assertEqual(self.geometry.read_bytes(), before)

    def test_nonfinite_table_beyond_first_16_kib_is_detected(self):
        data = ''.join(section(str(i)) for i in range(200))
        self.assertGreater(len(data.encode()), 16384)
        self.geometry.write_text(data + section('Tail', points=[0, 10, 5, 'NaN', 10, 10]))
        report = self.inspect()
        self.assertEqual(len(report['sections']), 201)
        self.assertFalse(report['inventory_complete'])
        self.assertIn('invalid_or_nonfinite_fixed_width_number', [i['code'] for i in report['first_issues']])


if __name__ == '__main__':
    unittest.main()
