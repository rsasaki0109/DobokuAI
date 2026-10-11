use crate::{compute, validate_project, ApiResult, AppState};
use axum::{extract::State, Json};
use doboku_core::{Error, Project, ENGINE_VERSION};
use doboku_hydraulics::resolution::{study, Study, METHOD};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    project: Project,
    confirmed_interpolation: bool,
}
#[derive(Serialize, Deserialize)]
pub struct Response {
    pub project: Project,
    pub engine_version: String,
    pub executed_at: String,
    pub study: Study,
    pub note: String,
}

pub async fn compare(
    State(s): State<AppState>,
    Json(req): Json<Request>,
) -> ApiResult<Json<Response>> {
    Ok(Json(calculate(&s, req).await?))
}

pub async fn calculate(s: &AppState, req: Request) -> ApiResult<Response> {
    if !req.confirmed_interpolation {
        return Err(Error::Invalid("測点間の補間条件を確認してください".into()).into());
    }
    let mut base = req.project.clone();
    base.scenarios.clear();
    base.staged = false;
    validate_project(&base)?;
    compute(s, move || {
        let result = study(&req.project.river)?;
        Ok(Response {
            project: req.project,
            engine_version: ENGINE_VERSION.into(),
            executed_at: chrono::Utc::now().to_rfc3339(),
            study: result,
            note: METHOD.into(),
        })
    })
    .await
}
