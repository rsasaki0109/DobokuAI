//! Append-only resolution snapshots; exports and loads never invoke the solver.
use crate::{internal, resolution, resolution_report, ApiError, ApiResult, AppState};
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
        "CREATE TABLE IF NOT EXISTS resolution_runs(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        project_name TEXT NOT NULL,
        executed_at TEXT NOT NULL,
        engine_version TEXT NOT NULL,
        case_count INTEGER NOT NULL,
        failed_count INTEGER NOT NULL,
        body TEXT NOT NULL
    ); CREATE INDEX IF NOT EXISTS resolution_project_id ON resolution_runs(project_id,id);",
    )
}

#[derive(Serialize)]
pub struct StoredComparison {
    pub id: i64,
    pub comparison: resolution::Response,
}
#[derive(Serialize)]
pub struct Summary {
    id: i64,
    project_name: String,
    executed_at: String,
    engine_version: String,
    case_count: usize,
    failed_count: usize,
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

pub async fn create(
    State(s): State<AppState>,
    Json(req): Json<resolution::Request>,
) -> ApiResult<Json<StoredComparison>> {
    let comparison = resolution::calculate(&s, req).await?;
    let failed = comparison
        .study
        .cases
        .iter()
        .filter(|c| matches!(c, doboku_hydraulics::resolution::Outcome::Failed { .. }))
        .count();
    let body = serde_json::to_string(&comparison).map_err(|_| internal())?;
    let db = s.db.lock().map_err(|_| internal())?;
    db.execute("INSERT INTO resolution_runs(project_id,project_name,executed_at,engine_version,case_count,failed_count,body) VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![comparison.project.id, comparison.project.name, comparison.executed_at, comparison.engine_version, comparison.study.cases.len(), failed, body]).map_err(|_| internal())?;
    Ok(Json(StoredComparison {
        id: db.last_insert_rowid(),
        comparison,
    }))
}
pub(super) fn snapshot(s: &AppState, id: i64) -> ApiResult<resolution::Response> {
    let db = s.db.lock().map_err(|_| internal())?;
    let body: String = db
        .query_row("SELECT body FROM resolution_runs WHERE id=?1", [id], |r| {
            r.get(0)
        })
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                ApiError(StatusCode::NOT_FOUND, "測点間隔比較履歴がありません".into())
            }
            _ => internal(),
        })?;
    serde_json::from_str(&body).map_err(|_| internal())
}
pub async fn load(
    State(s): State<AppState>,
    Path(id): Path<i64>,
) -> ApiResult<Json<StoredComparison>> {
    Ok(Json(StoredComparison {
        id,
        comparison: snapshot(&s, id)?,
    }))
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
    let mut statement = db.prepare("SELECT id,project_name,executed_at,engine_version,case_count,failed_count FROM resolution_runs WHERE project_id=?1 AND id<?2 ORDER BY id DESC LIMIT 21").map_err(|_| internal())?;
    let mut items = statement
        .query_map(params![project_id, before], |r| {
            Ok(Summary {
                id: r.get(0)?,
                project_name: r.get(1)?,
                executed_at: r.get(2)?,
                engine_version: r.get(3)?,
                case_count: r.get(4)?,
                failed_count: r.get(5)?,
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
pub async fn html(State(s): State<AppState>, Path(id): Path<i64>) -> ApiResult<Html<String>> {
    Ok(Html(resolution_report::html(&snapshot(&s, id)?)))
}
pub async fn csv(State(s): State<AppState>, Path(id): Path<i64>) -> ApiResult<Response> {
    Ok((
        [
            (header::CONTENT_TYPE, "text/csv; charset=utf-8"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=doboku-resolution.csv",
            ),
        ],
        resolution_report::csv(&snapshot(&s, id)?),
    )
        .into_response())
}
