//! Cut/fill between surveys in the same datum; no unit prices or production rates.
use doboku_core::{Error, Point, Result, River};
use doboku_geometry::ground;

#[derive(Debug, Clone, Copy, Default)]
pub struct Quantities {
    pub cut: f64,
    pub fill: f64,
}
fn elevation(p: &[Point], x: f64) -> f64 {
    for w in p.windows(2) {
        if w[1].x > w[0].x && x >= w[0].x - 1e-9 && x <= w[1].x + 1e-9 {
            return w[0].z + (w[1].z - w[0].z) * (x - w[0].x) / (w[1].x - w[0].x);
        }
    }
    p.last().unwrap().z
}
pub fn areas(before: &[Point], after: &[Point]) -> Result<Quantities> {
    if before.len() < 2 || after.len() < 2 {
        return Err(Error::Invalid("土量の測量断面が不足".into()));
    }
    for ps in [before, after] {
        if ps.iter().any(|p| !p.x.is_finite() || !p.z.is_finite())
            || ps.windows(2).any(|w| w[1].x < w[0].x)
            || ps.first().unwrap().x >= ps.last().unwrap().x
        {
            return Err(Error::Invalid(
                "土量の座標は有限値・xは非減少・幅は正".into(),
            ));
        }
    }
    if (before[0].x - after[0].x).abs() > 1e-8
        || (before.last().unwrap().x - after.last().unwrap().x).abs() > 1e-8
    {
        return Err(Error::Unsupported(
            "土量は同じ測量範囲の断面が必要。堤岸幅変更の土量算定は未対応".into(),
        ));
    }
    let mut xs: Vec<f64> = before.iter().chain(after).map(|p| p.x).collect();
    xs.sort_by(f64::total_cmp);
    xs.dedup_by(|a, b| (*a - *b).abs() < 1e-9);
    let mut q = Quantities::default();
    for w in xs.windows(2) {
        let dx = w[1] - w[0];
        let f = |x: f64| elevation(before, x) - elevation(after, x);
        let a = f(w[0]);
        let b = f(w[1]);
        if a * b >= 0.0 {
            let v = 0.5 * (a + b) * dx;
            if v >= 0.0 {
                q.cut += v;
            } else {
                q.fill -= v;
            }
        } else {
            let frac = a.abs() / (a.abs() + b.abs());
            let left = 0.5 * a.abs() * dx * frac;
            let right = 0.5 * b.abs() * dx * (1.0 - frac);
            if a > 0.0 {
                q.cut += left;
                q.fill += right;
            } else {
                q.fill += left;
                q.cut += right;
            }
        }
    }
    Ok(q)
}
pub fn volume(before: &River, after: &River) -> Result<(Vec<Quantities>, Quantities)> {
    if before.stations.len() < 2 || before.stations.len() != after.stations.len() {
        return Err(Error::Invalid("比較断面数が不一致".into()));
    }
    let mut aa = Vec::new();
    for (a, b) in before.stations.iter().zip(&after.stations) {
        if a.chainage != b.chainage {
            return Err(Error::Invalid("比較距離が不一致".into()));
        }
        aa.push(areas(
            &ground(&a.section, a.bed_elevation),
            &ground(&b.section, b.bed_elevation),
        )?);
    }
    let mut v = Quantities::default();
    for (i, w) in before.stations.windows(2).enumerate() {
        let dx = w[1].chainage - w[0].chainage;
        if !dx.is_finite() || dx <= 0.0 {
            return Err(Error::Invalid("土量の縦断距離は有限値・昇順".into()));
        }
        v.cut += 0.5 * (aa[i].cut + aa[i + 1].cut) * dx;
        v.fill += 0.5 * (aa[i].fill + aa[i + 1].fill) * dx;
    }
    Ok((aa, v))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cuts_and_fills_do_not_cancel() {
        let a = [Point { x: 0.0, z: 2.0 }, Point { x: 10.0, z: 2.0 }];
        let b = [Point { x: 0.0, z: 1.0 }, Point { x: 10.0, z: 3.0 }];
        let q = areas(&a, &b).unwrap();
        assert!((q.cut - 2.5).abs() < 1e-6);
        assert!((q.fill - 2.5).abs() < 1e-6);
    }
    #[test]
    fn rectangular_prism_volume() {
        let mut a = doboku_core::sample().river;
        for s in &mut a.stations {
            s.section = doboku_core::Section::Rectangle {
                width: 20.0,
                bank_height: 8.0,
            };
        }
        let mut b = a.clone();
        for s in &mut b.stations {
            s.bed_elevation -= 1.0;
            s.section = doboku_core::Section::Rectangle {
                width: 20.0,
                bank_height: 9.0,
            };
        }
        let (_, v) = volume(&a, &b).unwrap();
        assert!((v.cut - 20000.0).abs() < 1e-6);
        assert_eq!(v.fill, 0.0);
    }
}
