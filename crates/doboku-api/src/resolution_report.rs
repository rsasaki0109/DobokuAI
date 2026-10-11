//! Station-spacing reports from stored snapshots, without solver calls.
use crate::{
    report::{cell, difference_plot, escape, plot, table, water, Series},
    resolution::Response,
};
use doboku_core::Point;
use doboku_geometry::ground;
use doboku_hydraulics::resolution::Outcome;

pub fn csv(a: &Response) -> String {
    let prefix = [
        &a.engine_version,
        &a.executed_at,
        &a.project.name,
        &a.project.reference.vertical_datum,
    ]
    .map(|v| cell(v))
    .join(",");
    let suffix = format!(
        "{},{}",
        cell(&serde_json::to_string(&a.project).unwrap()),
        cell(&a.note)
    );
    let mut out = String::from("\u{feff}engine_version,study_executed_at,project,vertical_datum,subdivisions,status,error,chainage_m,water_elevation_m,water_change_m,depth_change_m,velocity_change_m,conditions_json,project_json,note\r\n");
    let conditions = cell(&serde_json::to_string(&a.project.river).unwrap());
    for r in &a.study.baseline.rows {
        out.push_str(&format!(
            "{prefix},1,ok,\"\",{},{},0,0,0,{conditions},{suffix}\r\n",
            r.chainage, r.water_elevation
        ));
    }
    for case in &a.study.cases {
        match case {
            Outcome::Ok {
                subdivisions,
                river,
                profile,
                differences,
                ..
            } => {
                let conditions = cell(&serde_json::to_string(river).unwrap());
                for (i, d) in differences.iter().enumerate() {
                    let r = &profile.rows[i * subdivisions];
                    out.push_str(&format!(
                        "{prefix},{subdivisions},ok,\"\",{},{},{},{},{},{conditions},{suffix}\r\n",
                        r.chainage,
                        r.water_elevation,
                        d.water_change,
                        d.depth_change,
                        d.velocity_change
                    ));
                }
            }
            Outcome::Failed {
                subdivisions,
                error,
            } => {
                out.push_str(&format!(
                    "{prefix},{subdivisions},failed,{},,,,,,,{suffix}\r\n",
                    cell(error)
                ));
            }
        }
    }
    out
}

