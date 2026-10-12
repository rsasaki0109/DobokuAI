# Validation record — 2026-10-11

Initial implementation validated in a Linux x86_64 cloud instance using Rust 1.90.0,
Node 24.19.0, npm 11.9.0, system Chromium and Docker Engine 28.4.0.

| Check | Observed outcome |
|---|---|
| `cargo fmt --all --check` | Passed |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | Passed, including additional hydraulic reference tests |
| Rust tests | 44 tests passed, 0 failed/ignored in the latest full check, including 2 external SWASHES cases |
| `npm run typecheck`, `npm run build` | Passed; type check is also part of build |
| Playwright E2E | 5 passed against isolated API/Vite; all 5 also passed against the rebuilt Compose distribution |
| Recovery failure tests | 3 Python tests passed; existing destination/corrupt file/foreign schema/corrupt sensitivity snapshot refused; legacy database accepted |
| RK4 reference generator | 11 reference depths; 0.05/0.025m refinement difference <10⁻¹⁰m |
| Additional independent reference suite | 6 cases × 11 reference depths; regenerated with `--check`; .02/.01m RK4 refinement difference <10⁻⁹m |
| External SWASHES references | Pinned wheel/binary hash verified; 2 cases regenerated with `--download --check`; fine-depth error <2.3×10⁻⁵m; common-point refinement improves approximately 16-fold |
| Saved installation procedure | `scripts/cloud-install.sh` executed successfully on the already installed instance using frozen locks |
| Saved startup procedure | `scripts/dev.sh` started API/Vite and passed functional calculation checks |
| Docker Compose | API/web images built, services started, API healthy, Nginx-proxied sample/solve/comparison/invalid-input checks passed |
| Production browser | Real Compose web build rendered; no browser exceptions; optional 3D WebGL initialized; mobile width390px had no horizontal overflow |

The standard-step reference test compares an independently implemented gradually varied
flow ODE (RK4) against the energy solver. A 10m station interval stays within 5×10⁻⁵m
of the reference and improves over 100m spacing by more than a factor of 20.
Analytical critical depth, Manning, uniform subcritical/supercritical reaches,
survey equivalence, bench discontinuities, bank overflow, invalid inputs, signed earthwork,
fixed-stage excavation, staged transformations and cofferdam proxy are exercised.

Sample (Q=100m³/s, n=.03, slope=.001, finite trapezoidal banks):
1m excavation retains the same surveyed banks and downstream stage 12.2m.
Cut area 32m² at each of 11 stations; integrated cut 32,000m³; maximum absolute water-stage
change approximately −0.315507m. This is a synthetic benchmark, not a field-validated design.

Browser E2E changes bottom width to 22m and discharge to 110m³/s, runs 0.5m excavation,
checks cut 17,000m³ and retained downstream stage 12.2m, exports CSV/HTML, saves a cloned
project, reloads it and checks persisted discharge **and scenario depth**. The other E2E
reviews an offline roughness tool before application, then verifies bank-overflow refusal
and that invalid results are not displayed.

The Vite build reports size advisories for chart and optional 3D bundles. The 3D code is
loaded only on request. There are no disabled assertions or skipped tests in the executed
suites. Zero-test Rust binary/doc-test targets are distinct from executed tests.

## Published-environment follow-up / calculation history

After the user reported publishing the cloud configuration, this task found the source,
toolchain, dependencies and setup scripts restored. The pre-change full check passed
(25 Rust tests, 2 E2E tests). Following the history implementation, the full check passed
again (27 Rust tests, 3 E2E tests, fmt, clippy with warnings denied, TypeScript and build).
This establishes restoration for this task; it does not establish GitHub publication or
that every future cloud task will have the same state.

The API tests verify append-only snapshots, unchanged results after project edits,
no records from failed calculations/previews/reports, project isolation, stable cursor
pagination, database reopening, and confirmed agent results in history. Saved-report
bodies are compared against the stored snapshot exactly. Initial exact-equality tests
found a JSON f64 parsing round-trip discrepancy; enabling `serde_json/float_roundtrip`
fixed it without relaxing the equality checks or changing the hydraulic algorithm.
The additional real-browser E2E saves two condition sets, reloads the project, opens the
older result, checks original flow/scenario/staged mode, downloads CSV/HTML/JSON with
the original timestamp, and verifies that editing clears the result display.
The restored task also started the latest API/Vite using `scripts/dev.sh` and passed
the functional smoke checks. A separate Chromium check created and displayed a saved
11-station run on the development server with no page exceptions. The history panel
was inspected at desktop width and at 390px; mobile document width remained 390px.
These are development-server checks; the previously tested Docker build is distinct.

## Confirmed 60% target / independent hydraulic verification

The user selected the 60% maturity goal. The next numerical verification step added
6 independent continuous-energy ODE references: rectangular/trapezoidal nonuniform
supercritical flow, trapezoidal backwater, asymmetric survey backwater, a survey
waterline crossing a side-slope vertex, and gradual rectangular widening. Python
survey area uses horizontal strip integration, distinct from Rust's wetted-ground
integration. Width variation includes the fixed-depth area gradient in the ODE.
These are synthetic cases, not external-product or observed-river benchmarks.

Each reference is regenerated at .02/.01m to check integration refinement; stored
conditions/results are checked without rewriting the fixture. The Rust tests compare
coarse/fine station intervals, depth/stage/velocity/Froude/friction, geometry at the
same reference depth, all-station energy residuals and boundary/regime preservation.
The 6 added tests passed within their predeclared tolerances, with approximately
25–64-fold error reduction. Detailed case inputs and measured errors are in
[hydraulic reference cases](hydraulic-reference-cases.md).

The full `scripts/check.sh` passed: reference regeneration, fmt, clippy, 33 Rust
tests and 3 E2E tests, TypeScript and production web build. No tests were skipped
and no numerical algorithm or application UI changes were needed for these cases.
The added check is part of the CI command, but the hosted CI has not been observed.

## CSV, sensitivity, recovery and provider contracts

The follow-up full check passed fmt, clippy, reference regeneration, 2 recovery failure
tests, 39 Rust tests, production build and 4 browser E2E tests. An additional failed-agent
atomicity case brought the executed Rust suites to 40; all 12 HTTP integration tests
and clippy were rerun successfully. No hydraulic algorithm changes were made.

CSV tests exercise absolute/relative interpretation, confirmation, changed preview
conditions, original input hash/datum in stored reports, missing/nonfinite values,
duplicate x, disconnected station groups, inconsistent station attributes, invalid
quoting, multivalley sections and invalid reach ordering. Rejected imports return
no partial geometry. Absolute-height subtraction is compared to relative geometry
within 1e-12m for IEEE-754 roundoff; stored history still requires exact equality.

Sensitivity tests preserve original geometry/boundary, compute flow/roughness changes
independently, return failed cases without fabricated values and leave projects/history
unchanged. Browser tests import 11 survey sections after explicit review, run valid/invalid
sensitivity cases, export results with datum/source metadata, save/reload and reject NaN CSV.

The online SQLite backup test backs up a running WAL database with API-created results,
changes the original project, restores into a fresh database with checksum verification,
reopens the API and checks original conditions/results/timestamps exactly. Connections
are closed before snapshot hashing. Current-schema recovery is tested; forward compatibility,
remote backup operations, retention policy and Compose-volume recovery are not validated.

A private transport seam tests OpenAI-compatible requests against a loopback HTTP server:
model/prompt/test auth contract, valid typed output, invalid JSON/content/tool/value/empty
actions, HTTP401/429/302, declared/streamed oversize bodies and timeout. Production Provider
still requires HTTPS, native CA roots, disabled redirects and a 30-second timeout. These
tests do not prove live provider credentials/TLS interoperability. API also verifies a
failed confirmed AI calculation does not modify a saved project or append a result.

Both latest Docker images were rebuilt and started with inherited proxy/CA and TLS
verification enabled. Session CA is supplied only by BuildKit/runtime read-only mounts,
not copied into image layers. Nginx smoke checks passed for sample solve, construction,
invalid inputs, reports, CSV import/provenance and success/failure sensitivity cases.
All 4 E2E tests also passed against the compiled Compose build using the synthetic DB
newly created by this task. `E2E_BASE_URL` permits these deployment tests; they write
synthetic projects/results and should only target a dedicated trial database.

That step scored maturity at 41.5/100, displayed as about 40%. External references were
subsequently added below. The 60% gate remains unmet: three appropriately sourced
real/practical data sets and actual technical reviewers are missing, along with hosted CI/release
evidence. The [trial pack](trial-review.md) is a preparation template, not completed review.

