"""Independent reference: integrate GVF ODE using fixed-step RK4 (not standard step).
SI: B=10 m, Q=20 m³/s, n=.03, S0=.001, L=1000 m, downstream depth=2.5 m.
Regenerate with `python tests/reference_gvf.py`; no external dependencies.
"""
import json
from pathlib import Path
B, Q, N, S0, G = 10.0, 20.0, 0.03, 0.001, 9.80665

def derivative(y):
    area = B*y
    radius = area/(B+2*y)
    sf = (N*Q/(area*radius**(2/3)))**2
    fr2 = Q**2/(G*B**2*y**3)
    return (S0-sf)/(1-fr2)

def integrate(step):
    x, y, values = 1000., 2.5, {1000:2.5}
    h = -step
    for i in range(round(1000/step)):
        k1 = derivative(y)
        k2 = derivative(y+h*k1/2)
        k3 = derivative(y+h*k2/2)
        k4 = derivative(y+h*k3)
        y += h*(k1+2*k2+2*k3+k4)/6
        x = 1000-(i+1)*step
        if abs(x/100-round(x/100))<1e-8: values[round(x)] = y
    return values

if __name__ == '__main__':
    a, b = integrate(.05), integrate(.025)
    assert max(abs(a[x]-b[x]) for x in a)<1e-10
    data = {'method':'Independent GVF ODE RK4, dx=0.025m; checked against dx=0.05m','rows':[{'chainage':x,'depth':b[x]} for x in sorted(b)]}
    Path('examples/reference-gvf.json').write_text(json.dumps(data,indent=2)+'\n')
    print('11 reference depths; RK4 refinement difference < 1e-10m')
