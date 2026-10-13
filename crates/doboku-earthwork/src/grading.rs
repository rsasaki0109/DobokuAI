//! Cut/fill area between a piecewise-linear ground profile and a horizontal
//! proposed elevation. Metres and square metres, never a terrain volume.
use doboku_core::{Error, Result};
use serde::{Deserialize, Serialize};

pub const MODEL_VERSION: &str = "linear-profile-grading-1";
pub const MAX_SPANS: usize = 8193;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub enum Ground {
    Unique {
        start_elevation_m: f64,
        end_elevation_m: f64,
    },
    Uncovered,
    Ambiguous,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Span {
    pub start_m: f64,
    pub end_m: f64,
    pub ground: Ground,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct LinearProfile {
    pub length_m: f64,
    pub spans: Vec<Span>,
    /// Includes unresolved endpoints and zero-width vertical projections.
    pub unresolved_points_m: Vec<f64>,
}
#[derive(Debug, Serialize)]
pub struct SpanAreas {
    pub start_m: f64,
    pub end_m: f64,
    pub cut_area_m2: Option<f64>,
    pub fill_area_m2: Option<f64>,
    pub crossing_distance_m: Option<f64>,
}
#[derive(Debug, Serialize)]
pub struct GradingAreas {
    pub complete: bool,
    pub known_length_m: f64,
    pub uncovered_length_m: f64,
    pub ambiguous_length_m: f64,
    pub unresolved_point_count: usize,
    pub cut_area_m2: Option<f64>,
    pub fill_area_m2: Option<f64>,
    pub known_cut_area_m2: f64,
    pub known_fill_area_m2: f64,
    pub spans: Vec<SpanAreas>,
}

#[derive(Default)]
struct Sum {
    value: f64,
    correction: f64,
}
impl Sum {
    fn add(&mut self, value: f64) {
        let y = value - self.correction;
        let t = self.value + y;
        self.correction = (t - self.value) - y;
        self.value = t;
    }
}
fn valid_height(h: f64) -> bool {
    h.is_finite() && h.abs() <= 12000.0
}
pub fn evaluate(profile: &LinearProfile, target_elevation_m: f64) -> Result<GradingAreas> {
    if !valid_height(target_elevation_m)
        || !profile.length_m.is_finite()
        || !(1e-6..=5000.0).contains(&profile.length_m)
        || profile.spans.is_empty()
        || profile.spans.len() > MAX_SPANS
        || profile.unresolved_points_m.len() > MAX_SPANS + 1
    {
        return Err(Error::Invalid(
            "断面長は0.000001〜5000m、標高は有限値かつ±12000m、区間は1〜8193件".into(),
        ));
    }
    if profile
        .unresolved_points_m
        .iter()
        .any(|x| !x.is_finite() || *x < 0.0 || *x > profile.length_m)
        || profile.unresolved_points_m.windows(2).any(|w| w[0] >= w[1])
    {
        return Err(Error::Invalid(
            "未解決点の距離は断面範囲内・有限値・重複なしの昇順".into(),
        ));
    }
    let mut expected_start = 0.0;
    let mut cut = Sum::default();
    let mut fill = Sum::default();
    let mut known = Sum::default();
    let mut uncovered = Sum::default();
    let mut ambiguous = Sum::default();
    let mut complete = profile.unresolved_points_m.is_empty();
    let mut spans = Vec::with_capacity(profile.spans.len());
    for span in &profile.spans {
        if !span.start_m.is_finite()
            || !span.end_m.is_finite()
            || span.start_m != expected_start
            || span.end_m <= span.start_m
            || span.end_m > profile.length_m
        {
            return Err(Error::Invalid(
                "区間は0から断面長まで隙間・重複なく昇順。未知の区間も明示してください".into(),
            ));
        }
        expected_start = span.end_m;
        let dx = span.end_m - span.start_m;
        let mut row = SpanAreas {
            start_m: span.start_m,
            end_m: span.end_m,
            cut_area_m2: None,
            fill_area_m2: None,
            crossing_distance_m: None,
        };
        match span.ground {
            Ground::Unique {
                start_elevation_m,
                end_elevation_m,
            } => {
                if !valid_height(start_elevation_m) || !valid_height(end_elevation_m) {
                    return Err(Error::Invalid("地形標高は有限値かつ±12000m".into()));
                }
                let a = start_elevation_m - target_elevation_m;
                let b = end_elevation_m - target_elevation_m;
                let (cut_area, fill_area) = if a >= 0.0 && b >= 0.0 {
                    (dx * (a + b) / 2.0, 0.0)
                } else if a <= 0.0 && b <= 0.0 {
                    (0.0, dx * (-a - b) / 2.0)
                } else {
                    let fraction = a.abs() / (a.abs() + b.abs());
                    row.crossing_distance_m = Some(span.start_m + dx * fraction);
                    let left = dx * fraction * a.abs() / 2.0;
                    let right = dx * (1.0 - fraction) * b.abs() / 2.0;
                    if a > 0.0 {
                        (left, right)
                    } else {
                        (right, left)
                    }
                };
                if !cut_area.is_finite() || !fill_area.is_finite() {
                    return Err(Error::Invalid(
                        "切土・盛土断面積が有限値ではありません".into(),
                    ));
                }
                row.cut_area_m2 = Some(cut_area);
                row.fill_area_m2 = Some(fill_area);
                known.add(dx);
                cut.add(cut_area);
                fill.add(fill_area);
            }
            Ground::Uncovered => {
                complete = false;
                uncovered.add(dx);
            }
            Ground::Ambiguous => {
                complete = false;
                ambiguous.add(dx);
            }
        }
        spans.push(row);
    }
    if expected_start != profile.length_m {
        return Err(Error::Invalid("区間の終端が断面長と一致しません".into()));
    }
    Ok(GradingAreas {
        complete,
        known_length_m: known.value,
        uncovered_length_m: uncovered.value,
        ambiguous_length_m: ambiguous.value,
        unresolved_point_count: profile.unresolved_points_m.len(),
        cut_area_m2: complete.then_some(cut.value),
        fill_area_m2: complete.then_some(fill.value),
        known_cut_area_m2: cut.value,
        known_fill_area_m2: fill.value,
        spans,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn profile(a: f64, b: f64) -> LinearProfile {
        LinearProfile {
            length_m: 10.0,
            spans: vec![Span {
                start_m: 0.0,
                end_m: 10.0,
                ground: Ground::Unique {
                    start_elevation_m: a,
                    end_elevation_m: b,
                },
            }],
            unresolved_points_m: vec![],
        }
    }
    #[test]
    fn analytic_rectangles_triangles_and_crossings() {
        for (a, b, target, cut, fill) in [
            (102.0, 102.0, 100.0, 20.0, 0.0),
            (98.0, 98.0, 100.0, 0.0, 20.0),
            (100.0, 104.0, 100.0, 20.0, 0.0),
            (102.0, 98.0, 100.0, 5.0, 5.0),
            (99.0, 103.0, 100.0, 11.25, 1.25),
            (-2.0, -2.0, -1.0, 0.0, 10.0),
            (100.0, 100.0, 100.0, 0.0, 0.0),
        ] {
            let q = evaluate(&profile(a, b), target).unwrap();
            assert_eq!(q.cut_area_m2, Some(cut));
            assert_eq!(q.fill_area_m2, Some(fill));
            assert_eq!(q.known_length_m, 10.0);
        }
        assert_eq!(
            evaluate(&profile(99.0, 103.0), 100.0).unwrap().spans[0].crossing_distance_m,
            Some(2.5)
        );
    }
    #[test]
    fn translation_reversal_and_subdivision_preserve_separate_areas() {
        let base = evaluate(&profile(99.0, 103.0), 100.0).unwrap();
        for p in [profile(1099.0, 1103.0), profile(1103.0, 1099.0)] {
            let q = evaluate(&p, 1100.0).unwrap();
            assert_eq!(q.cut_area_m2, base.cut_area_m2);
            assert_eq!(q.fill_area_m2, base.fill_area_m2);
        }
        let mut p = profile(99.0, 103.0);
        p.spans = vec![
            Span {
                start_m: 0.0,
                end_m: 2.5,
                ground: Ground::Unique {
                    start_elevation_m: 99.0,
                    end_elevation_m: 100.0,
                },
            },
            Span {
                start_m: 2.5,
                end_m: 10.0,
                ground: Ground::Unique {
                    start_elevation_m: 100.0,
                    end_elevation_m: 103.0,
                },
            },
        ];
        let q = evaluate(&p, 100.0).unwrap();
        assert_eq!(q.cut_area_m2, base.cut_area_m2);
        assert_eq!(q.fill_area_m2, base.fill_area_m2);
    }
    #[test]
    fn unknown_spans_and_points_never_become_complete_totals() {
        let mut p = profile(102.0, 102.0);
        p.spans[0].end_m = 9.9999999;
        p.spans.push(Span {
            start_m: 9.9999999,
            end_m: 10.0,
            ground: Ground::Uncovered,
        });
        let q = evaluate(&p, 100.0).unwrap();
        assert!(!q.complete);
        assert!(q.uncovered_length_m > 0.0 && q.uncovered_length_m < 1e-6);
        assert_eq!(q.cut_area_m2, None);
        assert!(q.known_cut_area_m2 > 19.99);
        assert_eq!(q.spans[1].cut_area_m2, None);
        p.spans[1].ground = Ground::Ambiguous;
        assert!(evaluate(&p, 100.0).unwrap().ambiguous_length_m > 0.0);
        let mut p = profile(102.0, 102.0);
        p.unresolved_points_m = vec![5.0];
        let q = evaluate(&p, 100.0).unwrap();
        assert_eq!(q.known_cut_area_m2, 20.0);
        assert_eq!(q.cut_area_m2, None);
        assert_eq!(q.unresolved_point_count, 1);
    }
    #[test]
    fn malformed_partitions_limits_and_nonfinite_inputs_are_rejected() {
        for bad in [f64::NAN, f64::INFINITY, 12000.1] {
            assert!(evaluate(&profile(100.0, 100.0), bad).is_err());
            assert!(evaluate(&profile(bad, 100.0), 0.0).is_err());
        }
        for bad in [f64::NAN, 0.0, 5000.1] {
            let mut p = profile(100.0, 100.0);
            p.length_m = bad;
            assert!(evaluate(&p, 0.0).is_err());
        }
        for (a, b) in [(1e-12, 10.0), (0.0, 9.0), (0.0, 0.0), (0.0, f64::NAN)] {
            let mut p = profile(100.0, 100.0);
            p.spans[0].start_m = a;
            p.spans[0].end_m = b;
            assert!(evaluate(&p, 0.0).is_err());
        }
        for points in [
            vec![5.0, 5.0],
            vec![6.0, 5.0],
            vec![-1.0],
            vec![f64::NAN],
            vec![11.0],
        ] {
            let mut p = profile(100.0, 100.0);
            p.unresolved_points_m = points;
            assert!(evaluate(&p, 0.0).is_err());
        }
        let mut p = profile(100.0, 100.0);
        p.spans = vec![p.spans[0].clone(); MAX_SPANS + 1];
        assert!(evaluate(&p, 0.0).is_err());
    }
    #[test]
    fn independent_midpoint_reference_cases() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../../examples/grading-reference.json")).unwrap();
        for case in fixture["cases"].as_array().unwrap() {
            let p: LinearProfile = serde_json::from_value(case["profile"].clone()).unwrap();
            let q = evaluate(&p, case["target_elevation_m"].as_f64().unwrap()).unwrap();
            for (actual, key) in [
                (q.known_cut_area_m2, "cut_area_m2"),
                (q.known_fill_area_m2, "fill_area_m2"),
            ] {
                let reference = case["expected"][key].as_f64().unwrap();
                assert!(
                    (actual - reference).abs() < 1e-6,
                    "{} {}: {actual} vs {reference}",
                    case["name"],
                    key
                );
            }
        }
    }
}
