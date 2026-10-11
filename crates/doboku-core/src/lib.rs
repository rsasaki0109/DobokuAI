//! Shared SI-unit contracts, independent of HTTP, storage, or AI.
use serde::{Deserialize, Serialize};

pub const ENGINE_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const G: f64 = 9.80665;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("入力条件: {0}")]
    Invalid(String),
    #[error("適用範囲外: {0}")]
    Unsupported(String),
    #[error("数値計算: {0}")]
    Numerical(String),
}
pub type Result<T> = std::result::Result<T, Error>;
pub fn positive(name: &str, v: f64) -> Result<()> {
    if !v.is_finite() || v <= 0.0 {
        return Err(Error::Invalid(format!("{name} は有限の正数が必要です")));
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Point {
    pub x: f64,
    pub z: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Section {
    Rectangle {
        width: f64,
        bank_height: f64,
    },
    Trapezoid {
        bottom_width: f64,
        side_slope: f64,
        bank_height: f64,
    },
    Survey {
        points: Vec<Point>,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Station {
    pub chainage: f64,
    pub bed_elevation: f64,
    pub roughness: f64,
    pub section: Section,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Regime {
    Subcritical,
    Supercritical,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Boundary {
    pub regime: Regime,
    pub depth: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct River {
    pub discharge: f64,
    pub normal_slope: f64,
    pub boundary: Boundary,
    pub stations: Vec<Station>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub river: River,
    #[serde(default)]
    pub reference: SpatialReference,
    #[serde(default)]
    pub scenarios: Vec<Scenario>,
    #[serde(default)]
    pub staged: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SpatialReference {
    pub vertical_datum: String,
    pub horizontal_reference: String,
    #[serde(default)]
    pub import: Option<ImportProvenance>,
}
impl Default for SpatialReference {
    fn default() -> Self {
        Self {
            vertical_datum: "未指定（プロジェクト内共通）".into(),
            horizontal_reference: "流下距離・横断距離（局所座標、m）".into(),
            import: None,
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImportProvenance {
    pub file_name: String,
    pub sha256: String,
    pub imported_at: String,
    pub elevation_mode: String,
    pub unit: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Modification {
    Excavate { depth: f64 },
    ReplaceSection { section: Section },
    Cofferdam { blocked_width: f64 },
    Roughness { value: f64 },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Scenario {
    pub name: String,
    pub modification: Modification,
}

pub fn sample() -> Project {
    Project {
        id: "sample-river".into(),
        name: "青葉川・河道改修検討".into(),
        reference: SpatialReference {
            vertical_datum: "サンプルの仮想基準高（現地の標高系ではありません）".into(),
            ..SpatialReference::default()
        },
        scenarios: vec![Scenario {
            name: "河道掘削 1.0 m".into(),
            modification: Modification::Excavate { depth: 1.0 },
        }],
        staged: false,
        river: River {
            discharge: 100.0,
            normal_slope: 0.001,
            boundary: Boundary {
                regime: Regime::Subcritical,
                depth: 3.2,
            },
            stations: (0..=10)
                .map(|i| Station {
                    chainage: i as f64 * 100.0,
                    bed_elevation: 10.0 - i as f64 * 0.1,
                    roughness: 0.03,
                    section: Section::Trapezoid {
                        bottom_width: 20.0,
                        side_slope: 1.5,
                        bank_height: 8.0,
                    },
                })
                .collect(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reject_nonphysical_units() {
        for v in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            assert!(positive("Q", v).is_err());
        }
        assert!(positive("Q", 100.0).is_ok());
    }
    #[test]
    fn sample_has_consistent_direction() {
        let p = sample();
        assert!(p
            .river
            .stations
            .windows(2)
            .all(|w| w[1].chainage > w[0].chainage));
    }
}
