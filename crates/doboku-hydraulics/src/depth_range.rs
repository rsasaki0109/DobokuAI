//! One continuous wetted-depth band with one minimum-energy critical depth.
use crate::{bisect, froude, manning, DEPTH_TOL, MAX_ITER};
use doboku_core::{Error, Result, Section};
use doboku_geometry::{connected_ranges, max_depth, wet};

#[derive(Debug, Clone, Copy)]
pub(crate) struct Branch {
    pub lower: f64,
    pub critical: f64,
    pub upper: f64,
}

/// Include vertex sides and analytic stationary points.
/// Within each vertex interval, A is quadratic and T/P are linear in depth.
fn grid(s: &Section, lower: f64, upper: f64, critical: bool) -> Result<Vec<f64>> {
    let Section::Survey { points } = s else {
        return Ok(vec![lower, upper]);
    };
    let mut grid = vec![lower, upper];
    let mut knots = vec![lower, upper];
    for p in points {
        if p.z > lower && p.z < upper {
            knots.push(p.z);
        }
        for h in [p.z * (1.0 - 1e-8), p.z, p.z * (1.0 + 1e-8)] {
            if h > lower && h < upper {
                grid.push(h);
            }
        }
    }
    knots.sort_by(f64::total_cmp);
    knots.dedup();
    for pair in knots.windows(2) {
        let middle = pair[0] + (pair[1] - pair[0]) / 2.0;
        if middle <= pair[0] || middle >= pair[1] {
            continue;
        }
        let g = wet(s, middle)?;
        let mut tp = 0.0;
        let mut pp = 0.0;
        for edge in points.windows(2) {
            let dz = (edge[1].z - edge[0].z).abs();
            if middle > edge[0].z.min(edge[1].z) && middle < edge[0].z.max(edge[1].z) {
                let dx = edge[1].x - edge[0].x;
                tp += dx / dz;
                pp += dx.hypot(dz) / dz;
            }
        }
        let derivative = |h: f64| -> Result<f64> {
            let d = h - middle;
            let area = g.area + g.top_width * d + 0.5 * tp * d * d;
            let width = g.top_width + tp * d;
            let perimeter = g.perimeter + pp * d;
            let value = if critical {
                tp * area - 3.0 * width * width
            } else {
                5.0 * width * perimeter - 2.0 * pp * area
            };
            if !value.is_finite() {
                return Err(Error::Numerical("水深区間の導関数が非有限です".into()));
            }
            Ok(value)
        };
        if derivative(pair[0])? * derivative(pair[1])? < 0.0 {
            let h = bisect(pair[0], pair[1], derivative)?;
            if h > lower && h < upper {
                grid.push(h);
            }
        }
    }
    grid.sort_by(f64::total_cmp);
    grid.dedup();
    Ok(grid)
}

fn roots(
    s: &Section,
    lower: f64,
    upper: f64,
    critical: bool,
    residual_tolerance: f64,
    f: impl Fn(f64) -> Result<f64>,
) -> Result<Vec<f64>> {
    let mut found = Vec::new();
    for pair in grid(s, lower, upper, critical)?.windows(2) {
        let a = f(pair[0])?;
        let b = f(pair[1])?;
        if !a.is_finite() || !b.is_finite() {
            return Err(Error::Numerical("水深探索の残差が非有限です".into()));
        }
        if a * b <= 0.0 {
            let root = residual_root(pair[0], pair[1], &f, residual_tolerance)?;
            if found
                .last()
                .is_none_or(|last: &f64| (root - last).abs() > 4.0 * DEPTH_TOL)
            {
                found.push(root);
            }
        }
    }
    Ok(found)
}

// Sharp but continuous bank widening can require more than the depth tolerance
// to meet the Froude/capacity residual. Never mistake that for a resolved root.
fn residual_root(
    mut lower: f64,
    mut upper: f64,
    f: &impl Fn(f64) -> Result<f64>,
    tolerance: f64,
) -> Result<f64> {
    let mut left = f(lower)?;
    if left == 0.0 {
        return Ok(lower);
    }
    if f(upper)? == 0.0 {
        return Ok(upper);
    }
    for _ in 0..MAX_ITER {
        let middle = lower + (upper - lower) / 2.0;
        let value = f(middle)?;
        if !value.is_finite() {
            return Err(Error::Numerical("水深探索の残差が非有限です".into()));
        }
        if value == 0.0 || (value.abs() <= tolerance && upper - lower <= DEPTH_TOL) {
            return Ok(middle);
        }
        if middle == lower || middle == upper {
            break;
        }
        if left * value <= 0.0 {
            upper = middle;
        } else {
            lower = middle;
            left = value;
        }
    }
    Err(Error::Unsupported(
        "横断面の段差または未解像な水深条件の残差が解消しません".into(),
    ))
}

