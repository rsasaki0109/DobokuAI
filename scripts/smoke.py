"""Functional smoke test against a running API or Nginx proxy. No writes to projects."""
import json
import math
import sys
import urllib.error
import urllib.request
from pathlib import Path

base = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:3001'
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

def request(path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + '/api' + path, data=data, headers={'Content-Type':'application/json'})
    with opener.open(req, timeout=30) as response:
        return json.load(response)

assert request('/health')['status'] == 'ok'
sample = request('/sample')
analysis = request('/compare', {'project':sample, 'scenarios':[{'name':'掘削 1m', 'modification':{'kind':'excavate','depth':1.0}}]})
rows = analysis['run']['profile']['rows']
comparison = analysis['comparisons'][0]
assert len(rows) == 11
assert all(math.isfinite(row[k]) for row in rows for k in ['depth','water_elevation','velocity','froude'])
assert all(row['froude'] < .98 for row in rows)
assert abs(comparison['cut_volume']-32000) < .01
assert all(abs(area-32)<1e-8 for area in comparison['cut_areas'])
assert comparison['max_water_change'] < 0
assert abs(rows[-1]['water_elevation']-comparison['profile']['rows'][-1]['water_elevation']) < 1e-8
invalid = {**sample['river'], 'discharge':-1}
try:
    request('/simulate', invalid)
    raise AssertionError('invalid discharge accepted')
except urllib.error.HTTPError as e:
    assert e.code == 422
export_input = {'project':sample, 'scenarios':[{'name':'掘削 1m', 'modification':{'kind':'excavate','depth':1.0}}]}
for path, markers in [('csv',['cut_area_m2','conditions_json']),('html',['<svg','掘削断面積 m²','再現用条件'])]:
    req = urllib.request.Request(base+'/api/reports/'+path, data=json.dumps(export_input).encode(), headers={'Content-Type':'application/json'})
    with opener.open(req,timeout=30) as res:
        text = res.read().decode('utf-8-sig')
        assert all(marker in text for marker in markers)
print(f"PASS: 11-station subcritical solve, fixed-stage excavation comparison, cut=32000m³, delta={comparison['max_water_change']:.6f}m, invalid input=422")
print('PASS: per-station cut area=32m²; CSV conditions and HTML section/profile figures')

source = {'csv': (Path(__file__).resolve().parents[1]/'examples/survey-absolute.csv').read_bytes().decode('utf-8'), 'file_name':'survey-absolute.csv','elevation_mode':'absolute','unit':'m','vertical_datum':'合成サンプルの仮想基準高','horizontal_reference':'局所座標m'}
preview = request('/imports/survey/preview',source)
assert preview['valid'] and len(preview['stations']) == 11
imported = request('/imports/survey/apply',{'source':source,'project':sample,'confirmed':True,'review_token':preview['review_token']})
assert imported['scenarios'] == [] and imported['river']['discharge'] == 100
assert imported['reference']['import']['file_name'] == 'survey-absolute.csv'
sensitivity = request('/sensitivity',{'project':imported,'cases':[{'parameter':'discharge','value':80},{'parameter':'roughness','value':.035},{'parameter':'discharge','value':-1}]})
assert [c['status'] for c in sensitivity['cases']] == ['ok','ok','failed']
assert 'run' not in sensitivity['cases'][2]
assert sensitivity['baseline']['river']['discharge'] == 100
print('PASS: survey CSV preview/confirmation/provenance; sensitivity preserves conditions and reports failed cases')