## Public external SWASHES verification

The pinned public `swashes 1.5.0` Linux wheel contains SWASHES 1.05.00 (2025-04-22).
Both wheel and executable hashes were checked before execution. The external tool
is development-only in ignored `.local/`; no upstream source/binary is included in
the product or Docker images. Distribution metadata names CECILL-2.0; its standard
license text was read, including execution/testing rights. This does not change the
product license or establish redistribution approval for the external software.

Two supported MacDonald pseudo-2D rectangular B1 cases exercise nonuniform
subcritical and supercritical profiles with gradual contraction/expansion.
Gravity differs (9.81 versus 9.80665), so Q/n are explicitly normalized to preserve
Q²/g and (nQ)²; original-Q velocity equality is not asserted. Both calculations
use the same sampled cell-center reach and reference boundary depth.

SWASHES bed output itself depends on cell count. Exploration at 193 samples preceded
the fixed 177-sample fixture and frozen tolerances (5e-6m external bed refinement,
1e-4m depth error, at least 4-fold common-point improvement). External regeneration
at 362,673/725,169 cells yields bed differences of 3e-6m/4e-6m. This is a refinement
estimate, not a certified bound. DobokuAI's 45/89/177-point subsets preserve endpoints.
Fine-profile maximum depth differences are 2.2603638e-5m subcritical and
1.9998214e-5m supercritical; common-point improvement is approximately 16-fold.
Boundary/regime preservation, finite values, stage and energy residuals also pass.
See [SWASHES validation](swashes-validation.md) for conditions, provenance and commands.

`python3 tests/swashes_reference.py --download --check` passed, reproducing fixture
values and complete-output hashes without rewriting the fixture. The full
`scripts/check.sh` passed fmt, clippy with warnings denied, independent RK4 regeneration,
42 Rust tests, 2 Python recovery tests, TypeScript/production build and 4 E2E tests.
No numerical solver or application UI was changed. The added hosted-CI regeneration
step has not been observed on GitHub. Docker was not rebuilt for tests/docs changes;
the previous application distribution checks remain separately recorded above.

The existing rubric raises numerical verification from 2.0 to 2.5, with all weights
and other grades unchanged: 44.0/100, displayed as about 45%. External analytic
references strengthen verification but do not replace real-river calibration or
actual independent technical reviewers. The 60% mandatory gates remain in force.

## Sensitivity snapshots, exports and public-data access

Added server-computed append-only sensitivity snapshots, project-scoped cursor pages,
original-result CSV/HTML exports and the browser history panel. API tests verify exact
f64/result/condition/timestamp preservation after SQLite reopening, unchanged saved projects,
no snapshot after baseline failure or a forged-result request, separate construction history,
project isolation and cursor stability after concurrent new insertions. Standard Python CSV
parsing verifies negative numerical values and empty numerical/timestamp fields for failed
alternatives. Imported source hashes and reference metadata survive sensitivity exports.
Online backup/restore recovers the full sensitivity result including failed cases exactly.

The full check passed 44 Rust tests, 3 Python recovery tests, independent RK4 regeneration,
fmt/clippy, TypeScript/build and 5 browser E2E tests. A final UI request-generation guard was
then added for history pagination; build and all 5 E2E tests passed again. The additional
browser test reloads the project, changes its working discharge, opens the old comparison,
downloads identical JSON and original-time CSV/HTML, and confirms exports issue no POST.

Both Docker images were rebuilt and started under the separate Compose project
`doboku-sensitivity-check-20261011`, with a newly created test-only SQLite volume and local
port18880. The proxied functional smoke test and all 5 production-browser E2E tests passed.
API image: `sha256:c7a8775adacab2b8ad397f4b17eaa8ec1772abc386965b1ff634cb7439d3503e`.
Web image: `sha256:305e4709be254145c30319048ccf3c50ce65d156ccee71ecb2db0691bbce6a99`.
Managed CA trust was supplied through the existing BuildKit-secret/runtime-read-only mount
workflow, with verification enabled. These are local distribution checks, not hosted CI or
a published release. Optional 3D/mobile checks were not repeated in this step.

After the two geospatial.jp domain additions appeared in the runtime policy, the ordinary proxy/TLS
request obtained robots.txt, but the Saitama point-cloud primary catalogue page returned
CloudFront403 `Request blocked`. The initial API request also returned403. The retrieved
robots disallows query URLs, so no further catalogue API request was made. The access record,
response and hashes are saved under `.local/research/public-data/saitama-primary-20261011T140341023700Z/`.
Primary licence, datum, actual point-cloud files and three practical datasets remain unverified.
Sensitivity-result workflow improvements do not meet the rubric's practical-data/reviewer
evidence requirements; the maturity score stays44.0/100, displayed about45%.
See [sensitivity history validation](sensitivity-history-validation.md).

Not validated: live external LLM credentials, the GitHub-hosted CI job, design certification,
real surveyed river calibration, or production authentication/team operation.
GitHub publication should be checked against the remote commit; a source push alone does
not establish hosted-CI success or a published release.
The user reported publishing the saved `install_script` and `start_skill` configuration;
the restored task's full check was actually executed as recorded above.
3D evidence belongs to the initial implementation. Docker was rerun for this CSV/sensitivity
step as described above; optional 3D was not retested in this step.

## Station-spacing study — 2026-10-11

Added a standalone Rust interpolation/study module and confirmation-gated
`POST /api/resolution`, plus original-station differences in the UI and JSON/CSV exports.
It does not mutate the working project or write SQLite. Unsupported interpolation,
capacity/spacing limits and solver failures are retained as diagnostics, without fabricated
numerical output. [Specification and measured errors](station-spacing.md) describe the
piecewise-linear assumptions and six independent ODE comparisons. Original abrupt-change
guards are checked before splitting.

Verification on this implementation:

- `cargo fmt --all --check`, workspace clippy with `-D warnings`: passed.
- All **50 Rust tests** and **3 Python recovery tests** passed; independent six-case
  reference regeneration matched the pinned fixture.
- TypeScript checking and Vite builds passed, including the final chart-layout adjustment
  in the Docker Web build.
- All **7 development browser E2E tests** passed after correcting the new sibling
  component's duplicate React key and increasing the independent CSV parser's bounded
  output buffer. Failed cases retain empty numerical CSV cells; exports preserve the
  displayed timestamp/results without a new request. A direct initial browser invocation
  lacked a Playwright-managed browser; later runs used the installed `/usr/bin/chromium`.
- Separate Compose project `doboku-resolution-check-20261011`, dedicated new SQLite
  volume, final API/Web images: startup and smoke passed; all **7 Docker browser E2E
  tests** passed through Nginx. Existing data/services were not used as the test database.
- A seventh actual UI GIF was recorded from a dedicated synthetic sample database.

API image: `sha256:ee9a10b1fa9f7dcb1f78d2909f35ad65820c4702b7c8d4572caca9ddbbb3769d`.
Web image: `sha256:a729b4a35ec9ce5f15aac0fb3e70624160a27d22af454771669183a44cd51887`.
BuildKit-secret and read-only runtime CA mounts retained TLS verification. No new dependency
or solver equation was introduced. The source hashes, observed sample differences and test
record are retained in `.local/spacing-verification.json` and `.local/spacing-sample-result.json`.
Those local outputs and databases are not Git content.

This is numerical/workflow verification using synthetic cases. It does not add practical
river datasets or actual technical reviewers. Maturity stays44.0/100 (displayed about45%).
Hosted CI, actual provider credentials and the target's practical-data/review requirements
remain unverified. Resolution-specific SQLite history/HTML are not implemented.

## Dataset provenance and candidate screening — 2026-10-11

Optional user-declared dataset origin/URL/attribution/usage terms/survey date/processing
now accompany confirmed survey imports, projects and calculation/sensitivity snapshots.
Missing fields remain unrecorded; metadata presence is not licence or survey certification.
Source edits invalidate the review token. HTTP URL, credential exclusion, UTF-8 byte bounds,
control characters and real calendar dates are validated both during preview and project
validation. Old inputs without this optional field remain accepted. HTML escapes source text.

Verification:

- Workspace formatting, clippy with `-D warnings`, **52 Rust tests**, six-case independent
  reference regeneration and **3 Python recovery tests** passed. The first full check
  found one Clippy boolean simplification; it was corrected and the complete check rerun.
- TypeScript/Vite build and all **7 development browser E2E tests** passed. The import
  E2E now edits provenance after preview, confirms it again, reloads a saved project and
  independently parses CSV fields to compare provenance with exported JSON.
