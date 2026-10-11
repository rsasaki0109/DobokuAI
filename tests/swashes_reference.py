"""Generate/check external SWASHES references; never imports the Rust solver.

SWASHES binary is an optional development tool, outside the product. Default
checks read the numerical fixture without requiring it. Explicit --download
fetches a pinned Linux x86_64 binary; TLS and the inherited proxy remain enabled.
"""
import argparse
import hashlib
import io
import json
import math
import platform
import subprocess
from pathlib import Path
from urllib.request import urlopen
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
WHEEL_URL = 'https://files.pythonhosted.org/packages/27/76/ef555970c79ad5a4f9fddeacd67c8e03a63691d7dbfd8c54ebb2f7bb0617/swashes-1.5.0-cp312-cp312-manylinux_2_17_x86_64.manylinux2014_x86_64.whl'
WHEEL_SHA256 = '14a1d359c9baa8b21ce384180fee21b47e42818c1092d8a7dedd4d2a0158607c'
BINARY_SHA256 = 'dbebe68fb9f26df4bcc4ca88ff8e4aafb78ba26750a64b86e423f7beeaaf4b24'
G_EXTERNAL = 9.81
G_ENGINE = 9.80665
STATIONS = 177
FACTORS = (2049, 4097)
# Frozen after exploratory runs at 193 stations and before generating the 177
# station validation fixture. Do not relax to accommodate a failed comparison.
BED_REFINEMENT_TOL = 5e-6
DEPTH_TOL = 1e-4
MINIMUM_IMPROVEMENT = 4.0


def checksum(data):
    return hashlib.sha256(data).hexdigest()


def download(executable):
    if platform.system() != 'Linux' or platform.machine() != 'x86_64':
        raise ValueError('Pinned external tool requires Linux x86_64; use the stored fixture elsewhere')
    with urlopen(WHEEL_URL, timeout=30) as response:
        data = response.read(2_000_000)
    if checksum(data) != WHEEL_SHA256:
        raise ValueError('SWASHES wheel checksum mismatch')
    with ZipFile(io.BytesIO(data)) as wheel:
        binary = wheel.read('swashes/data/bin/swashes')
    if checksum(binary) != BINARY_SHA256:
        raise ValueError('SWASHES executable checksum mismatch')
    executable.parent.mkdir(parents=True, exist_ok=True)
    executable.write_bytes(binary)
    executable.chmod(0o755)
    return checksum(binary)


def external(executable, choice, factor):
    args = ['1.5', '1', '1', str(choice), str(STATIONS * factor)]
    output = subprocess.run([str(executable), *args], capture_output=True, check=True, timeout=60).stdout
    text = output.decode()
    if 'SWASHES version 1.05.00, 2025-04-22' not in text:
        raise ValueError('Unexpected SWASHES version')
    if "Manning's friction coefficient: 0.03" not in text or '20 m^3/s' not in text:
        raise ValueError('Unexpected case parameters')
    rows = []
    offset = (factor - 1) // 2
    index = 0
    for line in text.splitlines():
        if not line.strip() or line.startswith('#'):
            continue
        if index >= offset and (index - offset) % factor == 0:
            values = list(map(float, line.split()))
            if len(values) != 4 or not all(map(math.isfinite, values)):
                raise ValueError('Unexpected external numerical output')
            x, depth, bed, stage = values
            if abs(bed + depth - stage) > 2e-6:
                raise ValueError('External stage inconsistent with depth and bed')
            rows.append(dict(chainage=x, depth=depth, bed_elevation=bed, water_elevation=stage))
        index += 1
    if index != STATIONS * factor or len(rows) != STATIONS:
        raise ValueError('External output sample count mismatch')
    return rows, checksum(output), args


def generate(executable):
    if checksum(executable.read_bytes()) != BINARY_SHA256:
        raise ValueError('SWASHES executable checksum mismatch; use --download to acquire the pinned tool')
    cases = []
    q = 20 * math.sqrt(G_ENGINE / G_EXTERNAL)
    n = .03 * math.sqrt(G_EXTERNAL / G_ENGINE)
    for choice, regime in [(1, 'subcritical'), (2, 'supercritical')]:
        a, sha_a, args_a = external(executable, choice, FACTORS[0])
        b, sha_b, args_b = external(executable, choice, FACTORS[1])
        if any(x['chainage'] != y['chainage'] or x['depth'] != y['depth'] for x, y in zip(a, b)):
            raise ValueError('Nested external sampling points are not identical')
        difference = max(abs(x['bed_elevation'] - y['bed_elevation']) for x, y in zip(a, b))
        if difference > BED_REFINEMENT_TOL:
            raise ValueError(f'{regime}: external bed refinement {difference} exceeds frozen tolerance')
        stations = [dict(chainage=r['chainage'], bed_elevation=r['bed_elevation'], roughness=n,
                         section=dict(kind='rectangle', bank_height=8,
                                      width=10 - 5 * math.exp(-10 * (r['chainage'] / 200 - .5) ** 2))) for r in b]
        boundary = b[-1] if choice == 1 else b[0]
        river = dict(discharge=q, normal_slope=.01,
                     boundary=dict(regime=regime, depth=boundary['depth']), stations=stations)
        cases.append(dict(id=f'swashes_b1_{regime}', river=river, rows=b, coarse_stride=4,
                          depth_tolerance_m=DEPTH_TOL, minimum_improvement=MINIMUM_IMPROVEMENT,
                          external_bed_refinement_m=difference,
                          external_coarse=dict(arguments=args_a, stdout_sha256=sha_a),
                          external_fine=dict(arguments=args_b, stdout_sha256=sha_b)))
        print(f'{regime}: 177 shared points; external bed refinement {difference:.3e}m')
    return dict(source=dict(name='SWASHES', binary_version='1.05.00, 2025-04-22',
                            wrapper_version='1.5.0', wheel_url=WHEEL_URL, wheel_sha256=WHEEL_SHA256,
                            binary_sha256=checksum(executable.read_bytes()),
                            declared_software_license='CECILL-2.0',
                            publication_doi='10.1002/fld.3741'),
                interpretation=dict(section='MacDonald pseudo2D rectangular B1: B(x)=10-5*exp(-10*(x/200-0.5)^2)',
                                    external_gravity=G_EXTERNAL, engine_gravity=G_ENGINE,
                                    external_discharge=20, external_roughness=.03,
                                    normalization='Q_engine=Q_external*sqrt(g_engine/g_external); n_engine=n_external*sqrt(g_external/g_engine). Preserves Q^2/g and (nQ)^2, hence depth/energy/friction equations. Velocity scales with Q.',
                                    boundary='Use sampled cell-center boundary depth; no extrapolation to x=0/200. Both sides share the same truncated reach.',
                                    note='External analytic hydraulic verification, not observed river calibration. Refined SWASHES bed output has integration/printing error. 8m banks and .01 normal-depth diagnostic slope are adapter settings.'),
                criteria=dict(external_bed_refinement_tolerance_m=BED_REFINEMENT_TOL,
                              depth_tolerance_m=DEPTH_TOL, minimum_improvement=MINIMUM_IMPROVEMENT), cases=cases)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--download', action='store_true')
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--executable', type=Path, default=ROOT / '.local/reference-tools/swashes')
    args = parser.parse_args()
    executable = args.executable.resolve()
    if args.download:
        download(executable)
    data = generate(executable)
    target = ROOT / 'examples/swashes-reference.json'
    if args.check:
        if json.loads(target.read_text()) != data:
            raise ValueError('Stored external fixture does not match pinned regeneration')
        print('PASS: external SWASHES fixture matches pinned executable output')
    else:
        target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()
