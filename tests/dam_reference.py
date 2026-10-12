"""Independent composite Simpson integration, not the Rust closed-form formulas.

Regenerate: python3 tests/dam_reference.py
Verify checked-in fixture: python3 tests/dam_reference.py --check
All cases synthetic; no field validation or code-compliance claim.
"""
import argparse
import json
import math
from pathlib import Path

TARGET = Path(__file__).resolve().parents[1] / 'examples/dam-reference.json'


def integrate(func, start, end, intervals=4096):
    if start == end:
        return 0.0
    dz = (end-start)/intervals
    return dz/3 * math.fsum(func(start+i*dz) * (1 if i in (0, intervals) else 4 if i % 2 else 2) for i in range(intervals+1))


def reference(name, h, c, b, hu, hd, gc=24, gw=9.80665, mu=.7):
    slope = (b-c)/h
    width = lambda z: b-slope*z
    area = integrate(width, 0, h)
    weight = integrate(lambda z: gc*width(z), 0, h)
    cx = integrate(lambda z: width(z)**2/2, 0, h)/area
    cz = integrate(lambda z: z*width(z), 0, h)/area
    pu = integrate(lambda z: gw*(hu-z), 0, hu)
    pd = integrate(lambda z: gw*(hd-z), 0, hd)
    vd = integrate(lambda z: slope*gw*(hd-z), 0, hd)
    up = lambda x: gw*(hu+(hd-hu)*x/b)
    uplift = integrate(up, 0, b)
    mx = integrate(lambda x: x*up(x), 0, b)
    ux = mx/uplift if uplift else None
    # Moments by integration of actual force application coordinates.
    resisting = integrate(lambda z: gc*(b*width(z)-width(z)**2/2), 0, h)
    resisting += integrate(lambda z: gw*(hd-z)*(z+slope*(b-width(z))), 0, hd)
    overturning = integrate(lambda z: gw*(hu-z)*z, 0, hu) + integrate(lambda x: (b-x)*up(x), 0, b)
    vertical = weight+vd-uplift
    horizontal = pu-pd
    resultant = b-(resisting-overturning)/vertical if vertical > 0 else None
    eccentricity = resultant-b/2 if resultant is not None else None
    contact = 'no_compression' if resultant is None else 'outside_base' if not 0 < resultant < b else 'partial' if abs(eccentricity) > b/6+1e-12*b else 'full'
    return {
        'name': name,
        'input': dict(height_m=h, crest_width_m=c, base_width_m=b, upstream_depth_m=hu, downstream_depth_m=hd, concrete_unit_weight_kn_m3=gc, water_unit_weight_kn_m3=gw, friction_coefficient=mu),
        'expected': dict(area_m2=area, centroid_x_m=cx, centroid_z_m=cz, weight_kn_m=weight, upstream_horizontal_kn_m=pu, downstream_horizontal_kn_m=pd, downstream_vertical_kn_m=vd, uplift_kn_m=uplift, uplift_x_m=ux, effective_vertical_kn_m=vertical, net_horizontal_kn_m=horizontal, resisting_moment_knm_m=resisting, overturning_moment_knm_m=overturning, resultant_x_m=resultant, eccentricity_m=eccentricity, contact=contact,
                         sliding_ratio=mu*max(0, vertical)/horizontal if horizontal > 0 else None, overturning_ratio=resisting/overturning if overturning > 0 else None,
                         heel_pressure_kpa=vertical/b*(1-6*eccentricity/b) if contact == 'full' else None,
                         toe_pressure_kpa=vertical/b*(1+6*eccentricity/b) if contact == 'full' else None),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    cases = [reference('rectangular hand calculation', 10, 10, 10, 8, 2, 20, 10, .5),
             reference('trapezoid with tailwater', 30, 5, 24, 27, 3),
             reference('dry trapezoid', 40, 8, 32, 0, 0),
             reference('equal levels on sloped face', 30, 5, 24, 20, 20),
             reference('partial contact', 10, 1, 5, 8, 0, 20, 10, .5),
             reference('resultant outside foundation', 10, 1, 3, 8, 0, 20, 10, .5),
             reference('uplift exceeds compression', 10, 1, 100, 10, 0, 10, 15, .5)]
    body = dict(method='Composite Simpson integration of concrete slices, face pressure and foundation uplift; 4096 intervals', cases=cases)
    serialized = json.dumps(body, ensure_ascii=False, indent=2, allow_nan=False)+'\n'
    if args.check:
        assert TARGET.read_text() == serialized, 'dam reference fixture differs; investigate before updating'
    else:
        TARGET.write_text(serialized)
    print(f'{len(cases)} independent dam reference cases verified' if args.check else f'{len(cases)} independent dam reference cases generated')


if __name__ == '__main__':
    main()
