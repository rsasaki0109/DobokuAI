use crate::{compute, ApiResult, AppState};
use axum::{extract::State, Json};
use doboku_core::{Error, ENGINE_VERSION};
use doboku_earthwork::grading::{self, GradingAreas, LinearProfile};
use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Conditions {
    pub target_elevation_m: f64,
    pub east_west: LinearProfile,
    pub south_north: LinearProfile,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub confirmed: bool,
    pub conditions: Conditions,
}
#[derive(Serialize)]
pub struct Run {
    pub engine_version: &'static str,
    pub model_version: &'static str,
    pub executed_at: String,
    pub conditions: Conditions,
    pub east_west: GradingAreas,
    pub south_north: GradingAreas,
    pub volume_m3: Option<f64>,
}
pub async fn inspect(
    State(state): State<AppState>,
    Json(request): Json<Request>,
) -> ApiResult<Json<Run>> {
    if !request.confirmed {
        return Err(
            Error::Invalid("計画標高・断面条件を確認してから計算してください".into()).into(),
        );
    }
    let conditions = request.conditions;
    let captured = conditions.clone();
    let (east_west, south_north) = compute(&state, move || {
        Ok((
            grading::evaluate(&captured.east_west, captured.target_elevation_m)?,
            grading::evaluate(&captured.south_north, captured.target_elevation_m)?,
        ))
    })
    .await?;
    Ok(Json(Run {
        engine_version: ENGINE_VERSION,
        model_version: grading::MODEL_VERSION,
        executed_at: chrono::Utc::now().to_rfc3339(),
        conditions,
        east_west,
        south_north,
        volume_m3: None,
    }))
}

#[cfg(test)]
mod tests {
    use axum::{
        body::Body,
        http::{header, Request, StatusCode},
    };
    use http_body_util::BodyExt;
    use tower::ServiceExt;
    async fn send(app: axum::Router, input: serde_json::Value) -> (StatusCode, serde_json::Value) {
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/earthwork/linear-grading")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(input.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
        )
    }
    fn request() -> serde_json::Value {
        let p = serde_json::json!({"length_m":10.0,"spans":[{"start_m":0.0,"end_m":10.0,"ground":{"status":"unique","start_elevation_m":99.0,"end_elevation_m":103.0}}],"unresolved_points_m":[]});
        serde_json::json!({"confirmed":true,"conditions":{"target_elevation_m":100.0,"east_west":p,"south_north":p}})
    }
    #[tokio::test]
    async fn confirmed_run_records_inputs_version_and_time_without_project_or_history_writes() {
        let state = crate::state(":memory:").unwrap();
        let app = crate::app(state.clone());
        let original: String = state
            .db
            .lock()
            .unwrap()
            .query_row(
                "SELECT body FROM projects WHERE id='sample-river'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let input = request();
        let (status, run) = send(app, input.clone()).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(run["conditions"], input["conditions"]);
        assert_eq!(run["east_west"]["cut_area_m2"], 11.25);
        assert_eq!(run["south_north"]["fill_area_m2"], 1.25);
        assert_eq!(run["engine_version"], doboku_core::ENGINE_VERSION);
        assert_eq!(
            run["model_version"],
            doboku_earthwork::grading::MODEL_VERSION
        );
        assert!(chrono::DateTime::parse_from_rfc3339(run["executed_at"].as_str().unwrap()).is_ok());
        assert!(run["volume_m3"].is_null());
        let current: String = state
            .db
            .lock()
            .unwrap()
            .query_row(
                "SELECT body FROM projects WHERE id='sample-river'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(original, current);
        let history_count: i64 = state
            .db
            .lock()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM runs", [], |row| row.get(0))
            .unwrap();
        assert_eq!(history_count, 0);
    }
    #[tokio::test]
    async fn rejects_unconfirmed_malformed_inputs_and_retains_partial_unknown_results() {
        let app = crate::app(crate::state(":memory:").unwrap());
        let mut input = request();
        input["confirmed"] = false.into();
        assert_eq!(
            send(app.clone(), input).await.0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
        let mut input = request();
        input["conditions"]["east_west"]["spans"][0]["start_m"] = 0.0000001.into();
        assert_eq!(
            send(app.clone(), input).await.0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
        let mut input = request();
        input["conditions"]["east_west"]["spans"][0]["ground"] =
            serde_json::json!({"status":"ambiguous"});
        let (status, run) = send(app, input).await;
        assert_eq!(status, StatusCode::OK);
        assert!(run["east_west"]["cut_area_m2"].is_null());
        assert_eq!(run["east_west"]["ambiguous_length_m"], 10.0);
        assert_eq!(run["east_west"]["known_cut_area_m2"], 0.0);
        assert_eq!(run["south_north"]["cut_area_m2"], 11.25);
    }
}