- Two API integration tests cover stale metadata confirmation, exact SQLite reopening
  of normal/sensitivity snapshots, escaping of executable-looking source text, multiline
  CSV round trips, invalid dates/URLs/control/length limits and pre-feature input formats.
- Final Docker API/Web builds, startup/smoke and all **7 Docker browser E2E tests** passed
  through Nginx on a dedicated new database volume, including the final field layout.

API image: `sha256:30236756ea97598faa264eb66d0e8155ee0da38d5fe89b205d40dd8bd13a4f5b`.
Web image: `sha256:ad1f08f344ffda1db486bb8d45778cf621ff923761943d707f94904d350e17fe`.
Compose project: `doboku-provenance-check-20261011`. CA/proxy and TLS verification were
retained; no new application dependency or solver equation was introduced.
Vite retains its existing bundle-size warning; hosted CI execution remains unverified.

[Candidate inventory](public-data-candidates.json) records pinned repository revisions and
BathyPix attribute-file hashes/counts. Actual attribute/CRS files exist, but vertical units,
reference datum, original survey attribution and usage terms remain unconfirmed. No dataset
was adopted/redistributed, and no field calibration or external engineer review was performed.
Maturity remains44.0/100 (displayed about45%), target60%.

An eighth actual UI GIF was recorded on the dedicated synthetic database, including the
stored-results HTML. Its four source screenshots were visually inspected. Local evidence
and source hashes are in `.local/provenance-verification.json` and `.local/readme-capture/`;
raw research/database files are ignored by Git.

## Station-spacing snapshots, reports and Compose recovery — 2026-10-11

`POST /api/resolution/runs` appends server-computed comparisons; project-scoped pages,
loads and CSV/HTML reports use immutable snapshots without invoking the solver.
The existing unsaved `/api/resolution` remains available. Old databases gain an optional
`resolution_runs` table/index; the backup CLI counts and checks its saved JSON.
Opening a spacing history leaves working project conditions unchanged. Results include
full interpolated profiles, original-station differences, source metadata, version/time
and partial/total refinement failures; unsuccessful baseline calculations are not saved.

- `scripts/check.sh` passed: workspace formatting, Clippy with warnings denied, **55 Rust
  tests**, six independent reference-case regeneration, **4 Python recovery tests**,
  TypeScript/Vite build and all **8 development E2E tests**. No assertions were disabled.
- Three additional API tests verify exact saved numbers/source metadata after project
  edits and SQLite reopening, stable scoped pagination, missing-record errors, forbidden
  client-provided results, partial/total refinement diagnostics and empty failed CSV
  numerical cells. An independent Python CSV reader checks column alignment/quoting.
- The API backup/restore test now includes spacing history and checks restored CSV/HTML
  against original report bodies exactly. Python recovery rejects invalid spacing JSON.
- Dedicated Compose startup/smoke and all **8 Docker E2E tests** passed through Nginx.
  After correcting a cramped history timestamp, the Web was rebuilt and the focused
  spacing export/confirmation E2E passed again. The API binary before/after that cached
  rebuild has the same SHA-256, recorded below. Vite's existing size advisory remains.
- On a live disposable Compose volume, the online backup contained **7 projects, 6
  calculation histories, 2 sensitivity histories and 4 spacing histories**. A hash-checked
  restoration into a separate new volume and API returned all **12 snapshots and 24
  CSV/HTML reports byte-for-byte identically**. Post-backup additions were excluded.
  SHA-256 of both database snapshots: `6bda203e50068df5fa1f553db925cb96986d1e0807e14b9eddd43e391423168f`.
- The development API was updated after a separate backup; its existing project and
  calculation/sensitivity rows remained identical, and the new spacing-history API
  returned an empty page. The development smoke checks passed.
- The station-spacing GIF was recaptured from six real synthetic UI states, including
  reload/history and the actual stored-results HTML. README retains eight GIFs total.

Final API image: `sha256:583ba1f3cb8a6ca70e9a4dd306fcab70e6381632e1d8cf7ba64da4ecc8168ef5`.
Final Web image: `sha256:48237f2df7261cf8a68999b35542078038d254cf6d616699f8ca9b30835b6ea6`.
API executable SHA-256: `c6e3f00bec38ee2acd2cc68253b71f4b33bcba1cd6ab045f0fd222ada200d84e`.
The full Docker E2E/recovery run used the same API executable in image
`sha256:e81db54f06e8d0d3ab91c1860e2999b3e7dc9f744bdc1ce61b52b9f01700f14f`;
the initial Web image was `sha256:c6e1fc9e61599b5ec1f93b71774909d559f8e26ac05d5a2c6cd3bbc99b53f269`.
Proxy/CA settings and TLS verification were retained, without new application dependencies
or numerical equations. Compose project: `doboku-resolution-history-check-20261011`.
Local evidence is kept in `.local/compose-recovery/`, `.local/readme-capture/` and
`.local/resolution-history-verification.json`; raw databases and research files are not Git content.

GitHub Actions' ordinary HTTPS page returned404; Git access does not establish page/API
authorization or CI success. Hosted CI remains unobserved. Practical datasets and actual
external technical reviewers were not added. Fixed-rubric maturity remains44.0/100
(displayed about45%), target60%. Retention limits and future schema compatibility remain
unimplemented; same-version synthetic recovery is not proof of operational reliability.

## Gravity dam hydraulics and statics — 2026-10-12 (JST)

The independent gravity-dam workspace adds a free-overflow capacity model and rigid-body
static equilibrium for a trapezoid with vertical upstream face. See
[contracts, units, formulas and exclusions](dam-calculations.md).
The numerical modules depend on neither HTTP, SQLite nor LLM. The illustrative gallery
is not linked to these inputs or outputs; arch/bridge/sabo structural calculations remain unimplemented.

Analytic tests cover rectangular loads/bearing, dry/equal-water cases, head scaling,
undefined ratios, invalid/nonfinite input, unknown earthquake/gate fields, submergence,
partial contact, outside-base resultants and loss of compression.
Seven synthetic structural cases are independently integrated by Python composite Simpson
quadrature (4096 intervals) and compared against Rust loads, centroids, moments, resultants,
ratios, contact state and applicable bearing pressures. The fixed acceptance rule is
absolute difference ≤ 1e−9 × max(1, |reference|). The production API comparison measured
maximum normalized difference 1.7763568394002505e−15; no field calibration is implied.
The checked-in fixture can be regenerated/checked with `tests/dam_reference.py` and is
included in Cargo tests; `scripts/check.sh` checks it before the workspace suite.

The final workspace passed 65 Rust tests, `cargo fmt --all --check`,
`cargo clippy --workspace --all-targets --locked -- -D warnings`, and frontend typecheck/build.
The provider mock requires a local TCP listener: an initial sandbox-only run was denied by
socket restrictions, then the complete suite passed with local test networking enabled.
Five Python recovery checks include optional dam-table JSON validation and corruption rejection.

The development web and Docker production build each passed all 15 browser tests, including
confirmation, edit invalidation, baseline comparison, immutable history restore, CSV/HTML
exports, invalid depth/submergence rejection and explicit absent partial-contact pressure.
The final load-arrow adjustment passed the two dam tests in development and Docker; it adds the downward
component of the downstream face-pressure resultant without changing any numerical results.

The new `dam_runs` table retains server-generated conditions, numerical results, engine/model
versions and original execution timestamps. API integration confirms cursor paging, failure
without append, unchanged river projects/history, reopen with byte-identical JSON/CSV/HTML,
and independently parsed CSV column/condition alignment. Full-contact pressures alone are
computed. Unsupported contact pressure and zero-denominator ratios remain null/empty.

A running Compose database was backed up through SQLite's online API with the source volume
mounted read-only into a Python helper. Its snapshot contained 7 projects, 6 river runs,
2 sensitivity runs, 3 spacing runs and 11 dam runs. Restoration into a new file and reopening
with a separate production API confirmed the 7 retained reference-run JSON snapshots and
all 14 CSV/HTML reports were exactly unchanged. A concurrent later screen capture appended
another source run without altering the backup. Local evidence is in
`.local/dam-public-validation/`; these synthetic verification artifacts are not product data.

This validates the stated simple static/capacity models. It does not validate earthquake,
FEM, cracking, foundation deformation, uplift drainage reduction, gate discharge, reservoir
routing, spillway-flow loads or any code-of-practice safety criteria. Maturity remains
44.0/100 (display approximately 45%); actual-river trials and hosted CI remain unverified.

## Unsmoothed irregular sections — engine 0.2.0, 2026-10-12 (JST)

