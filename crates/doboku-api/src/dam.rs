//! Independent dam inputs and append-only snapshots; never modifies river projects.
use crate::{
    compute, internal,
    report::{cell, escape},
    ApiError, ApiResult, AppState,
};
use axum::{
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::{Html, IntoResponse, Response},
    Json,
};
use doboku_core::{Error, ENGINE_VERSION};
use doboku_hydraulics::spillway::{self, Overflow, Spillway};
use doboku_structures::{GravityDam, Statics};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Conditions {
    pub name: String,
    pub dam: GravityDam,
    pub spillway: Spillway,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub conditions: Conditions,
    pub confirmed: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Run {
    pub engine_version: String,
    pub structural_model_version: String,
    pub hydraulic_model_version: String,
    pub executed_at: String,
    pub conditions: Conditions,
    pub statics: Statics,
    pub overflow: Overflow,
    pub note: String,
}
#[derive(Serialize)]
pub struct Stored {
    pub id: i64,
    pub run: Run,
}
#[derive(Serialize)]
pub struct Summary {
    id: i64,
    name: String,
    executed_at: String,
    upstream_depth_m: f64,
}
#[derive(Serialize)]
pub struct Page {
    items: Vec<Summary>,
    next_before: Option<i64>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Cursor {
    before: Option<i64>,
}

pub fn sample() -> Conditions {
    Conditions {
        name: "合成重力式ダム・予備照査".into(),
        dam: GravityDam {
            height_m: 30.0,
            crest_width_m: 5.0,
            base_width_m: 24.0,
            upstream_depth_m: 27.0,
            downstream_depth_m: 3.0,
            concrete_unit_weight_kn_m3: 24.0,
            water_unit_weight_kn_m3: 9.80665,
            friction_coefficient: 0.7,
        },
        spillway: Spillway {
            effective_width_m: 20.0,
            crest_elevation_m: 25.0,
            coefficient_m_half_s: 1.7,
        },
    }
}
pub fn initialize(db: &Connection) -> rusqlite::Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS dam_runs(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, executed_at TEXT NOT NULL, upstream_depth_m REAL NOT NULL, body TEXT NOT NULL);")
}
fn solve(c: Conditions) -> doboku_core::Result<Run> {
    if c.name.trim().is_empty() || c.name.len() > 200 {
        return Err(Error::Invalid("照査名は1〜200バイト".into()));
    }
    let statics = doboku_structures::solve(&c.dam)?;
    if c.spillway.crest_elevation_m > c.dam.height_m {
        return Err(Error::Invalid("越流頂は堤高以下で指定してください".into()));
    }
    let overflow = spillway::solve(
        &c.spillway,
        c.dam.upstream_depth_m,
        c.dam.downstream_depth_m,
    )?;
    Ok(Run {
        engine_version: ENGINE_VERSION.into(), structural_model_version: doboku_structures::MODEL_VERSION.into(), hydraulic_model_version: spillway::MODEL_VERSION.into(), executed_at: chrono::Utc::now().to_rfc3339(), conditions: c, statics, overflow,
        note: "構造は非越流部の台形剛体、容量は別の理想化した自由越流式。洪水吐部の荷重を連成評価していません。施設ギャラリーとは別条件、基礎面z=0の局所座標。例示値は設計推奨値ではありません。".into(),
    })
}
pub async fn create(State(s): State<AppState>, Json(r): Json<Request>) -> ApiResult<Json<Stored>> {
    if !r.confirmed {
        return Err(ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            "計算条件・適用範囲の確認が必要です".into(),
        ));
    }
    let run = compute(&s, move || solve(r.conditions)).await?;
    let body = serde_json::to_string(&run).map_err(|_| internal())?;
    let db = s.db.lock().map_err(|_| internal())?;
    db.execute(
        "INSERT INTO dam_runs(name,executed_at,upstream_depth_m,body) VALUES (?1,?2,?3,?4)",
        params![
            run.conditions.name,
            run.executed_at,
            run.conditions.dam.upstream_depth_m,
            body
        ],
    )
    .map_err(|_| internal())?;
    Ok(Json(Stored {
        id: db.last_insert_rowid(),
        run,
    }))
}
fn snapshot(s: &AppState, id: i64) -> ApiResult<Run> {
    let db = s.db.lock().map_err(|_| internal())?;
    let body: String = db
        .query_row("SELECT body FROM dam_runs WHERE id=?1", [id], |r| r.get(0))
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                ApiError(StatusCode::NOT_FOUND, "ダム照査履歴がありません".into())
            }
            _ => internal(),
        })?;
    serde_json::from_str(&body).map_err(|_| internal())
}
pub async fn load(State(s): State<AppState>, Path(id): Path<i64>) -> ApiResult<Json<Stored>> {
    Ok(Json(Stored {
        id,
        run: snapshot(&s, id)?,
    }))
}
pub async fn list(
    State(s): State<AppState>,
    Query(cursor): Query<Cursor>,
) -> ApiResult<Json<Page>> {
    let before = cursor.before.unwrap_or(i64::MAX);
    if before <= 0 {
        return Err(ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            "履歴カーソルは正の整数".into(),
        ));
    }
    let db = s.db.lock().map_err(|_| internal())?;
    let mut stmt = db.prepare("SELECT id,name,executed_at,upstream_depth_m FROM dam_runs WHERE id<?1 ORDER BY id DESC LIMIT 21").map_err(|_| internal())?;
    let mut items = stmt
        .query_map([before], |r| {
            Ok(Summary {
                id: r.get(0)?,
                name: r.get(1)?,
                executed_at: r.get(2)?,
                upstream_depth_m: r.get(3)?,
            })
        })
        .map_err(|_| internal())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| internal())?;
    let more = items.len() > 20;
    items.truncate(20);
    let next_before = if more {
        items.last().map(|s| s.id)
    } else {
        None
    };
    Ok(Json(Page { items, next_before }))
}
pub async fn csv(State(s): State<AppState>, Path(id): Path<i64>) -> ApiResult<Response> {
    Ok((
        [
            (header::CONTENT_TYPE, "text/csv; charset=utf-8"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=doboku-dam.csv",
            ),
        ],
        csv_report(&snapshot(&s, id)?),
    )
        .into_response())
}
pub async fn html(State(s): State<AppState>, Path(id): Path<i64>) -> ApiResult<Html<String>> {
    Ok(Html(html_report(&snapshot(&s, id)?)))
}

