use crate::Analysis;
use doboku_core::Point;
use doboku_geometry::ground;
use doboku_hydraulics::Profile;

pub(super) fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
pub(super) fn cell(s: &str) -> String {
    let s = if s.starts_with(['=', '+', '-', '@', '\t', '\r']) {
        format!("'{s}")
    } else {
        s.into()
    };
    format!("\"{}\"", s.replace('"', "\"\""))
}
pub fn csv(a: &Analysis) -> String {
    let mut out=String::from("\u{feff}engine_version,executed_at,scenario,chainage_m,bed_elevation_m,water_elevation_m,depth_m,velocity_m_s,area_m2,froude,friction_slope,critical_depth_m,normal_depth_m,energy_residual_m,cut_volume_m3,fill_volume_m3,cut_area_m2,conditions_json,reference_json\r\n");
    let reference = cell(&serde_json::to_string(&a.project.reference).unwrap());
    let mut add = |name: &str,
                   p: &Profile,
                   river: &doboku_core::River,
                   cut: Option<f64>,
                   fill: Option<f64>,
                   areas: Option<&[f64]>| {
        let conditions = cell(&serde_json::to_string(river).unwrap());
        for (i, r) in p.rows.iter().enumerate() {
            out.push_str(&format!(
                "{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{}\r\n",
                cell(&a.run.engine_version),
                cell(&a.run.executed_at),
                cell(name),
                r.chainage,
                r.bed_elevation,
                r.water_elevation,
                r.depth,
                r.velocity,
                r.area,
                r.froude,
                r.friction_slope,
                r.critical_depth,
                r.normal_depth,
                r.energy_residual,
                cut.map(|v| v.to_string()).unwrap_or_default(),
                fill.map(|v| v.to_string()).unwrap_or_default(),
                areas.map(|a| a[i].to_string()).unwrap_or_default(),
                conditions,
                reference
            ));
        }
    };
    add("施工前", &a.run.profile, &a.run.river, None, None, None);
    for c in &a.comparisons {
        add(
            &c.scenario.name,
            &c.profile,
            &c.river,
            c.cut_volume,
            c.fill_volume,
            c.cut_areas.as_deref(),
        );
    }
    out
}
pub(super) struct Series {
    pub name: String,
    pub color: &'static str,
    pub points: Vec<Point>,
}
pub(super) fn plot(title: &str, series: Vec<Series>) -> String {
    let points: Vec<&Point> = series.iter().flat_map(|s| &s.points).collect();
    let xmin = points.iter().map(|p| p.x).fold(f64::INFINITY, f64::min);
    let xmax = points.iter().map(|p| p.x).fold(f64::NEG_INFINITY, f64::max);
    let ymin = points.iter().map(|p| p.z).fold(f64::INFINITY, f64::min) - 0.5;
    let ymax = points.iter().map(|p| p.z).fold(f64::NEG_INFINITY, f64::max) + 0.5;
    let px = |v: f64| 60.0 + (v - xmin) / (xmax - xmin).max(1e-8) * 700.0;
    let py = |v: f64| 220.0 - (v - ymin) / (ymax - ymin).max(1e-8) * 170.0;
    let height = 260 + series.len().div_ceil(3) * 18;
    let mut s=format!("<svg role='img' aria-label='{}' viewBox='0 0 820 {}'><title>{}</title><rect width='820' height='{}' fill='#fff'/>",escape(title),height,escape(title),height);
    for i in 0..=4 {
        let y = ymin + (ymax - ymin) * i as f64 / 4.0;
        s.push_str(&format!(
            "<path d='M60 {}H760' stroke='#dde3eb'/><text x='8' y='{}'>{:.2}</text>",
            py(y),
            py(y) + 4.0,
            y
        ));
        let x = xmin + (xmax - xmin) * i as f64 / 4.0;
        s.push_str(&format!(
            "<text x='{}' y='245'>{:.1}</text>",
            px(x) - 15.0,
            x
        ));
    }
    for (i, line) in series.iter().enumerate() {
        let coords = line
            .points
            .iter()
            .map(|p| format!("{:.2},{:.2}", px(p.x), py(p.z)))
            .collect::<Vec<_>>()
            .join(" ");
        s.push_str(&format!("<polyline fill='none' stroke='{}' stroke-width='2' points='{}'/><text x='{}' y='{}' fill='{}'>{}</text>",line.color,coords,60+i%3*245,265+i/3*15,line.color,escape(&line.name)));
    }
    s.push_str("<text x='60' y='25'>標高 (m / 共通基準高)</text><text x='660' y='25'>距離 (m)</text></svg>");
    s
}
pub(super) fn water(points: &[Point], stage: f64) -> Vec<Point> {
    let mut xs = Vec::new();
    for w in points.windows(2) {
        if w[0].z <= stage {
            xs.push(w[0].x);
        }
        if (w[0].z - stage) * (w[1].z - stage) < 0.0 {
            xs.push(w[0].x + (w[1].x - w[0].x) * (stage - w[0].z) / (w[1].z - w[0].z));
        }
        if w[1].z <= stage {
            xs.push(w[1].x);
        }
    }
    vec![
        Point {
            x: xs.iter().copied().fold(f64::INFINITY, f64::min),
            z: stage,
        },
        Point {
            x: xs.iter().copied().fold(f64::NEG_INFINITY, f64::max),
            z: stage,
        },
    ]
}
pub(super) fn table(p: &Profile, areas: Option<&[f64]>) -> String {
    let mut s="<table><thead><tr><th>距離 m</th><th>河床 m</th><th>水位 m</th><th>水深 m</th><th>流速 m/s</th><th>Fr</th><th>限界水深 m</th><th>等流水深 m</th><th>残差 m</th><th>掘削断面積 m²</th></tr></thead><tbody>".to_string();
    for (i, r) in p.rows.iter().enumerate() {
        let area = areas.map(|a| format!("{:.3}", a[i])).unwrap_or("—".into());
        s.push_str(&format!("<tr><td>{:.1}</td><td>{:.3}</td><td>{:.3}</td><td>{:.3}</td><td>{:.3}</td><td>{:.3}</td><td>{:.3}</td><td>{:.3}</td><td>{:.2e}</td><td>{}</td></tr>",r.chainage,r.bed_elevation,r.water_elevation,r.depth,r.velocity,r.froude,r.critical_depth,r.normal_depth,r.energy_residual,area));
    }
    s.push_str("</tbody></table>");
    s
}
pub fn html(a: &Analysis) -> String {
    let colors = [
        "#e18127", "#895be5", "#cc526c", "#1e948b", "#8a863a", "#445ea9",
    ];
    let mut s=format!("<!doctype html><html lang='ja'><meta charset='utf-8'><title>DobokuAI 計算レポート</title><style>body{{font:14px system-ui;color:#203244;max-width:1100px;margin:40px auto;padding:20px}}h1,h2,h3{{color:#12382f}}table{{width:100%;border-collapse:collapse;font-size:12px}}td,th{{border-bottom:1px solid #ddd;padding:7px;text-align:right}}pre{{white-space:pre-wrap;font-size:11px;background:#f4f6f7;padding:15px}}svg{{width:100%;font:12px system-ui}}section{{break-inside:avoid;margin:24px 0}}@media print{{body{{margin:0}}}}</style><h1>DobokuAI / {}</h1><p>エンジン {} ・実行日時 {} (UTC) ・単位 SI ・全図共通基準高</p><h2>計算条件・手法</h2><p>Q={} m³/s / 参照勾配={} / 境界 {:?}: 水深 {} m。標準逐次計算法、Manning摩擦、α=1、区間摩擦勾配の算術平均。二分法最大120回、エネルギー残差≤10⁻⁷m。等流水深は参照勾配の診断値。</p><p>{}</p><p>施工案モード: {}。水位差・土量は施工前からの累積値。工期・費用は根拠データがないため未算定。</p>",escape(&a.project.name),escape(&a.run.engine_version),escape(&a.run.executed_at),a.run.river.discharge,a.run.river.normal_slope,a.run.river.boundary.regime,a.run.river.boundary.depth,escape(doboku_hydraulics::LIMITATIONS),if a.staged{"順序付き施工段階（条件を累積）"}else{"独立した代替案"});
    s.push_str(&format!("<h3>座標・基準高と取込み元</h3><p>標高系: {} / 水平座標: {}。座標変換は行っていません。</p>", escape(&a.project.reference.vertical_datum), escape(&a.project.reference.horizontal_reference)));
    if let Some(source) = &a.project.reference.import {
        s.push_str(&format!("<p>取込み元: {} / 日時 {} / 高さの解釈 {} / 単位 {}<br>取込み元CSVのSHA-256: {}。取込み後の編集はハッシュに含まれません。現在の条件は末尾の再現用JSONを参照してください。</p>", escape(&source.file_name), escape(&source.imported_at), escape(&source.elevation_mode), escape(&source.unit), escape(&source.sha256)));
        s.push_str(&crate::provenance::html(source.dataset.as_ref()));
    }
    let mut lines = vec![
        Series {
            name: "施工前 河床".into(),
            color: "#766657",
            points: a
                .run
                .profile
                .rows
                .iter()
                .map(|r| Point {
                    x: r.chainage,
                    z: r.bed_elevation,
                })
                .collect(),
        },
        Series {
            name: "施工前 水位".into(),
            color: "#258dc0",
            points: a
                .run
                .profile
                .rows
                .iter()
                .map(|r| Point {
                    x: r.chainage,
                    z: r.water_elevation,
                })
                .collect(),
        },
    ];
    for (i, c) in a.comparisons.iter().enumerate() {
        lines.push(Series {
            name: c.scenario.name.clone(),
            color: colors[i],
            points: c
                .profile
                .rows
                .iter()
                .map(|r| Point {
                    x: r.chainage,
                    z: r.water_elevation,
                })
                .collect(),
        });
    }
    s.push_str("<section><h2>縦断水面形</h2>");
    s.push_str(&plot("縦断水面形", lines));
    s.push_str("</section><h2>施工前 数値結果</h2>");
    s.push_str(&table(&a.run.profile, None));
    for c in &a.comparisons {
        s.push_str(&format!("<section><h2>{}</h2><p>最大絶対変化地点の水位差 {:+.4} m / 掘削量 {} m³ / 盛土量 {} m³</p><p>{}</p>{}</section>",escape(&c.scenario.name),c.max_water_change,c.cut_volume.map(|v|format!("{v:.2}")).unwrap_or("未算定".into()),c.fill_volume.map(|v|format!("{v:.2}")).unwrap_or("未算定".into()),escape(&c.volume_note),table(&c.profile,c.cut_areas.as_deref())));
    }
    s.push_str("<h2>河川横断図（施工前後・各測点）</h2>");
    for (j, st) in a.run.river.stations.iter().enumerate() {
        let g = ground(&st.section, st.bed_elevation);
        let mut lines = vec![
            Series {
                name: "施工前 地盤".into(),
                color: "#766657",
                points: g.clone(),
            },
            Series {
                name: "施工前 水位".into(),
                color: "#258dc0",
                points: water(&g, a.run.profile.rows[j].water_elevation),
            },
        ];
        for (i, c) in a.comparisons.iter().enumerate() {
            let st = &c.river.stations[j];
            let g = ground(&st.section, st.bed_elevation);
            lines.push(Series {
                name: format!("{} 地盤", c.scenario.name),
                color: colors[i],
                points: g.clone(),
            });
            lines.push(Series {
                name: format!("{} 水位", c.scenario.name),
                color: colors[i],
                points: water(&g, c.profile.rows[j].water_elevation),
            });
        }
        s.push_str(&format!(
            "<section><h3>距離 {:.1} m</h3>{}</section>",
            st.chainage,
            plot("横断図", lines)
        ));
    }
    s.push_str("<h2>再現用条件（全断面・施工条件・バージョン・日時）</h2><pre>");
    s.push_str(&escape(&serde_json::to_string_pretty(a).unwrap()));
    s.push_str("</pre></html>");
    s
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn report_escapes_names_and_retains_reproducibility() {
        let mut p = doboku_core::sample();
        p.name = "<script>alert(1)</script>".into();
        let a = crate::analyze(crate::AnalysisRequest {
            project: p,
            scenarios: vec![],
            staged: false,
        })
        .unwrap();
        let html = html(&a);
        assert!(!html.contains("<script>"));
        assert!(html.contains("&lt;script&gt;"));
        assert!(html.contains(&a.run.executed_at));
        assert!(html.contains("<svg"));
        let csv = csv(&a);
        assert_eq!(csv.lines().count(), 12);
        assert!(csv.contains("normal_depth_m"));
        assert!(csv.contains("discharge"));
        assert_eq!(cell("=SUM(1)"), "\"'=SUM(1)\"");
    }
}