The geometry contract now permits irregular ground without modifying vertices, while
wetted geometry requires one connected surface interval. The hydraulic solver enumerates
connected depth bands, scans vertex sides and interval stationary points for critical and
normal roots, rejects detected multiple/discontinuous roots, and restricts standard-step
and boundary depth to the band with the unique minimum-energy critical root.
See [the model, tolerances and exclusions](irregular-sections.md).

Two additional synthetic benchmarks use independent horizontal-strip integration that
sums separate low-level slices below submerged bed ridges, followed by the continuous
GVF ODE integrated with RK4. The production formula and Rust geometry are not imported.
Reference steps 0.02/0.01m differ by 2.887e−14m for subcritical and 9.504e−12m for
supercritical flow. The observed standard-step fine-grid errors are approximately
4.273e−8m (4m stations, about 24 times better than 20m stations) and 4.288e−5m
(1m stations, about 26 times better than 5m stations). Predefined acceptance limits
are 5e−5m / 15-times improvement and 1e−4m / 10-times improvement respectively.
Original classic ODE, survey-vertex and external SWASHES comparisons remain passing.

Hand-integrated irregular geometry checks area=127/24m² and surface width=41/12m at
3m depth. Additional tests verify retained vertices, disconnected/just-touching water,
wrong connected band at the boundary, continuous sharp widening with multiple critical
roots, and multiple or unresolved-discontinuous Manning normal-depth roots.
CSV preview acceptance is explicitly separate from subsequent wetted-flow validation.
A formerly rejected irregular ground fixture now previews intact, but its split-water
calculation fails without changing projects or appending history.

Final quality checks: 72 Rust tests; cargo fmt and clippy with warnings denied;
frontend typecheck/Vite build; 5 Python recovery checks; independent irregular-reference
regeneration and gravity-dam fixture checks. Development E2E initially passed 15/16:
the old overflow case received an overly generic depth-band error. Boundary wet geometry
is now checked first; the affected overflow and irregular-section tests both passed.
The production Docker build passed all 16 E2E, including unchanged dam/3D/gallery,
spacing, sensitivity, survey provenance, AI confirmation and report/history workflows.

A copy of a real earlier 0.1.0 verification DB was reopened by the 0.2.0 API. All
22 saved snapshots (6 river, 2 sensitivity, 3 spacing, 11 dam) matched their stored JSON
conditions, numerical values, original versions and timestamps exactly without solving.
The source database was untouched. River CSV retains existing columns and appends
warnings_json; HTML exports stored profile warnings. The old-version CSV still reported
0.1.0 and its original warnings. Byte identity of an old CSV/HTML across the format
upgrade is not claimed; numerical/input snapshot compatibility is verified.

The bundled synthetic CSV previews as 21 sections with all eight ground vertices retained.
Actual Antelope Creek points were reviewed with explicit geometry-only placeholder reach
spacing/roughness, with no apply or calculation: the old monotonic-ground rejection is
removed, but its pair of original sections fails the existing adjacent-width guard.
Original datum and survey conditions remain unconfirmed. This is not an adopted field trial.
Local evidence is retained in .local/irregular-validation/.

A full execution volume was encountered after the Docker build. Unused build cache
older than one hour was pruned; tagged images, running containers, all project databases
and research evidence were retained. Approximately 20GB became available and the
production browser/compatibility checks completed. No TLS or numerical assertion was disabled.
Maturity remains 44.0/100 (approximately 45%) pending qualified real-data trials and hosted CI.

## River input diagnostics and new data candidates — 2026-10-12 (JST)

Added a read-only preflight using the solver's critical/normal-depth branch, regime check
and shared transition guards. It reports every section and transition rather than only
the first failing reach. Invalid inputs are rejected before evaluation; unavailable depths
and invalid boundary hydraulic values remain null. The solver now includes the failing
transition's chainages in its error. No project, river result or history table is changed.

Verification passed:

- cargo fmt --all --check; clippy --workspace --all-targets --locked -D warnings.
- All 76 Rust tests, including three new numerical/diagnostic tests and one HTTP test
  covering exact input echo, timestamp/version, multiple abrupt transitions, overflowing
  boundary, invalid roughness, unchanged project and empty history tables.
- Frontend typecheck/build and independent irregular/dam reference regeneration checks.
- Development-browser diagnostics and irregular survey workflows.
- All 17 browser tests against a separate Docker project, including existing hydraulic,
  construction, AI, reports/history, spacing, sensitivity, dam and 3D functionality.
- After adding project ID/name and reference/provenance to the diagnostic JSON export,
  rebuilt the final Web image and reran the diagnostic browser test successfully. Export
  equals the API's exact input/checks plus the selected project's reference metadata.
  Edited conditions hide the previous results and export button without saving a run.

The initial browser fixture assumed a nonexistent project JSON upload and was corrected
to use saved project selection. Reusing the Docker test DB exposed duplicate display names;
the test now selects the exact unique project ID and verifies that ID in the export.
The exported ID before that fixture fix already matched the selected project.
The first sandboxed full Rust test attempt could not bind the mock LLM TCP server;
the same assertions passed with local socket permissions enabled. No assertions were skipped.

Final production images:

- API: sha256:a6f486c039438d81f39712885c577d4f5c51a2af60a85119e817900a42dba654
- Web: sha256:86f61123bb1b404b8ba05f840b52bde31e2c356332fb0d23e5a8895e5c342408

Docker sample diagnostic evidence is kept at .local/diagnostics-validation/docker-sample.json:
11 sections, 10 transitions, downstream chainage 1000m, stage 12.2m,
Fr 0.24574405996332127, first critical/normal depths 1.320157884506755 / 2.487285530843849m.
These are synthetic sample values, not observed river accuracy.

Four additional public repositories were pinned and reviewed. Ngwerere has actual XYZ
sections (27 and 25 points) and a tutorial stating a shared vertical reference with water
level; original survey metadata, use terms, flow direction and hydraulic conditions remain
unconfirmed. NOAA's documented model access requires separate external credentials;
pyHMT2D's README requires original-owner authorization for reuse; PyRASFile contains no
field geometry. Details and hashes: [model data review](public-data-model-review.md).
No third-party data/code is shipped. Adopted field trials remain zero, hosted CI is unconfirmed,
and the maturity score remains 44.0/100 (approximately 45%), against the current 50% target.

## Rejected survey geometry inspection — 2026-10-12 (JST)

CSV inspection now retains all complete, valid section point arrays when an adjacent
width/bed transition prevents import. It reports every transition, original section ID and
the downstream section's first CSV line. The same Rust transition checks guard actual
calculations. No discharge, normal slope or boundary depth is assumed for geometry checks.

Rejected import responses keep stations empty and review_token null; diagnostic geometry
is separate. Direct apply is rejected and existing project/history remain unchanged.
Malformed records, inconsistent units, missing/nonfinite values, invalid sections or station
order do not produce partial diagnostic geometry. Absolute elevations are interpreted using
the existing IEEE-754 subtraction; original CSV text is retained exactly in the export.
Finite common elevations are checked before plotting/evaluation, including addition overflow.

The UI inspects all sections with common horizontal/elevation axis bounds, input ground
profiles and every transition. The plots contain no computed water surface. Their section
legend says CSV input ground. JSON exports source CSV/interpretation/provenance, full preview,
engine version and UTC inspection timestamp. Edits invalidate the preview/export.

Verification passed:

- All 78 Rust tests, fmt and clippy with warnings denied. Final timestamp/version assertions
  were rerun in the new API integration case after adding inspection metadata.
- TypeScript checks and native/Docker frontend builds; no dependencies or lockfiles changed.
- Development-browser rejected-CSV inspection, existing irregular survey workflow and river
  preflight. The API/browser fixtures use exactly representable synthetic bed increments for
  strict point preservation, rather than relaxing numerical tolerances for decimal subtraction.
- Docker full suite passed 17/18 initially; the combined gallery workflow exhausted its 45s
  total deadline before GLB saving. Trace showed completed model/fullscreen operations.
  That software-WebGL workflow alone now has a 90s bounded deadline. All its GLB, instancing,
  metadata, fullscreen and browser-error assertions remain unchanged. It passed in the targeted
  rerun (14.8s), along with the final CSV inspection (1.6s). All 18 distinct cases are verified.
- The final CSV inspection exports exact original CSV and preview, preserves every point and
  verifies no project/history mutation. Browser drawing was inspected with no client exceptions.

Final production images:

