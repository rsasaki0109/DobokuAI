//! Append-only server-computed snapshots. Loading/exporting never runs the solver.
use crate::{
    analyze, compute, internal, report, validate_project, Analysis, AnalysisRequest, ApiError,
    ApiResult, AppState,
};
use axum::{
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::{Html, IntoResponse, Response},
    Json,
};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

pub fn initialize(db: &Connection) -> rusqlite::Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS runs(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        project_name TEXT NOT NULL,
        executed_at TEXT NOT NULL,
        engine_version TEXT NOT NULL,
        discharge REAL NOT NULL,
        station_count INTEGER NOT NULL,
        scenario_count INTEGER NOT NULL,
        staged INTEGER NOT NULL,
        body TEXT NOT NULL
    ); CREATE INDEX IF NOT EXISTS runs_project_id ON runs(project_id,id);",
    )
}

#[derive(Serialize)]
pub struct StoredAnalysis {
    pub id: i64,
    pub analysis: Analysis,
}
#[derive(Serialize)]
pub struct Summary {
    id: i64,
    project_id: String,
    project_name: String,
    executed_at: String,
    engine_version: String,
    discharge: f64,
    station_count: usize,
    scenario_count: usize,
    staged: bool,
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

pub(super) fn save(s: &AppState, a: &Analysis) -> ApiResult<i64> {
    let body = serde_json::to_string(a).map_err(|_| internal())?;
    let db = s.db.lock().map_err(|_| internal())?;
    db.execute("INSERT INTO runs(project_id,project_name,executed_at,engine_version,discharge,station_count,scenario_count,staged,body) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![a.project.id, a.project.name, a.run.executed_at, a.run.engine_version, a.run.river.discharge, a.run.profile.rows.len(), a.comparisons.len(), a.staged, body]).map_err(|_| internal())?;
    Ok(db.last_insert_rowid())
}
pub(super) fn snapshot(s: &AppState, id: i64) -> ApiResult<Analysis> {
    let db = s.db.lock().map_err(|_| internal())?;
    let body: String = db
        .query_row("SELECT body FROM runs WHERE id=?1", [id], |row| row.get(0))
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                ApiError(StatusCode::NOT_FOUND, "計算履歴がありません".into())
            }
            _ => internal(),
        })?;
    serde_json::from_str(&body).map_err(|_| internal())
}
pub async fn create(
    State(s): State<AppState>,
    Json(mut req): Json<AnalysisRequest>,
) -> ApiResult<Json<StoredAnalysis>> {
    req.project.scenarios = req.scenarios.clone();
    req.project.staged = req.staged;
    validate_project(&req.project)?;
    let analysis = compute(&s, move || analyze(req)).await?;
    let id = save(&s, &analysis)?;
    Ok(Json(StoredAnalysis { id, analysis }))
}
pub async fn list(
    State(s): State<AppState>,
    Path(project_id): Path<String>,
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
    let mut statement = db.prepare("SELECT id,project_id,project_name,executed_at,engine_version,discharge,station_count,scenario_count,staged FROM runs WHERE project_id=?1 AND id<?2 ORDER BY id DESC LIMIT 21").map_err(|_| internal())?;
    let mut items = statement
        .query_map(params![project_id, before], |r| {
            Ok(Summary {
                id: r.get(0)?,
                project_id: r.get(1)?,
                project_name: r.get(2)?,
                executed_at: r.get(3)?,
                engine_version: r.get(4)?,
                discharge: r.get(5)?,
                station_count: r.get(6)?,
                scenario_count: r.get(7)?,
                staged: r.get(8)?,
            })
        })
        .map_err(|_| internal())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| internal())?;
    let has_more = items.len() > 20;
    items.truncate(20);
    let next_before = if has_more {
        items.last().map(|r| r.id)
    } else {
        None
    };
    Ok(Json(Page { items, next_before }))
}
pub async fn load(
    State(s): State<AppState>,
    Path(id): Path<i64>,
) -> ApiResult<Json<StoredAnalysis>> {
    Ok(Json(StoredAnalysis {
        id,
        analysis: snapshot(&s, id)?,
    }))
}
pub async fn html(State(s): State<AppState>, Path(id): Path<i64>) -> ApiResult<Html<String>> {
    Ok(Html(report::html(&snapshot(&s, id)?)))
}
pub async fn csv(State(s): State<AppState>, Path(id): Path<i64>) -> ApiResult<Response> {
    Ok((
        [
            (header::CONTENT_TYPE, "text/csv; charset=utf-8"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=doboku-results.csv",
            ),
        ],
        report::csv(&snapshot(&s, id)?),
    )
        .into_response())
}
