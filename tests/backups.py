"""Recovery failure cases independent of the API persistence integration test."""
import importlib.util
import sqlite3
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("database", Path(__file__).resolve().parents[1] / "scripts/database.py")
database = importlib.util.module_from_spec(spec)
spec.loader.exec_module(database)


class RecoveryFailures(unittest.TestCase):
    def test_resolution_snapshots_are_counted_and_corruption_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, backup, target = [Path(tmp)/name for name in ('source.sqlite','backup.sqlite','restore.sqlite')]
            with sqlite3.connect(source) as connection:
                for table in ('projects','runs','resolution_runs'):
                    connection.execute(f'CREATE TABLE {table} (body TEXT)')
                connection.execute('INSERT INTO resolution_runs VALUES (?)', ('{"study":{"cases":[]}}',))
            self.assertEqual(database.copy_database(source, backup)['counts'], {'projects':0,'runs':0,'resolution_runs':1})
            with sqlite3.connect(source) as connection:
                connection.execute('UPDATE resolution_runs SET body=?', ('invalid json',))
            with self.assertRaises(ValueError):
                database.copy_database(source, target)
            self.assertFalse(target.exists())
    def test_legacy_schema_restores_and_corrupt_sensitivity_snapshots_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, legacy, target = Path(tmp)/'source.sqlite', Path(tmp)/'legacy.sqlite', Path(tmp)/'restore.sqlite'
            with sqlite3.connect(source) as connection:
                connection.execute('CREATE TABLE projects (body TEXT)')
                connection.execute('CREATE TABLE runs (body TEXT)')
                connection.execute('INSERT INTO runs VALUES (?)', ('{}',))
            self.assertEqual(database.copy_database(source, legacy)['counts'], {'projects': 0, 'runs': 1})
            with sqlite3.connect(source) as connection:
                connection.execute('CREATE TABLE sensitivity_runs (body TEXT)')
                connection.execute('INSERT INTO sensitivity_runs VALUES (?)', ('invalid json',))
            with self.assertRaises(ValueError):
                database.copy_database(source, target)
            self.assertFalse(target.exists())
    def test_existing_destination_and_invalid_sources_are_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, target = Path(tmp)/"source.sqlite", Path(tmp)/"target.sqlite"
            target.write_bytes(b"existing data")
            source.write_bytes(b"not a database")
            with self.assertRaises(FileExistsError):
                database.copy_database(source, target)
            self.assertEqual(target.read_bytes(), b"existing data")
            target.unlink()
            with self.assertRaises(sqlite3.DatabaseError):
                database.copy_database(source, target)
            self.assertFalse(target.exists())

    def test_other_sqlite_schema_is_rejected_without_leaving_a_restore(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, target = Path(tmp)/"other.sqlite", Path(tmp)/"restore.sqlite"
            with sqlite3.connect(source) as connection:
                connection.execute("CREATE TABLE unrelated (value TEXT)")
            with self.assertRaisesRegex(ValueError, "schema"):
                database.copy_database(source, target)
            self.assertFalse(target.exists())


if __name__ == '__main__':
    unittest.main()
