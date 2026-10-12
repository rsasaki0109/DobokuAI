use axum::{
    body::Body,
    http::{Request, StatusCode},
    Router,
};
use doboku_api::{app, state};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    io::Write,
    process::{Command, Stdio},
};
use tower::ServiceExt;

async fn call(api: Router, method: &str, path: &str, value: Value) -> (StatusCode, String) {
    let response = api
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header("content-type", "application/json")
                .body(Body::from(value.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    (
        response.status(),
        String::from_utf8(
            response
                .into_body()
                .collect()
                .await
                .unwrap()
                .to_bytes()
                .to_vec(),
        )
        .unwrap(),
    )
}

fn source(unit: &str, absolute: bool) -> Value {
    let mut csv = format!(
        "station,chainage_{unit},bed_elevation_{unit},roughness,x_{unit},elevation_{unit}\n"
    );
    for (id, chainage, bed) in [("U", 0., 3937.), ("D", 3937., 3936.)] {
        for (x, z) in [
            (-7874., 29.5275),
            (-3937., 0.),
            (3937., 0.),
            (7874., 29.5275),
        ] {
            csv.push_str(&format!(
                "{id},{chainage},{bed},.03,{x},{}\n",
                if absolute { bed + z } else { z }
            ));
        }
    }
    json!({"csv":csv,"file_name":"synthetic-foot.csv","elevation_mode":if absolute {"absolute"} else {"relative"},
        "unit":unit,"vertical_datum":"合成の共通基準高","horizontal_reference":"合成の局所距離",
        "dataset":{"data_kind":"synthetic","processing":"単位の合成照査、実測ではない"}})
}

async fn preview(api: Router, input: Value) -> Value {
    let (status, response) = call(api, "POST", "/api/imports/survey/preview", input).await;
    assert_eq!(status, StatusCode::OK);
    serde_json::from_str(&response).unwrap()
}

#[tokio::test]
async fn survey_foot_definitions_have_distinct_known_metric_lengths() {
    let api = app(state(":memory:").unwrap());
    for absolute in [false, true] {
        let us = preview(api.clone(), source("us_survey_ft", absolute)).await;
        let ft = preview(api.clone(), source("ft", absolute)).await;
        let m = preview(api.clone(), source("m", absolute)).await;
        for p in [&us, &ft, &m] {
            assert_eq!(p["valid"], true, "{p}");
        }
        let length = |p: &Value| p["stations"][1]["chainage"].as_f64().unwrap();
        assert!((length(&us) - 1200.).abs() < 1e-10);
        assert!((length(&ft) - 1199.9976).abs() < 1e-10);
        assert_eq!(length(&m), 3937.);
        assert!((length(&us) - length(&ft) - 0.0024).abs() < 1e-10);
        assert_eq!(us["stations"][0]["roughness"], 0.03);
        assert!((us["stations"][0]["bed_elevation"].as_f64().unwrap() - 1200.).abs() < 1e-10);
        let points = us["stations"][0]["section"]["points"].as_array().unwrap();
        assert_eq!(points.len(), 4);
        assert!((points[0]["x"].as_f64().unwrap() + 2400.).abs() < 1e-10);
        assert!((points[0]["z"].as_f64().unwrap() - 9.).abs() < 1e-10);
        assert_eq!(points[1]["z"], 0.);
        assert_eq!(us["reference"]["import"]["unit"], "us_survey_ft");
    }
}

#[tokio::test]
async fn native_inconsistency_and_negative_height_are_not_hidden_by_unit_underflow() {
    let api = app(state(":memory:").unwrap());
    let mut inconsistent = source("us_survey_ft", false);
    inconsistent["csv"] =
        json!(inconsistent["csv"]
            .as_str()
            .unwrap()
            .replacen("U,0,3937", "U,5e-324,3937", 1));
    let result = preview(api.clone(), inconsistent).await;
    assert_eq!(
        result["valid"], false,
        "Native unequal chainages must not become equal by underflow"
    );
    let mut negative = source("us_survey_ft", false);
    negative["csv"] =
        json!(negative["csv"]
            .as_str()
            .unwrap()
            .replacen(".03,-3937,0", ".03,-3937,-5e-324", 1));
    assert_eq!(preview(api, negative).await["valid"], false);
}

#[tokio::test]
async fn unit_header_mismatch_unknown_unit_and_stale_confirmation_are_rejected() {
    let api = app(state(":memory:").unwrap());
    let original = source("us_survey_ft", false);
    let old = preview(api.clone(), original.clone()).await;
    let mut mismatch = original.clone();
    mismatch["unit"] = json!("m");
    let refused = preview(api.clone(), mismatch).await;
    assert_eq!(refused["valid"], false);
    assert_eq!(refused["geometry"], Value::Null);
    assert_eq!(refused["review_token"], Value::Null);
    let mut unknown = original;
    unknown["unit"] = json!("feet");
    assert_eq!(preview(api.clone(), unknown).await["valid"], false);
    let changed = source("ft", false);
    let current = preview(api.clone(), changed.clone()).await;
    assert_ne!(old["review_token"], current["review_token"]);
    let project = serde_json::to_value(doboku_core::sample()).unwrap();
    let (status, _) = call(
        api,
        "POST",
        "/api/imports/survey/apply",
        json!({"source":changed,"project":project,
        "confirmed":true,"review_token":old["review_token"]}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn survey_original_units_survive_saved_si_calculation_and_reports() {
    let api = app(state(":memory:").unwrap());
    let input = source("us_survey_ft", true);
    let inspected = preview(api.clone(), input.clone()).await;
    let original = serde_json::to_value(doboku_core::sample()).unwrap();
    let (status, response) = call(
        api.clone(),
        "POST",
        "/api/imports/survey/apply",
        json!({"source":input,"project":original,
        "confirmed":true,"review_token":inspected["review_token"]}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{response}");
    let mut project: Value = serde_json::from_str(&response).unwrap();
    project["id"] = json!("synthetic-us-foot");
    assert_eq!(
        project["river"]["discharge"],
        original["river"]["discharge"]
    );
    assert_eq!(project["river"]["boundary"], original["river"]["boundary"]);
    assert_eq!(
        project["river"]["normal_slope"],
        original["river"]["normal_slope"]
    );
    assert!(project["scenarios"].as_array().unwrap().is_empty());
    let sha = format!(
        "{:x}",
        Sha256::digest(input["csv"].as_str().unwrap().as_bytes())
    );
    assert_eq!(project["reference"]["import"]["sha256"], sha);
    assert_eq!(
        call(api.clone(), "POST", "/api/projects", project.clone())
            .await
            .0,
        StatusCode::OK
    );
    let (_, loaded) = call(
        api.clone(),
        "GET",
        "/api/projects/synthetic-us-foot",
        Value::Null,
    )
    .await;
    assert_eq!(serde_json::from_str::<Value>(&loaded).unwrap(), project);
    let (status, response) = call(
        api.clone(),
        "POST",
        "/api/runs",
        json!({"project":project,"scenarios":[],"staged":false}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{response}");
    let stored: Value = serde_json::from_str(&response).unwrap();
    let id = stored["id"].as_i64().unwrap();
    assert_eq!(
        stored["analysis"]["project"]["reference"]["import"]["unit"],
        "us_survey_ft"
    );
    assert!(
        (stored["analysis"]["run"]["profile"]["rows"][1]["chainage"]
            .as_f64()
            .unwrap()
            - 1200.)
            .abs()
            < 1e-10
    );
    let (_, reopened) = call(api.clone(), "GET", &format!("/api/runs/{id}"), Value::Null).await;
    assert_eq!(serde_json::from_str::<Value>(&reopened).unwrap(), stored);
    for suffix in ["csv", "html"] {
        let (status, report) = call(
            api.clone(),
            "GET",
            &format!("/api/runs/{id}/reports/{suffix}"),
            Value::Null,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(report.contains("us_survey_ft"));
    }
    // Independent Python geometry/energy audit consumes the actual exported ZIP.
    let response = api
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/review-packs/zip")
                .header("content-type", "application/json")
                .body(Body::from(json!({"run_id":id}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let script =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../scripts/audit-review-pack.py");
    let mut child = Command::new("python3").args(["-c", "import sys,tempfile,pathlib,json,importlib.util; spec=importlib.util.spec_from_file_location('audit',sys.argv[1]); audit=importlib.util.module_from_spec(spec); spec.loader.exec_module(audit); d=tempfile.TemporaryDirectory(); p=pathlib.Path(d.name)/'pack.zip'; p.write_bytes(sys.stdin.buffer.read()); print(json.dumps(audit.audit(p)))"])
        .arg(script).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
    child.stdin.take().unwrap().write_all(&bytes).unwrap();
    let result = child.wait_with_output().unwrap();
    assert!(result.status.success());
    let audited: Value = serde_json::from_slice(&result.stdout).unwrap();
    assert_eq!(audited["passed"], true, "{audited}");
    assert_eq!(audited["profiles"][0]["rows"], 2);
}
