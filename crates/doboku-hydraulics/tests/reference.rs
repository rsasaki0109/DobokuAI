use doboku_core::{Boundary, Regime, River, Section, Station};
use doboku_hydraulics::solve;

fn reference_error(dx: f64) -> f64 {
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../../../examples/reference-gvf.json")).unwrap();
    let r = River {
        discharge: 20.0,
        normal_slope: 0.001,
        boundary: Boundary {
            regime: Regime::Subcritical,
            depth: 2.5,
        },
        stations: (0..=(1000.0 / dx) as usize)
            .map(|i| Station {
                chainage: i as f64 * dx,
                bed_elevation: 10.0 - i as f64 * dx * 0.001,
                roughness: 0.03,
                section: Section::Rectangle {
                    width: 10.0,
                    bank_height: 10.0,
                },
            })
            .collect(),
    };
    let profile = solve(&r).unwrap();
    fixture["rows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| {
            let x = row["chainage"].as_f64().unwrap();
            let y = row["depth"].as_f64().unwrap();
            (profile.rows[(x / dx).round() as usize].depth - y).abs()
        })
        .fold(0.0, f64::max)
}
#[test]
fn backwater_matches_independent_ode_and_converges_with_refinement() {
    let coarse = reference_error(100.0);
    let fine = reference_error(10.0);
    assert!(fine < 5e-5, "fine maximum error {fine}");
    assert!(fine < coarse / 20.0, "coarse {coarse}, fine {fine}");
}
