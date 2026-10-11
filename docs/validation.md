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