fn results(r: &Run) -> Vec<(&'static str, &'static str, Option<f64>)> {
    let s = &r.statics;
    vec![
        ("自由越流容量", "m³/s", Some(r.overflow.discharge_m3_s)),
        ("越流水頭", "m", Some(r.overflow.head_m)),
        ("断面積", "m²", Some(s.area_m2)),
        ("重心x", "m", Some(s.centroid_x_m)),
        ("重心z", "m", Some(s.centroid_z_m)),
        ("自重", "kN/m", Some(s.weight_kn_m)),
        ("上流水平力", "kN/m", Some(s.upstream_horizontal_kn_m)),
        ("下流水平力", "kN/m", Some(s.downstream_horizontal_kn_m)),
        ("下流鉛直力", "kN/m", Some(s.downstream_vertical_kn_m)),
        ("揚圧力", "kN/m", Some(s.uplift_kn_m)),
        ("揚圧合力x", "m", s.uplift_x_m),
        ("有効鉛直力", "kN/m", Some(s.effective_vertical_kn_m)),
        ("水平力差", "kN/m", Some(s.net_horizontal_kn_m)),
        ("抵抗モーメント", "kN·m/m", Some(s.resisting_moment_knm_m)),
        ("転倒モーメント", "kN·m/m", Some(s.overturning_moment_knm_m)),
        ("滑動比", "1", s.sliding_ratio),
        ("転倒比", "1", s.overturning_ratio),
        ("合力x", "m", s.resultant_x_m),
        ("偏心", "m", s.eccentricity_m),
        ("上流端接触圧", "kPa", s.heel_pressure_kpa),
        ("下流端接触圧", "kPa", s.toe_pressure_kpa),
    ]
}
fn csv_report(r: &Run) -> String {
    let mut out = String::from("\u{feff}engine_version,structural_model_version,hydraulic_model_version,executed_at,metric,unit,value,contact,conditions_json,warnings_json,note\r\n");
    let input = cell(&serde_json::to_string(&r.conditions).unwrap());
    let warnings =
        cell(&serde_json::to_string(&[&r.statics.warnings, &r.overflow.warnings]).unwrap());
    for (name, unit, value) in results(r) {
        out.push_str(&format!(
            "{},{},{},{},{},{},{},{},{input},{warnings},{}\r\n",
            cell(&r.engine_version),
            cell(&r.structural_model_version),
            cell(&r.hydraulic_model_version),
            cell(&r.executed_at),
            cell(name),
            cell(unit),
            value.map(|v| v.to_string()).unwrap_or_default(),
            cell(&format!("{:?}", r.statics.contact)),
            cell(&r.note)
        ));
    }
    out
}
fn html_report(r: &Run) -> String {
    let d = &r.conditions.dam;
    let scale = (440.0 / d.base_width_m).min(280.0 / d.height_m);
    let x = |v: f64| 130.0 + v * scale;
    let y = |v: f64| 350.0 - v * scale;
    let top = y(d.height_m);
    let mut out = format!("<!doctype html><html lang='ja'><meta charset='utf-8'><title>DobokuAI ダム予備照査</title><style>body{{font:14px system-ui;max-width:1000px;margin:35px auto;padding:20px;color:#203244}}table{{width:100%;border-collapse:collapse}}td,th{{padding:7px;border-bottom:1px solid #ddd;text-align:right}}pre{{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f6f8;padding:15px}}svg{{width:100%}}</style><h1>{} / 重力式ダム予備照査</h1><p>エンジン {} / 構造 {} / 水理 {} / 実行日時 {} (UTC)</p><p>{}</p><h2>断面図 / 基礎面 z=0・上流 x=0・m</h2><svg viewBox='0 0 760 430' role='img' aria-label='ダム断面図'><path d='M130 350 L{} 350 L{} {top} L130 {top} Z' fill='#b2bbc2' stroke='#425361'/><path d='M30 {} H130 M{} {} H720' fill='none' stroke='#168fbb' stroke-width='3'/><text x='30' y='410'>堤高 {} m / 底幅 {} m / 上流水深 {} m / 下流水深 {} m</text></svg><h2>数値結果 / 安全判定なし</h2><p>接触状態: {:?}。接触圧の空欄は適用範囲外、比率の空欄は分母0等の未定義を表します。</p><table><tr><th>項目</th><th>単位</th><th>値</th></tr>", escape(&r.conditions.name),escape(&r.engine_version),escape(&r.structural_model_version),escape(&r.hydraulic_model_version),escape(&r.executed_at),escape(&r.note), x(d.base_width_m),x(d.crest_width_m),y(d.upstream_depth_m),x(d.base_width_m-(d.base_width_m-d.crest_width_m)*d.downstream_depth_m/d.height_m),y(d.downstream_depth_m),d.height_m,d.base_width_m,d.upstream_depth_m,d.downstream_depth_m,r.statics.contact);
    for (name, unit, value) in results(r) {
        out.push_str(&format!(
            "<tr><td>{name}</td><td>{unit}</td><td>{}</td></tr>",
            value
                .map(|v| format!("{v:.8}"))
                .unwrap_or_else(|| "—".into())
        ));
    }
    out.push_str("</table><h2>計算方法と適用範囲</h2><p>Q=C L H^1.5。台形断面の自重、静水圧、上流→下流の全幅線形揚圧。滑動比=μN/(Pu−Pd)、転倒比=下流端まわりの抵抗/転倒モーメント。全幅接触時の圧=N/B(1±6e/B)。</p>");
    for warning in r.statics.warnings.iter().chain(&r.overflow.warnings) {
        out.push_str(&format!("<p>{}</p>", escape(warning)));
    }
    out.push_str(&format!(
        "<h2>計算条件</h2><pre>{}</pre><h2>再現用保存結果JSON</h2><pre>{}</pre>",
        escape(&serde_json::to_string_pretty(&r.conditions).unwrap()),
        escape(&serde_json::to_string_pretty(r).unwrap())
    ));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use http_body_util::BodyExt;
    use tower::ServiceExt;
    async fn request(
        app: axum::Router,
        method: &str,
        path: &str,
        body: serde_json::Value,
    ) -> (StatusCode, Vec<u8>) {
        let res = app
            .oneshot(
                axum::http::Request::builder()
                    .method(method)
                    .uri(path)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        (
            res.status(),
            res.into_body().collect().await.unwrap().to_bytes().to_vec(),
        )
    }
    #[tokio::test]
    async fn confirmed_server_result_roundtrip_exports_and_failure_no_save() {
        let state = crate::state(":memory:").unwrap();
        let app = crate::app(state.clone());
        let input = serde_json::json!({"conditions": sample(),"confirmed":false});
        assert_eq!(
            request(app.clone(), "POST", "/api/dams/runs", input)
                .await
                .0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
        let input = serde_json::json!({"conditions": sample(),"confirmed":true});
        let (status, body) = request(app.clone(), "POST", "/api/dams/runs", input.clone()).await;
        assert_eq!(status, StatusCode::OK);
        let saved: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let id = saved["id"].as_i64().unwrap();
        assert!(
            (saved["run"]["overflow"]["discharge_m3_s"].as_f64().unwrap() - 96.16652224137047)
                .abs()
                < 1e-10
        );
        let loaded = request(
            app.clone(),
            "GET",
            &format!("/api/dams/runs/{id}"),
            serde_json::Value::Null,
        )
        .await;
        assert_eq!(
            saved,
            serde_json::from_slice::<serde_json::Value>(&loaded.1).unwrap()
        );
        for format in ["csv", "html"] {
            let response = request(
                app.clone(),
                "GET",
                &format!("/api/dams/runs/{id}/reports/{format}"),
                serde_json::Value::Null,
            )
            .await;
            assert_eq!(response.0, StatusCode::OK);
            let text = String::from_utf8(response.1).unwrap();
            assert!(text.contains(saved["run"]["executed_at"].as_str().unwrap()));
            assert!(text.contains("gravity-static-1"));
        }
        let mut bad = input.clone();
        bad["conditions"]["dam"]["upstream_depth_m"] = 31.0.into();
        assert_eq!(
            request(app.clone(), "POST", "/api/dams/runs", bad).await.0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
        let mut bad = input.clone();
        bad["conditions"]["dam"]["downstream_depth_m"] = 25.0.into();
        assert_eq!(
            request(app.clone(), "POST", "/api/dams/runs", bad).await.0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
        let mut bad = input;
        bad["computed_result"] = 42.into();
        assert_eq!(
            request(app.clone(), "POST", "/api/dams/runs", bad).await.0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
        let db = state.db.lock().unwrap();
        assert_eq!(
            db.query_row("SELECT count(*) FROM dam_runs", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            db.query_row("SELECT count(*) FROM runs", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            db.query_row(
                "SELECT body FROM projects WHERE id='sample-river'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            serde_json::to_string(&doboku_core::sample()).unwrap()
        );
    }
    #[tokio::test]
    async fn persisted_conditions_results_and_exports_survive_database_reopen() {
        let root = std::env::temp_dir().join(format!(
            "doboku-dam-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap()
        ));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("state.sqlite");
        let original;
        let original_csv;
        let original_html;
        {
            let app = crate::app(crate::state(path.to_str().unwrap()).unwrap());
            let (status, body) = request(
                app.clone(),
                "POST",
                "/api/dams/runs",
                serde_json::json!({"conditions":sample(),"confirmed":true}),
            )
            .await;
            assert_eq!(status, StatusCode::OK);
            original = body;
            original_csv = request(
                app.clone(),
                "GET",
                "/api/dams/runs/1/reports/csv",
                serde_json::Value::Null,
            )
            .await
            .1;
            original_html = request(
                app,
                "GET",
                "/api/dams/runs/1/reports/html",
                serde_json::Value::Null,
            )
            .await
            .1;
        }
        let app = crate::app(crate::state(path.to_str().unwrap()).unwrap());
        assert_eq!(
            request(
                app.clone(),
                "GET",
                "/api/dams/runs/1",
                serde_json::Value::Null
            )
            .await
            .1,
            original
        );
        assert_eq!(
            request(
                app.clone(),
                "GET",
                "/api/dams/runs/1/reports/csv",
                serde_json::Value::Null
            )
            .await
            .1,
            original_csv
        );
        assert_eq!(
            request(
                app,
                "GET",
                "/api/dams/runs/1/reports/html",
                serde_json::Value::Null
            )
            .await
            .1,
            original_html
        );
        let text = String::from_utf8(original_csv).unwrap();
        let mut reader = csv::Reader::from_reader(text.trim_start_matches('\u{feff}').as_bytes());
        for row in reader.records() {
            let row = row.unwrap();
            assert_eq!(row.len(), 11);
            let restored: Conditions = serde_json::from_str(&row[8]).unwrap();
            assert_eq!(restored.dam, sample().dam);
        }
        std::fs::remove_dir_all(root).unwrap();
    }
    #[tokio::test]
    async fn history_cursor_and_partial_contact_report_remain_explicit() {
        let state = crate::state(":memory:").unwrap();
        let app = crate::app(state);
        let mut c = sample();
        c.dam.base_width_m = 15.0;
        let r = solve(c.clone()).unwrap();
        assert_ne!(r.statics.contact, doboku_structures::Contact::Full);
        assert!(r.statics.toe_pressure_kpa.is_none());
        assert!(html_report(&r).contains("部分接触"));
        for _ in 0..22 {
            assert_eq!(
                request(
                    app.clone(),
                    "POST",
                    "/api/dams/runs",
                    serde_json::json!({"conditions":c,"confirmed":true})
                )
                .await
                .0,
                StatusCode::OK
            );
        }
        let first = request(
            app.clone(),
            "GET",
            "/api/dams/runs",
            serde_json::Value::Null,
        )
        .await;
        let page: serde_json::Value = serde_json::from_slice(&first.1).unwrap();
        assert_eq!(page["items"].as_array().unwrap().len(), 20);
        let next = page["next_before"].as_i64().unwrap();
        let last = request(
            app.clone(),
            "GET",
            &format!("/api/dams/runs?before={next}"),
            serde_json::Value::Null,
        )
        .await;
        let page: serde_json::Value = serde_json::from_slice(&last.1).unwrap();
        assert_eq!(page["items"].as_array().unwrap().len(), 2);
        assert_eq!(
            request(
                app.clone(),
                "GET",
                "/api/dams/runs?before=0",
                serde_json::Value::Null
            )
            .await
            .0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
        assert_eq!(
            request(app, "GET", "/api/dams/runs/999", serde_json::Value::Null)
                .await
                .0,
            StatusCode::NOT_FOUND
        );
    }
}
