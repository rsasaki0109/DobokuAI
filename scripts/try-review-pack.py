#!/usr/bin/env python3
"""Run an isolated synthetic river trial against an explicitly selected API."""
import argparse
import csv
import hashlib
import io
import json
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True, help="API origin, e.g. http://127.0.0.1:8198")
    parser.add_argument("--output", type=Path, required=True, help="New or empty output directory")
    args = parser.parse_args()
    url = urllib.parse.urlsplit(args.base_url)
    if url.scheme not in {"http", "https"} or not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in {"", "/"}:
        parser.error("base-url must be an http/https origin without credentials or query")
    if args.output.exists() and any(args.output.iterdir()):
        parser.error("choose a new or empty output directory; existing evidence is not overwritten")
    args.output.mkdir(parents=True, exist_ok=True)
    origin = args.base_url.rstrip("/") + "/api"

    def request(path, data=None, binary=False):
        body = None if data is None else json.dumps(data, ensure_ascii=False).encode()
        req = urllib.request.Request(origin + path, data=body, headers={"content-type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=45) as response:
                raw = response.read(64 * 1024 * 1024 + 65536)
        except urllib.error.HTTPError as error:
            raise RuntimeError(f"{path}: HTTP {error.code}: {error.read(4096).decode(errors='replace')}") from error
        return raw if binary else json.loads(raw)

    source_bytes = (Path(__file__).resolve().parents[1] / "examples/survey-absolute.csv").read_bytes()
    project = request("/sample")
    project["id"] = "synthetic-review-" + uuid.uuid4().hex
    project["name"] = "合成試行・青葉川の測量点形式"
    source = {
        "csv": source_bytes.decode("utf-8"), "file_name": "survey-absolute.csv", "unit": "m",
        "elevation_mode": "absolute", "vertical_datum": "合成サンプルの仮想基準高（実測ではない）",
        "horizontal_reference": "上流から下流への局所流下距離・横断x、m",
        "dataset": {"data_kind": "synthetic", "source_url": "https://github.com/rsasaki0109/DobokuAI/blob/eb43ef0771afe126d79c6cecc12e0c041573b14a/examples/survey-absolute.csv",
                    "attribution": "DobokuAIの合成サンプル", "usage_terms": "実測ではない合成試行用。リポジトリのNOTICE.mdを参照。",
                    "survey_date": "", "processing": "合成台形断面を4頂点の絶対標高CSVで表現。並べ替え・平滑化・基準高変換なし。"},
    }
    preview = request("/imports/survey/preview", source)
    assert preview["valid"] and preview["geometry"]["can_import"]
    project = request("/imports/survey/apply", {"source": source, "project": project, "confirmed": True, "review_token": preview["review_token"]})
    assert project["reference"]["import"]["sha256"] == hashlib.sha256(source_bytes).hexdigest()
    request("/projects", project)
    run = request("/runs", {"project": project, "scenarios": [{"name": "合成河道・1m掘削", "modification": {"kind": "excavate", "depth": 1}}], "staged": False})
    sensitivity = request("/sensitivity/runs", {"project": project, "cases": [{"parameter": "discharge", "value": 120}, {"parameter": "discharge", "value": 10000}]})
    resolution = request("/resolution/runs", {"project": project, "confirmed_interpolation": True})
    selection = {"run_id": run["id"], "sensitivity_id": sensitivity["id"], "resolution_id": resolution["id"]}
    manifest_preview = request("/review-packs/preview", selection)
    packed = request("/review-packs/zip", selection, binary=True)
    expected_names = {"index.html", "README.txt", "manifest.json", "conditions.json"}
    expected_names.update(f"{kind}.{ext}" for kind in ["construction", "sensitivity", "resolution"] for ext in ["json", "csv", "html"])
    with zipfile.ZipFile(io.BytesIO(packed)) as archive:
        assert set(archive.namelist()) == expected_names and archive.testzip() is None
        files = {name: archive.read(name) for name in expected_names}
    manifest = json.loads(files["manifest.json"])
    assert manifest["files"] == manifest_preview["files"]
    for info in manifest["files"]:
        content = files[info["path"]]
        assert len(content) == info["bytes"] and hashlib.sha256(content).hexdigest() == info["sha256"]
    assert hashlib.sha256(files["conditions.json"]).hexdigest() == manifest["conditions_sha256"]
    for name, stored, path in [("construction", run, f"/runs/{run['id']}"), ("sensitivity", sensitivity, f"/sensitivity/runs/{sensitivity['id']}"), ("resolution", resolution, f"/resolution/runs/{resolution['id']}")]:
        assert json.loads(files[name + ".json"]) == stored
        for ext in ["csv", "html"]:
            assert files[name + "." + ext] == request(path + "/reports/" + ext, binary=True)
    rows = list(csv.DictReader(io.StringIO(files["sensitivity.csv"].decode("utf-8-sig"))))
    failed = [row for row in rows if row["status"] == "failed"]
    assert len(failed) == 1 and all(failed[0][key] == "" for key in ["water_elevation_m", "depth_m", "velocity_m_s", "executed_at"])
    for kind in ["runs", "sensitivity-runs", "resolution-runs"]:
        assert len(request(f"/projects/{project['id']}/{kind}")["items"]) == 1
    assert request(f"/projects/{project['id']}") == project
    (args.output / "sample.zip").write_bytes(packed)
    (args.output / "source.csv").write_bytes(source_bytes)
    (args.output / "source-and-preview.json").write_text(json.dumps({"source": source, "preview": preview}, ensure_ascii=False, indent=2), encoding="utf-8")
    report = {"data_kind": "synthetic", "project_id": project["id"], "selection": selection,
              "verified_files": len(files), "individual_exports_equal": 6, "failed_sensitivity_numeric_fields_empty": True,
              "cut_volume_m3": run["analysis"]["comparisons"][0]["cut_volume"],
              "max_water_change_m": run["analysis"]["comparisons"][0]["max_water_change"],
              "engine_version": run["analysis"]["run"]["engine_version"], "executed_at": run["analysis"]["run"]["executed_at"],
              "zip_sha256": hashlib.sha256(packed).hexdigest(), "adopted_field_datasets": 0}
    (args.output / "trial-result.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
