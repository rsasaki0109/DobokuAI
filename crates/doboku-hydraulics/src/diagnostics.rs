//! Read-only checks using the same depth branches and transition guards as solve.
//! Passing these checks does not establish existence of a longitudinal solution.
use crate::{check_regime, depth_range, froude, validate_inputs};
use doboku_core::{Regime, Result, River, Station};
use doboku_geometry::{connected_ranges, wet, DepthRange};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct SectionCheck {
    pub chainage: f64,
    pub connected_depth_ranges: Vec<DepthRange>,
    pub selected_depth_range: Option<DepthRange>,
    pub critical_depth: Option<f64>,
    pub normal_depth: Option<f64>,
    pub issues: Vec<String>,
}
#[derive(Debug, Serialize)]
pub struct TransitionCheck {
    pub upstream_chainage: f64,
    pub downstream_chainage: f64,
    pub bed_slope: Option<f64>,
    pub reference_depth: Option<f64>,
    pub upstream_width: Option<f64>,
    pub downstream_width: Option<f64>,
    pub width_ratio: Option<f64>,
    pub issues: Vec<String>,
}
#[derive(Debug, Serialize)]
pub struct BoundaryCheck {
    pub chainage: f64,
    pub depth: f64,
    pub water_surface: Option<f64>,
    pub froude: Option<f64>,
    pub issues: Vec<String>,
}
#[derive(Debug, Serialize)]
pub struct RiverCheck {
    pub can_attempt_profile: bool,
    pub sections: Vec<SectionCheck>,
    pub transitions: Vec<TransitionCheck>,
    pub boundary: BoundaryCheck,
    pub note: &'static str,
}

pub(crate) fn transition(a: &Station, b: &Station) -> TransitionCheck {
    let mut check = TransitionCheck {
        upstream_chainage: a.chainage,
        downstream_chainage: b.chainage,
        bed_slope: None,
        reference_depth: None,
        upstream_width: None,
        downstream_width: None,
        width_ratio: None,
        issues: vec![],
    };
    let slope = (a.bed_elevation - b.bed_elevation) / (b.chainage - a.chainage);
    if !slope.is_finite() {
        check.issues.push("河床勾配が非有限です".into());
    } else {
        check.bed_slope = Some(slope);
        if slope.abs() > 0.1 {
            check.issues.push("河床急変（勾配>0.1）".into());
        }
    }
    let widths = || -> Result<(f64, f64, f64)> {
        let depth = depth_range::width_reference(&a.section, &b.section)?;
        Ok((
            depth,
            wet(&a.section, depth)?.top_width,
            wet(&b.section, depth)?.top_width,
        ))
    };
    match widths() {
        Ok((depth, wa, wb)) => {
            check.reference_depth = Some(depth);
            check.upstream_width = Some(wa);
            check.downstream_width = Some(wb);
            let ratio = wa.max(wb) / wa.min(wb);
            if ratio.is_finite() {
                check.width_ratio = Some(ratio);
            }
            if !ratio.is_finite() || ratio > 1.25 {
                check.issues.push("隣接断面の幅急変（25%以上）".into());
            }
        }
        Err(error) => check.issues.push(error.to_string()),
    }
    check
}