- API: sha256:71ca31cd81815113707ae1bcc86c0027011027d61c861719fbf8f56c0c14d776
- Web: sha256:3dc12181e16dbda59adc6ea5512980004c6e3991655ca2fefbc0e9f286898ab8

New Ngwerere primary notes describe RTK measurements and shared ellipsoid heights. Horizontal
GeoJSON→UTM comparison agrees with the same CSV's 52 points to about 1e-9m and stored heights
match exactly without height conversion. This checks representation consistency, not independent
survey accuracy. Original use terms, survey realization/date and hydraulic reach conditions
remain incomplete. No field dataset is adopted or bundled; maturity remains 44.0/100.
Details: [survey inspection](survey-import.md) and [primary-source review](public-data-model-review.md).

## Saved review packs and synthetic trial — 2026-10-12 (JST)

The two review-pack endpoints read immutable construction, sensitivity and resolution
snapshots. They never call the solver or write project/history data. Optional studies must
match project ID, all river/reference conditions, archived engine version and baseline
profile, including warnings. Renaming a project alone is allowed. Unknown IDs and mismatches
are rejected. CSV size is conservatively budgeted before generating repeated condition rows;
a 200-station, six-case study verifies refusal rather than truncated output.

Verification passed:

- All 82 Rust tests; cargo fmt and clippy with warnings denied; frontend type check/build.
- API integration tests read the actual ZIP and verify all file hashes/sizes, selection,
  condition hash, stored JSON objects and exact equality with six existing CSV/HTML exports.
  They edit the current project, reconnect to the real temporary SQLite file and verify
  unchanged archived output, histories and current project. These are SQLite reconnect
  checks, not a new Docker backup/restore exercise.
- All 19 Docker browser E2E cases passed in one run (59.1 seconds). The new workflow
  selects exact project/history IDs, invalidates previews on edits, rejects an incompatible
  study, downloads the ZIP, verifies it using Python zipfile/hashlib/csv and opens index/report
  HTML with API access blocked. Failed sensitivity values remain empty and no calculation
  requests occur during pack generation.
- The reproducible scripts/try-review-pack.py trial imported the bundled synthetic absolute
  elevation CSV with declared virtual datum and source attribution, then saved 1m excavation,
  two discharge cases and 2/4 spacing subdivisions. All 13 ZIP entries passed CRC/hash/size
  checks, six individual exports matched exactly and all three stored snapshots matched.
  History counts remained one per kind and the saved project was unchanged by export.

Actual synthetic trial results: cut volume 32000.000000000004m³, maximum water level change
−0.315507366004006m, engine 0.2.0, execution time 2026-10-12T09:01:38.955334205+00:00.
Evidence is in .local/review-pack-trial-20261012/ (ignored): original CSV, import preview,
trial-result.json and sample.zip. ZIP SHA-256:
49a4cfd5c640dde51b2bb084bf7857ffa90b80a97d9aaff37edfa9e80450ad1c.
Original CSV is kept separately because raw survey files are not stored in history snapshots.

Final production images:

- API: sha256:d4646c812b961237b91021a1773b84937043c9781f4c0adac6ea06b35aa8d4b9
- Web: sha256:0e5eb59cbe59ef6a12ba35074f038ee55df058f783cd795a9a22ca6ed0d82284

The new zip 6.0.0 dependency uses stored entries with compression disabled; seven lockfile
packages were added, with existing dependencies unchanged. Numerical engine version and
database schema are unchanged. Pack assembly timestamps are distinguished from original
calculation times; non-manifest files remain byte-identical for the same stored selection
and exporter version. This trial does not establish field accuracy or hosted CI success.
Adopted field datasets remain zero and the maturity score stays 44.0/100 (approximately 45%).

## Complete NCRO CSV inspection — 2026-10-12 (JST)

Three public NCRO sample CSVs were fully downloaded from cfbrush/cv-stream-rating-data
at 2c34575d109b055a7dd38409a0c74de56dc18bec. The previous 16 KiB prefix inspection is
retained separately. The full files total 81,918,330 bytes and 355,484 records:
120,114 Elk Slough, 121,501 Middle River South and 113,869 records in the Sacramento-labelled
file, whose internal feature name identifies GrantLine/FabianBell Canal.

scripts/inspect-ncro-survey.py verified complete CSV parsing, column counts and finite XYZ
in every row, and records complete-file SHA-256, original-coordinate bounds, metadata counts,
calendar date checks and the first 20 issue locations. All three files retain the mojibake
header prefix without correction. Survey_Report is empty in all records. The index associates
2, 2 and 9 entries with their respective resource URLs; none of their feature basenames
matches the observed CSV feature. This is a string correspondence check, not proof of
geographic mismatch or survey identity. No coordinate/datum transformation, section
extraction, engineering calculation, project import or adoption occurred.

Five new synthetic tests verify a nonfinite point beyond 16 KiB, index aliasing, metadata
date aliases/reversal and mojibake, malformed CSV/headers/columns, and rejected-report retention
with overwrite prevention. They are included in scripts/check.sh. The complete check script
finished with exit status zero: 82 Rust tests, fmt/clippy, existing independent reference
generators, five backup checks, five inspection tests, frontend type check/build and all
19 development-browser E2E cases (1.3 minutes). No assertions were skipped. Docker images and
numerical engine were not changed; Docker was not rebuilt or rerun for this script change.
Logs and complete source/report files remain ignored under .local/ncro-check-20261012.log
and .local/research/goal50/full-20261012/. Third-party data/code are not bundled.

The environment draft was read and its previous custom hosts, install script and startup
instructions preserved. Six data/metadata destinations were added; draft revision 7 saving
and reread confirmed them. Running spec revision 11 remains unchanged. This is a pending
configuration update, not successful original-source or hosted-CI access. Field survey units,
reference realization, original terms/reports and a supported hydraulic reach remain
unverified. Adopted field trials stay zero and maturity remains 44.0/100 against target 50%.
Details: [DWR review and reproduction](public-data-dwr-review.md).

## Offline hydraulic balance audit — 2026-10-12 (JST)

scripts/audit-review-pack.py reads stored review packs without API, extraction, solving or
project/history changes. It validates the allowed archive entries, CRC, size/file hashes,
conditions hash, saved record metadata and identical study baselines. Python independently
clips ground polylines and integrates wetted geometry, then recomputes velocity, Froude,
Manning friction, critical/normal diagnostics, boundary and per-segment energy balances.
Saved residuals alone cannot make the check pass. Tolerances are fixed and reported.
This is consistency verification, not an independent water-surface solution or field accuracy.

Ten synthetic tests pass: analytic uniform subcritical/supercritical profiles, closed-form
trapezoid/survey geometry, irregular vertices and dry-ridge separation, corrupted hashes and
unsafe archive paths, physically wrong values even after rehashing, incorrect bed with stored
zero residual, inconsistent conditions/unsupported engines/nonfinite JSON, preserved failed
studies with no invented results, and CLI failure report/overwrite handling.

The full scripts/check.sh completed with exit zero: 82 Rust tests, fmt/clippy, independent
reference regeneration, five backup checks, five NCRO checks, frontend type check/build and
all 19 development-browser E2E cases (1.7 minutes). The initial eight audit tests passed in
that run. Final irregular/large-bank cases and the stricter failed-case schema were tested
with the complete ten-case audit suite afterward. The finite 1e20m bank stress test exposed
cancellation in clip-fraction subtraction; direct wet-fraction calculation fixed the lost
wetted wall. The final original ZIP was rerun and the same 117 rows/110 segments passed.
No API, numerical engine, UI behavior,
dependencies or Docker images changed; no additional Docker build was performed.

The original synthetic sample ZIP (SHA-256
49a4cfd5c640dde51b2bb084bf7857ffa90b80a97d9aaff37edfa9e80450ad1c) passed the final auditor:
13 entries, seven successful profiles, 117 rows, 110 segments and one retained failed
sensitivity case. Maximum independently recomputed energy residual was
3.7886892928495897e-10m, against the fixed 1e-7m balance threshold. Evidence:
.local/review-pack-trial-20261012/offline-audit-verified.json;
pipeline log: .local/review-audit-check-20261012.log.

CSV/HTML are checked by hash; numerical checks read JSON. Derived case differences, earthwork
volumes, critical-root uniqueness and full original-input applicability are outside this
auditor. The manifest's Rust-encoded baseline profile hash is not re-encoded in Python;
baseline objects are compared directly. Hashes do not authenticate the original survey.
Running network configuration is still unchanged; original metadata and hosted CI remain
unconfirmed. Adopted field datasets remain zero and maturity stays 44.0/100 (approximately
45%), against the 50% target. [Audit scope and usage](offline-audit.md).

