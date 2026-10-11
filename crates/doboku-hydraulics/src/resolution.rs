//! Explicit piecewise-linear interpolation for a station-spacing study.
//! This does not add observations or estimate absolute hydraulic accuracy.
use crate::{solve, validate, Profile};
use doboku_core::{Error, Point, Result, River, Section, Station};
use serde::{Deserialize, Serialize};

pub const METHOD: &str = "元の各区間を2分割・4分割。河床標高・粗度、矩形/台形の寸法を区間内で線形補間。測量断面は横断xと最低点の位置が一致する場合だけ相対高さを補間。元の測点・流量・境界水深・流況を保持し、施工案は適用しません。補間点は追加の測量ではありません。差は同じ元測点の数値的な結果差であり、実河川の精度・収束の保証ではありません。";

fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}
fn section(a: &Section, b: &Section, t: f64) -> Result<Section> {
    if a == b {
        return Ok(a.clone());
    }
    match (a, b) {
        (
            Section::Rectangle {
                width: aw,
                bank_height: ah,
            },
            Section::Rectangle {
                width: bw,
                bank_height: bh,
            },
        ) => Ok(Section::Rectangle {
            width: lerp(*aw, *bw, t),
            bank_height: lerp(*ah, *bh, t),
        }),
        (
            Section::Trapezoid {
                bottom_width: aw,
                side_slope: am,
                bank_height: ah,
            },
            Section::Trapezoid {
                bottom_width: bw,
                side_slope: bm,
                bank_height: bh,
            },
        ) => Ok(Section::Trapezoid {
            bottom_width: lerp(*aw, *bw, t),
            side_slope: lerp(*am, *bm, t),
            bank_height: lerp(*ah, *bh, t),
        }),
        (Section::Survey { points: ap }, Section::Survey { points: bp }) => {
            if ap.len() != bp.len()
                || ap
                    .iter()
                    .zip(bp)
                    .any(|(a, b)| a.x != b.x || (a.z == 0.0) != (b.z == 0.0))
            {
                return Err(Error::Unsupported("測量断面の線形補間には点数・横断x・最低点の位置の一致が必要です（再配置・補正は行いません）".into()));
            }
            Ok(Section::Survey {
                points: ap
                    .iter()
                    .zip(bp)
                    .map(|(a, b)| Point {
                        x: a.x,
                        z: lerp(a.z, b.z, t),
                    })
                    .collect(),
            })
        }
        _ => Err(Error::Unsupported(
            "異なる断面形式の間の補間は未対応です".into(),
        )),
    }
}

pub fn refine(river: &River, subdivisions: usize) -> Result<River> {
    // Validate the unrefined river first; splitting must not evade abrupt-change guards.
    validate(river)?;
    if !(1..=16).contains(&subdivisions) {
        return Err(Error::Invalid("区間分割数は1〜16".into()));
    }
    let count = (river.stations.len() - 1) * subdivisions + 1;
    if count > 200 {
        return Err(Error::Unsupported(format!(
            "{subdivisions}分割後は{count}断面となり、上限200を超えます"
        )));
    }
    let mut refined = river.clone();
    let mut stations = Vec::with_capacity(count);
    for pair in river.stations.windows(2) {
        let (a, b) = (&pair[0], &pair[1]);
        stations.push(a.clone());
        for j in 1..subdivisions {
            let t = j as f64 / subdivisions as f64;
            let shape = section(&a.section, &b.section, t).map_err(|e| {
                Error::Unsupported(format!("区間 {}〜{} m: {e}", a.chainage, b.chainage))
            })?;
            stations.push(Station {
                chainage: lerp(a.chainage, b.chainage, t),
                bed_elevation: lerp(a.bed_elevation, b.bed_elevation, t),
                roughness: lerp(a.roughness, b.roughness, t),
                section: shape,
            });
        }
    }
    stations.push(river.stations.last().unwrap().clone());
    refined.stations = stations;
    validate(&refined)?;
    Ok(refined)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Difference {
    pub chainage: f64,
    pub water_change: f64,
    pub depth_change: f64,
    pub velocity_change: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum Outcome {
    Ok {
        subdivisions: usize,
        river: River,
        profile: Profile,
        differences: Vec<Difference>,
        max_abs_water_change: f64,
        previous_max_abs_water_change: Option<f64>,
    },
    Failed {
        subdivisions: usize,
        error: String,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Study {
    pub baseline: Profile,
    pub cases: Vec<Outcome>,
}

pub fn study(river: &River) -> Result<Study> {
    let baseline = solve(river)?;
    let mut previous = baseline.clone();
    let mut previous_factor = 1;
    let cases = [2, 4]
        .into_iter()
        .map(|subdivisions| {
            let result = refine(river, subdivisions).and_then(|refined| {
                let profile = solve(&refined)?;
                Ok((refined, profile))
            });
            match result {
                Err(error) => Outcome::Failed {
                    subdivisions,
                    error: error.to_string(),
                },
                Ok((refined, profile)) => {
                    let differences: Vec<_> = baseline
                        .rows
                        .iter()
                        .enumerate()
                        .map(|(i, b)| {
                            let r = &profile.rows[i * subdivisions];
                            Difference {
                                chainage: b.chainage,
                                water_change: r.water_elevation - b.water_elevation,
                                depth_change: r.depth - b.depth,
                                velocity_change: r.velocity - b.velocity,
                            }
                        })
                        .collect();
                    let max_abs_water_change = differences
                        .iter()
                        .map(|d| d.water_change.abs())
                        .fold(0.0, f64::max);
                    // All comparisons, including 2→4, use only the original stations.
                    let previous_max_abs_water_change = if subdivisions == previous_factor * 2 {
                        Some(
                            baseline
                                .rows
                                .iter()
                                .enumerate()
                                .map(|(i, _)| {
                                    (profile.rows[i * subdivisions].water_elevation
                                        - previous.rows[i * previous_factor].water_elevation)
                                        .abs()
                                })
                                .fold(0.0, f64::max),
                        )
                    } else {
                        None
                    };
                    previous = profile.clone();
                    previous_factor = subdivisions;
                    Outcome::Ok {
                        subdivisions,
                        river: refined,
                        profile,
                        differences,
                        max_abs_water_change,
                        previous_max_abs_water_change,
                    }
                }
            }
        })
        .collect();
    Ok(Study { baseline, cases })
}
