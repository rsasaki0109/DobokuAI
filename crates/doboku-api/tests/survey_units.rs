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

#[test]
fn legacy_import_metadata_round_trips_without_new_fields() {
    let old = r#"{"file_name":"survey.csv","sha256":"old","imported_at":"2026-10-12T00:00:00Z","elevation_mode":"absolute","unit":"m","dataset":null}"#;
    let imported: doboku_core::ImportProvenance = serde_json::from_str(old).unwrap();
    assert!(imported.vertical_unit.is_none());
    assert_eq!(serde_json::to_string(&imported).unwrap(), old);
    let mut mixed = imported;
    mixed.vertical_unit = Some("us_survey_ft".into());
    let encoded = serde_json::to_string(&mixed).unwrap();
    let decoded: doboku_core::ImportProvenance = serde_json::from_str(&encoded).unwrap();
    assert_eq!(decoded.unit, "m");
    assert_eq!(decoded.vertical_unit.as_deref(), Some("us_survey_ft"));
}

#[tokio::test]
async fn mixed_units_and_original_reports_survive_online_backup_and_restored_api() {
    let root = std::env::temp_dir().join(format!(
        "doboku-mixed-units-{}-{}",
        std::process::id(),
        chrono::Utc::now().timestamp_nanos_opt().unwrap()
    ));
    std::fs::create_dir(&root).unwrap();
    let live = root.join("live.sqlite");
    let api = app(state(live.to_str().unwrap()).unwrap());
    let input = mixed_source("m", "us_survey_ft", true);
    let inspected = preview(api.clone(), input.clone()).await;
    let (status, text) = call(
        api.clone(),
        "POST",
        "/api/imports/survey/apply",
        json!({"source":input,
        "project":doboku_core::sample(),"confirmed":true,"review_token":inspected["review_token"]}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{text}");
    let project: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(
        call(api.clone(), "POST", "/api/projects", project.clone())
            .await
            .0,
        StatusCode::OK
    );
    let (status, text) = call(
        api.clone(),
        "POST",
        "/api/runs",
        json!({"project":project,"scenarios":[],"staged":false}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{text}");
    let stored: Value = serde_json::from_str(&text).unwrap();
    let url = format!("/api/runs/{}", stored["id"]);
    let mut reports = Vec::new();
    for suffix in ["csv", "html"] {
        let (status, report) = call(
            api.clone(),
            "GET",
            &format!("{url}/reports/{suffix}"),
            Value::Null,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        reports.push(report);
    }
    let script = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../scripts/database.py");
    let backup = root.join("backup.sqlite");
    let restored = root.join("restored.sqlite");
    for (operation, from, to) in [("backup", &live, &backup), ("restore", &backup, &restored)] {
        let output = Command::new("python3")
            .arg(&script)
            .args([operation, "--source"])
            .arg(from)
            .arg("--destination")
            .arg(to)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    let mut edited = project.clone();
    edited["river"]["discharge"] = json!(110.);
    edited["reference"]["import"]["vertical_unit"] = json!("m");
    assert_eq!(
        call(api.clone(), "POST", "/api/projects", edited).await.0,
        StatusCode::OK
    );
    drop(api);
    let restored_api = app(state(restored.to_str().unwrap()).unwrap());
    let (status, text) = call(
        restored_api.clone(),
        "GET",
        "/api/projects/sample-river",
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(serde_json::from_str::<Value>(&text).unwrap(), project);
    let (_, text) = call(restored_api.clone(), "GET", &url, Value::Null).await;
    assert_eq!(serde_json::from_str::<Value>(&text).unwrap(), stored);
    for (suffix, original) in ["csv", "html"].iter().zip(reports) {
        assert_eq!(
            call(
                restored_api.clone(),
                "GET",
                &format!("{url}/reports/{suffix}"),
                Value::Null
            )
            .await,
            (StatusCode::OK, original)
        );
    }
    drop(restored_api);
    std::fs::remove_dir_all(root).unwrap();
}

fn mixed_source(distance_unit: &str, height_unit: &str, absolute: bool) -> Value {
    let mut input = source(distance_unit, absolute);
    input["vertical_unit"] = json!(height_unit);
    input["csv"] = json!(input["csv"]
        .as_str()
        .unwrap()
        .replace(
            &format!("bed_elevation_{distance_unit}"),
            &format!("bed_elevation_{height_unit}")
        )
        .replace(
            &format!("elevation_{distance_unit}"),
            &format!("elevation_{height_unit}")
        ));
    input
}

#[tokio::test]
async fn distance_and_height_units_convert_independently_in_both_height_modes() {
    let api = app(state(":memory:").unwrap());
    // Independent defining identities for 3937 native units and the 29.5275-unit bank.
    for (distance_unit, length) in [("m", 3937.), ("ft", 1199.9976), ("us_survey_ft", 1200.)] {
        for (height_unit, bed, bank) in [
            ("m", 3937., 29.5275),
            ("ft", 1199.9976, 8.999982),
            ("us_survey_ft", 1200., 9.),
        ] {
            for absolute in [false, true] {
                let p = preview(
                    api.clone(),
                    mixed_source(distance_unit, height_unit, absolute),
                )
                .await;
                assert_eq!(p["valid"], true, "{p}");
                let first = &p["stations"][0];
                assert!((p["stations"][1]["chainage"].as_f64().unwrap() - length).abs() < 1e-10);
                assert!((first["bed_elevation"].as_f64().unwrap() - bed).abs() < 1e-10);
                assert!(
                    (first["section"]["points"][1]["x"].as_f64().unwrap() + length).abs() < 1e-10
                );
                assert!(
                    (first["section"]["points"][0]["z"].as_f64().unwrap() - bank).abs() < 1e-10
                );
                assert_eq!(first["roughness"], 0.03);
                assert_eq!(first["section"]["points"].as_array().unwrap().len(), 4);
                assert_eq!(p["reference"]["import"]["unit"], distance_unit);
                assert_eq!(p["reference"]["import"]["vertical_unit"], height_unit);
            }
        }
    }
}

#[tokio::test]
async fn separate_height_unit_is_validated_and_requires_reconfirmation() {
    let api = app(state(":memory:").unwrap());
    let original = source("m", false);
    let old = preview(api.clone(), original.clone()).await;
    assert!(old["reference"]["import"].get("vertical_unit").is_none());
    let explicit = mixed_source("m", "m", false);
    let checked = preview(api.clone(), explicit.clone()).await;
    assert_eq!(checked["valid"], true);
    assert_eq!(checked["stations"], old["stations"]);
    assert_ne!(checked["review_token"], old["review_token"]);
    let (status, _) = call(
        api.clone(),
        "POST",
        "/api/imports/survey/apply",
        json!({"source":explicit,
        "project":doboku_core::sample(),"confirmed":true,"review_token":old["review_token"]}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    for unit in ["feet", "", "USSurveyFeet"] {
        let mut input = original.clone();
        input["vertical_unit"] = json!(unit);
        let p = preview(api.clone(), input).await;
        assert_eq!(p["valid"], false);
        assert_eq!(p["stations"], json!([]));
        assert_eq!(p["geometry"], Value::Null);
        assert_eq!(p["review_token"], Value::Null);
    }
    let mut mismatched = mixed_source("m", "us_survey_ft", false);
    mismatched["vertical_unit"] = json!("ft");
    assert_eq!(preview(api.clone(), mismatched).await["valid"], false);
    // Project writes validate the new provenance field, rather than accepting it unchecked.
    let mut project = serde_json::to_value(doboku_core::sample()).unwrap();
    project["reference"] = checked["reference"].clone();
    project["reference"]["import"]["vertical_unit"] = json!("feet");
    assert_eq!(
        call(api, "POST", "/api/projects", project).await.0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
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
    assert_saved_reports(source("us_survey_ft", true), 1200.).await;
}

#[tokio::test]
async fn separate_units_survive_saved_si_calculation_and_independent_zip_audit() {
    assert_saved_reports(mixed_source("m", "us_survey_ft", true), 3937.).await;
    assert_saved_reports(mixed_source("us_survey_ft", "m", false), 1200.).await;
}

async fn assert_saved_reports(input: Value, expected_distance: f64) {
    let api = app(state(":memory:").unwrap());
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
    assert_eq!(project["reference"]["import"]["unit"], input["unit"]);
    assert_eq!(
        project["reference"]["import"]["vertical_unit"],
        input["vertical_unit"]
    );
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
        input["unit"]
    );
    assert!(
        (stored["analysis"]["run"]["profile"]["rows"][1]["chainage"]
            .as_f64()
            .unwrap()
            - expected_distance)
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
        if let Some(height) = input["vertical_unit"].as_str() {
            assert!(report.contains(height));
            if suffix == "html" {
                assert!(report.contains(&format!(
                    "距離 {} / 高さ {}",
                    input["unit"].as_str().unwrap(),
                    height
                )));
            }
        }
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