## Explicit international/survey foot import — 2026-10-12 (JST)

CSV coordinates/heights now explicitly accept m, international ft (0.3048m) or
us_survey_ft (1200/3937m). All dimensional headers must use the selected suffix;
ambiguous aliases and mixed headers are rejected. Original UTF-8 CSV SHA-256 and native
unit survive provenance, saved projects, calculation snapshots and reports. River data,
plots and result CSV remain SI. Loading a stored project/result does not convert it again.
Discharge m³/s, reference slope, boundary depth m and SI-engine Manning n are unchanged.
Absolute heights are subtracted in their native unit before scaling; order/vertices are
retained without rounding, sorting, smoothing or datum/CRS conversion.

Four API integration tests pass. They verify the independent known length identities
3937 US Survey Feet = 1200m and 3937 international ft = 1199.9976m in both absolute/relative
modes, unchanged original metre inputs, header/unknown-unit refusal, stale confirmation
tokens, source hash preservation, SI calculation/history/CSV/HTML and independent Python
audit of the actual resulting ZIP. A focused subnormal test initially exposed that unequal
native chainages could become equal after scaling; comparison now uses original parsed
values. Negative native relative height is also rejected before multiplication can turn it
into negative zero. Final four-case suite passed after that correction.

Final scripts/check.sh exited zero: 86 Rust tests, fmt/clippy, independent reference
regeneration, five backup tests, five NCRO tests, ten offline-audit tests, frontend type
check/build and all 20 development-browser E2E cases (1.4 minutes). The new browser test
checks selection, SI geometry, original CSV export, no mutation before confirmation,
incompatible headers, explicit apply/save, calculation and unchanged reopened snapshots.

Docker was rebuilt after the final parser correction. Three production-browser cases passed
(10.0 seconds): existing m import/provenance/sensitivity, rejected geometry inspection and
new survey-foot import. Direct production API checks also passed for valid input, native
inconsistency and negative-height refusal without project/history writes. Logs:
.local/survey-units-final-check-20261012.log, .local/survey-units-docker-final-20261012.log,
.local/survey-units-docker-e2e-20261012.log and .local/survey-units-docker-edge-20261012.json.

Final production images:

- API: sha256:953fd27c848ac548f9526d6c62e3dad70f47e3a878f2756fe4bdced49efbe50a
- Web: sha256:5e5d2cae070c67d16c4e1b7b57c4c316a49ea65adb04aaec26c0f10650a5200a

Numerical core version 0.2.0, database schema, dependencies and lockfiles are unchanged.
The bundled two-section foot CSV is synthetic, not a field dataset. The original CSDP
developer's paper and ten classes confirm that network format includes centerline distance,
section length, metadata and datum/unit choices/defaults. They do not establish the actual
2009/NCRO source-file metadata or hydraulic applicability. Raw originals remain inaccessible
under the current network configuration; field adoption stays zero, hosted CI remains
unconfirmed and maturity stays 44.0/100. [Unit specification](survey-import.md) and
[pinned original-format evidence](public-data-dwr-review.md).

## Hosted CI and public repository verification — 2026-10-12 (JST)