pub fn html(a: &Response) -> String {
    let mut s = format!("<!doctype html><html lang='ja'><meta charset='utf-8'><title>DobokuAI 測点間隔比較レポート</title><style>body{{font:14px system-ui;color:#203244;max-width:1100px;margin:40px auto;padding:20px}}table{{width:100%;border-collapse:collapse;font-size:12px}}td,th{{border-bottom:1px solid #ddd;padding:7px;text-align:right}}pre{{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;background:#f4f6f7;padding:15px}}svg{{width:100%;font:12px system-ui}}section{{break-inside:avoid;margin:24px 0}}@media print{{body{{margin:0}}}}</style><h1>DobokuAI 測点間隔比較 / {}</h1><p>エンジン {} / 比較日時 {} (UTC) / SI単位</p><h2>比較条件・手法</h2><p>{}</p><p>Q={} m³/s / 参照勾配={} / 境界 {:?}: 水深 {} m / 元の断面数 {}</p><p>標準逐次計算法、Manning摩擦、α=1、区間摩擦勾配の算術平均。二分法最大120回、エネルギー残差≤10⁻⁷m。等流水深は参照勾配の診断値。</p><p>{}</p><p>2分割の直前は元の計算、4分割の直前は2分割です。すべての差を同じ元測点で比較し、失敗案の数値は生成しません。</p><h2>座標・基準高</h2><p>標高系: {} / 水平座標: {}。全図共通基準高、座標変換は行っていません。</p><pre>{}</pre>",
        escape(&a.project.name), escape(&a.engine_version), escape(&a.executed_at), escape(&a.note),
        a.project.river.discharge, a.project.river.normal_slope, a.project.river.boundary.regime,
        a.project.river.boundary.depth, a.project.river.stations.len(), escape(doboku_hydraulics::LIMITATIONS),
        escape(&a.project.reference.vertical_datum), escape(&a.project.reference.horizontal_reference),
        escape(&serde_json::to_string_pretty(&a.project.reference).unwrap()));
    if let Some(source) = &a.project.reference.import {
        s.push_str(&crate::provenance::html(source.dataset.as_ref()));
        s.push_str("<p>SHA-256は取込み元CSVのものです。取込み後の編集は含みません。現在の条件は末尾の再現用JSONを参照してください。</p>");
    }
    s.push_str("<h2>各分割の判定</h2><table><tr><th>分割</th><th>断面数</th><th>判定</th><th>元の計算からの最大絶対水位差 m</th><th>直前の分割からの最大絶対水位差 m / 診断</th></tr>");
    let mut stages = vec![Series {
        name: "元の計算".into(),
        color: "#258dc0",
        points: a
            .study
            .baseline
            .rows
            .iter()
            .map(|r| Point {
                x: r.chainage,
                z: r.water_elevation,
            })
            .collect(),
    }];
    let mut differences = Vec::new();
    for (index, case) in a.study.cases.iter().enumerate() {
        match case {
            Outcome::Ok {
                subdivisions,
                river,
                profile,
                differences: delta,
                max_abs_water_change,
                previous_max_abs_water_change,
            } => {
                s.push_str(&format!("<tr><td>{subdivisions}分割</td><td>{}</td><td>成功</td><td>{max_abs_water_change:.6e}</td><td>{}</td></tr>",river.stations.len(),previous_max_abs_water_change.map(|v|format!("{v:.6e}")).unwrap_or_else(||"前の分割が失敗したため未比較".into())));
                let color = ["#e18127", "#895be5"][index % 2];
                stages.push(Series {
                    name: format!("{subdivisions}分割"),
                    color,
                    points: profile
                        .rows
                        .iter()
                        .map(|r| Point {
                            x: r.chainage,
                            z: r.water_elevation,
                        })
                        .collect(),
                });
                differences.push(Series {
                    name: format!("{subdivisions}分割 − 元の計算"),
                    color,
                    points: delta
                        .iter()
                        .map(|r| Point {
                            x: r.chainage,
                            z: r.water_change,
                        })
                        .collect(),
                });
            }
            Outcome::Failed {
                subdivisions,
                error,
            } => s.push_str(&format!(
                "<tr><td>{subdivisions}分割</td><td>—</td><td>失敗</td><td>—</td><td>{}</td></tr>",
                escape(error)
            )),
        }
    }
    s.push_str("</table><section><h2>縦断水面形</h2>");
    s.push_str(&plot("測点間隔比較の縦断水面形", stages));
    s.push_str("</section>");
    if !differences.is_empty() {
        s.push_str("<section><h2>元測点の水位差</h2><p>水位差の軸は指数表記です。微小な差を表示するため縦断水面形とは縦軸スケールが異なります。</p>");
        s.push_str(&difference_plot(
            "測点細分化による元測点の水位差",
            differences,
        ));
        s.push_str("</section>");
    }
    s.push_str("<h2>代表横断図（元測点）</h2><p>上流端・中央・下流端の元測点を共通の基準高で表示します。補間による未測量断面の正しさを証明する図ではありません。</p>");
    let count = a.project.river.stations.len();
    let mut indices = vec![0, count / 2, count - 1];
    indices.dedup();
    for i in indices {
        let station = &a.project.river.stations[i];
        let points = ground(&station.section, station.bed_elevation);
        let mut lines = vec![
            Series {
                name: "河床・堤岸".into(),
                color: "#766657",
                points: points.clone(),
            },
            Series {
                name: "元の計算".into(),
                color: "#258dc0",
                points: water(&points, a.study.baseline.rows[i].water_elevation),
            },
        ];
        for (j, case) in a.study.cases.iter().enumerate() {
            if let Outcome::Ok {
                subdivisions,
                profile,
                ..
            } = case
            {
                lines.push(Series {
                    name: format!("{subdivisions}分割"),
                    color: ["#e18127", "#895be5"][j % 2],
                    points: water(&points, profile.rows[i * subdivisions].water_elevation),
                });
            }
        }
        s.push_str(&plot(
            &format!("流下距離 {} m の横断面", station.chainage),
            lines,
        ));
    }
    s.push_str("<h2>元の計算結果</h2>");
    for warning in &a.study.baseline.warnings {
        s.push_str(&format!("<p>{}</p>", escape(warning)));
    }
    s.push_str(&table(&a.study.baseline, None));
    for case in &a.study.cases {
        if let Outcome::Ok {
            subdivisions,
            profile,
            differences,
            ..
        } = case
        {
            for warning in &profile.warnings {
                s.push_str(&format!("<p>{subdivisions}分割: {}</p>", escape(warning)));
            }
            s.push_str(&format!("<h2>{subdivisions}分割・元測点の差</h2><table><tr><th>距離 m</th><th>水位差 m</th><th>水深差 m</th><th>流速差 m/s</th></tr>"));
            for d in differences {
                s.push_str(&format!(
                    "<tr><td>{}</td><td>{:.6e}</td><td>{:.6e}</td><td>{:.6e}</td></tr>",
                    d.chainage, d.water_change, d.depth_change, d.velocity_change
                ));
            }
            s.push_str(&format!(
                "</table><h2>{subdivisions}分割・全測点の計算結果</h2>"
            ));
            s.push_str(&table(profile, None));
        }
    }
    s.push_str(&format!("<h2>再現用JSON（保存時の条件・結果）</h2><p>保存結果を出力しています。再計算していません。</p><pre>{}</pre>",escape(&serde_json::to_string_pretty(a).unwrap())));
    s
}
