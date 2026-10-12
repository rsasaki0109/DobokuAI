# Architecture / MVP implementation plan

DobokuAI 0.1: source visibility is separate from licensing; no OSS license grant is implied.
SI units (m, m², m³, m³/s, s); dam statics use kN/m³, kN/m, kN·m/m and kPa.

| Module | Responsibility |
|---|---|
| doboku-core | Typed project, boundary, station and scenario contracts; engineering errors |
| doboku-geometry | Section validation, wet geometry, bank elevations, survey coordinates |
| doboku-hydraulics | Deterministic Manning, critical/normal depth, standard-step energy solver |
| doboku-structures | Gravity-dam rigid-body statics, full linear uplift, foundation contact diagnostics |
| doboku-earthwork | Survey-ground differences and trapezoidal reach-volume integration |
| doboku-planning | Explicit construction transformations and same-datum hydraulic comparison |
| doboku-agent | Proposed typed actions; offline Japanese parser; optional HTTP LLM adapter |
| doboku-api | Axum, SQLite projects/run snapshots, bounded blocking calculations, exports and HTTP validation |
| apps/web | React/TypeScript, 2D Recharts editors, comparison, confirmation and printable reports |

Dependency direction: core ← geometry ← hydraulics; geometry ← earthwork;
planning composes hydraulics + earthwork; API composes planning + agent. No LLM is used inside a numerical function.

`doboku-structures` depends only on core and serialization. The separate dam API composes
`hydraulics::spillway` and structures without coupling them to the river solver or illustrative
facility meshes. Only explicitly confirmed typed conditions are calculated and appended to
`dam_runs`; read/export/recovery use the original snapshot and model versions.
See [dam model and validation](dam-calculations.md).

Implementation order: workspace/contracts → engine → independent numerical validation → API → web/editor → profile/comparison → agent → report → containers/E2E.

## Hydraulic contract

Stations increase **upstream to downstream**. Bed elevation is in a single project datum.
Steady, incompressible, 1D, constant positive discharge, hydrostatic pressure, alpha=1,
single channel, uniform section roughness, no lateral inflow, no sediment transport.
Friction loss is the arithmetic mean of adjacent Manning friction slopes times reach length.
The solver uses bracketed bisection on the selected branch of specific energy.
Subcritical flow requires downstream depth; supercritical flow requires upstream depth.
Boundary water elevation stays fixed in construction comparisons unless the user edits it.

Rectangular/trapezoidal banks have a finite height. Surveyed sections are single-valley
piecewise-linear polylines, with strictly increasing x, monotonically falling then rising z.
No disconnected wet areas or vertical survey segments. Water must remain below both banks.
Critical flow (within a 2% Froude margin), missing branch roots, nonconvergence,
nonfinite inputs/results, adverse/flat normal-depth slopes, bank overflow, reach bed slopes
over 0.1, and adjacent width changes over 25% are rejected. This width check is a conservative
MVP guard, not proof that a real transition is gradual. Mixed regimes, hydraulic jumps,
structures, abrupt contractions, bends and local losses require another engine/model.
The user must assess actual transition geometry and survey spacing. These restrictions are
displayed in UI and reports. No claim of suitability for design certification is made.

## Construction contract

The optional station-spacing study is implemented in `doboku-hydraulics::resolution`,
independent of HTTP/storage/AI. It validates the original model before inserting
piecewise-linear intermediate stations, so refinement cannot evade abrupt-change guards.
`POST /api/resolution` requires explicit interpolation confirmation and computes baseline,
2-way and 4-way splits through the same bounded blocking pool. Its response retains the
project, full interpolated rivers/profiles, original-station differences, diagnostics,
engine version and UTC study timestamp. This operation does not write SQLite or change
projects/scenarios. The UI uses `POST /api/resolution/runs` to compute and append a server-created
snapshot to its own `resolution_runs` table. It pages project-scoped summaries, reopens original
conditions/results without changing the working project, and exports saved JSON/CSV/HTML without
recomputing. Reports include a separate scientific-scale difference plot, representative sections,
all successful profiles and explicit failure diagnostics. Recovery checks/copies this optional table;
old databases gain the table on startup. No client-provided numerical results are accepted for storage.
See [station spacing](station-spacing.md) for compatibility restrictions and validation.

