use doboku_core::{Regime, River, Section, Station};
use doboku_geometry::wet;
use doboku_hydraulics::{solve, ENERGY_TOL};
use serde::Deserialize;

#[derive(Deserialize)]
struct Suite {
    cases: Vec<Case>,
}
#[derive(Deserialize)]
struct Case {
    id: String,
    river: River,
    fine_dx: f64,
    depth_tolerance_m: f64,
    minimum_improvement: f64,
    reference_refinement_m: f64,
    rows: Vec<ReferenceRow>,
}
#[derive(Deserialize)]
struct ReferenceRow {
    chainage: f64,
    depth: f64,
    water_elevation: f64,
    area: f64,
    perimeter: f64,
    top_width: f64,
    velocity: f64,
    froude: f64,
    friction_slope: f64,
}

fn refine(river: &River, dx: f64) -> River {
    let mut refined = river.clone();
    let mut stations = Vec::new();
    for pair in river.stations.windows(2) {
        let (a, b) = (&pair[0], &pair[1]);
        let length = b.chainage - a.chainage;
        let count = (length / dx).round() as usize;
        assert!((count as f64 * dx - length).abs() < 1e-10);
        for i in 0..count {
            let fraction = i as f64 / count as f64;
            let section = if a.section == b.section {
                a.section.clone()
            } else {
                match (&a.section, &b.section) {
                    (
                        Section::Rectangle {
                            width: aw,
                            bank_height: ah,
                        },
                        Section::Rectangle {
                            width: bw,
                            bank_height: bh,
                        },
                    ) => {
                        assert_eq!(ah, bh);
                        Section::Rectangle {
                            width: aw + (bw - aw) * fraction,
                            bank_height: *ah,
                        }
                    }
                    _ => panic!("Only linearly varying rectangles are in this reference suite"),
                }
            };
            stations.push(Station {
                chainage: a.chainage + length * fraction,
                bed_elevation: a.bed_elevation + (b.bed_elevation - a.bed_elevation) * fraction,
                roughness: a.roughness + (b.roughness - a.roughness) * fraction,
                section,
            });
        }
    }
    stations.push(river.stations.last().unwrap().clone());
    refined.stations = stations;
    refined
}

fn verify(id: &str) {
    let suite: Suite =
        serde_json::from_str(include_str!("../../../examples/reference-cases.json")).unwrap();
    let case = suite.cases.into_iter().find(|c| c.id == id).unwrap();
    assert!(case.reference_refinement_m >= 0.0 && case.reference_refinement_m < 1e-9);
    assert!(case.rows.len() >= 11);
    let coarse = solve(&case.river).unwrap();
    let refined_river = refine(&case.river, case.fine_dx);
    let fine = solve(&refined_river).unwrap();
    let error = |rows: &[doboku_hydraulics::Row]| {
        case.rows
            .iter()
            .map(|expected| {
                let actual = rows
                    .iter()
                    .find(|r| (r.chainage - expected.chainage).abs() < 1e-8)
                    .unwrap();
                (actual.depth - expected.depth).abs()
            })
            .fold(0.0, f64::max)
    };
    let coarse_error = error(&coarse.rows);
    let fine_error = error(&fine.rows);
    println!(
        "{id}: coarse={coarse_error:.9e}m fine={fine_error:.9e}m improvement={:.2}",
        coarse_error / fine_error
    );
    assert!(
        fine_error < case.depth_tolerance_m,
        "{id}: fine error {fine_error} exceeds {}",
        case.depth_tolerance_m
    );
    assert!(
        fine_error < coarse_error / case.minimum_improvement,
        "{id}: coarse {coarse_error}, fine {fine_error}"
    );
    let depths: Vec<f64> = case.rows.iter().map(|r| r.depth).collect();
    let range = depths.iter().copied().fold(f64::NEG_INFINITY, f64::max)
        - depths.iter().copied().fold(f64::INFINITY, f64::min);
    assert!(range > 0.05, "Reference must exercise nonuniform flow");
    if id == "survey_vertex_crossing" {
        assert!(depths.iter().any(|y| *y < 2.0));
        assert!(depths.iter().any(|y| *y > 2.0));
    }
    let boundary_index = match case.river.boundary.regime {
        Regime::Subcritical => fine.rows.len() - 1,
        Regime::Supercritical => 0,
    };
    assert_eq!(fine.rows[boundary_index].depth, case.river.boundary.depth);
    for actual in &fine.rows {
        assert!(actual.depth.is_finite() && actual.depth > 0.0);
        assert!(actual.energy_residual.abs() < ENERGY_TOL);
        match case.river.boundary.regime {
            Regime::Subcritical => assert!(actual.froude < 0.98),
            Regime::Supercritical => assert!(actual.froude > 1.02),
        }
    }
    for expected in &case.rows {
        let index = fine
            .rows
            .iter()
            .position(|r| (r.chainage - expected.chainage).abs() < 1e-8)
            .unwrap();
        let actual = &fine.rows[index];
        // Validate geometry at exactly the reference water depth, independently of
        // the longitudinal solver error. Python integrates horizontal strips.
        let g = wet(&refined_river.stations[index].section, expected.depth).unwrap();
        assert!((g.area - expected.area).abs() < 1e-10);
        assert!((g.perimeter - expected.perimeter).abs() < 1e-10);
        assert!((g.top_width - expected.top_width).abs() < 1e-10);
        assert!((actual.water_elevation - expected.water_elevation).abs() < case.depth_tolerance_m);
        assert!((actual.velocity - expected.velocity).abs() < 20.0 * case.depth_tolerance_m);
        assert!((actual.froude - expected.froude).abs() < 20.0 * case.depth_tolerance_m);
        assert!((actual.friction_slope - expected.friction_slope).abs() < case.depth_tolerance_m);
    }
}

#[test]
fn rectangular_nonuniform_supercritical_flow_matches_independent_ode() {
    verify("rectangle_supercritical");
}
#[test]
fn trapezoidal_nonuniform_supercritical_flow_matches_independent_ode() {
    verify("trapezoid_supercritical");
}
#[test]
fn trapezoidal_backwater_matches_independent_ode() {
    verify("trapezoid_subcritical");
}
#[test]
fn asymmetric_survey_backwater_matches_horizontal_strip_reference() {
    verify("survey_subcritical");
}
#[test]
fn survey_waterline_crossing_a_vertex_matches_independent_ode() {
    verify("survey_vertex_crossing");
}
#[test]
fn gradual_width_change_matches_ode_including_area_gradient() {
    verify("widening_rectangle_subcritical");
}
