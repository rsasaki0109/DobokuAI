//! External SWASHES B1 fixtures. The optional generator never calls this solver.
use doboku_core::{Regime, River, G};
use doboku_hydraulics::{solve, Profile, ENERGY_TOL};
use serde::Deserialize;

#[derive(Deserialize)]
struct Suite {
    cases: Vec<Case>,
}
#[derive(Deserialize)]
struct Case {
    id: String,
    river: River,
    rows: Vec<Reference>,
    coarse_stride: usize,
    depth_tolerance_m: f64,
    minimum_improvement: f64,
    external_bed_refinement_m: f64,
}
#[derive(Deserialize)]
struct Reference {
    chainage: f64,
    depth: f64,
    bed_elevation: f64,
    water_elevation: f64,
}

fn sampled(river: &River, stride: usize) -> River {
    let mut result = river.clone();
    assert_eq!((river.stations.len() - 1) % stride, 0);
    result.stations = river.stations.iter().step_by(stride).cloned().collect();
    result
}

fn verify(regime: Regime) {
    let suite: Suite =
        serde_json::from_str(include_str!("../../../examples/swashes-reference.json")).unwrap();
    let case = suite
        .cases
        .into_iter()
        .find(|c| c.river.boundary.regime == regime)
        .unwrap();
    assert_eq!(case.rows.len(), 177);
    assert_eq!(case.coarse_stride, 4);
    assert_eq!(case.depth_tolerance_m, 1e-4);
    assert_eq!(case.minimum_improvement, 4.0);
    assert!(case.external_bed_refinement_m <= 5e-6);
    // Normalize gravity transparently, preserving the native reference energy
    // and Manning friction invariants. These are not original-Q velocity tests.
    assert!((case.river.discharge.powi(2) / G - 400.0 / 9.81).abs() < 1e-12);
    for station in &case.river.stations {
        assert!((station.roughness * case.river.discharge - 0.6).abs() < 1e-12);
    }
    let coarse = solve(&sampled(&case.river, case.coarse_stride)).unwrap();
    let medium = solve(&sampled(&case.river, 2)).unwrap();
    let fine = solve(&case.river).unwrap();
    // Compare refinement errors at the same 45 points, including both ends.
    let common_error = |profile: &Profile| {
        case.rows
            .iter()
            .step_by(case.coarse_stride)
            .map(|expected| {
                let actual = profile
                    .rows
                    .iter()
                    .find(|r| r.chainage == expected.chainage)
                    .unwrap();
                (actual.depth - expected.depth).abs()
            })
            .fold(0.0, f64::max)
    };
    let errors = [
        common_error(&coarse),
        common_error(&medium),
        common_error(&fine),
    ];
    let fine_max = fine
        .rows
        .iter()
        .zip(&case.rows)
        .map(|(actual, expected)| (actual.depth - expected.depth).abs())
        .fold(0.0, f64::max);
    println!(
        "{}: 45/89/177 common-point errors={errors:?}m; all-point fine={fine_max:.9e}m; external bed refinement={:.9e}m",
        case.id, case.external_bed_refinement_m
    );
    assert!(errors[1] < errors[0], "{}: refinement failed", case.id);
    assert!(errors[2] < errors[1], "{}: refinement failed", case.id);
    assert!(errors[2] < errors[0] / case.minimum_improvement);
    assert!(fine_max < case.depth_tolerance_m);
    let boundary = if regime == Regime::Subcritical {
        fine.rows.last().unwrap()
    } else {
        &fine.rows[0]
    };
    assert_eq!(boundary.depth, case.river.boundary.depth);
    for (actual, expected) in fine.rows.iter().zip(&case.rows) {
        assert_eq!(actual.chainage, expected.chainage);
        assert_eq!(actual.bed_elevation, expected.bed_elevation);
        assert!(actual.depth.is_finite() && actual.depth > 0.0);
        assert!(actual.energy_residual.abs() < ENERGY_TOL);
        assert!(
            (actual.water_elevation - expected.water_elevation).abs()
                < case.depth_tolerance_m + 2e-6
        );
        match regime {
            Regime::Subcritical => assert!(actual.froude < 0.98),
            Regime::Supercritical => assert!(actual.froude > 1.02),
        }
    }
}

#[test]
fn swashes_rectangular_b1_backwater_matches_and_converges() {
    verify(Regime::Subcritical);
}

#[test]
fn swashes_rectangular_b1_supercritical_profile_matches_and_converges() {
    verify(Regime::Supercritical);
}