pub fn inspect(river: &River) -> Result<RiverCheck> {
    // Reject invalid input before computing any displayed number.
    validate_inputs(river)?;
    let mut sections = Vec::with_capacity(river.stations.len());
    for station in &river.stations {
        let mut check = SectionCheck {
            chainage: station.chainage,
            connected_depth_ranges: connected_ranges(&station.section)?,
            selected_depth_range: None,
            critical_depth: None,
            normal_depth: None,
            issues: vec![],
        };
        match depth_range::branch(&station.section, river.discharge) {
            Ok(branch) => {
                check.selected_depth_range = Some(DepthRange {
                    lower: branch.lower,
                    upper: branch.upper,
                });
                check.critical_depth = Some(branch.critical);
                match depth_range::normal(
                    &station.section,
                    river.discharge,
                    station.roughness,
                    river.normal_slope,
                    branch,
                ) {
                    Ok(depth) => check.normal_depth = Some(depth),
                    Err(error) => check.issues.push(error.to_string()),
                }
            }
            Err(error) => check.issues.push(error.to_string()),
        }
        sections.push(check);
    }
    let transitions: Vec<_> = river
        .stations
        .windows(2)
        .map(|p| transition(&p[0], &p[1]))
        .collect();
    let index = if river.boundary.regime == Regime::Subcritical {
        river.stations.len() - 1
    } else {
        0
    };
    let station = &river.stations[index];
    let mut boundary = BoundaryCheck {
        chainage: station.chainage,
        depth: river.boundary.depth,
        water_surface: None,
        froude: None,
        issues: vec![],
    };
    match froude(&station.section, boundary.depth, river.discharge) {
        Ok(fr) if fr.is_finite() => {
            boundary.froude = Some(fr);
            let stage = station.bed_elevation + boundary.depth;
            if stage.is_finite() {
                boundary.water_surface = Some(stage);
            } else {
                boundary.issues.push("境界水位が非有限です".into());
            }
            if let Err(error) = check_regime(fr, river.boundary.regime) {
                boundary.issues.push(error.to_string());
            }
            match sections[index].selected_depth_range {
                Some(range) if boundary.depth >= range.lower && boundary.depth <= range.upper => {}
                _ => boundary
                    .issues
                    .push("境界水深が限界水深を含む選択流路の探索範囲外です".into()),
            }
        }
        Ok(_) => boundary.issues.push("境界Frが非有限です".into()),
        Err(error) => boundary.issues.push(error.to_string()),
    }
    Ok(RiverCheck {
        can_attempt_profile: sections.iter().all(|s| s.issues.is_empty())
            && transitions.iter().all(|s| s.issues.is_empty()) && boundary.issues.is_empty(),
        sections, transitions, boundary,
        note: "基本条件の事前診断です。施工案は未適用。水深は河床からのm、幾何区間の端点は除外。選択探索区間は数値余裕を含む。限界・等流水深は同じRust解法を使用。通過しても縦断計算の収束、現地適合、安全性を保証しません。",
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use doboku_core::{sample, Point, Section};

    #[test]
    fn preflight_uses_solver_branches_and_boundary_direction() {
        let r = sample().river;
        let report = inspect(&r).unwrap();
        assert!(report.can_attempt_profile);
        assert_eq!(
            report.boundary.chainage,
            r.stations.last().unwrap().chainage
        );
        let profile = crate::solve(&r).unwrap();
        for (check, row) in report.sections.iter().zip(profile.rows) {
            assert_eq!(check.critical_depth, Some(row.critical_depth));
            assert_eq!(check.normal_depth, Some(row.normal_depth));
        }
    }
    #[test]
    fn irregular_split_boundary_and_multiple_bad_transitions_are_localized() {
        let mut r = sample().river;
        r.discharge = 1.;
        r.boundary.depth = 1.5;
        for station in &mut r.stations {
            station.section = Section::Survey {
                points: [(0., 4.), (1., 0.), (2., 2.), (3., 1.), (4., 4.)]
                    .map(|(x, z)| Point { x, z })
                    .to_vec(),
            };
        }
        let report = inspect(&r).unwrap();
        assert!(!report.can_attempt_profile);
        assert_eq!(
            report.sections[0].connected_depth_ranges,
            vec![
                DepthRange {
                    lower: 0.,
                    upper: 1.
                },
                DepthRange {
                    lower: 2.,
                    upper: 4.
                }
            ]
        );
        assert!(report.boundary.issues[0].contains("分離した流路"));
        assert!(report.boundary.froude.is_none());
        assert!(report.boundary.water_surface.is_none());
        r = sample().river;
        r.stations[1].section = Section::Rectangle {
            width: 100.,
            bank_height: 8.,
        };
        let report = inspect(&r).unwrap();
        assert_eq!(
            report
                .transitions
                .iter()
                .filter(|t| !t.issues.is_empty())
                .count(),
            2
        );
        let error = crate::validate(&r).unwrap_err().to_string();
        assert!(error.contains("測点 0 → 100 m"));
        assert!(report.transitions[0].issues[0].contains("幅急変"));
        assert!(report.transitions[0].width_ratio.unwrap() > 1.25);
    }
    #[test]
    fn preflight_rejects_invalid_input_and_does_not_invent_missing_depths() {
        let mut r = sample().river;
        r.stations[0].roughness = f64::NAN;
        assert!(inspect(&r).is_err());
        r = sample().river;
        r.discharge = 999999.;
        let report = inspect(&r).unwrap();
        assert!(!report.can_attempt_profile);
        assert!(report.sections.iter().all(|s| s.critical_depth.is_none()
            && s.normal_depth.is_none()
            && !s.issues.is_empty()));
    }
}
