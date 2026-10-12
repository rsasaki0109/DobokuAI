use crate::{compute, ApiResult, AppState};
use axum::{extract::State, Json};
use doboku_core::{River, ENGINE_VERSION};
use doboku_hydraulics::diagnostics::RiverCheck;
use serde::Serialize;

#[derive(Serialize)]
pub struct Diagnosis {
    river: River,
    engine_version: &'static str,
    checked_at: String,
    #[serde(flatten)]
    checks: RiverCheck,
}

pub async fn inspect(
    State(state): State<AppState>,
    Json(river): Json<River>,
) -> ApiResult<Json<Diagnosis>> {
    let snapshot = river.clone();
    let checks = compute(&state, move || {
        doboku_hydraulics::diagnostics::inspect(&river)
    })
    .await?;
    Ok(Json(Diagnosis {
        river: snapshot,
        engine_version: ENGINE_VERSION,
        checked_at: chrono::Utc::now().to_rfc3339(),
        checks,
    }))
}