Excavation preserves bank coordinates/elevations and lowers the bottom: rectangle walls
extend; trapezoid side slopes reconnect fixed banks to lowered toes; survey inner vertices
are lowered and endpoint banks remain fixed. Section replacements use the same datum.
A cofferdam is a **width-blockage proxy**, rectangular/trapezoidal sections only, without
structure losses, scour or stability. No cost/duration is generated without source data.
Volume integrates positive ground cuts over cross-section x and station distance; fill is
reported separately, never silently subtracted from excavation. Sections must have the
same survey width for volume accounting; section changes extending beyond surveyed banks
have uncomputed quantities with an explicit reason; hydraulic comparison can continue. Comparisons retain station positions and fixed boundary stage.

## AI and reproducibility

Agent output is a proposal of a closed enum of tools. Confirmation is required before apply.
LLM failures do not affect deterministic workflows; its explanation is labelled separately.
Provider adapter accepts an OpenAI-compatible chat endpoint, configurable URL/model/key.
No key is required for local rules or hydraulics. Exports retain input snapshot, version,
UTC execution timestamp, computed depths/stages/velocities, warnings and SVG section/profile.
Projects and append-only calculation snapshots are stored in SQLite. `POST /runs` computes
on the server and records a snapshot only after success; confirmed agent application also
records a snapshot. No endpoint accepts client-supplied numerical results as a saved run.
Snapshots retain input, scenarios, staged mode, outputs, engine version and execution time.
Loading or exporting a stored run does not invoke the current solver. JSON parsing enables
`float_roundtrip` so every serialized f64 is recovered exactly. Restoring a run into the UI
does not overwrite a saved project; edits invalidate the displayed snapshot, and subsequent
calculation appends a new run. Automatic startup previews and report-only recalculations do
not create history. Summary queries use project/id indexes and cursor pagination (20 rows).
Existing project databases gain the runs table on startup without changing project bodies.
There is no run deletion/retention UI, tamper-proof audit trail or future schema migration yet.

## Survey import, sensitivity and recovery

Project has a backward-compatible default SpatialReference with declared vertical datum,
horizontal reference and optional source CSV filename/SHA-256/UTC import time/mode/units.
Import validates bounded UTF-8 CSV without geometric repair, returns read-only diagnostics
and a source/options token, then requires explicit confirmation and token matching before
replacing station geometry and clearing construction scenarios. Saving and solving are
separate operations. Reports include reference metadata; the hash describes original CSV,
while subsequent edits are captured in the calculation snapshot, not in that source hash.

Sensitivity retains original geometry/datum/boundary depth and solves independent discharge
or whole-reach roughness cases. Baseline failure rejects the batch; failed alternatives
contain diagnostics without numerical results. It does not apply construction scenarios
or alter saved projects/construction history. The read-only comparison endpoint remains
stateless; the browser uses a separate create endpoint that computes and appends a typed
snapshot to `sensitivity_runs`. Project-scoped cursor pages, loading, CSV and HTML exports
use those snapshots without solving again. Failed alternatives have empty numerical CSV
fields. Opening an old comparison displays its original conditions/results but leaves the
working project's conditions unchanged. Online recovery includes sensitivity snapshots;
old databases gain the optional new table without rewriting projects or construction runs.

The recovery CLI uses SQLite's online backup API, checks integrity/schema/JSON, closes the
snapshot before hashing, and restores only into a newly created path. A live WAL database
with API-created projects/results is backed up, changed, restored and reopened in tests;
original results/conditions/timestamps must match exactly. Managed CA trust is mounted at
build/runtime and does not remain in final image layers. Production TLS stays enabled.
