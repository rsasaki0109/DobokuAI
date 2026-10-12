//! Deterministic Manning and standard-step solver. No storage, network or AI.
use doboku_core::{positive, Error, Regime, Result, River, Section, G};
use doboku_geometry::{validate as validate_section, wet};
use serde::{Deserialize, Serialize};

mod depth_range;
pub mod resolution;
pub mod spillway;

pub const DEPTH_TOL: f64 = 1e-9;
pub const ENERGY_TOL: f64 = 1e-7;
pub const MAX_ITER: usize = 120;
pub const LIMITATIONS: &str = "1次元定常・一定流量・α=1・単一流路。跳水、混在流況、急変、越岸、構造物損失、土砂移動は未対応。仮締切は幅閉塞の簡易モデル。実施設計には独立照査が必要。";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Row {
    pub chainage: f64,
    pub bed_elevation: f64,
    pub water_elevation: f64,
    pub depth: f64,
    pub velocity: f64,
    pub area: f64,
    pub froude: f64,
    pub friction_slope: f64,
    pub critical_depth: f64,
    pub normal_depth: f64,
    pub energy_residual: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub rows: Vec<Row>,
    pub warnings: Vec<String>,
}

pub fn manning(s: &Section, depth: f64, n: f64, slope: f64) -> Result<f64> {
    positive("粗度", n)?;
    positive("勾配", slope)?;
    let g = wet(s, depth)?;
    Ok(g.area * g.radius().powf(2.0 / 3.0) * slope.sqrt() / n)
}
pub fn froude(s: &Section, depth: f64, q: f64) -> Result<f64> {
    positive("流量", q)?;
    let g = wet(s, depth)?;
    Ok(q / g.area / (G * g.area / g.top_width).sqrt())
}
fn bisect<F: Fn(f64) -> Result<f64>>(mut lo: f64, mut hi: f64, f: F) -> Result<f64> {
    let mut a = f(lo)?;
    let b = f(hi)?;
    if !a.is_finite() || !b.is_finite() || a * b > 0.0 {
        return Err(Error::Numerical(
            "解の区間がありません（境界水位・流量・断面を確認）".into(),
        ));
    }
    for _ in 0..MAX_ITER {
        let mid = (lo + hi) / 2.0;
        let v = f(mid)?;
        if !v.is_finite() {
            return Err(Error::Numerical("非有限の残差".into()));
        }
        if v.abs() < 1e-11 || hi - lo < DEPTH_TOL {
            return Ok(mid);
        }
        if a * v <= 0.0 {
            hi = mid;
        } else {
            lo = mid;
            a = v;
        }
    }
    Err(Error::Numerical("二分法が収束しません".into()))
}
pub fn critical_depth(s: &Section, q: f64) -> Result<f64> {
    validate_section(s)?;
    positive("流量", q)?;
    Ok(depth_range::branch(s, q)?.critical)
}
pub fn normal_depth(s: &Section, q: f64, n: f64, slope: f64) -> Result<f64> {
    validate_section(s)?;
    positive("流量", q)?;
    positive("粗度", n)?;
    positive("等流水深の参照河床勾配", slope)?;
    if !matches!(s, Section::Survey { .. }) {
        return bisect(1e-6, doboku_geometry::max_depth(s) * (1.0 - 1e-8), |d| {
            Ok(manning(s, d, n, slope)? - q)
        });
    }
    depth_range::normal(s, q, n, slope, depth_range::branch(s, q)?)
}
fn state(s: &Section, y: f64, q: f64, n: f64) -> Result<(f64, f64)> {
    let g = wet(s, y)?;
    let v = q / g.area;
    Ok((
        y + v * v / (2.0 * G),
        (q * n / (g.area * g.radius().powf(2.0 / 3.0))).powi(2),
    ))
}
pub fn validate(r: &River) -> Result<()> {
    positive("流量 Q (m³/s)", r.discharge)?;
    positive("参照河床勾配", r.normal_slope)?;
    if r.discharge > 1e6 || r.normal_slope > 0.1 {
        return Err(Error::Unsupported("流量>10⁶ または勾配>0.1".into()));
    }
    positive("境界水深", r.boundary.depth)?;
    if !(2..=200).contains(&r.stations.len()) {
        return Err(Error::Invalid("断面数は2〜200".into()));
    }
    for s in &r.stations {
        if !s.chainage.is_finite() || !s.bed_elevation.is_finite() {
            return Err(Error::Invalid("測点位置・標高は有限値".into()));
        }
        positive("粗度係数", s.roughness)?;
        if !(0.005..=0.2).contains(&s.roughness) {
            return Err(Error::Invalid("粗度係数は0.005〜0.2".into()));
        }
        validate_section(&s.section)?;
    }
    for w in r.stations.windows(2) {
        let dx = w[1].chainage - w[0].chainage;
        if dx < 0.1 || !dx.is_finite() {
            return Err(Error::Invalid("距離は上流→下流に増加、間隔0.1m以上".into()));
        }
        if (w[0].bed_elevation - w[1].bed_elevation).abs() / dx > 0.1 {
            return Err(Error::Unsupported("河床急変（勾配>0.1）".into()));
        }
        let d = depth_range::width_reference(&w[0].section, &w[1].section)?;
        let a = wet(&w[0].section, d)?.top_width;
        let b = wet(&w[1].section, d)?.top_width;
        if a.max(b) / a.min(b) > 1.25 {
            return Err(Error::Unsupported("隣接断面の幅急変（25%以上）".into()));
        }
    }
    Ok(())
}
fn check_regime(fr: f64, regime: Regime) -> Result<()> {
    let ok = match regime {
        Regime::Subcritical => fr < 0.98,
        Regime::Supercritical => fr > 1.02,
    };
    if !ok || !fr.is_finite() {
        return Err(Error::Unsupported(
            "限界流付近または流況が境界条件と不一致。混在・跳水は未対応".into(),
        ));
    }
    Ok(())
}
pub fn solve(r: &River) -> Result<Profile> {
    validate(r)?;
    let count = r.stations.len();
    let mut depths = vec![0.0; count];
    let mut residuals = vec![0.0; count];
    let sub = r.boundary.regime == Regime::Subcritical;
    let order: Vec<usize> = if sub {
        (0..count).rev().collect()
    } else {
        (0..count).collect()
    };
    // Report the actual boundary geometry fault (overflow or separated water)
    // before testing membership in the narrower critical-depth branch.
    wet(&r.stations[order[0]].section, r.boundary.depth)?;
    let branches: Vec<_> = r
        .stations
        .iter()
        .map(|s| depth_range::branch(&s.section, r.discharge))
        .collect::<Result<_>>()?;
    let boundary_branch = branches[order[0]];
    if r.boundary.depth <= boundary_branch.lower || r.boundary.depth >= boundary_branch.upper {
        return Err(Error::Unsupported(format!("境界水深が、一意な限界水深と同じ連続流路の水深範囲にありません。距離{}m: {:.6} < 水深 < {:.6}m。分離流路を確認してください",r.stations[order[0]].chainage,boundary_branch.lower,boundary_branch.upper)));
    }
    depths[order[0]] = r.boundary.depth;
    check_regime(
        froude(&r.stations[order[0]].section, r.boundary.depth, r.discharge)?,
        r.boundary.regime,
    )?;
    for pair in order.windows(2) {
        let (known, i) = (pair[0], pair[1]);
        let a = &r.stations[i];
        let b = &r.stations[known];
        let dx = (a.chainage - b.chainage).abs();
        let (eb, sfb) = state(&b.section, depths[known], r.discharge, b.roughness)?;
        let branch = branches[i];
        let yc = branch.critical;
        let (lo, hi) = if sub {
            (yc * (1.0 + 1e-6), branch.upper)
        } else {
            (branch.lower.max(1e-5), yc * (1.0 - 1e-6))
        };
        let f = |y: f64| -> Result<f64> {
            let (ea, sfa) = state(&a.section, y, r.discharge, a.roughness)?;
            let loss = 0.5 * (sfa + sfb) * dx;
            Ok(if sub {
                a.bed_elevation + ea - b.bed_elevation - eb - loss
            } else {
                b.bed_elevation + eb - a.bed_elevation - ea - loss
            })
        };
        // Find every sign-changing bracket on the requested branch; choose continuity.
        let mut candidates = Vec::new();
        let mut left = lo;
        let mut fl = f(left)?;
        for k in 1..=256 {
            let right = lo * (hi / lo).powf(k as f64 / 256.0);
            let fr = f(right)?;
            if fl * fr <= 0.0 {
                candidates.push(bisect(left, right, f)?);
            }
            left = right;
            fl = fr;
        }
        let y = candidates
            .into_iter()
            .min_by(|a, b| {
                (a - depths[known])
                    .abs()
                    .total_cmp(&(b - depths[known]).abs())
            })
            .ok_or_else(|| {
                Error::Numerical(format!(
                    "距離{}mで選択した流況の解がありません。境界・断面間隔を確認",
                    a.chainage
                ))
            })?;
        let res = f(y)?;
        if res.abs() > ENERGY_TOL {
            return Err(Error::Numerical(format!(
                "距離{}mのエネルギー残差が許容値を超過",
                a.chainage
            )));
        }
        check_regime(froude(&a.section, y, r.discharge)?, r.boundary.regime)?;
        depths[i] = y;
        residuals[i] = res;
    }
    let mut rows = Vec::with_capacity(count);
    for (i, s) in r.stations.iter().enumerate() {
        let y = depths[i];
        let g = wet(&s.section, y)?;
        let row = Row {
            chainage: s.chainage,
            bed_elevation: s.bed_elevation,
            water_elevation: s.bed_elevation + y,
            depth: y,
            velocity: r.discharge / g.area,
            area: g.area,
            froude: froude(&s.section, y, r.discharge)?,
            friction_slope: state(&s.section, y, r.discharge, s.roughness)?.1,
            critical_depth: branches[i].critical,
            normal_depth: depth_range::normal(
                &s.section,
                r.discharge,
                s.roughness,
                r.normal_slope,
                branches[i],
            )?,
            energy_residual: residuals[i],
        };
        if [
            row.water_elevation,
            row.velocity,
            row.froude,
            row.friction_slope,
        ]
        .iter()
        .any(|v| !v.is_finite())
        {
            return Err(Error::Numerical("異常値検出".into()));
        }
        rows.push(row);
    }
    Ok(Profile {
        rows,
        warnings: vec![
            LIMITATIONS.into(),
            "等流水深は参照勾配の診断値。各区間の実標高を不等流計算に使用。".into(),
            "測量地盤の起伏を保持。計算水面が1流路となり、一意な最小エネルギーの限界水深と同じ連続水深範囲だけを使用。等流水深の複数根・不連続も拒否します。".into(),
        ],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use doboku_core::{sample, Boundary, Station};
    fn rectangle() -> Section {
        Section::Rectangle {
            width: 10.0,
            bank_height: 20.0,
        }
    }
    #[test]
    fn analytical_rectangular_critical_depth() {
        let expected = (25.0_f64.powi(2) / (G * 10.0_f64.powi(2))).cbrt();
        assert!((critical_depth(&rectangle(), 25.0).unwrap() - expected).abs() < 1e-8);
    }
    #[test]
    fn manning_known_value_and_normal_inverse() {
        // Independently hand-evaluated A=20, P=14, R=10/7.
        let q = 20.0 * (10.0_f64 / 7.0).powf(2.0 / 3.0) * 0.001_f64.sqrt() / 0.03;
        assert!((manning(&rectangle(), 2.0, 0.03, 0.001).unwrap() - q).abs() < 1e-12);
        assert!((normal_depth(&rectangle(), q, 0.03, 0.001).unwrap() - 2.0).abs() < 1e-8);
    }
    #[test]
    fn standard_step_reproduces_uniform_flow_both_branches() {
        for (slope, regime) in [(0.001, Regime::Subcritical), (0.04, Regime::Supercritical)] {
            let q = 25.0;
            let y = normal_depth(&rectangle(), q, 0.03, slope).unwrap();
            let r = River {
                discharge: q,
                normal_slope: slope,
                boundary: Boundary { regime, depth: y },
                stations: (0..21)
                    .map(|i| Station {
                        chainage: i as f64 * 5.0,
                        bed_elevation: 10.0 - i as f64 * 5.0 * slope,
                        roughness: 0.03,
                        section: rectangle(),
                    })
                    .collect(),
            };
            for row in solve(&r).unwrap().rows {
                assert!((row.depth - y).abs() < 1e-7);
                assert!(row.energy_residual.abs() < ENERGY_TOL);
            }
        }
    }
    #[test]
    fn invalid_and_unsupported_conditions_fail_explicitly() {
        let mut r = sample().river;
        r.discharge = -1.0;
        assert!(solve(&r).is_err());
        r = sample().river;
        r.stations[1].chainage = 0.0;
        assert!(solve(&r).is_err());
        r = sample().river;
        r.boundary.regime = Regime::Supercritical;
        assert!(solve(&r).is_err());
        r = sample().river;
        r.boundary.depth = 8.0;
        assert!(solve(&r).is_err());
        r = sample().river;
        r.boundary.depth = critical_depth(&r.stations[0].section, r.discharge).unwrap();
        assert!(solve(&r).is_err());
        r = sample().river;
        r.stations[1].section = Section::Rectangle {
            width: 200.0,
            bank_height: 8.0,
        };
        assert!(solve(&r).is_err());
        r = sample().river;
        r.boundary.depth = 0.2;
        assert!(solve(&r).is_err());
    }
    #[test]
    fn adverse_bed_still_uses_actual_elevation() {
        let mut r = sample().river;
        for (i, s) in r.stations.iter_mut().enumerate() {
            s.bed_elevation = 9.0 + i as f64 * 0.02;
        }
        let p = solve(&r).unwrap();
        assert!(p.rows.iter().all(|v| v.froude < 0.98));
    }
    #[test]
    fn survey_profile_matches_analytical_section_geometry() {
        let r = sample().river;
        let original = solve(&r).unwrap();
        let mut survey = r.clone();
        for s in &mut survey.stations {
            s.section = Section::Survey {
                points: doboku_geometry::ground(&s.section, 0.0),
            };
        }
        let actual = solve(&survey).unwrap();
        for (a, b) in actual.rows.iter().zip(original.rows) {
            assert!((a.depth - b.depth).abs() < 1e-7);
            assert!((a.critical_depth - b.critical_depth).abs() < 1e-7);
        }
    }
    #[test]
    fn bench_critical_discontinuity_is_rejected() {
        use doboku_core::Point;
        let points = [
            (-120.0, 5.0),
            (-100.0, 1.5),
            (-5.0, 1.5),
            (-4.9, 0.0),
            (4.9, 0.0),
            (5.0, 1.5),
            (100.0, 1.5),
            (120.0, 5.0),
        ]
        .into_iter()
        .map(|(x, z)| Point { x, z })
        .collect();
        assert!(matches!(
            critical_depth(&Section::Survey { points }, 40.0),
            Err(Error::Unsupported(_))
        ));
        assert!(normal_depth(&rectangle(), 20.0, 0.03, 0.0).is_err());
    }
}
