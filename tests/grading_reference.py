"""Independent composite midpoint integration of positive cut/fill differences.

No closed-form crossing split. Synthetic profiles only, metres and m².
Regenerate: python3 tests/grading_reference.py
Verify: python3 tests/grading_reference.py --check
"""
import argparse
import json
import math
from pathlib import Path

TARGET = Path(__file__).resolve().parents[1] / 'examples/grading-reference.json'


def integrate(spans, target, count):
    cut, fill = [], []
    for span in spans:
        dx = span['end_m'] - span['start_m']
        a = span['ground']['start_elevation_m']
        b = span['ground']['end_elevation_m']
        cut.append(dx / count * math.fsum(max(0, a + (b-a)*(i+.5)/count - target) for i in range(count)))
        fill.append(dx / count * math.fsum(max(0, target - a - (b-a)*(i+.5)/count) for i in range(count)))
    return dict(cut_area_m2=math.fsum(cut), fill_area_m2=math.fsum(fill))


def reference(name, coordinates, target):
    spans = [dict(start_m=a[0], end_m=b[0], ground=dict(status='unique', start_elevation_m=a[1], end_elevation_m=b[1]))
             for a, b in zip(coordinates, coordinates[1:])]
    coarse, fine = integrate(spans, target, 65536), integrate(spans, target, 131072)
    assert max(abs(fine[k]-coarse[k]) for k in fine) < 1e-7, name
    return dict(name=name, profile=dict(length_m=coordinates[-1][0], spans=spans, unresolved_points_m=[]),
                target_elevation_m=target, expected=fine)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    cases = [reference('flat cut', [(0, 102), (10, 102)], 100),
             reference('flat fill', [(0, 98), (10, 98)], 100),
             reference('asymmetric crossing', [(0, 99), (10, 103)], 100),
             reference('non-dyadic crossing', [(0, 99.3), (13.7, 103.1)], 100.2),
             reference('negative datum', [(0, -3.7), (24.2, -.6)], -2.3),
             reference('multiple ridges and troughs', [(0, 3), (4.1, -2), (12.3, 4), (25.7, 1), (31, -3)], .7),
             reference('reversed asymmetric crossing', [(0, 103), (10, 99)], 100),
             reference('subdivision at zero difference', [(0, 99), (2.5, 100), (10, 103)], 100),
             reference('no difference', [(0, 1.2), (10, 1.2)], 1.2)]
    body = dict(method='Composite midpoint quadrature, 131072 samples per span; comparison with 65536 samples differs by less than 1e-7 m²', cases=cases)
    serialized = json.dumps(body, ensure_ascii=False, indent=2, allow_nan=False) + '\n'
    if args.check:
        assert TARGET.read_text() == serialized, 'grading reference fixture differs; investigate before updating'
    else:
        TARGET.write_text(serialized)
    print(f'{len(cases)} independent grading reference cases verified' if args.check else f'{len(cases)} independent grading reference cases generated')


if __name__ == '__main__':
    main()
