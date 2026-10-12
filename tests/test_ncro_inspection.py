"""Synthetic inspection cases; these are not adopted field surveys."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/inspect-ncro-survey.py'
spec = importlib.util.spec_from_file_location('ncro_inspection', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class InspectionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def source(self, text):
        path = self.root / 'survey.csv'
        path.write_text(text, encoding='utf-8')
        return path

    def test_entire_file_hash_metadata_and_nonfinite_tail(self):
        source = self.source('X,Y,Z,FEATURE_CLASS_NAME,DATA_EQUIPMENT_TYPE,SURVEY_REPORT\n' +
                             '1,2,3,ReachA,Singlebeam,\n' * 1000 +
                             '4,5,NaN,ReachB,Multibeam,report.pdf\n')
        original = source.read_bytes()
        self.assertGreater(len(original), 16384)
        report = module.inspect(source)
        self.assertTrue(report['parse_complete'])
        self.assertEqual((report['rows'], report['finite_xyz_rows']), (1001, 1000))
        self.assertEqual(report['native_xyz_bounds'], {'x': [1., 1.], 'y': [2., 2.], 'z': [3., 3.]})
        self.assertEqual(report['metadata']['feature']['distinct_nonempty'], 2)
        self.assertEqual(report['nonempty_survey_report_rows'], 1)
        self.assertEqual(report['first_issues'], [{'code': 'missing_or_nonfinite_coordinate', 'csv_line': 1002}])
        self.assertEqual(report['source']['sha256'], hashlib.sha256(original).hexdigest())
        self.assertEqual(source.read_bytes(), original)
        json.dumps(report, allow_nan=False)

    def test_index_aliases_cannot_create_survey_identity(self):
        source = self.source('X,Y,Z,Feature_Class_Name\n1,2,3,https://example.test/MapServer/Canal\n')
        index = self.root / 'index.csv'
        index.write_text('objectid,feature_class_name,waterway,year,sonar_type,data_ca_gov_csv_url\n'
                         '1,Canal,Canal,2024,Singlebeam,https://example.test/csv\n'
                         '2,OtherRiver,Other river,2019,Multibeam,https://example.test/csv\n'
                         '3,Elsewhere,Elsewhere,2020,Singlebeam,https://example.test/other\n')
        report = module.inspect(source, index, 'https://example.test/csv')['index']
        self.assertEqual(report['rows_with_same_url'], 2)
        self.assertEqual([r['objectid'] for r in report['feature_matches']], ['1'])
        self.assertEqual([r['objectid'] for r in report['feature_not_observed']], ['2'])
        self.assertEqual(report['sha256'], hashlib.sha256(index.read_bytes()).hexdigest())
        with self.assertRaisesRegex(ValueError, 'resource-url'):
            module.inspect(source, index)

    def test_date_aliases_and_mojibake_are_recorded(self):
        source = self.source('ï»¿OBJECTID,X,Y,Z,DATE_STARTED,DATE_COMPLETED,DATE_DATA_REFERS_TO\n'
                             '1,1,2,3,2024/01/24 00:00:00+00,2024/01/23 00:00:00+00,broken\n')
        report = module.inspect(source)
        self.assertTrue(report['parse_complete'])
        self.assertEqual(report['metadata']['started']['values'][0]['value'], '2024/01/24 00:00:00+00')
        self.assertEqual({i['code'] for i in report['first_issues']}, {
            'mojibake_header_prefix', 'invalid_reference_date', 'fieldwork_dates_reversed'})

    def test_structural_errors_and_unknown_units_are_not_repaired(self):
        for text in ['X,Y,Z\n1,2,3,extra\n', 'X,X,Z\n1,2,3\n', 'X,Y,Z\n1,2,"unterminated']:
            with self.subTest(text=text):
                report = module.inspect(self.source(text))
                self.assertGreater(report['issue_count'], 0)
                self.assertEqual(report['finite_xyz_rows'], 0)
                self.assertIsNone(report['native_xyz_bounds']['z'])
        report = module.inspect(self.source('X,Y,Z\n1,2,3\n'))
        self.assertIn('Native coordinate units and reference realization', report['unverified'])
        self.assertNotIn('converted_coordinates', report)

    def test_cli_retains_rejected_report_and_refuses_overwrite(self):
        source = self.source('X,Y,Z\n1,2,Infinity\n')
        output = self.root / 'inspection.json'
        cmd = [sys.executable, str(SCRIPT), '--csv', str(source), '--output', str(output)]
        first = subprocess.run(cmd, capture_output=True, text=True)
        self.assertEqual(first.returncode, 2)
        report = json.loads(output.read_text())
        self.assertEqual(report['finite_xyz_rows'], 0)
        original = output.read_bytes()
        second = subprocess.run(cmd, capture_output=True, text=True)
        self.assertEqual(second.returncode, 2)
        self.assertIn('already exists', second.stderr)
        self.assertEqual(output.read_bytes(), original)


if __name__ == '__main__':
    unittest.main()
