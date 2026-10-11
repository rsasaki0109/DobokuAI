use doboku_core::{sample, Point, Regime, River, Section};
use doboku_hydraulics::{
    resolution::{refine, study, Outcome},
    ENERGY_TOL,
};
use serde::Deserialize;

#[test]
fn interpolation_preserves_originals_and_boundary_and_matches_hand_values() {
    let mut river = sample().river;
    river.stations.truncate(2);
    river.stations[1].roughness = 0.04;
    river.stations[1].section = Section::Trapezoid {
        bottom_width: 22.0,
        side_slope: 1.6,
        bank_height: 9.0,
    };
    let before = serde_json::to_string(&river).unwrap();
    let refined = refine(&river, 4).unwrap();
    assert_eq!(refined.stations.len(), 5);
    for (i, old) in river.stations.iter().enumerate() {
        assert_eq!(
            serde_json::to_value(old).unwrap(),
            serde_json::to_value(&refined.stations[i * 4]).unwrap()
        );
    }
    let mid = &refined.stations[2];
    assert_eq!(mid.chainage, 50.0);
    assert!((mid.bed_elevation - 9.95).abs() < 1e-12);
    assert!((mid.roughness - 0.035).abs() < 1e-12);
    assert_eq!(
        mid.section,
        Section::Trapezoid {
            bottom_width: 21.0,
            side_slope: 1.55,
            bank_height: 8.5
        }
    );
    assert_eq!(serde_json::to_string(&river).unwrap(), before);
    assert_eq!(refined.boundary.depth, river.boundary.depth);
    assert_eq!(refined.boundary.regime, river.boundary.regime);
    assert_eq!(refined.discharge, river.discharge);
}

#[test]
fn survey_interpolation_requires_matching_x_and_valley_and_never_reorders() {
    let mut river = sample().river;
    river.stations.truncate(2);
    let points = vec![
        Point { x: -20.0, z: 8.0 },
        Point { x: -10.0, z: 0.0 },
        Point { x: 10.0, z: 0.0 },
        Point { x: 20.0, z: 8.0 },
    ];
    river.stations[0].section = Section::Survey {
        points: points.clone(),
    };
    let mut changed = points.clone();
    changed[0].z = 9.0;
    changed[3].z = 9.0;
    river.stations[1].section = Section::Survey {
        points: changed.clone(),
    };
    let result = refine(&river, 2).unwrap();
    let Section::Survey { points: mid } = &result.stations[1].section else {
        panic!()
    };
    assert_eq!(mid[0], Point { x: -20.0, z: 8.5 });
    assert_eq!(mid[1], points[1]);
    changed[0].x = -21.0;
    river.stations[1].section = Section::Survey {
        points: changed.clone(),
    };
    assert!(refine(&river, 2).unwrap_err().to_string().contains("横断x"));
    changed = points;
    changed[1].z = 0.1;
    river.stations[1].section = Section::Survey { points: changed };
    assert!(refine(&river, 2)
        .unwrap_err()
        .to_string()
        .contains("最低点"));
}

#[test]
fn spacing_capacity_and_original_abrupt_change_guards_cannot_be_evaded() {
    let river = sample().river;
    assert!(refine(&river, 0).is_err());
    assert!(refine(&river, usize::MAX).is_err());
    let mut dense = river.clone();
    for (i, s) in dense.stations.iter_mut().enumerate() {
        s.chainage = i as f64 * 0.2;
        s.bed_elevation = 10.0 - i as f64 * 0.0002;
    }
    assert!(refine(&dense, 4)
        .unwrap_err()
        .to_string()
        .contains("間隔0.1m"));
    let many = refine(&river, 10).unwrap();
    let result = study(&many).unwrap();
    for c in result.cases {
        assert!(matches!(c,Outcome::Failed{error,..} if error.contains("上限200")));
    }
    let mut abrupt = river;
    abrupt.stations[0].section = Section::Rectangle {
        width: 10.0,
        bank_height: 8.0,
    };
    abrupt.stations[1].section = Section::Rectangle {
        width: 14.0,
        bank_height: 8.0,
    };
    assert!(refine(&abrupt, 4)
        .unwrap_err()
        .to_string()
        .contains("幅急変"));
}

#[derive(Deserialize)]
struct Suite {
    cases: Vec<Case>,
}
#[derive(Deserialize)]
struct Case {
    id: String,
    river: River,
    rows: Vec<Reference>,
}
#[derive(Deserialize)]
struct Reference {
    chainage: f64,
    depth: f64,
}

#[test]
fn spacing_study_converges_against_six_independent_ode_references() {
    let suite: Suite =
        serde_json::from_str(include_str!("../../../examples/reference-cases.json")).unwrap();
    for case in suite.cases {
        let mut river = case.river;
        // The fixture's observation locations are a coarser subset of its stations.
        river
            .stations
            .retain(|s| case.rows.iter().any(|r| r.chainage == s.chainage));
        let result = study(&river).unwrap();
        let error = |p: &doboku_hydraulics::Profile, factor: usize| {
            case.rows
                .iter()
                .enumerate()
                .map(|(i, r)| (p.rows[i * factor].depth - r.depth).abs())
                .fold(0.0, f64::max)
        };
        let mut previous = error(&result.baseline, 1);
        for outcome in result.cases {
            let Outcome::Ok {
                subdivisions,
                river: refined,
                profile,
                differences,
                max_abs_water_change,
                previous_max_abs_water_change,
            } = outcome
            else {
                panic!("{}: expected successful refinement", case.id)
            };
            let current = error(&profile, subdivisions);
            assert!(
                current < previous / 2.0,
                "{}: {previous} -> {current}",
                case.id
            );
            println!("{} / {} divisions: independent depth error={current:.9e} m; previous result difference={:.9e} m",case.id,subdivisions,previous_max_abs_water_change.unwrap());
            previous = current;
            let boundary = if river.boundary.regime == Regime::Subcritical {
                profile.rows.last().unwrap()
            } else {
                &profile.rows[0]
            };
            assert_eq!(boundary.depth, river.boundary.depth);
            for row in &profile.rows {
                assert!(row.energy_residual.abs() < ENERGY_TOL);
            }
            for (i, d) in differences.iter().enumerate() {
                assert_eq!(d.chainage, river.stations[i].chainage);
                assert_eq!(refined.stations[i * subdivisions].chainage, d.chainage);
                assert!(
                    (d.water_change
                        - (profile.rows[i * subdivisions].water_elevation
                            - result.baseline.rows[i].water_elevation))
                        .abs()
                        < 1e-12
                );
            }
            assert_eq!(
                max_abs_water_change,
                differences
                    .iter()
                    .map(|d| d.water_change.abs())
                    .fold(0.0, f64::max)
            );
        }
    }
}
