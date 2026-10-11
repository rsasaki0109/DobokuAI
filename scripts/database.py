#!/usr/bin/env python3
"""Online SQLite backup and restore into a new file; never overwrite a database."""
import argparse
import hashlib
import json
import sqlite3
import time
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote


def inspect(connection):
    integrity = connection.execute("PRAGMA integrity_check").fetchall()
    if integrity != [("ok",)]:
        raise ValueError("SQLite integrity_check failed")
    tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if not {"projects", "runs"} <= tables:
        raise ValueError("DobokuAI projects/runs schema is required")
    counts = {}
    snapshot_tables = ["projects", "runs"]
    # Older databases remain recoverable; the API adds this table on startup.
    if "sensitivity_runs" in tables:
        snapshot_tables.append("sensitivity_runs")
    for table in snapshot_tables:
        counts[table] = connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
    # Parse every stored JSON snapshot before treating it as recoverable.
    for table in snapshot_tables:
        for (body,) in connection.execute(f"SELECT body FROM {table}"):
            json.loads(body)
    return counts


def copy_database(source, destination):
    source, destination = Path(source).resolve(), Path(destination).absolute()
    if not source.is_file():
        raise ValueError("Source database does not exist")
    if not destination.parent.is_dir():
        raise ValueError("Create the destination directory first")
    # Exclusive creation also rejects existing symlinks, including dangling links.
    with destination.open("xb"):
        pass
    deadline = time.monotonic() + 30

    def progress(_status, _remaining, _total):
        if time.monotonic() > deadline:
            raise TimeoutError("Backup exceeded 30 seconds; retry when the database is less busy")

    try:
        with closing(sqlite3.connect(f"file:{quote(str(source))}?mode=ro", uri=True, timeout=15)) as src:
            with closing(sqlite3.connect(destination, timeout=15)) as dst:
                src.backup(dst, pages=256, progress=progress, sleep=0.1)
                counts = inspect(dst)
        with destination.open("rb") as snapshot:
            checksum = hashlib.file_digest(snapshot, "sha256").hexdigest()
        return {
            "format": "doboku-sqlite-snapshot-v1",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "database": str(destination),
            "sha256": checksum,
            "counts": counts,
        }
    except Exception:
        destination.unlink(missing_ok=True)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("backup", "restore"))
    parser.add_argument("--source", required=True)
    parser.add_argument("--destination", required=True)
    parser.add_argument("--expected-sha256", help="Optional backup hash to verify before restoring")
    args = parser.parse_args()
    try:
        if args.expected_sha256:
            with Path(args.source).open("rb") as file:
                actual = hashlib.file_digest(file, "sha256").hexdigest()
            if actual != args.expected_sha256.lower():
                raise ValueError("Backup SHA-256 does not match; destination was not created")
        record = copy_database(args.source, args.destination)
        print(json.dumps(record, ensure_ascii=False, indent=2))
    except (OSError, ValueError, sqlite3.Error, TimeoutError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
