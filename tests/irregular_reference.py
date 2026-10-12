"""Irregular-bed references using horizontal-strip integration and continuous GVF.

No Rust or standard-step imports. Multiple strips below a submerged bed ridge
are integrated separately; the actual water surface must have one interval.
All cases synthetic. Acceptance limits set before the Rust comparison.
"""
import argparse
import json
import math
from pathlib import Path
import reference_cases as reference

POINTS = [(-10, 6), (-5, .6), (-3, 0), (-1, .12), (1, .04), (3, .18), (5, .5), (9, 6)]


def strips(points, level):
    crossings = []
    for a, b in zip(points, points[1:]):
        if min(a[1], b[1]) <= level < max(a[1], b[1]):
            crossings.append(a[0]+(b[0]-a[0])*(level-a[1])/(b[1]-a[1]))
    crossings.sort()
    if len(crossings) % 2:
        raise ValueError('Unpaired horizontal intersections')
    return [(a,b) for a,b in zip(crossings[::2],crossings[1::2]) if b>a]


def geometry(points, depth):
    surface = strips(points, depth)
    if len(surface) != 1:
        raise ValueError('The reference water surface is disconnected')
    levels = sorted({0., depth, *(z for _,z in points if 0<z<depth)})
    # T(level) is affine within each interval. Midpoint integration is exact
    # and avoids counting a dry bank bench at an interval endpoint.
    area = math.fsum((b-a)*sum(right-left for left,right in strips(points,(a+b)/2)) for a,b in zip(levels,levels[1:]))
    perimeter = 0.
    for a,b in zip(points,points[1:]):
        low,high=sorted([a[1],b[1]])
        fraction=1. if high<=depth else 0. if low>=depth else (depth-low)/(high-low)
        perimeter+=math.hypot(b[0]-a[0],b[1]-a[1])*fraction
    return area,perimeter,surface[0][1]-surface[0][0]


def generate():
    # Hand-integrated W-shaped section, including two separate low strips.
    hand=[(0,4),(1,0),(2,2),(3,1),(4,4)]
    area,_,width=geometry(hand,3)
    assert abs(area-127/24)<1e-12 and abs(width-41/12)<1e-12
    assert len(strips(hand,1.5))==2
    reference.survey_geometry=geometry
    reference.CASES=[
        dict(id='irregular_subcritical',description='Nonuniform backwater above unsmoothed bed ridges',length=400,sample_dx=40,coarse_dx=20,fine_dx=4,discharge=15,roughness=.035,slope=.001,regime='subcritical',boundary_depth=3.6,section=dict(kind='survey',points=[dict(x=x,z=z) for x,z in POINTS]),width_gradient=0,depth_tolerance=5e-5,minimum_improvement=15),
        dict(id='irregular_supercritical',description='Nonuniform supercritical profile above submerged bed ridges',length=100,sample_dx=10,coarse_dx=5,fine_dx=1,discharge=15,roughness=.025,slope=.02,regime='supercritical',boundary_depth=.5,section=dict(kind='survey',points=[dict(x=x,z=z) for x,z in POINTS]),width_gradient=0,depth_tolerance=1e-4,minimum_improvement=10),
    ]
    return reference.generate()


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--check',action='store_true');args=parser.parse_args()
    data=generate();target=Path(__file__).resolve().parents[1]/'examples/reference-irregular.json'
    if args.check:
        old=json.loads(target.read_text())
        assert old.keys()==data.keys() and len(old['cases'])==len(data['cases'])
        for a,b in zip(old['cases'],data['cases']):
            assert {k:v for k,v in a.items() if k not in ['rows','reference_refinement_m']}=={k:v for k,v in b.items() if k not in ['rows','reference_refinement_m']}
            assert 0<=b['reference_refinement_m']<1e-9 and len(a['rows'])==len(b['rows'])
            for ar,br in zip(a['rows'],b['rows']):
                assert ar.keys()==br.keys()
                assert all(abs(ar[k]-br[k])<1e-9 for k in ar)
        print('Irregular reference conditions and values verified')
    else:
        target.write_text(json.dumps(data,indent=2)+'\n')


if __name__=='__main__':
    main()
