use doboku_core::{Boundary, Error, Point, Regime, River, Section, Station};
use doboku_geometry::{connected_ranges, ground, wet};
use doboku_hydraulics::{critical_depth, normal_depth, solve};

fn section() -> Section {
    Section::Survey {
        points: [
            (-10., 6.),
            (-5., 0.6),
            (-3., 0.),
            (-1., 0.12),
            (1., 0.04),
            (3., 0.18),
            (5., 0.5),
            (9., 6.),
        ]
        .into_iter()
        .map(|(x, z)| Point { x, z })
        .collect(),
    }
}

#[test]
fn irregular_vertices_are_retained_and_flow_stays_in_one_connected_band() {
    let s = section();
    let points = ground(&s, 0.0);
    assert!(wet(&s, 0.08).is_err());
    assert!(wet(&s, 0.12).is_err());
    assert!(wet(&s, 1.0).is_ok());
    let critical = critical_depth(&s, 15.0).unwrap();
    let normal = normal_depth(&s, 15.0, 0.035, 0.001).unwrap();
    assert!(critical > 0.12 && normal > critical);
    let mut river = River {
        discharge: 15.0,
        normal_slope: 0.001,
        boundary: Boundary {
            regime: Regime::Subcritical,
            depth: 3.6,
        },
        stations: (0..11)
            .map(|i| Station {
                chainage: i as f64 * 40.0,
                bed_elevation: 20.0 - i as f64 * 0.04,
                roughness: 0.035,
                section: s.clone(),
            })
            .collect(),
    };
    let profile = solve(&river).unwrap();
    assert!(profile
        .rows
        .iter()
        .all(|r| r.depth > 0.12 && r.froude < 0.98));
    for station in &river.stations {
        assert_eq!(ground(&station.section, 0.0), points);
    }
    river.boundary.depth = 0.02;
    river.boundary.regime = Regime::Supercritical;
    assert!(solve(&river)
        .unwrap_err()
        .to_string()
        .contains("同じ連続流路"));
    assert_eq!(connected_ranges(&s).unwrap().len(), 2);
}

#[test]
fn smooth_rapid_widening_with_multiple_critical_roots_is_rejected() {
    // Continuous banks, not a horizontal-bench discontinuity.
    let s = Section::Survey {
        points: [
            (-520., 3.),
            (-500., 1.6),
            (-1., 1.5),
            (-0.99, 0.),
            (0.99, 0.),
            (1., 1.5),
            (500., 1.6),
            (520., 3.),
        ]
        .into_iter()
        .map(|(x, z)| Point { x, z })
        .collect(),
    };
    assert!(matches!(
        critical_depth(&s, 10.0),
        Err(Error::Unsupported(_))
    ));
    let error = critical_depth(&s, 10.0).unwrap_err();
    assert!(error.to_string().contains("複数"), "{error}");
}

#[test]
fn multiple_or_discontinuous_normal_depth_is_not_chosen_arbitrarily() {
    let s = Section::Survey {
        points: [
            (-120., 5.),
            (-100., 1.5),
            (-5., 1.5),
            (-4.9, 0.),
            (4.9, 0.),
            (5., 1.5),
            (100., 1.5),
            (120., 5.),
        ]
        .into_iter()
        .map(|(x, z)| Point { x, z })
        .collect(),
    };
    assert!(critical_depth(&s, 5.0).is_ok());
    let error = normal_depth(&s, 5.0, 0.03, 0.001).unwrap_err();
    assert!(error.to_string().contains("等流水深") || error.to_string().contains("残差"));
    assert!(matches!(error, Error::Unsupported(_)));
}
