//! Wetted geometry for finite-bank, single-valley sections.
use doboku_core::{positive, Error, Point, Result, Section};
use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize)]
pub struct WetGeometry {
    pub area: f64,
    pub perimeter: f64,
    pub top_width: f64,
}
impl WetGeometry {
    pub fn radius(self) -> f64 {
        self.area / self.perimeter
    }
}

pub fn validate(s: &Section) -> Result<()> {
    match s {
        Section::Rectangle { width, bank_height } => {
            positive("幅", *width)?;
            positive("堤岸高", *bank_height)?;
        }
        Section::Trapezoid {
            bottom_width,
            side_slope,
            bank_height,
        } => {
            positive("底幅", *bottom_width)?;
            positive("堤岸高", *bank_height)?;
            if !side_slope.is_finite() || *side_slope < 0.0 || *side_slope > 20.0 {
                return Err(Error::Invalid("法勾配は0〜20 (水平/鉛直)".into()));
            }
        }
        Section::Survey { points } => {
            if !(3..=200).contains(&points.len()) {
                return Err(Error::Invalid("測点数は3〜200".into()));
            }
            if points
                .iter()
                .any(|p| !p.x.is_finite() || !p.z.is_finite() || p.z < 0.0)
            {
                return Err(Error::Invalid("測点は有限値、相対高さは0以上".into()));
            }
            let min = points.iter().map(|p| p.z).fold(f64::INFINITY, f64::min);
            if min.abs() > 1e-9 {
                return Err(Error::Invalid("測量断面の最低点は相対高さ0".into()));
            }
            let mut rising = false;
            for w in points.windows(2) {
                if w[1].x <= w[0].x {
                    return Err(Error::Invalid("測点xは単調増加、垂直区間は未対応".into()));
                }
                if w[1].z > w[0].z {
                    rising = true;
                }
                if rising && w[1].z < w[0].z {
                    return Err(Error::Unsupported("複断面・分離した流路は未対応".into()));
                }
            }
            positive("左岸高", points[0].z)?;
            positive("右岸高", points.last().unwrap().z)?;
        }
    }
    Ok(())
}
pub fn max_depth(s: &Section) -> f64 {
    match s {
        Section::Rectangle { bank_height, .. } | Section::Trapezoid { bank_height, .. } => {
            *bank_height
        }
        Section::Survey { points } => points
            .first()
            .map(|p| p.z)
            .unwrap_or(0.0)
            .min(points.last().map(|p| p.z).unwrap_or(0.0)),
    }
}
pub fn wet(s: &Section, depth: f64) -> Result<WetGeometry> {
    validate(s)?;
    positive("水深", depth)?;
    if depth >= max_depth(s) {
        return Err(Error::Unsupported("水位が堤岸高以上（越岸未対応）".into()));
    }
    let g = match s {
        Section::Rectangle { width, .. } => WetGeometry {
            area: width * depth,
            perimeter: width + 2.0 * depth,
            top_width: *width,
        },
        Section::Trapezoid {
            bottom_width: b,
            side_slope: m,
            ..
        } => WetGeometry {
            area: (b + m * depth) * depth,
            perimeter: b + 2.0 * depth * (1.0 + m * m).sqrt(),
            top_width: b + 2.0 * m * depth,
        },
        Section::Survey { points } => {
            let mut g = WetGeometry {
                area: 0.0,
                perimeter: 0.0,
                top_width: 0.0,
            };
            for w in points.windows(2) {
                let (a, b) = (w[0], w[1]);
                if a.z >= depth && b.z >= depth {
                    continue;
                }
                let crossing = |p: Point, q: Point| Point {
                    x: p.x + (q.x - p.x) * (depth - p.z) / (q.z - p.z),
                    z: depth,
                };
                let lo = if a.z > depth { crossing(a, b) } else { a };
                let hi = if b.z > depth { crossing(a, b) } else { b };
                let dx = hi.x - lo.x;
                g.area += dx * (2.0 * depth - lo.z - hi.z) / 2.0;
                g.perimeter += dx.hypot(hi.z - lo.z);
                g.top_width += dx;
            }
            g
        }
    };
    if [g.area, g.perimeter, g.top_width]
        .iter()
        .any(|v| !v.is_finite() || *v <= 0.0)
    {
        return Err(Error::Numerical("不正な潤辺・面積".into()));
    }
    Ok(g)
}

/// Ground survey points in a common datum, including duplicate x for vertical walls.
pub fn ground(s: &Section, bed: f64) -> Vec<Point> {
    match s {
        Section::Rectangle {
            width: b,
            bank_height: h,
        } => vec![
            Point {
                x: -b / 2.0,
                z: bed + h,
            },
            Point {
                x: -b / 2.0,
                z: bed,
            },
            Point { x: b / 2.0, z: bed },
            Point {
                x: b / 2.0,
                z: bed + h,
            },
        ],
        Section::Trapezoid {
            bottom_width: b,
            side_slope: m,
            bank_height: h,
        } => vec![
            Point {
                x: -b / 2.0 - m * h,
                z: bed + h,
            },
            Point {
                x: -b / 2.0,
                z: bed,
            },
            Point { x: b / 2.0, z: bed },
            Point {
                x: b / 2.0 + m * h,
                z: bed + h,
            },
        ],
        Section::Survey { points } => points
            .iter()
            .map(|p| Point {
                x: p.x,
                z: bed + p.z,
            })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn clipped_survey_matches_trapezoid() {
        let t = Section::Trapezoid {
            bottom_width: 10.0,
            side_slope: 2.0,
            bank_height: 5.0,
        };
        let s = Section::Survey {
            points: ground(&t, 0.0),
        };
        for d in [0.01, 1.0, 4.9] {
            let a = wet(&t, d).unwrap();
            let b = wet(&s, d).unwrap();
            assert!((a.area - b.area).abs() < 1e-10);
            assert!((a.perimeter - b.perimeter).abs() < 1e-10);
            assert!((a.top_width - b.top_width).abs() < 1e-10);
        }
    }
    #[test]
    fn valley_and_banks_are_enforced() {
        let t = Section::Rectangle {
            width: 10.0,
            bank_height: 5.0,
        };
        assert!(wet(&t, 5.0).is_err());
        assert!(wet(&t, f64::NAN).is_err());
        let p = vec![
            Point { x: 0.0, z: 4.0 },
            Point { x: 1.0, z: 0.0 },
            Point { x: 2.0, z: 2.0 },
            Point { x: 3.0, z: 1.0 },
            Point { x: 4.0, z: 4.0 },
        ];
        assert!(validate(&Section::Survey { points: p }).is_err());
    }
}
