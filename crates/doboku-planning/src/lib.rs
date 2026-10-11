use doboku_core::{positive, Error, Regime, Result, River, Section};
pub use doboku_core::{Modification, Scenario};
use doboku_hydraulics::{solve, Profile};
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Comparison {
    pub scenario: Scenario,
    pub river: River,
    pub profile: Profile,
    pub cut_areas: Option<Vec<f64>>,
    pub cut_volume: Option<f64>,
    pub fill_volume: Option<f64>,
    pub volume_note: String,
    pub max_water_change: f64,
}

pub fn modify(base: &River, m: &Modification) -> Result<River> {
    doboku_hydraulics::validate(base)?;
    let mut r = base.clone();
    let boundary_index = if base.boundary.regime == Regime::Subcritical {
        base.stations.len().saturating_sub(1)
    } else {
        0
    };
    let old_bed = base
        .stations
        .get(boundary_index)
        .ok_or_else(|| Error::Invalid("断面なし".into()))?
        .bed_elevation;
    for s in &mut r.stations {
        match m {
            Modification::Excavate { depth: d } => {
                positive("掘削深", *d)?;
                if *d > 10.0 {
                    return Err(Error::Unsupported("MVPの掘削深上限は10m".into()));
                }
                s.section = match &s.section {
                    Section::Rectangle {
                        width,
                        bank_height: h,
                    } => Section::Rectangle {
                        width: *width,
                        bank_height: h + d,
                    },
                    Section::Trapezoid {
                        bottom_width,
                        side_slope: m,
                        bank_height: h,
                    } => Section::Trapezoid {
                        bottom_width: *bottom_width,
                        side_slope: m * h / (h + d),
                        bank_height: h + d,
                    },
                    Section::Survey { points } => {
                        let mut ps = points.clone();
                        let last = ps.len() - 1;
                        for (i, p) in ps.iter_mut().enumerate() {
                            if i == 0 || i == last {
                                p.z += d;
                            }
                        }
                        Section::Survey { points: ps }
                    }
                };
                s.bed_elevation -= d;
            }
            Modification::ReplaceSection { section } => {
                s.section = section.clone();
            }
            Modification::Cofferdam { blocked_width: w } => {
                positive("閉塞幅", *w)?;
                match &mut s.section {
                    Section::Rectangle { width, .. } => *width -= w,
                    Section::Trapezoid { bottom_width, .. } => *bottom_width -= w,
                    Section::Survey { .. } => {
                        return Err(Error::Unsupported(
                            "測量断面の仮締切簡易モデルは未対応".into(),
                        ))
                    }
                }
            }
            Modification::Roughness { value } => s.roughness = *value,
        }
    }
    r.boundary.depth += old_bed - r.stations[boundary_index].bed_elevation;
    doboku_hydraulics::validate(&r)?;
    Ok(r)
}
pub fn compare(base: &River, scenario: Scenario) -> Result<Comparison> {
    let original = solve(base)?;
    compare_with_profile(base, &original, scenario)
}
pub fn compare_with_profile(
    base: &River,
    original: &Profile,
    scenario: Scenario,
) -> Result<Comparison> {
    let river = modify(base, &scenario.modification)?;
    evaluate_comparison(base, original, scenario, river)
}
pub fn evaluate_comparison(
    base: &River,
    original: &Profile,
    scenario: Scenario,
    river: River,
) -> Result<Comparison> {
    if scenario.name.trim().is_empty() || scenario.name.len() > 200 {
        return Err(Error::Invalid("施工案名は1〜200バイト".into()));
    }
    let profile = solve(&river)?;
    let delta = profile
        .rows
        .iter()
        .zip(&original.rows)
        .map(|(a, b)| a.water_elevation - b.water_elevation)
        .max_by(|a, b| a.abs().total_cmp(&b.abs()))
        .unwrap_or(0.0);
    let (cut_areas, cut_volume, fill_volume, note) =
        if matches!(scenario.modification, Modification::Cofferdam { .. }) {
            (
                None,
                None,
                None,
                "仮締切は水理幅閉塞モデルのみ。材料土量・構造物損失は算定しない".into(),
            )
        } else {
            match doboku_earthwork::volume(base, &river) {
                Ok((a, v)) => (
                    Some(a.iter().map(|a| a.cut).collect()),
                    Some(v.cut),
                    Some(v.fill),
                    "平均断面法。測点間線形補間・同一座標/基準高。概算、測量範囲内のみ".into(),
                ),
                Err(Error::Unsupported(msg)) => (None, None, None, msg),
                Err(e) => return Err(e),
            }
        };
    Ok(Comparison {
        scenario,
        river,
        profile,
        cut_areas,
        cut_volume,
        fill_volume,
        volume_note: note,
        max_water_change: delta,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn excavation_preserves_banks_and_boundary_stage() {
        let base = doboku_core::sample().river;
        let r = modify(&base, &Modification::Excavate { depth: 1.0 }).unwrap();
        for (a, b) in base.stations.iter().zip(&r.stations) {
            let aa = doboku_geometry::ground(&a.section, a.bed_elevation);
            let bb = doboku_geometry::ground(&b.section, b.bed_elevation);
            assert_eq!(aa[0], bb[0]);
            assert_eq!(aa.last(), bb.last());
        }
        assert_eq!(
            base.stations[10].bed_elevation + base.boundary.depth,
            r.stations[10].bed_elevation + r.boundary.depth
        );
        let c = compare(
            &base,
            Scenario {
                name: "掘削1m".into(),
                modification: Modification::Excavate { depth: 1.0 },
            },
        )
        .unwrap();
        assert!((c.cut_volume.unwrap() - 32000.0).abs() < 0.01);
        assert!(c.max_water_change < 0.0);
    }
    #[test]
    fn staged_modifications_are_cumulative() {
        let a = modify(
            &doboku_core::sample().river,
            &Modification::Excavate { depth: 0.5 },
        )
        .unwrap();
        let b = modify(&a, &Modification::Excavate { depth: 0.5 }).unwrap();
        assert!((b.stations[0].bed_elevation - 9.0).abs() < 1e-12);
        assert!(modify(
            &b,
            &Modification::Cofferdam {
                blocked_width: 100.0
            }
        )
        .is_err());
    }
    #[test]
    fn cofferdam_is_a_hydraulic_proxy_without_invented_earthwork() {
        let c = compare(
            &doboku_core::sample().river,
            Scenario {
                name: "仮締切2m".into(),
                modification: Modification::Cofferdam { blocked_width: 2.0 },
            },
        )
        .unwrap();
        assert!(c.max_water_change > 0.0);
        assert!(c.cut_volume.is_none());
        assert!(c.fill_volume.is_none());
    }
}
