"""Independent GVF references for additional hydraulic validation cases.

No DobokuAI imports or standard-step equations are used. Integrate the continuous
energy ODE with RK4; survey area is integrated from horizontal water widths.
SI units, g=9.80665, alpha=1, constant discharge/n, no local losses or jumps.
The fixtures are synthetic verification cases, not observed river calibrations.

Run from any directory: python3 tests/reference_cases.py [--check]
"""

import argparse
import copy
import json
import math
from pathlib import Path

G = 9.80665
ROOT = Path(__file__).resolve().parents[1]
SURVEY = [(-12, 8), (-6, 2), (-2, 0), (3, 0), (9, 3), (13, 8)]
CASES = [
    dict(id="rectangle_supercritical", description="Nonuniform supercritical flow on a steep rectangular bed",
         length=100, sample_dx=10, coarse_dx=5, fine_dx=1, discharge=20,
         roughness=.03, slope=.02, regime="supercritical", boundary_depth=.5,
         section=dict(kind="rectangle", width=10, bank_height=8), width_gradient=0,
         depth_tolerance=1e-4, minimum_improvement=10),
    dict(id="trapezoid_supercritical", description="Nonuniform supercritical flow in a trapezoidal channel",
         length=100, sample_dx=10, coarse_dx=5, fine_dx=1, discharge=15,
         roughness=.025, slope=.02, regime="supercritical", boundary_depth=.5,
         section=dict(kind="trapezoid", bottom_width=6, side_slope=1, bank_height=8),
         width_gradient=0, depth_tolerance=1e-4, minimum_improvement=10),
    dict(id="trapezoid_subcritical", description="M1 backwater in a trapezoidal channel",
         length=400, sample_dx=40, coarse_dx=20, fine_dx=4, discharge=30,
         roughness=.025, slope=.001, regime="subcritical", boundary_depth=3,
         section=dict(kind="trapezoid", bottom_width=8, side_slope=1.25, bank_height=8),
         width_gradient=0, depth_tolerance=5e-5, minimum_improvement=15),
    dict(id="survey_subcritical", description="Asymmetric single-valley survey with changing side slopes",
         length=400, sample_dx=40, coarse_dx=20, fine_dx=4, discharge=15,
         roughness=.035, slope=.001, regime="subcritical", boundary_depth=3.6,
         section=dict(kind="survey", points=[dict(x=x, z=z) for x, z in SURVEY]),
         width_gradient=0, depth_tolerance=5e-5, minimum_improvement=15),
    dict(id="survey_vertex_crossing", description="Backwater whose wetted edge crosses a survey side-slope vertex",
         length=1000, sample_dx=100, coarse_dx=50, fine_dx=6.25, discharge=15,
         roughness=.035, slope=.001, regime="subcritical", boundary_depth=2.5,
         section=dict(kind="survey", points=[dict(x=x, z=z) for x, z in SURVEY]),
         width_gradient=0, depth_tolerance=1e-4, minimum_improvement=20),
    dict(id="widening_rectangle_subcritical", description="Gradual rectangular widening from 8 to 12m",
         length=400, sample_dx=40, coarse_dx=20, fine_dx=4, discharge=25,
         roughness=.03, slope=.001, regime="subcritical", boundary_depth=3,
         section=dict(kind="rectangle", width=8, bank_height=8), width_gradient=.01,
         depth_tolerance=5e-5, minimum_improvement=15),
]


def survey_width(points, level):
    """Intersections with a horizontal strip, including a flat channel bottom."""
    intersections = []
    for a, b in zip(points, points[1:]):
        if a[1] == b[1]:
            if level == a[1]:
                intersections.extend([a[0], b[0]])
        elif min(a[1], b[1]) <= level <= max(a[1], b[1]):
            intersections.append(a[0] + (b[0] - a[0]) * (level - a[1]) / (b[1] - a[1]))
    if len(intersections) < 2:
        raise ValueError("No connected horizontal water width")
    return max(intersections) - min(intersections)


def survey_geometry(points, depth):
    levels = sorted({0., depth, *(z for _, z in points if 0 < z < depth)})
    area = sum((survey_width(points, a) + survey_width(points, b)) * (b - a) / 2
               for a, b in zip(levels, levels[1:]))
    perimeter = 0.
    for a, b in zip(points, points[1:]):
        low, high = sorted([a[1], b[1]])
        fraction = 1. if high <= depth else 0. if low >= depth else (depth - low) / (high - low)
        perimeter += math.hypot(b[0] - a[0], b[1] - a[1]) * fraction
    return area, perimeter, survey_width(points, depth)


def section_at(case, x):
    section = copy.deepcopy(case["section"])
    if case["width_gradient"]:
        section["width"] += case["width_gradient"] * x
    return section


def geometry(case, x, depth):
    s = case["section"]
    bank = min(s["points"][0]["z"], s["points"][-1]["z"]) if s["kind"] == "survey" else s["bank_height"]
    if not math.isfinite(depth) or not 0 < depth < bank:
        raise ValueError(f"{case['id']}: nonphysical/overflow reference depth {depth}")
    if s["kind"] == "rectangle":
        width = s["width"] + case["width_gradient"] * x
        return width * depth, width + 2 * depth, width
    if s["kind"] == "trapezoid":
        b, m = s["bottom_width"], s["side_slope"]
        return (b + m * depth) * depth, b + 2 * depth * math.hypot(1, m), b + 2 * m * depth
    return survey_geometry([(p["x"], p["z"]) for p in s["points"]], depth)


