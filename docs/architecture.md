# Architecture / MVP implementation plan

DobokuAI 0.2: source visibility is separate from licensing; no OSS license grant is implied.
SI units (m, m², m³, m³/s, s); dam statics use kN/m³, kN/m, kN·m/m and kPa.

| Module | Responsibility |
|---|---|
| doboku-core | Typed project, boundary, station and scenario contracts; engineering errors |
| doboku-geometry | Section validation, wet geometry, bank elevations, survey coordinates |
| doboku-hydraulics | Deterministic Manning, critical/normal depth, standard-step energy solver |
| doboku-structures | Gravity-dam rigid-body statics, full linear uplift, foundation contact diagnostics |
| doboku-earthwork | Survey-ground differences, trapezoidal reach volumes and separate horizontal-plane grading areas for linear profiles |
| doboku-planning | Explicit construction transformations and same-datum hydraulic comparison |
| doboku-agent | Proposed typed actions; offline Japanese parser; optional HTTP LLM adapter |
| doboku-api | Axum, SQLite projects/run snapshots, bounded blocking calculations, exports and HTTP validation |
| apps/web | React/TypeScript, 2D Recharts editors, comparison, confirmation and printable reports |

Dependency direction: core ← geometry ← hydraulics; geometry ← earthwork;
planning composes hydraulics + earthwork; API composes planning + agent and the independent grading module. No LLM is used inside a numerical function.

`doboku-structures` depends only on core and serialization. The separate dam API composes
`hydraulics::spillway` and structures without coupling them to the river solver or illustrative
facility meshes. Only explicitly confirmed typed conditions are calculated and appended to
`dam_runs`; read/export/recovery use the original snapshot and model versions.
See [dam model and validation](dam-calculations.md).

Implementation order: workspace/contracts → engine → independent numerical validation → API → web/editor → profile/comparison → agent → report → containers/E2E.

## CityGML display workspace

`apps/web/src/cityModel.ts` reads bounded embedded CityGML surfaces in the browser,
validates declared CRS/dimensions and rings, and triangulates display geometry.
`CityWorkspace.tsx` separates input, reviewed candidates and confirmed display/footprints.
`cityTerrain.ts` inspects source terrain triangles at five display-coordinate points;
it reports missing or ambiguous heights without extrapolation or a whole-area coverage claim.
An explicit picking mode takes horizontal positions from the rendered mesh raycast,
then rechecks source double-precision terrain heights before staging a footprint candidate.
Orbit drags do not select candidates; footprint confirmation updates the marker and exported footprint.
This is browser display geometry inspection, separate from Rust engineering solvers.
`cityReport.ts` exports confirmed footprint inspection as self-contained HTML/CSV,
with source hashes, display version, UTC creation time and explicit missing/ambiguous points.
The HTML includes a companion CSV and a north-up schematic; it never represents full terrain coverage.
`citySections.ts` intersects display terrain triangles with two confirmed centerlines and sweeps their boundaries.
Missing spans, inconsistent height functions and vertical projections remain explicit.
`CitySectionsView.tsx` draws separate valid intervals; `citySectionCSV.ts` records points and intervals with provenance.
`citySectionReport.ts` statically renders that same view into an offline HTML document with expanded
point/interval tables and an embedded companion CSV. A shared section snapshot normalizes UTC timestamps,
checks centerline axes/lengths/endpoints against the confirmed footprint, and copies the section results.
The HTML, JSON and companion CSV use that one snapshot; imported text is escaped and scripts/assets are absent.
The profile state is valid only for the exact confirmed model/footprint objects; staged edits cannot alter its exports.
`citySectionOverlay.ts` maps valid chart intervals/points to east, source-height minus origin-height,
and minus-north for the 3D frame. Independent segments prevent gap/discontinuity bridges;
ambiguous points are omitted. Shared axis colors identify the same two profiles in charts and 3D.
`CitySectionOverlayView.tsx` uses owned Three.js line/point resources, disables their picking,
and disposes them on replacement/unmount. Opaque overlays use the transparent render queue
after the translucent planning marker, without height offsets or building occlusion.
Camera focus uses only valid profile geometry bounds. Invalidated profiles also invalidate the focus;
camera/overlay controls do not change the confirmed project or numerical results.
`cityDisplay.ts` validates schema 2 display settings against the currently loaded model's metadata,
source hashes and SHA-256 of its parsed double-precision geometry. A file/revision/model-scoped preview
must be confirmed before restoring view modes, layers, selection and the footprint. Only those settings
are whitelisted; imported provenance and terrain/solver results are ignored. Ground points are recomputed,
section results and staged footprint edits are cleared, and river state/storage remain separate.
EPSG:6697 horizontal coordinates use a GRS80 tangent-plane display approximation;
source heights are retained. No datum conversion or solver integration is implied.
The default scene is a licensed display subset of the original Yokohama 2024 PLATEAU
buildings and terrain; the synthetic demo remains explicitly labelled. Known bundled
public data and unclassified uploaded files have separate export metadata. Original
coordinates are retained, with source/derived hashes, extraction bounds and CC BY 4.0
attribution. City display trials do not establish hydraulic field-data adoption.
The display/inspection path remains independent of HTTP and numerical solvers. [Scope](city-workspace.md).

