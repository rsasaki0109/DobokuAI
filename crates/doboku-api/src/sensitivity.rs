//! Each sensitivity case uses the same original geometry and boundary.
use crate::{compute, run, validate_project, ApiResult, AppState, Run};
use axum::{extract::State, Json};
use doboku_core::{Error, Project};
use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize)]
#[serde(tag = "parameter", rename_all = "snake_case", deny_unknown_fields)]
pub enum Change {
    Discharge { value: f64 },
    Roughness { value: f64 },
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    project: Project,
    cases: Vec<Change>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum Outcome {
    Ok {
        change: Change,
        run: Run,
        max_water_change: f64,
    },
    Failed {
        change: Change,
        error: String,
    },
}
#[derive(Clone, Deserialize, Serialize)]
pub struct Response {
    pub project: Project,
    pub baseline: Run,
    pub cases: Vec<Outcome>,
    pub note: String,
}
pub async fn compare(
    State(s): State<AppState>,
    Json(req): Json<Request>,
) -> ApiResult<Json<Response>> {
    Ok(Json(calculate(&s, req).await?))
}
pub(super) async fn calculate(s: &AppState, req: Request) -> ApiResult<Response> {
    let mut base_project = req.project.clone();
    base_project.scenarios.clear();
    base_project.staged = false;
    validate_project(&base_project)?;
    if !(1..=8).contains(&req.cases.len()) {
        return Err(Error::Invalid("感度比較は1〜8条件".into()).into());
    }
    compute(s, move || {
        let baseline = run(req.project.river.clone())?;
        let cases = req.cases.into_iter().map(|change| {
            let mut river = req.project.river.clone();
            match change {Change::Discharge{value} => river.discharge = value, Change::Roughness{value} => river.stations.iter_mut().for_each(|st| st.roughness = value)}
            match run(river) {
                Ok(run) => {
                    let max_water_change = run.profile.rows.iter().zip(&baseline.profile.rows).map(|(a,b)| a.water_elevation-b.water_elevation).max_by(|a,b| a.abs().total_cmp(&b.abs())).unwrap_or(0.0);
                    Outcome::Ok {change, run, max_water_change}
                },
                Err(e) => Outcome::Failed {change, error: e.to_string()},
            }
        }).collect();
        Ok(Response {project: req.project, baseline, cases, note: "基本断面・基準高・境界水深は固定。各案を基本条件から独立に計算し、粗度の指定は全断面を置換します。施工案はこの比較に適用しません。失敗案の数値は生成しません。".into()})
    }).await
}
