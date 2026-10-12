//! Deterministic rigid-body gravity dam statics. SI: m, kN/m³, kN/m, kPa.
//! Vertical upstream face, straight downstream face; no drainage or cohesion.
use doboku_core::{Error, Result};
use serde::{Deserialize, Serialize};

pub const MODEL_VERSION: &str = "gravity-static-1";
pub const LIMITATIONS: &str = "上流面鉛直の台形剛体・堤軸方向1m。静水圧、自重、全幅線形揚圧、摩擦のみ。排水効果・粘着力・地震・動水圧・堆砂・材料強度・基礎変形・亀裂・FEM・アーチ作用は未評価。比率は基準適合や安全判定ではありません。";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct GravityDam {
    pub height_m: f64,
    pub crest_width_m: f64,
    pub base_width_m: f64,
    pub upstream_depth_m: f64,
    pub downstream_depth_m: f64,
    pub concrete_unit_weight_kn_m3: f64,
    pub water_unit_weight_kn_m3: f64,
    pub friction_coefficient: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Contact {
    Full,
    Partial,
    OutsideBase,
    NoCompression,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Statics {
    pub area_m2: f64,
    pub centroid_x_m: f64,
    pub centroid_z_m: f64,
    pub weight_kn_m: f64,
    pub upstream_horizontal_kn_m: f64,
    pub downstream_horizontal_kn_m: f64,
    pub downstream_vertical_kn_m: f64,
    pub uplift_kn_m: f64,
    pub uplift_x_m: Option<f64>,
    pub effective_vertical_kn_m: f64,
    pub net_horizontal_kn_m: f64,
    pub resisting_moment_knm_m: f64,
    pub overturning_moment_knm_m: f64,
    pub sliding_ratio: Option<f64>,
    pub overturning_ratio: Option<f64>,
    pub resultant_x_m: Option<f64>,
    pub eccentricity_m: Option<f64>,
    pub heel_pressure_kpa: Option<f64>,
    pub toe_pressure_kpa: Option<f64>,
    pub contact: Contact,
    pub warnings: Vec<String>,
}

pub fn bounded(name: &str, value: f64, low: f64, high: f64) -> Result<()> {
    if !value.is_finite() || !(low..=high).contains(&value) {
        return Err(Error::Invalid(format!(
            "{name} は {low}〜{high} の有限値が必要です"
        )));
    }
    Ok(())
}

pub fn solve(d: &GravityDam) -> Result<Statics> {
    let h = d.height_m;
    let b = d.base_width_m;
    let c = d.crest_width_m;
    bounded("堤高(m)", h, 0.1, 300.0)?;
    bounded("底幅(m)", b, 0.1, 1000.0)?;
    bounded("天端幅(m)", c, 0.1, b)?;
    bounded("上流水深(m)", d.upstream_depth_m, 0.0, h)?;
    bounded("下流水深(m)", d.downstream_depth_m, 0.0, d.upstream_depth_m)?;
    bounded(
        "コンクリート単位体積重量(kN/m³)",
        d.concrete_unit_weight_kn_m3,
        10.0,
        35.0,
    )?;
    bounded(
        "水単位体積重量(kN/m³)",
        d.water_unit_weight_kn_m3,
        5.0,
        15.0,
    )?;
    bounded("摩擦係数", d.friction_coefficient, 0.0, 2.0)?;
    let hu = d.upstream_depth_m;
    let hd = d.downstream_depth_m;
    let gw = d.water_unit_weight_kn_m3;
    let area = (b + c) * h / 2.0;
    // Rectangle [0,c] + right triangle [c,b] at the foundation.
    let rectangle = c * h;
    let triangle = (b - c) * h / 2.0;
    let cx = (rectangle * c / 2.0 + triangle * (b + 2.0 * c) / 3.0) / area;
    let cz = (rectangle * h / 2.0 + triangle * h / 3.0) / area;
    let w = area * d.concrete_unit_weight_kn_m3;
    let pu = gw * hu * hu / 2.0;
    let pd = gw * hd * hd / 2.0;
    let slope = (b - c) / h;
    let vd = slope * pd;
    let uplift = gw * (hu + hd) * b / 2.0;
    let ux = if hu + hd > 0.0 {
        Some(b * (hu + 2.0 * hd) / (3.0 * (hu + hd)))
    } else {
        None
    };
    let vertical = w + vd - uplift;
    let horizontal = pu - pd;
    let resisting = w * (b - cx) + pd * hd / 3.0 + vd * slope * hd / 3.0;
    let overturning = pu * hu / 3.0 + uplift * (b - ux.unwrap_or(0.0));
    let resultant = (vertical > 0.0).then(|| b - (resisting - overturning) / vertical);
    let eccentricity = resultant.map(|x| x - b / 2.0);
    let contact = match resultant {
        None => Contact::NoCompression,
        Some(x) if x <= 0.0 || x >= b => Contact::OutsideBase,
        Some(x) if (x - b / 2.0).abs() > b / 6.0 + 1e-12 * b => Contact::Partial,
        Some(_) => Contact::Full,
    };
    let pressure = if contact == Contact::Full {
        let e = eccentricity.unwrap_or(0.0);
        Some((
            (vertical / b * (1.0 - 6.0 * e / b)).max(0.0),
            (vertical / b * (1.0 + 6.0 * e / b)).max(0.0),
        ))
    } else {
        None
    };
    let mut warnings = vec![LIMITATIONS.into()];
    match contact {
        Contact::Full => {},
        Contact::Partial => warnings.push("合力が中央1/3の外: 部分接触。全幅線形接触圧は適用できません。部分接触・亀裂の再解析が必要です。".into()),
        Contact::OutsideBase => warnings.push("合力が基礎幅の外または端部: この剛体モデルで圧縮接触による釣合いを満たせません。接触圧は未計算です。".into()),
        Contact::NoCompression => warnings.push("有効鉛直力が0以下: 圧縮接触を成立させられません。合力位置・接触圧は未計算です。".into()),
    }
    if horizontal == 0.0 {
        warnings.push("水平力の差が0のため滑動比は未定義です。".into());
    }
    if overturning == 0.0 {
        warnings.push("転倒モーメントが0のため転倒比は未定義です。".into());
    }
    let result = Statics {
        area_m2: area,
        centroid_x_m: cx,
        centroid_z_m: cz,
        weight_kn_m: w,
        upstream_horizontal_kn_m: pu,
        downstream_horizontal_kn_m: pd,
        downstream_vertical_kn_m: vd,
        uplift_kn_m: uplift,
        uplift_x_m: ux,
        effective_vertical_kn_m: vertical,
        net_horizontal_kn_m: horizontal,
        resisting_moment_knm_m: resisting,
        overturning_moment_knm_m: overturning,
        sliding_ratio: (horizontal > 0.0)
            .then(|| d.friction_coefficient * vertical.max(0.0) / horizontal),
        overturning_ratio: (overturning > 0.0).then(|| resisting / overturning),
        resultant_x_m: resultant,
        eccentricity_m: eccentricity,
        heel_pressure_kpa: pressure.map(|p| p.0),
        toe_pressure_kpa: pressure.map(|p| p.1),
        contact,
        warnings,
    };
    let finite = [
        Some(area),
        Some(cx),
        Some(cz),
        Some(w),
        Some(pu),
        Some(pd),
        Some(vd),
        Some(uplift),
        ux,
        Some(vertical),
        Some(horizontal),
        Some(resisting),
        Some(overturning),
        result.sliding_ratio,
        result.overturning_ratio,
        resultant,
        eccentricity,
        result.heel_pressure_kpa,
        result.toe_pressure_kpa,
    ]
    .into_iter()
    .flatten()
    .all(f64::is_finite);
    if !finite {
        return Err(Error::Numerical(
            "ダム予備照査に非有限の結果が生じました。水深や荷重比を確認してください".into(),
        ));
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn rectangular() -> GravityDam {
        GravityDam {
            height_m: 10.0,
            crest_width_m: 10.0,
            base_width_m: 10.0,
            upstream_depth_m: 8.0,
            downstream_depth_m: 2.0,
            concrete_unit_weight_kn_m3: 20.0,
            water_unit_weight_kn_m3: 10.0,
            friction_coefficient: 0.5,
        }
    }
    fn close(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-9, "{a} != {b}");
    }
    #[test]
    fn rectangular_analytic_forces_and_bearing() {
        let s = solve(&rectangular()).unwrap();
        close(s.weight_kn_m, 2000.0);
        close(s.uplift_kn_m, 500.0);
        close(s.upstream_horizontal_kn_m, 320.0);
        close(s.downstream_horizontal_kn_m, 20.0);
        close(s.effective_vertical_kn_m, 1500.0);
        close(s.sliding_ratio.unwrap(), 2.5);
        close(s.resultant_x_m.unwrap(), 5.893333333333333);
        close(s.heel_pressure_kpa.unwrap(), 69.6);
        close(s.toe_pressure_kpa.unwrap(), 230.4);
    }
    #[test]
    fn dry_and_equal_water_are_not_infinite_ratios() {
        let mut d = rectangular();
        d.upstream_depth_m = 0.0;
        d.downstream_depth_m = 0.0;
        let s = solve(&d).unwrap();
        close(s.centroid_x_m, 5.0);
        close(s.centroid_z_m, 5.0);
        close(s.toe_pressure_kpa.unwrap(), 200.0);
        assert!(s.sliding_ratio.is_none());
        assert!(s.overturning_ratio.is_none());
        d.upstream_depth_m = 4.0;
        d.downstream_depth_m = 4.0;
        let s = solve(&d).unwrap();
        assert!(s.sliding_ratio.is_none());
        close(s.heel_pressure_kpa.unwrap(), 160.0);
        assert!(!serde_json::to_string(&s).unwrap().contains("Infinity"));
    }
    #[test]
    fn diagnoses_partial_outside_and_no_compression() {
        let mut d = rectangular();
        d.crest_width_m = 1.0;
        d.base_width_m = 5.0;
        d.downstream_depth_m = 0.0;
        let partial = solve(&d).unwrap();
        assert_eq!(partial.contact, Contact::Partial);
        assert!(partial.toe_pressure_kpa.is_none());
        d.base_width_m = 3.0;
        let outside = solve(&d).unwrap();
        assert_eq!(outside.contact, Contact::OutsideBase);
        assert!(outside.heel_pressure_kpa.is_none());
        d.base_width_m = 100.0;
        d.concrete_unit_weight_kn_m3 = 10.0;
        d.water_unit_weight_kn_m3 = 15.0;
        d.upstream_depth_m = 10.0;
        let no_contact = solve(&d).unwrap();
        assert_eq!(no_contact.contact, Contact::NoCompression);
        assert!(no_contact.resultant_x_m.is_none());
    }
    #[test]
    fn rejects_invalid_and_unmodelled_input() {
        let mut d = rectangular();
        d.height_m = f64::NAN;
        assert!(solve(&d).is_err());
        d = rectangular();
        d.crest_width_m = 11.0;
        assert!(solve(&d).is_err());
        d = rectangular();
        d.downstream_depth_m = 9.0;
        assert!(solve(&d).is_err());
        d = rectangular();
        d.upstream_depth_m = 1e-155;
        d.downstream_depth_m = 0.0;
        assert!(solve(&d).is_err());
        let mut json = serde_json::to_value(rectangular()).unwrap();
        json["earthquake_coefficient"] = 0.2.into();
        assert!(serde_json::from_value::<GravityDam>(json).is_err());
    }
}