`doboku-earthwork::grading` separately integrates the positive and negative differences
between a piecewise-linear profile and a horizontal proposed elevation. It validates
finite SI inputs and exact interval partitions; missing/ambiguous spans are explicit,
and any unresolved span/point prevents complete-profile area totals. Known-span subtotals
remain separate. This module has no HTTP, SQLite or LLM dependency and never estimates a volume.
The confirmed `POST /api/earthwork/linear-grading` uses the shared blocking computation
limit, returns echoed conditions/version/UTC time, and performs no project/history writes.
`CityGrading.tsx` uses only the confirmed display profiles, aborts obsolete requests,
checks response contracts, and draws/exports source geometry plus the proposed plane.
Its separate HTML/CSV/JSON retain the calculation and source snapshot; display-only
reports/settings keep their existing contracts. [Method and limits](city-grading.md).

`cityGradingRestore.ts` accepts only the current grading-report contract, compares
all source/geometry/provenance fields with the current confirmed section snapshot,
and verifies every numerical field/version against a new Rust calculation.
Object key order is insignificant; array order and values are exact. The file
cannot replace the workspace's footprint, source records or geometry. Review
and confirmation are separate, and revision/abort guards prevent stale previews.
Confirmed restoration displays the archived calculation and original UTC event
strings; the recomputation time is shown as a separate verification event.

`CityGradingComparison` keeps a calculated or restored baseline unchanged and
requests a second Rust run using the same source sections and a reviewed target
elevation. `cityGradingComparison.ts` rejects foreign input geometry, different
engine versions and mismatching coverage. Differences are scenario minus baseline;
incomplete total areas remain null, with separate known-span subtotal differences.
The shared section renderer uses both targets to match each axis's vertical range.
HTML/CSV/JSON retain source provenance, conditions and both original run timestamps.
The comparison does not construct excavated terrain or estimate volumes or costs.

`cityGradingComparisonRestore.ts` validates the complete source and both archived
runs, reconstructs and checks the stored differences, and verifies both runs
against fresh Rust results. The UI reviews the candidate before opening a separate
archived comparison; it never replaces the current target, baseline or geometry.
Both requests share cancellation and revision guards. Historical UTC timestamps
remain in exports, while verification timestamps are shown only in the UI.

## Hydraulic contract

Stations increase **upstream to downstream**. Bed elevation is in a single project datum.
Steady, incompressible, 1D, constant positive discharge, hydrostatic pressure, alpha=1,
single channel, uniform section roughness, no lateral inflow, no sediment transport.
Friction loss is the arithmetic mean of adjacent Manning friction slopes times reach length.
The solver uses bracketed bisection on the selected branch of specific energy.
Subcritical flow requires downstream depth; supercritical flow requires upstream depth.
Boundary water elevation stays fixed in construction comparisons unless the user edits it.
The web boundary-level input subtracts the selected downstream/upstream bed elevation
to set the existing SI boundary depth. It is an alternative input representation, not a
new absolute-stage boundary mode. Base bed/regime edits retain depth and change the displayed
level; construction comparisons retain stage through the existing Rust adjustment.
See [boundary level input](boundary-water-level.md).
Downstream station addition is an explicit draft: chainage defaults to last+100m,
geometry/roughness are stated copies, and bed elevation requires user input. No bed is
extrapolated from the normal-depth reference slope. Confirmation adds one station while
retaining depth; subcritical stage moves with the new downstream bed, while supercritical
upstream boundary remains unchanged. Saving and solving remain separate operations.
See [station addition](station-addition.md).
Station deletion also requires explicit application after a preview of target ground,
remaining count, new boundary bed/stage and joined-neighbour spacing. Remaining original
stations are kept verbatim and in order; boundary depth stays fixed. Endpoint removal
may change stage/domain, while middle removal changes station spacing. No solve/persist
occurs before explicit actions. Switching targets or editing original conditions clears
the proposal; cardinality changes reset uncommitted section drafts at reused indices.
See [station deletion](station-deletion.md).

Rectangular/trapezoidal banks have a finite height. Surveyed sections are unsmoothed
piecewise-linear polylines with strictly increasing x and relative minimum z=0.
The selected water depth must cover one connected wetted interval below both banks.
Critical-depth roots are checked across connected bands using vertex sides and analytic
stationary points. A unique minimum-energy root selects one continuous band; boundary,
standard-step and normal-depth roots stay in that band. Multiple/discontinuous roots,
separated surface water and vertical survey segments are rejected.
See [irregular cross sections](irregular-sections.md).
The web section-type selector proposes explicit changes before application. Parametric
dimensions are retained; positive-slope trapezoids become surveyed points without shifting
coordinates. Vertical banks cannot be converted to the strictly increasing-x survey format
and are refused. Survey-to-parametric candidates use stated initial dimensions, not a fitted
approximation. See [section conversion](section-conversion.md).
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
Before application, the UI shows current/candidate roughness ranges and inherited flow,
slope, regime and boundary depth. The upstream/downstream boundary bed comes from the CSV;
its stage becomes that bed plus retained depth. Datum declarations are displayed separately,
without estimating a water-level difference across different declarations or transforming
vertical references. This condition review does not solve or persist anything.

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
