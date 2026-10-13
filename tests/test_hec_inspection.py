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
                     'native_coefficient_variation_present_mode_unconfirmed', 'ineffective_flow_area_headers_present']:
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

    def add_plan(self, text=None):
        self.project.write_text(self.project.read_text() + 'Plan File=p01\nCurrent Plan=p01\n')
        plan = self.root / 'demo.p01'
        plan.write_text(text or 'Geom File=g01\nFlow File=f01\nSubcritical Flow\nProgram Version=4.01\n'
                        'Std Step Tol=.01\nCritical Tol=.01\nMax Error Tol=.3\nNum of Std Step Trials=20\n')
        return plan

    def test_explicit_plan_binds_to_supplied_sources_without_executing(self):
        plan = self.add_plan()
        before = plan.read_bytes()
        report = module.inspect(self.project, self.geometry, self.flow, plan)
        self.assertTrue(report['inventory_complete'], report['first_issues'])
        self.assertEqual(report['plan_inventory']['native_flow_regime_declarations'], ['Subcritical Flow'])
        self.assertEqual(report['plan_inventory']['native_solver_settings']['Std Step Tol'], .01)
        self.assertTrue(report['plan_inventory']['is_project_current_plan'])
        self.assertEqual(report['sources']['plan']['sha256'], hashlib.sha256(before).hexdigest())
        self.assertEqual(plan.read_bytes(), before)
        self.assertFalse(report['solver_input_generated'])
        self.assertIsNone(self.inspect()['plan_inventory'])
        self.assertIn('plan_not_supplied', self.inspect()['requires_review'])

    def test_conflicting_plan_references_regime_and_nonfinite_tolerance_fail(self):
        plan = self.add_plan('Geom File=g02\nFlow File=f02\nSubcritical Flow\nSupercritical Flow\n'
                             'Std Step Tol=NaN\nNum of Std Step Trials=1.5\n')
        report = module.inspect(self.project, self.geometry, self.flow, plan)
        self.assertFalse(report['inventory_complete'])
        self.assertTrue({'plan_geometry_reference_mismatch', 'plan_flow_reference_mismatch',
                         'missing_or_conflicting_plan_regime', 'invalid_or_nonfinite_plan_setting'}.issubset(
                             {i['code'] for i in report['first_issues']}))
        plan.write_text('Geom File=g01\nFlow File=f01\nMixed Flow\n')
        report = module.inspect(self.project, self.geometry, self.flow, plan)
        self.assertTrue(report['inventory_complete'])
        self.assertIn('mixed_flow_plan_outside_current_solver_scope', report['requires_review'])
        other = self.root / 'other.p01'
        other.write_bytes(plan.read_bytes())
        self.assertFalse(module.inspect(self.project, self.geometry, self.flow, other)['inventory_complete'])

    def test_boundaries_preserve_negative_stage_unknown_type_and_profile_identity(self):
        self.flow.write_text(self.flow.read_text() +
                             'Boundary for River Rch & Prof#=R,Up,1\nUp Type=0\nDn Type=1\nDn Known WS=-2\n'
                             'Boundary for River Rch & Prof#=R,Up,2\nUp Type=0\nDn Type=99\nDn Slope=.0023\n')
        report = self.inspect()
        self.assertTrue(report['inventory_complete'], report['first_issues'])
        self.assertEqual(report['native_boundary_records'][0]['native_fields']['Dn Known WS'], -2)
        self.assertEqual(report['native_boundary_records'][1]['native_fields'], {
            'Up Type': 0, 'Dn Type': 99, 'Dn Slope': .0023})
        self.assertIn('native_boundary_codes_and_fields_require_review', report['requires_review'])
        self.assertNotIn('boundary_profile_coverage_requires_review', report['requires_review'])
        self.assertNotIn('interpreted_boundary', report)

    def test_duplicate_or_malformed_boundary_data_cannot_silently_replace_conditions(self):
        original = self.flow.read_text()
        self.flow.write_text(original + 'Dn Type=1\nBoundary for River Rch & Prof#=R,Up,1\n'
                             'Up Type=0\nDn Type=1\nDn Known WS=5\nDn Known WS=6\n'
                             'Boundary for River Rch & Prof#=R,Up,1\nUp Type=0\nDn Type=3\nDn Slope=Inf\n'
                             'Boundary for River Rch & Prof#=R,Up,3\nUp Type=0\nDn Type=1\n')
        report = self.inspect()
        codes = {i['code'] for i in report['first_issues']}
        self.assertFalse(report['inventory_complete'])
        self.assertTrue({'boundary_field_without_identity', 'duplicate_boundary_field',
                         'duplicate_boundary_identity', 'invalid_or_nonfinite_boundary_field',
                         'invalid_boundary_identity'}.issubset(codes))
        self.assertEqual(report['native_boundary_records'][0]['native_fields']['Dn Known WS'], 5)
        self.assertEqual(report['native_boundary_records'][0]['duplicate_native_fields'][0]['value'], 6)
        self.assertIn('boundary_profile_coverage_requires_review', report['requires_review'])
        self.flow.write_text(original + 'Boundary for River Rch & Prof#=R,Other,1\nUp Type=0\n')
        report = self.inspect()
        self.assertFalse(report['inventory_complete'])
        self.assertIn('missing_boundary_type', {i['code'] for i in report['first_issues']})
        self.assertIn('boundary_reach_identity_requires_review', report['requires_review'])

    def test_profile_names_cannot_replace_the_native_flow_values(self):
        original = self.flow.read_text()
        self.flow.write_text(original + 'Profile Names=999 cfs,Low flow\n')
        report = self.inspect()
        self.assertTrue(report['inventory_complete'])
        self.assertEqual(report['native_profile_names'], ['999 cfs', 'Low flow'])
        self.assertEqual(report['flow_locations'][0]['native_profile_flows'], [10, 20])
        self.flow.write_text(original + 'Profile Names=Only one\n')
        self.assertFalse(self.inspect()['inventory_complete'])
        self.flow.write_text(original + 'Profile Names=One,Two\nProfile Names=Three,Four\n')
        report = self.inspect()
        self.assertFalse(report['inventory_complete'])
        self.assertIsNone(report['native_profile_names'])

    def test_coefficient_modes_and_all_three_columns_are_preserved_without_assuming_direction(self):
        for mode in ('1', '-1', '999'):
            with self.subTest(mode=mode):
                self.geometry.write_text(section().replace('#Mann=1,0,0\n' + fixed([0, .03, 0]),
                    f'#Mann=2,{mode},7\n' + fixed([0, .03, 4, 5, .05, 8])))
                report = self.inspect()
                s = report['sections'][0]
                self.assertTrue(report['inventory_complete'])
                self.assertEqual(s['native_coefficient_headers'][0]['fields'], ['2', mode, '7'])
                self.assertEqual(s['native_coefficient_tables'][0]['rows'], [[0, .03, 4], [5, .05, 8]])
                self.assertIn('native_coefficient_mode_requires_review', report['requires_review'])
                self.assertIn('native_coefficient_variation_present_mode_unconfirmed', report['requires_review'])
                self.assertNotIn('transverse_coefficient_variation_present', report['requires_review'])
        self.geometry.write_text(section().replace('#Mann=1,0,0\n' + fixed([0, .03, 0]),
            '#Mann=1,1,7\n' + fixed([0, .03, 4]) + '#Mann=1,-1,0\n' + fixed([5, .05, 0])))
        report = self.inspect()
        self.assertFalse(report['inventory_complete'])
        self.assertEqual(len(report['sections'][0]['native_coefficient_headers']), 2)
        self.assertEqual(len(report['sections'][0]['native_coefficient_tables']), 2)

    def test_unknown_boundary_fields_and_orphans_are_explicitly_uninterpreted(self):
        self.flow.write_text(self.flow.read_text() +
            'Up Future Option= NaN\nBoundary for River Rch & Prof#=R,Up,1\n'
            'Up Type=0\nDn Type=4\nDn Rating Curve= 2,unknown\nDn Rating Curve= 3,other\n'
            'Observed WS=R,Up,A,0,5,6\nDn Future Option= preserved\n')
        report = self.inspect()
        self.assertTrue(report['inventory_complete'])
        self.assertEqual([entry['key'] for entry in report['unassociated_boundary_fields']],
                         ['Up Future Option', 'Dn Future Option'])
        self.assertEqual(report['unassociated_boundary_fields'][0]['raw_value'], ' NaN')
        boundary = report['native_boundary_records'][0]
        self.assertEqual([x['raw_value'] for x in boundary['uninterpreted_fields']], [' 2,unknown', ' 3,other'])
        self.assertNotIn('Dn Rating Curve', boundary['native_fields'])
        self.assertIn('uninterpreted_boundary_fields_present', report['requires_review'])
        json.dumps(report, allow_nan=False)


if __name__ == '__main__':
    unittest.main()
