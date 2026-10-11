use axum::{
    extract::{DefaultBodyLimit, Path, State},
    http::{header, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use doboku_agent::{Action, CompatibleProvider, LocalRules, Proposal, Provider};
use doboku_core::{Error, Project, River, ENGINE_VERSION};
use doboku_hydraulics::{solve, Profile};
use doboku_planning::{evaluate_comparison, modify, Comparison, Scenario};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tokio::sync::Semaphore;
pub mod history;
mod provenance;
pub mod report;
pub mod resolution;
pub mod sensitivity;
pub mod sensitivity_history;
pub mod sensitivity_report;
pub mod survey;

#[derive(Clone)]
pub struct AppState {
    db: Arc<Mutex<Connection>>,
    slots: Arc<Semaphore>,
    pub llm: Option<Arc<CompatibleProvider>>,
}
pub fn state(path: &str) -> std::result::Result<AppState, rusqlite::Error> {
    let db = Connection::open(path)?;
    db.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, name TEXT NOT NULL, body TEXT NOT NULL);")?;
    history::initialize(&db)?;
    sensitivity_history::initialize(&db)?;
    let p = doboku_core::sample();
    db.execute(
        "INSERT OR IGNORE INTO projects(id,name,body) VALUES (?1,?2,?3)",
        params![
            p.id,
            p.name,
            serde_json::to_string(&p).expect("sample serializable")
        ],
    )?;
    Ok(AppState {
        db: Arc::new(Mutex::new(db)),
        slots: Arc::new(Semaphore::new(4)),
        llm: None,
    })
}
#[derive(Debug)]
pub struct ApiError(StatusCode, String);
impl From<Error> for ApiError {
    fn from(e: Error) -> Self {
        Self(StatusCode::UNPROCESSABLE_ENTITY, e.to_string())
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(serde_json::json!({"error":self.1}))).into_response()
    }
}
fn internal() -> ApiError {
    ApiError(StatusCode::INTERNAL_SERVER_ERROR, "内部エラー".into())
}
type ApiResult<T> = std::result::Result<T, ApiError>;