pub(crate) fn branch(s: &Section, q: f64) -> Result<Branch> {
    let f = |h| Ok(froude(s, h, q)?.powi(2) - 1.0);
    if !matches!(s, Section::Survey { .. }) {
        let lower = 1e-6;
        let upper = max_depth(s) * (1.0 - 1e-8);
        if upper <= lower {
            return Err(Error::Unsupported(
                "断面の堤岸高は1µmより大きい値が必要".into(),
            ));
        }
        return Ok(Branch {
            lower,
            critical: bisect(lower, upper, f)?,
            upper,
        });
    }
    let mut found = Vec::new();
    for range in connected_ranges(s)? {
        let lower = (range.lower + (4.0 * DEPTH_TOL).max(range.lower * 1e-8)).max(1e-6);
        let upper = range.upper - (4.0 * DEPTH_TOL).max(range.upper * 1e-8);
        if lower >= upper {
            continue;
        }
        for critical in roots(s, lower, upper, true, 1e-8, f)? {
            if f(critical)?.abs() > 1e-6 {
                return Err(Error::Unsupported(
                    "横断面の段差による限界条件の不連続は未対応".into(),
                ));
            }
            found.push(Branch {
                lower,
                critical,
                upper,
            });
        }
    }
    if found.len() > 1 {
        return Err(Error::Unsupported("限界水深が複数の断面は未対応".into()));
    }
    let branch = found.into_iter().next().ok_or_else(|| {
        Error::Unsupported(
            "単一流路となる水深範囲に限界水深がありません。分離流路や境界・流量を確認してください"
                .into(),
        )
    })?;
    if f(branch.lower)? <= 0.0 || f(branch.upper)? >= 0.0 {
        return Err(Error::Unsupported(
            "一意な最小エネルギーの限界水深を持つ連続水深範囲ではありません".into(),
        ));
    }
    Ok(branch)
}

pub(crate) fn normal(s: &Section, q: f64, n: f64, slope: f64, branch: Branch) -> Result<f64> {
    let f = |h| Ok(manning(s, h, n, slope)? - q);
    if !matches!(s, Section::Survey { .. }) {
        return bisect(branch.lower, branch.upper, f);
    }
    let candidates = roots(s, branch.lower, branch.upper, false, 1e-8 * q.max(1.0), f)?;
    if candidates.len() > 1 {
        return Err(Error::Unsupported(
            "選択した連続流路の等流水深が複数です".into(),
        ));
    }
    let depth = candidates
        .into_iter()
        .next()
        .ok_or_else(|| Error::Numerical("選択した連続流路に等流水深がありません".into()))?;
    if f(depth)?.abs() > 1e-7 * q.max(1.0) {
        return Err(Error::Unsupported(
            "横断面の段差による等流水深条件の不連続は未対応".into(),
        ));
    }
    Ok(depth)
}

pub(crate) fn width_reference(a: &Section, b: &Section) -> Result<f64> {
    let preferred = 0.5 * max_depth(a).min(max_depth(b));
    let mut depths = Vec::new();
    let ar = connected_ranges(a)?;
    let br = connected_ranges(b)?;
    for a in ar {
        for b in &br {
            let lower = a.lower.max(b.lower);
            let upper = a.upper.min(b.upper);
            if lower < upper {
                let depth = if preferred > lower && preferred < upper {
                    preferred
                } else {
                    lower + (upper - lower) / 2.0
                };
                if depth > lower && depth < upper {
                    depths.push(depth);
                }
            }
        }
    }
    depths
        .into_iter()
        .min_by(|a, b| (a - preferred).abs().total_cmp(&(b - preferred).abs()))
        .ok_or_else(|| {
            Error::Unsupported("隣接断面に単一流路となる共通の参照水深範囲がありません".into())
        })
}
