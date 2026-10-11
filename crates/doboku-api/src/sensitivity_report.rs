//! Reports use stored deterministic results, including explicit failed cases.
use crate::{
    report::{cell, escape, plot, table, water, Series},
    sensitivity::{Change, Outcome, Response},
    Run,
};
use doboku_core::Point;
use doboku_geometry::ground;

fn label(change: &Change) -> String {
    match change {
        Change::Discharge { value } => format!("流量 Q = {value} m³/s"),
        Change::Roughness { value } => format!("全断面粗度 n = {value}"),
    }
}
fn changed(change: &Change) -> (&'static str, f64) {
    match *change {
        Change::Discharge { value } => ("discharge", value),
        Change::Roughness { value } => ("roughness", value),
    }
}
fn csv_row(fields: &[String]) -> String {
    fields
        .iter()
        .enumerate()
        .map(|(i, s)| {
            // Numeric fields come from typed f64 values, not user-provided strings.
            if i == 2 || (7..=18).contains(&i) {
                format!("\"{s}\"")
            } else {
                cell(s)
            }
        })
        .collect::<Vec<_>>()
        .join(",")
        + "\r\n"
}
pub fn csv(a: &Response) -> String {
    let mut out=String::from("\u{feff}case,parameter,requested_value,status,error,engine_version,executed_at,chainage_m,bed_elevation_m,water_elevation_m,depth_m,velocity_m_s,area_m2,froude,friction_slope,critical_depth_m,normal_depth_m,energy_residual_m,water_change_m,conditions_json,project_json,note\r\n");
    let project = serde_json::to_string(&a.project).unwrap();
    let mut add =
        |name: String, change: Option<&Change>, run: Option<&Run>, error: Option<&str>| {
            let (parameter, value) = change
                .map(|c| {
                    let (p, v) = changed(c);
                    (p.to_string(), v.to_string())
                })
                .unwrap_or_default();
            let status = if error.is_some() { "failed" } else { "ok" };
            let prefix = vec![
                name,
                parameter,
                value,
                status.into(),
                error.unwrap_or_default().into(),
            ];
            if let Some(run) = run {
                let conditions = serde_json::to_string(&run.river).unwrap();
                for (i, r) in run.profile.rows.iter().enumerate() {
                    let mut fields = prefix.clone();
                    fields.extend([
                        run.engine_version.clone(),
                        run.executed_at.clone(),
                        r.chainage.to_string(),
                        r.bed_elevation.to_string(),
                        r.water_elevation.to_string(),
                        r.depth.to_string(),
                        r.velocity.to_string(),
                        r.area.to_string(),
                        r.froude.to_string(),
                        r.friction_slope.to_string(),
                        r.critical_depth.to_string(),
                        r.normal_depth.to_string(),
                        r.energy_residual.to_string(),
                        (r.water_elevation - a.baseline.profile.rows[i].water_elevation)
                            .to_string(),
                        conditions.clone(),
                    ]);
                    fields.extend([project.clone(), a.note.clone()]);
                    out.push_str(&csv_row(&fields));
                }
            } else {
                let mut fields = prefix;
                // Failed cases have neither a run timestamp nor numerical output.
                fields.extend(vec![String::new(); 15]);
                fields.extend([project.clone(), a.note.clone()]);
                out.push_str(&csv_row(&fields));
            }
        };
    add("基本条件".into(), None, Some(&a.baseline), None);
    for (i, c) in a.cases.iter().enumerate() {
        match c {
            Outcome::Ok { change, run, .. } => add(
                format!("{}: {}", i + 1, label(change)),
                Some(change),
                Some(run),
                None,
            ),
            Outcome::Failed { change, error } => add(
                format!("{}: {}", i + 1, label(change)),
                Some(change),
                None,
                Some(error),
            ),
        }
    }
    out
}
pub fn html(a: &Response) -> String {
    let colors = [
        "#e18127", "#895be5", "#cc526c", "#1e948b", "#8a863a", "#445ea9", "#356ac2", "#a4634a",
    ];
    let valid: Vec<_> = a
        .cases
        .iter()
        .enumerate()
        .filter_map(|(i, c)| match c {
            Outcome::Ok { change, run, .. } => Some((i, change, run)),
            _ => None,
        })
        .collect();
    let mut s=format!("<!doctype html><html lang='ja'><meta charset='utf-8'><title>DobokuAI 感度比較レポート</title><style>body{{font:14px system-ui;color:#203244;max-width:1100px;margin:40px auto;padding:20px}}table{{width:100%;border-collapse:collapse;font-size:12px}}td,th{{border-bottom:1px solid #ddd;padding:7px;text-align:right}}pre{{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;background:#f4f6f7;padding:15px}}svg{{width:100%;font:12px system-ui}}section{{break-inside:avoid;margin:24px 0}}</style><h1>DobokuAI 感度比較 / {}</h1><p>エンジン {} / 基本計算日時 {} (UTC) / SI単位</p><p>{}</p><h2>基準高・取込み元</h2><p>標高系: {} / 水平座標: {}。全図共通基準高、座標変換は行っていません。</p><pre>{}</pre><h2>計算手法と適用範囲</h2><p>標準逐次計算法、Manning摩擦、α=1、区間摩擦勾配の算術平均。二分法最大120回、エネルギー残差≤10⁻⁷m。等流水深は参照勾配の診断値。</p><p>{}</p>",escape(&a.project.name),escape(&a.baseline.engine_version),escape(&a.baseline.executed_at),escape(&a.note),escape(&a.project.reference.vertical_datum),escape(&a.project.reference.horizontal_reference),escape(&serde_json::to_string_pretty(&a.project.reference).unwrap()),escape(doboku_hydraulics::LIMITATIONS));
    if a.project.reference.import.is_some() {
        s.push_str("<p>SHA-256は取込み元CSVのものです。取込み後の編集は含みません。現在の条件は末尾の再現用JSONを参照してください。</p>");
    }
    s.push_str("<h2>各条件の判定</h2><table><tr><th>変更条件</th><th>判定</th><th>最大絶対変化地点の水位差 m / 診断</th></tr>");
    for c in &a.cases {
        match c {
            Outcome::Ok {
                change,
                max_water_change,
                ..
            } => s.push_str(&format!(
                "<tr><td>{}</td><td>成功</td><td>{:+.6}</td></tr>",
                escape(&label(change)),
                max_water_change
            )),
            Outcome::Failed { change, error } => s.push_str(&format!(
                "<tr><td>{}</td><td>失敗</td><td>{}</td></tr>",
                escape(&label(change)),
                escape(error)
            )),
        }
    }
    s.push_str("</table><section><h2>縦断水面形</h2>");
    let profile_series = |name: String, color, run: &Run| Series {
        name,
        color,
        points: run
            .profile
            .rows
            .iter()
            .map(|r| Point {
                x: r.chainage,
                z: r.water_elevation,
            })
            .collect(),
    };
    let mut lines = vec![
        Series {
            name: "基本河床".into(),
            color: "#766657",
            points: a
                .baseline
                .profile
                .rows
                .iter()
                .map(|r| Point {
                    x: r.chainage,
                    z: r.bed_elevation,
                })
                .collect(),
        },
        profile_series("基本条件".into(), "#258dc0", &a.baseline),
    ];
    for (i, c, r) in &valid {
        lines.push(profile_series(label(c), colors[*i], r));
    }
    s.push_str(&plot("感度比較の縦断水面形", lines));
    s.push_str("</section><h2>基本条件の数値結果</h2>");
    s.push_str(&table(&a.baseline.profile, None));
    for (_, c, r) in &valid {
        s.push_str(&format!(
            "<section><h2>{}</h2><p>エンジン {} / 実行日時 {} (UTC)</p>{}</section>",
            escape(&label(c)),
            escape(&r.engine_version),
            escape(&r.executed_at),
            table(&r.profile, None)
        ));
    }
    s.push_str("<h2>河川横断図</h2>");
    for (j, st) in a.baseline.river.stations.iter().enumerate() {
        let g = ground(&st.section, st.bed_elevation);
        let mut lines = vec![
            Series {
                name: "基本地盤".into(),
                color: "#766657",
                points: g.clone(),
            },
            Series {
                name: "基本条件".into(),
                color: "#258dc0",
                points: water(&g, a.baseline.profile.rows[j].water_elevation),
            },
        ];
        for (i, c, r) in &valid {
            lines.push(Series {
                name: label(c),
                color: colors[*i],
                points: water(&g, r.profile.rows[j].water_elevation),
            });
        }
        s.push_str(&format!(
            "<section><h3>距離 {:.1} m</h3>{}</section>",
            st.chainage,
            plot("感度比較の横断図", lines)
        ));
    }
    s.push_str("<h2>再現用条件・結果・失敗理由（元の版・日時）</h2><pre>");
    s.push_str(&escape(&serde_json::to_string_pretty(a).unwrap()));
    s.push_str("</pre></html>");
    s
}
