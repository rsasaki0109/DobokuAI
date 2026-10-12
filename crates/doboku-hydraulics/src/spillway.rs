//! Free overflow capacity only. C has units m^0.5/s; no gate/submergence model.
use doboku_core::{Error, Result};
use serde::{Deserialize, Serialize};

pub const MODEL_VERSION: &str = "free-overflow-1";
pub const LIMITATIONS: &str = "Q=C L H^1.5。自由越流・接近流速水頭無視。Cは有次元(m^0.5/s)の指定値。ゲート、潜り越流、貯水池追跡、シュート、減勢工、越流水荷重は未計算。";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Spillway {
    pub effective_width_m: f64,
    pub crest_elevation_m: f64,
    pub coefficient_m_half_s: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Overflow {
    pub head_m: f64,
    pub discharge_m3_s: f64,
    pub warnings: Vec<String>,
}
pub fn solve(s: &Spillway, upstream_m: f64, downstream_m: f64) -> Result<Overflow> {
    for (name, value, lo, hi) in [
        ("有効越流幅(m)", s.effective_width_m, 0.1, 10000.0),
        ("越流頂標高(m)", s.crest_elevation_m, 0.0, 300.0),
        ("越流係数(m^0.5/s)", s.coefficient_m_half_s, 0.1, 4.0),
        ("上流水位(m)", upstream_m, 0.0, 300.0),
        ("下流水位(m)", downstream_m, 0.0, upstream_m),
    ] {
        if !value.is_finite() || !(lo..=hi).contains(&value) {
            return Err(Error::Invalid(format!(
                "{name} は {lo}〜{hi} の有限値が必要です"
            )));
        }
    }
    let head = (upstream_m - s.crest_elevation_m).max(0.0);
    if head > 0.0 && downstream_m >= s.crest_elevation_m {
        return Err(Error::Unsupported(
            "下流水位が越流頂以上です。潜り越流を自由越流式で評価できません".into(),
        ));
    }
    Ok(Overflow {
        head_m: head,
        discharge_m3_s: s.coefficient_m_half_s * s.effective_width_m * head.powf(1.5),
        warnings: vec![LIMITATIONS.into()],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn input() -> Spillway {
        Spillway {
            effective_width_m: 20.0,
            crest_elevation_m: 25.0,
            coefficient_m_half_s: 1.7,
        }
    }
    #[test]
    fn analytic_zero_head_and_head_scaling() {
        let s = input();
        assert_eq!(solve(&s, 24.0, 0.0).unwrap().discharge_m3_s, 0.0);
        assert_eq!(solve(&s, 25.0, 0.0).unwrap().discharge_m3_s, 0.0);
        let q = solve(&s, 26.0, 0.0).unwrap().discharge_m3_s;
        assert_eq!(q, 34.0);
        assert!((solve(&s, 29.0, 0.0).unwrap().discharge_m3_s / q - 8.0).abs() < 1e-12);
    }
    #[test]
    fn rejects_submergence_nonfinite_and_gate() {
        let s = input();
        assert!(solve(&s, 27.0, 25.0).is_err());
        assert!(solve(&s, f64::NAN, 0.0).is_err());
        let mut json = serde_json::to_value(s).unwrap();
        json["gate_opening_m"] = 1.0.into();
        assert!(serde_json::from_value::<Spillway>(json).is_err());
    }
}