pub fn app(state: AppState) -> Router {
    Router::new()
        .route(
            "/api/health",
            get(|| async {
                Json(serde_json::json!({"status":"ok","engine_version":ENGINE_VERSION}))
            }),
        )
        .route("/api/sample", get(|| async { Json(doboku_core::sample()) }))
        .route("/api/projects", get(list_projects).post(save_project))
        .route("/api/projects/{id}", get(load_project))
        .route("/api/simulate", post(simulate))
        .route("/api/compare", post(compare))
        .route("/api/imports/survey/preview", post(survey::preview))
        .route("/api/imports/survey/apply", post(survey::apply))
        .route("/api/sensitivity", post(sensitivity::compare))
        .route("/api/resolution", post(resolution::compare))
        .route("/api/sensitivity/runs", post(sensitivity_history::create))
        .route(
            "/api/projects/{id}/sensitivity-runs",
            get(sensitivity_history::list),
        )
        .route("/api/sensitivity/runs/{id}", get(sensitivity_history::load))
        .route(
            "/api/sensitivity/runs/{id}/reports/html",
            get(sensitivity_history::html),
        )
        .route(
            "/api/sensitivity/runs/{id}/reports/csv",
            get(sensitivity_history::csv),
        )
        .route("/api/runs", post(history::create))
        .route("/api/projects/{id}/runs", get(history::list))
        .route("/api/runs/{id}", get(history::load))
        .route("/api/runs/{id}/reports/html", get(history::html))
        .route("/api/runs/{id}/reports/csv", get(history::csv))
        .route("/api/agent/propose", post(propose))
        .route("/api/agent/apply", post(apply))
        .route("/api/reports/html", post(html_report))
        .route("/api/reports/csv", post(csv_report))
        .layer(DefaultBodyLimit::max(262144))
        .with_state(state)
}
fn validate_project(p: &Project) -> ApiResult<()> {
    for label in [
        &p.reference.vertical_datum,
        &p.reference.horizontal_reference,
    ] {
        if label.trim().is_empty() || label.len() > 200 {
            return Err(Error::Invalid("基準高・座標参照の名称は1〜200バイト".into()).into());
        }
    }
    if let Some(source) = &p.reference.import {
        if let Some(data) = &source.dataset {
            provenance::validate(data)?;
        }
        if source.file_name.is_empty()
            || source.file_name.len() > 200
            || source.sha256.len() != 64
            || !source.sha256.chars().all(|c| c.is_ascii_hexdigit())
            || !matches!(source.elevation_mode.as_str(), "absolute" | "relative")
            || source.unit != "m"
            || chrono::DateTime::parse_from_rfc3339(&source.imported_at).is_err()
        {
            return Err(Error::Invalid("測量取込みの出典情報が不正です".into()).into());
        }
    }
    if p.id.is_empty()
        || p.id.len() > 80
        || !p
            .id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            "IDは英数字・ハイフン・アンダースコア、80文字以内".into(),
        ));
    }
    if p.name.trim().is_empty() || p.name.len() > 200 {
        return Err(ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            "プロジェクト名は1〜200バイト".into(),
        ));
    }
    doboku_hydraulics::validate(&p.river)?;
    if p.scenarios.len() > 6 {
        return Err(Error::Invalid("比較案は6件以内".into()).into());
    }
    let mut previous = p.river.clone();
    for s in &p.scenarios {
        if s.name.trim().is_empty() || s.name.len() > 200 {
            return Err(Error::Invalid("施工案名は1〜200バイト".into()).into());
        }
        previous = modify(if p.staged { &previous } else { &p.river }, &s.modification)?;
    }
    Ok(())
}
async fn list_projects(State(s): State<AppState>) -> ApiResult<Json<Vec<Project>>> {
    let db = s.db.lock().map_err(|_| internal())?;
    let mut stmt = db
        .prepare("SELECT body FROM projects ORDER BY name")
        .map_err(|_| internal())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|_| internal())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(serde_json::from_str(&row.map_err(|_| internal())?).map_err(|_| internal())?);
    }
    Ok(Json(out))
}
async fn load_project(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<Json<Project>> {
    let db = s.db.lock().map_err(|_| internal())?;
    let body = db
        .query_row("SELECT body FROM projects WHERE id=?1", [id], |r| {
            r.get::<_, String>(0)
        })
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                ApiError(StatusCode::NOT_FOUND, "プロジェクトがありません".into())
            }
            _ => internal(),
        })?;
    Ok(Json(serde_json::from_str(&body).map_err(|_| internal())?))
}
async fn save_project(
    State(s): State<AppState>,
    Json(p): Json<Project>,
) -> ApiResult<Json<Project>> {
    validate_project(&p)?;
    let db = s.db.lock().map_err(|_| internal())?;
    db.execute("INSERT INTO projects(id,name,body) VALUES (?1,?2,?3) ON CONFLICT(id) DO UPDATE SET name=excluded.name,body=excluded.body",params![p.id,p.name,serde_json::to_string(&p).map_err(|_|internal())?]).map_err(|_|internal())?;
    Ok(Json(p))
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Run {
    pub engine_version: String,
    pub executed_at: String,
    pub river: River,
    pub profile: Profile,
}
fn run(r: River) -> doboku_core::Result<Run> {
    let profile = solve(&r)?;
    Ok(Run {
        engine_version: ENGINE_VERSION.into(),
        executed_at: chrono::Utc::now().to_rfc3339(),
        river: r,
        profile,
    })
}
async fn compute<T: Send + 'static>(
    s: &AppState,
    f: impl FnOnce() -> doboku_core::Result<T> + Send + 'static,
) -> ApiResult<T> {
    let permit = s
        .slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| ApiError(StatusCode::TOO_MANY_REQUESTS, "計算が混雑しています".into()))?;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        f()
    })
    .await
    .map_err(|_| internal())?
    .map_err(Into::into)
}
async fn simulate(State(s): State<AppState>, Json(r): Json<River>) -> ApiResult<Json<Run>> {
    Ok(Json(compute(&s, move || run(r)).await?))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AnalysisRequest {
    pub project: Project,
    #[serde(default)]
    pub scenarios: Vec<Scenario>,
    #[serde(default)]
    pub staged: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Analysis {
    pub project: Project,
    pub run: Run,
    pub comparisons: Vec<Comparison>,
    pub staged: bool,
}
pub fn analyze(mut req: AnalysisRequest) -> doboku_core::Result<Analysis> {
    if req.scenarios.len() > 6 {
        return Err(Error::Invalid("比較案は6件以内".into()));
    }
    req.project.scenarios = req.scenarios.clone();
    req.project.staged = req.staged;
    let original = run(req.project.river.clone())?;
    let mut comparisons = Vec::new();
    let mut previous = req.project.river.clone();
    for scenario in req.scenarios {
        let changed = modify(
            if req.staged {
                &previous
            } else {
                &req.project.river
            },
            &scenario.modification,
        )?;
        let c = evaluate_comparison(
            &req.project.river,
            &original.profile,
            scenario,
            changed.clone(),
        )?;
        previous = changed;
        comparisons.push(c);
    }
    Ok(Analysis {
        project: req.project,
        run: original,
        comparisons,
        staged: req.staged,
    })
}
async fn compare(
    State(s): State<AppState>,
    Json(req): Json<AnalysisRequest>,
) -> ApiResult<Json<Analysis>> {
    validate_project(&req.project)?;
    Ok(Json(compute(&s, move || analyze(req)).await?))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Prompt {
    prompt: String,
    #[serde(default)]
    local: bool,
}
#[derive(Serialize)]
struct AgentResponse {
    proposal: Proposal,
    provider: String,
}
async fn propose(
    State(s): State<AppState>,
    Json(req): Json<Prompt>,
) -> ApiResult<Json<AgentResponse>> {
    let (proposal, provider) = if let Some(llm) = s.llm.filter(|_| !req.local) {
        (llm.propose(&req.prompt).await?, "LLM（型付き提案）")
    } else {
        (
            LocalRules.propose(&req.prompt).await?,
            "ローカルルール（APIキー不要）",
        )
    };
    Ok(Json(AgentResponse {
        proposal,
        provider: provider.into(),
    }))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ApplyRequest {
    project: Project,
    proposal: Proposal,
    confirmed: bool,
    #[serde(default)]
    scenarios: Vec<Scenario>,
    #[serde(default)]
    staged: bool,
}
#[derive(Serialize)]
struct Applied {
    project: Project,
    analysis: Analysis,
    report_requested: bool,
    history_id: i64,
}
async fn apply(
    State(s): State<AppState>,
    Json(req): Json<ApplyRequest>,
) -> ApiResult<Json<Applied>> {
    if !req.confirmed {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "提案の明示的確認が必要です".into(),
        ));
    }
    validate_project(&req.project)?;
    req.proposal.validate()?;
    let out = compute(&s, move || {
        let mut project = req.project;
        let mut scenarios = req.scenarios;
        let mut report_requested = false;
        for action in req.proposal.actions {
            match action {
                Action::SetDischarge { value } => project.river.discharge = value,
                Action::CreateReport => report_requested = true,
                a => scenarios.push(Scenario {
                    name: match a {
                        Action::CompareRoughness { value } => format!("粗度 {value}"),
                        Action::CompareExcavation { depth } => format!("掘削 {depth} m"),
                        _ => unreachable!(),
                    },
                    modification: a.modification().unwrap(),
                }),
            }
        }
        let analysis = analyze(AnalysisRequest {
            project: project.clone(),
            scenarios,
            staged: req.staged,
        })?;
        Ok(Applied {
            project: analysis.project.clone(),
            analysis,
            report_requested,
            history_id: 0,
        })
    })
    .await?;
    let mut out = out;
    validate_project(&out.analysis.project)?;
    out.history_id = history::save(&s, &out.analysis)?;
    Ok(Json(out))
}
async fn html_report(
    State(s): State<AppState>,
    Json(req): Json<AnalysisRequest>,
) -> ApiResult<Html<String>> {
    validate_project(&req.project)?;
    Ok(Html(
        compute(&s, move || Ok(report::html(&analyze(req)?))).await?,
    ))
}
async fn csv_report(
    State(s): State<AppState>,
    Json(req): Json<AnalysisRequest>,
) -> ApiResult<Response> {
    validate_project(&req.project)?;
    let csv = compute(&s, move || Ok(report::csv(&analyze(req)?))).await?;
    Ok((
        [
            (header::CONTENT_TYPE, "text/csv; charset=utf-8"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=doboku-results.csv",
            ),
        ],
        csv,
    )
        .into_response())
}