The official GitHub web pages now provide evidence for implementation commit
`f6c826d78cbcbb00d5052c2c0f8984d3bbddfeb5`: [MVP checks #19](https://github.com/rsasaki0109/DobokuAI/actions/runs/38245445172)
reports Success, the sole `validate` job completed successfully, and the run matches the
main-branch push at 2026-10-12T11:52:20Z. Total duration is 4m 33s; job duration is 4m 21s.
The run's workflow includes pinned Rust installation, npm frozen install, Chromium,
external SWASHES regeneration and the complete `scripts/check.sh`. Hosted test counts
are not independently counted from downloaded logs; the prior local 86 Rust/20 browser
counts remain separate evidence. [Recorded page URLs/hashes and limits](hosted-ci-evidence.json).

The repository page displays Public, `repository_public=true`, `isPrivate=false` and
`logged_in=false`. This confirms current visibility, not who changed it or when.
The agent did not change visibility and did not grant an OSS licence.

The original job's Node.js 20 deprecation warning identifies checkout/setup-node v4.
The workflow now uses fixed commits from both official v6 tags, whose action manifests
declare `using: node24`; existing Node 24, npm lockfile cache and validation commands
remain. Workflow permissions are limited to `contents: read`. The fixed source files and
hashes are recorded in the evidence JSON. Updated executions are available through
the README workflow badge. No hydraulic engine, UI, dependencies or Docker build changed.

Pinned CSDP/DSM2/BayDeltaSCHISM trees (867/603/644 tracked paths) and six resource files
were also reviewed. CSDP's 1166 landmark labels declare NGVD29, not the separate
NAVD88 network; they do not contain surveyed cross-section vertices. No `.cdn` exists in
these three revisions, DSM2 fixtures do not supply original survey provenance, and the
SCHISM bathymetry directory contains only an initial-empty-directory README. Other
revisions/releases were not exhaustively searched. No field dataset was imported/adopted.
The hosted CI gate is now supported, but real-river trials and continuous operations
remain incomplete; fixed maturity stays 44.0/100 (approximately 45%), target 50%.

## Independent distance/height import units — 2026-10-12 (JST)

Survey CSV now accepts optional `vertical_unit`, separately from distance `unit`.
Horizontal x/chainage and bed/point heights must have their respective explicit header
suffixes. Both support m, international ft and US Survey Foot. Missing/null vertical unit
keeps the legacy common-unit interpretation; it is omitted again during serialization.
Absolute height differences are formed in native height units before conversion. Native
conditions/negative heights, finite converted values and existing geometry/transition
guards remain checked. No coordinate or datum transformation is performed.

The nine-case API suite passed, including the existing four tests. New coverage checks all
nine distance/height combinations in both absolute/relative modes against independent
3937-unit and 29.5275-unit identities, unknown height-unit/header refusal, metadata-only
reconfirmation, project-write validation, exact legacy JSON round trips, stored SI runs and
original units in CSV/HTML. Actual exported ZIPs for horizontal m/vertical survey feet and
the reverse pairing passed the separate Python geometry/energy auditor. A real temporary
SQLite database was backed up online and restored through `scripts/database.py`; the
restored API returned identical projects, stored runs and CSV/HTML after live metadata/
flow edits. Tests do not access the user's database.

Full `scripts/check.sh` exited zero: 91 Rust tests, fmt/clippy, independent references,
five backup tests, five NCRO tests, ten offline-audit tests, frontend type check/build and
21 development-browser E2E cases (1.5 minutes). New browser coverage checks explicit
height selection, unchanged horizontal distances, unchanged project before confirmation,
inspection JSON retaining original CSV/units, invalidation/refusal after unit changes,
apply/save/calculate/reload and original-unit display/reports.

The rebuilt Docker distribution passed four targeted browser cases (11.9 seconds): new
mixed units, legacy same-unit survey feet, existing m import/provenance/sensitivity and
rejected-geometry inspection. Production images:

- API: sha256:bc5ca5e6e4e6826f9d9ab6d6ac61034faffc8b1e57be2fd359a48f0beec238a0
- Web: sha256:a9834b4430abf776f770b167b7154f359ec3f65dd24ba2ab509a776ac1fc5ae2

Evidence logs: `.local/mixed-survey-check-20261012.log`,
`.local/mixed-survey-docker-build-20261012.log`, `.local/mixed-survey-docker-e2e-20261012.log`.
The editor screenshot was visually inspected. Numeric-engine version remains 0.2.0;
SQLite schema, dependencies and locks remain unchanged. Old metadata without the new
field and old report unit text remain compatible. The bundled mixed-unit example is
synthetic. This is not original DWR/NCRO metadata verification, field adoption or datum
conversion; adopted field datasets remain zero and maturity stays 44.0/100 (about 45%).

## Mixed-unit hosted CI follow-up — 2026-10-12 (JST)

The previous Queued observation is superseded. Implementation commit
`fffb533c94403e76df8e00d34b95a669244227be` completed [MVP checks #21](https://github.com/rsasaki0109/DobokuAI/actions/runs/38250915009)
with Success; `validate` job 114816675657 completed successfully. The associated job
page matches that exact commit and has no Node.js 20 deprecation warning. Its workflow
uses both fixed official v6 action commits and `bash scripts/check.sh`. Run/job/workflow
page hashes and observation time are recorded in [hosted evidence](hosted-ci-evidence.json).
The summary reports 15m 23s total duration; it is not a numerical-solver timing measurement.
Hosted numeric test counts are not independently counted from downloaded logs. Local
91 Rust/21 browser and Docker four-case evidence above remains distinct. No source,
dependencies or images changed during this evidence-only follow-up, and those passed
tests were not repeated. Runtime network configuration still lacks the saved primary-data
hosts; field trials remain zero and maturity remains 44.0/100, target 50%.

## Common-datum boundary level input — 2026-10-12 (JST)

The hydraulic conditions screen now accepts a boundary water elevation in SI metres.
It subtracts the current downstream bed for subcritical flow or upstream bed for
supercritical flow to update the existing boundary depth. The selected station's
chainage, bed and declared vertical datum are displayed. Depth edits update the displayed
level. This is an alternate input representation, not a new absolute-stage boundary mode:
base bed/regime edits retain depth, whereas existing Rust construction comparisons
retain the preconstruction stage. No datum/native-unit transformation is performed.

Two new browser cases verify subcritical 9m bed/12.6m stage/3.6m depth and supercritical
10m bed/10.55m stage/.55m depth, actual Rust calculations and boundary profile rows,
the 1m excavation retaining 12.6m while depth increases to 4.6m, explicit save/reload,
unchanged stored runs after edits and refusals, and derived stage changes after bed/regime
edits. Below-bed, bed-equal and empty inputs remain invalid and create no new calculation
history. The initial focused run completed the subcritical case and the actual
supercritical calculation, then exposed a missing exact accessible label on the regime
select. Its name is now explicit; the final complete runs passed without loosening tests.

Full `scripts/check.sh` exited zero: 91 Rust tests, fmt/clippy, independent references,
five backup tests, five NCRO tests, ten offline-audit tests, frontend type check/build and
all 23 development-browser E2E cases (1.6 minutes). The rebuilt Docker distribution passed
three targeted browser cases (8.5 seconds): both new boundary-level cases and the existing
cross-section editing/construction/report/persistence workflow. The conditions screenshot
was visually inspected. No numerical-engine, API contract, database schema, dependencies
or lockfiles changed; engine version remains 0.2.0.

Production images:

- API: sha256:94e165ba1b602a76cb1c03fd9d16b7afc13118096907c265aa4379abe69efcb2
- Web: sha256:a16ff8793bdb016d5f8b4f1d78f7b36ff67919ddbc3e106dabe349262bef4d49

Logs: `.local/boundary-stage-focused-20261012.log` (initial focused failure),
`.local/boundary-stage-check-20261012.log`, `.local/boundary-stage-docker-build-20261012.log`
and `.local/boundary-stage-docker-e2e-20261012.log` (final passing runs).
The inputs are synthetic and do not authenticate observed levels or field applicability.
Original-data network settings remain unapplied, field adoption remains zero and fixed
maturity stays 44.0/100 (about 45%), target 50%. [Input semantics](boundary-water-level.md).

The same implementation commit `805b9bce5334a9d211f224015df05b05cf9589b2`
subsequently completed [MVP checks #23](https://github.com/rsasaki0109/DobokuAI/actions/runs/38256815215)
with Success. Its `validate` job and associated workflow were matched to that commit;
the fixed v6 actions and full `scripts/check.sh` were verified. Official run/job/workflow
page hashes and observation time are retained in [hosted evidence](hosted-ci-evidence.json).
Hosted test counts are not independently counted from downloaded job logs.

## Explicit section conversion / 2026-10-12

The section selector previously shifted the x coordinates of vertical banks by 0.1m
when converting parametric geometry to survey points. That implicit geometry change is
removed. Conversion now proposes the original and candidate dimensions/points and target
scope; only explicit application edits conditions. Rectangular and zero-side-slope banks
are refused for survey conversion. Rectangle-to-trapezoid preserves custom dimensions
with side slope zero; positive-slope trapezoid-to-survey retains every original coordinate.
Survey-to-parametric candidates disclose initial dimensions rather than claiming a fit.
Empty survey drafts remain empty and fail parsing instead of reusing the original points.

Three new browser cases check confirmation/cancellation, persistence before confirmation,
all-station application, exact points, custom width/height retention, station-switch
proposal invalidation, vertical-bank refusal, unchanged saved history, and construction
replacement with an unchanged base river and retained downstream stage. The synthetic
trapezoid and converted survey results agree within absolute 1e-7 for depth, stage, area,
velocity, Froude, normal depth and critical depth. This comparison uses the same Rust
engine and is a conversion consistency check, separate from the independent reference
suites and field validation.

An initial focused test used an exact label locator that did not resolve the construction
selector; the accessible combobox locator fixed that test and all three cases passed.
The first complete and Docker browser invocations were mistakenly run concurrently with
the same Playwright artifact directory. Their reported errors were missing trace/context
artifact files (ENOENT). Those runs are retained as failures. Final browser
runs use separate output directories. Rust, reference, recovery, audit and build checks
had already passed and were not repeated for this artifact-directory issue.

The complete numerical/build portion passed: 91 Rust tests, fmt, clippy with warnings
denied, independent reference regeneration, five backup tests, five NCRO tests, ten
offline review-pack audit tests, frontend type check and production build. The final
isolated native-browser invocation exited zero with all 26 cases passing (2.5 minutes).
No numerical engine, API contracts, database schema, dependencies or lockfiles changed;
engine version remains 0.2.0. Field adoption remains zero and maturity remains
44.0/100 (about 45%), target 50%.

The rebuilt Docker distribution passed four final browser cases (13.8 seconds): all three
section-conversion cases and the existing edit/steady-flow/construction/report/persistence
workflow. The confirmation screenshot was visually inspected. Production images:

- API: sha256:8f03d56a07d906fe21cced2b3287553ab6e1cf9da4b17d4470b3ca806b70d7ad
- Web: sha256:9be9d75776832006fa5b814e38e9e233ab6f97b426cc9743b9cd97bb02e7020a

Logs retained under `.local/section-conversion-`: `focused-20261012.log` (initial selector
failure), `focused-fixed-20261012.log` (three passing cases), `check-20261012.log` and
`docker-e2e-20261012.log` (artifact-collision failures), `native-final-20261012.log` and
`docker-final-20261012.log` (final successful browser runs), and `docker-build-20261012.log`.
Only the dedicated `doboku-section-20261012` Compose project is stopped after validation;
its data volume and the user's existing native services/database are retained.

The implementation commit `5aba0233fa0f56358e3149a37a274378ec59c850` subsequently
completed [MVP checks](https://github.com/rsasaki0109/DobokuAI/actions/runs/38267126753)
with Success. The associated `validate` job also completed successfully; its workflow
contains the pinned v6 checkout/setup-node actions and full `scripts/check.sh` command.
Official page hashes and observation time are retained in [hosted evidence](hosted-ci-evidence.json).
The test counts above are from local execution; hosted numeric counts were not independently
counted from downloaded job logs. This establishes CI success for the implementation
commit, not field applicability or the later documentation-only commit.

## Survey import condition review / 2026-10-12

The import panel incorrectly said existing Manning roughness would be retained, although
CSV roughness replaces it. The explanation is corrected and a read-only condition review
shows current/candidate roughness ranges and individual CSV values in the existing geometry
table. Discharge, reference slope, regime and boundary depth remain inherited conditions;
new endpoint chainage/bed and bed-plus-depth stage are displayed before explicit application.
The declarations are shown separately, without a water-level difference across different
vertical datum labels or a claim that matching labels authenticate the original datum.
No solver, API/storage contract, schema, dependency or lockfile changed.

Two synthetic browser cases cover subcritical/downstream and supercritical/upstream endpoints,
original versus CSV roughness, inherited Q/slope/depth, changed declarations, confirmation
before saving, cleared scenarios, actual Rust profiles in the selected regime, unchanged
prior run snapshots and saved project persistence. The displayed review follows current
project declarations if edited after the CSV preview. The existing table-scroll class now
shares the intended horizontal scroll styling; width390px does not overflow the page after
the responsive charts settle.

The initial subcritical fixture compared an 8m relative height exactly after serializing
it as an absolute decimal elevation; subtraction produced ordinary ~1e-15 round-off.
The condition-review fixture now supplies explicit relative heights, preserving exact
coordinate assertions without changing engine tolerances. Absolute-height conversion
remains covered by existing tests. The first mobile check ran before responsive chart
layout settled; the final test waits for the same width390px assertion without relaxing it.
Both focused cases then passed (30.9 seconds). The confirmation screenshot was inspected.

A final UI review found that working scenario edits are held separately from the saved
project in App. The importer now receives the current scenario/staged state as well as
current river/reference conditions, so the count of proposals to clear is accurate even
before saving. Both new cases add an unsaved second scenario and enable cumulative mode,
then check the displayed count, unchanged stored project before confirmation and cleared
scenarios/cumulative mode afterward. The initial complete check was stopped during its
browser phase to apply this correction; its numerical/reference/recovery/audit portion
had passed. The final source was rebuilt/type-checked and all browser cases rerun.

The numerical/reference/build checks passed: 91 Rust tests, fmt, clippy with warnings
denied, independent reference regeneration, five backup tests, five NCRO tests, ten
review-pack audit tests, type check and production build. Final native browser execution
exited zero with all 28 cases passing (3.2 minutes), including both new condition-review
cases with unsaved scenario edits. Engine version remains 0.2.0. Field adoption remains
zero; fixed maturity remains 44.0/100 (about 45%), target 50%.

The final rebuilt Docker distribution passed four targeted browser cases (16.4 seconds):
both new cases, the existing horizontal-m/vertical-survey-foot import, and the existing
edit/steady-flow/construction/report/persistence workflow. Production images:

- API: sha256:83f6cb75c03aa468a1a796647aef8bae15d82e3b292fa735ba6533110fd9ecde
- Web: sha256:01c4c676b60197a9cf6be3c0ac2dc89bbb68da74c9ec95f73bfc048975cc4b0b

Logs under `.local/import-conditions-`: `focused-20261012.log` and
`focused-fixed-20261012.log` (initial fixture/layout failures), `responsive-20261012.log`
(passing focused cases), `check-20261012.log` (numerical/build checks then interrupted
browser phase), `build-final-20261012.log`, `native-final-20261012.log`,
`docker-build-final-20261012.log` and `docker-final-20261012.log` (final passing runs).
The dedicated `doboku-import-20261012` Compose project is stopped after testing and its
volume is retained. The existing user database/services remain in place.

The implementation commit `c06e9a6d6e9f70fb3ca2fd93eee3dff31da56086` subsequently
completed [MVP checks](https://github.com/rsasaki0109/DobokuAI/actions/runs/38304858522)
with Success. Its `validate` job completed successfully and the associated workflow
contains the pinned v6 actions and full `scripts/check.sh`. Official page hashes and UTC
observation time are retained in [hosted evidence](hosted-ci-evidence.json).
Numeric counts above are local results, not independently counted hosted job logs.
This establishes CI success for the implementation commit, not field applicability or
the following documentation-only commit.

## Confirmed downstream station addition / 2026-10-12 UTC

The editor formerly added a copied station immediately at last+100m and extrapolated
bed elevation from the normal-depth reference slope. It now opens a draft without editing
the project. Distance defaults to last+100m and stated geometry/roughness copies; bed must
be explicitly supplied. Preview shows declared reference, copied source, ground only and
current/candidate boundary stage. Confirmation appends one station and selects it; saving
and solving remain separate. Cancelling or changing original conditions discards the draft.
Existing stations, Q, reference slope, scenarios and boundary depth are retained. The new
downstream bed determines subcritical boundary stage; supercritical upstream stage stays
unchanged. Source CSV provenance continues to describe the original file, not later edits.

The NumberField component was moved verbatim to a shared module, with the original Editor
re-export retained, to avoid a circular dependency between editor and draft component.
No engine, API/storage contracts, schema, dependencies or lockfiles changed.
Two focused synthetic browser cases passed (14.7 seconds): blank bed blocks application,
duplicate chainage/invalid roughness are refused, candidate/cancellation do not affect
saved geometry or history, original edits invalidate the proposal, and all 11 original
stations remain exactly equal after adding the twelfth. Actual Rust profiles check
subcritical new downstream stage 12.1m and supercritical upstream stage 10.55m, selected
regime at every station, old immutable runs and saved project persistence. The all-station
shape toggle cannot propagate an addition, and is reset after confirmation. The confirmation
screenshot was inspected. This is not field-data adoption or observed-water calibration.

The full `scripts/check.sh` exited zero: 91 Rust tests, fmt, clippy with warnings denied,
independent references, five backup tests, five NCRO tests, ten review-pack audit tests,
frontend type check/build and all 30 native-browser E2E cases (4.2 minutes). Engine version
remains 0.2.0. Field adoption remains zero; fixed maturity remains 44.0/100 (about 45%),
target 50%. [Addition semantics](station-addition.md).

The final Docker distribution passed four targeted browser cases (24.1 seconds): both
new station-addition cases, boundary-water-level input and the existing edit/steady-flow/
construction/report/persistence workflow. Production images:

- API: sha256:c342e353352744584948d3631ee446570b9f1f562d4f94d47ff3333f35e7ac2e
- Web: sha256:4d7449fb21d850a113ad4e7d5359a585bec120b75ddad9394f588efd4f77c413

Logs retained under `.local/station-addition-`: `focused-20261012.log`,
`check-20261012.log`, `docker-build-20261012.log` and `docker-final-20261012.log`.
All executed cases passed without skipped or loosened assertions. The dedicated
`doboku-station-20261012` Compose project is stopped and its volume is retained;
existing user services/database remain in place.

The implementation commit `64ebd61bc4ab8b9726476112c2ec276db591663e` subsequently
completed [MVP checks](https://github.com/rsasaki0109/DobokuAI/actions/runs/38310017471)
with Success. Its `validate` job completed successfully and the associated workflow
contains the pinned v6 actions and full `scripts/check.sh`. Official page hashes and UTC
observation time are retained in [hosted evidence](hosted-ci-evidence.json).
Counts above are local results, not independently counted hosted job logs. This validates
the implementation commit, not field applicability or the later documentation-only commit.

## Confirmed station deletion / 2026-10-12 UTC

The editor previously removed the selected station immediately. It now previews target
ground and reference, remaining count, original/candidate boundary location/stage and
joined-neighbour spacing. Explicit confirmation removes one station verbatim without
reindexing coordinates, interpolation or smoothing. Remaining Q/reference slope/regime/
boundary depth/scenarios/reference are retained; deleting the active boundary endpoint
moves the prescribed stage with the new endpoint bed. Cancel, target switching or edits
to original conditions discard the proposal; addition/deletion proposals are exclusive.
The section-input key includes station count, so an uncommitted survey draft is discarded
when an upstream deletion reuses the same index for another original station.
No numerical engine, API/storage contract, schema, dependencies or lockfiles changed.

The initial focused run passed four endpoint cases and the survey/minimum-count case
(40.7 seconds); a follow-up passed both actual middle-deletion calculations (17.1 seconds).
Final tests cover subcritical and supercritical first/middle/last station removal, explicit
save during preview leaving original data unchanged, cancel/reselect/no proposal revival,
unchanged stored projects before save, exact equality of every retained condition/station,
actual Rust profiles and regime at all ten stations, inherited scenario comparisons and
unchanged old snapshots after saving/editing. Subcritical endpoint cut quantity is 28,800m³
for the new 900m domain; middle deletion keeps 32,000m³ for the synthetic constant-cut-area
1,000m domain. Supercritical removal of the first station uses 10.35m instead of 10.55m at
the upstream boundary, without changing depth. The three-survey-section case checks
original-edit invalidation, stale uncommitted point text discarded at reused index and
the minimum of two sections. The confirmation screenshot was inspected.
These synthetic results are not field-data adoption, calibration or design certification.

The complete `scripts/check.sh` exited zero: 91 Rust tests, fmt, clippy with warnings denied,
independent reference regeneration, five backup tests, five NCRO tests, ten offline-audit
tests, frontend type check/build and all 37 native-browser E2E cases (2.8 minutes).
No skipped assertions or relaxed numerical tolerances were used. Engine version remains
0.2.0; field adoption remains zero and fixed maturity stays 44.0/100 (about 45%), target 50%.
[Deletion semantics](station-deletion.md).

The final Docker distribution passed eight targeted browser cases (25.8 seconds):
all seven station-deletion cases and the existing edit/steady-flow/construction/report/
persistence workflow. Production images:

- API: sha256:8e51c9d1f872edf4545988a4942f05ae9824ebffc101c3228d418810f05a30cb
- Web: sha256:a1dc77090bfec9f3b6a4c2bf3a786daba3c17522c112d417b9ab7640dac34387

Logs retained under `.local/station-deletion-`: `focused-20261012.log`,
`middle-20261012.log`, `check-20261012.log`, `docker-build-20261012.log` and
`docker-final-20261012.log`. The dedicated `doboku-delete-20261012` Compose project
is stopped after testing and its volume is retained. Existing user services/database
remain in place.