def state(case, x, depth):
    area, perimeter, width = geometry(case, x, depth)
    q = case["discharge"]
    friction = (case["roughness"] * q / (area * (area / perimeter) ** (2 / 3))) ** 2
    fr2 = q * q * width / (G * area ** 3)
    valid = fr2 < .98 ** 2 if case["regime"] == "subcritical" else fr2 > 1.02 ** 2
    if not valid:
        raise ValueError(f"{case['id']}: reference crossed the selected regime at x={x}")
    return area, perimeter, width, friction, fr2


def derivative(case, x, depth):
    area, _, _, friction, fr2 = state(case, x, depth)
    # E=z+y+Q^2/(2gA^2). dE/dx=-Sf. A_x is evaluated at fixed depth.
    area_x = case["width_gradient"] * depth
    return (case["slope"] - friction + case["discharge"] ** 2 * area_x / (G * area ** 3)) / (1 - fr2)


def integrate(case, step):
    downstream = case["regime"] == "supercritical"
    length = case["length"]
    start = 0 if downstream else length
    sign = 1 if downstream else -1
    h = sign * step
    depth = case["boundary_depth"]
    values = {start: depth}
    count = round(length / step)
    sample_every = round(case["sample_dx"] / step)
    assert math.isclose(count * step, length, abs_tol=1e-10)
    assert math.isclose(sample_every * step, case["sample_dx"], abs_tol=1e-10)
    for i in range(count):
        x = start + sign * i * step
        k1 = derivative(case, x, depth)
        k2 = derivative(case, x + h / 2, depth + h * k1 / 2)
        k3 = derivative(case, x + h / 2, depth + h * k2 / 2)
        k4 = derivative(case, x + h, depth + h * k3)
        depth += h * (k1 + 2 * k2 + 2 * k3 + k4) / 6
        if (i + 1) % sample_every == 0:
            values[round(start + sign * (i + 1) * step)] = depth
    return values


def self_check():
    # Strip integration reproduces independent hand integrals across side-slope changes.
    a, _, t = survey_geometry(SURVEY, 1.5)
    assert abs(a - 12) < 1e-12 and abs(t - 11) < 1e-12
    a, p, t = survey_geometry(SURVEY, 4)
    assert abs(a - 49.4) < 1e-12 and abs(t - 17.8) < 1e-12
    expected_p = 5 + math.sqrt(20) + math.sqrt(8) + math.sqrt(45) + math.hypot(.8, 1)
    assert abs(p - expected_p) < 1e-12


def generate():
    self_check()
    result = []
    for case in CASES:
        coarse_ref, fine_ref = integrate(case, .02), integrate(case, .01)
        refinement_error = max(abs(coarse_ref[x] - fine_ref[x]) for x in fine_ref)
        assert refinement_error < 1e-9, (case["id"], refinement_error)
        river = dict(discharge=case["discharge"], normal_slope=case["slope"],
                     boundary=dict(regime=case["regime"], depth=case["boundary_depth"]),
                     stations=[dict(chainage=x, bed_elevation=20 - case["slope"] * x,
                                    roughness=case["roughness"], section=section_at(case, x))
                               for x in range(0, case["length"] + 1, case["coarse_dx"])])
        rows = []
        for x, depth in sorted(fine_ref.items()):
            area, perimeter, width, sf, fr2 = state(case, x, depth)
            rows.append(dict(chainage=x, depth=depth, water_elevation=20 - case["slope"] * x + depth,
                             area=area, perimeter=perimeter, top_width=width,
                             velocity=case["discharge"] / area, froude=math.sqrt(fr2), friction_slope=sf))
        result.append(dict(id=case["id"], description=case["description"], river=river,
                           fine_dx=case["fine_dx"], depth_tolerance_m=case["depth_tolerance"],
                           minimum_improvement=case["minimum_improvement"], reference_refinement_m=refinement_error,
                           rows=rows))
        print(f"{case['id']}: 11 depths; RK4 .02/.01m difference={refinement_error:.3e}m")
    return dict(method="Independent continuous-energy GVF ODE, fixed-step RK4 .01m verified against .02m",
                equation="dy/dx=(S0-Sf+Q^2*A_x/(g*A^3))/(1-Fr^2); A_x at fixed y",
                assumptions="SI; g=9.80665; alpha=1; constant Q/n; hydrostatic; no local losses; synthetic data",
                cases=result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Verify stored fixture without modifying it")
    args = parser.parse_args()
    data = generate()
    target = ROOT / "examples/reference-cases.json"
    if args.check:
        existing = json.loads(target.read_text())
        assert {k: v for k, v in data.items() if k != "cases"} == {k: v for k, v in existing.items() if k != "cases"}
        assert len(existing["cases"]) == len(data["cases"])
        for a, b in zip(existing["cases"], data["cases"]):
            assert {k: v for k, v in a.items() if k not in ("rows", "reference_refinement_m")} == {k: v for k, v in b.items() if k not in ("rows", "reference_refinement_m")}
            assert len(a["rows"]) == len(b["rows"])
            assert 0 <= a["reference_refinement_m"] < 1e-9
            for ar, br in zip(a["rows"], b["rows"]):
                assert ar.keys() == br.keys()
                assert all(abs(ar[k] - br[k]) < 1e-9 for k in ar), (a["id"], ar, br)
        print("PASS: stored conditions and reference values match independent regeneration")
    else:
        target.write_text(json.dumps(data, indent=2) + "\n")


if __name__ == "__main__":
    main()
