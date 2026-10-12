use axum::{
    body::Body,
    http::{Request, StatusCode},
    Router,
};
use doboku_api::{app, state};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

async fn call(app: Router, method: &str, url: &str, body: Value) -> (StatusCode, String) {
    let res = app
        .oneshot(
            Request::builder()
                .method(method)
                .uri(url)
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = res.status();
    let text =
        String::from_utf8(res.into_body().collect().await.unwrap().to_bytes().to_vec()).unwrap();
    (status, text)
}

#[tokio::test]
async fn river_diagnostics_preserve_conditions_and_history_and_localize_rejected_input() {
    let api = app(state(":memory:").unwrap());
    let mut project = serde_json::to_value(doboku_core::sample()).unwrap();
    let (status, _) = call(api.clone(), "POST", "/api/projects", project.clone()).await;
    assert_eq!(status, StatusCode::OK);
    let original = project.clone();
    let (status, body) = call(
        api.clone(),
        "POST",
        "/api/diagnostics/river",
        project["river"].clone(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let report: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(report["river"], original["river"]);
    assert_eq!(report["engine_version"], doboku_core::ENGINE_VERSION);
    chrono::DateTime::parse_from_rfc3339(report["checked_at"].as_str().unwrap()).unwrap();
    assert_eq!(report["can_attempt_profile"], true);
    assert_eq!(report["boundary"]["chainage"], 1000.);
    assert_eq!(report["sections"].as_array().unwrap().len(), 11);
    // Two bad transitions and an overflowing downstream boundary must all be reported.
    project["river"]["stations"][1]["section"] =
        json!({"kind":"rectangle","width":100.,"bank_height":8.});
    project["river"]["boundary"]["depth"] = json!(99.);
    let (status, body) = call(
        api.clone(),
        "POST",
        "/api/diagnostics/river",
        project["river"].clone(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let report: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(report["can_attempt_profile"], false);
    assert_eq!(
        report["transitions"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|t| !t["issues"].as_array().unwrap().is_empty())
            .count(),
        2
    );
    assert!(report["boundary"]["issues"][0]
        .as_str()
        .unwrap()
        .contains("越岸"));
    assert_eq!(report["boundary"]["froude"], Value::Null);
    assert_eq!(report["boundary"]["water_surface"], Value::Null);
    let (_, saved) = call(
        api.clone(),
        "GET",
        &format!("/api/projects/{}", original["id"].as_str().unwrap()),
        Value::Null,
    )
    .await;
    assert_eq!(serde_json::from_str::<Value>(&saved).unwrap(), original);
    for suffix in ["runs", "sensitivity-runs", "resolution-runs"] {
        let (status, history) = call(
            api.clone(),
            "GET",
            &format!(
                "/api/projects/{}/{suffix}",
                original["id"].as_str().unwrap()
            ),
            Value::Null,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(serde_json::from_str::<Value>(&history).unwrap()["items"]
            .as_array()
            .unwrap()
            .is_empty());
    }
    project["river"]["stations"][0]["roughness"] = json!(0.);
    let (status, body) = call(
        api,
        "POST",
        "/api/diagnostics/river",
        project["river"].clone(),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(body.contains("粗度"));
    assert!(!body.contains("critical_depth"));
}

#[tokio::test]
async fn irregular_survey_preserves_vertices_and_saved_results_and_rejects_split_boundary() {
    let api = app(state(":memory:").unwrap());
    let points = [
        (-10., 6.),
        (-5., 0.6),
        (-3., 0.),
        (-1., 0.12),
        (1., 0.04),
        (3., 0.18),
        (5., 0.5),
        (9., 6.),
    ];
    let mut csv = String::from("station,chainage_m,bed_elevation_m,roughness,x_m,elevation_m\n");
    for i in 0..11 {
        for (x, z) in points {
            csv.push_str(&format!(
                "S{i},{},{},0.035,{x},{z}\n",
                i * 40,
                20.0 - i as f64 * 0.04
            ));
        }
    }
    let source = json!({"csv":csv,"file_name":"irregular-synthetic.csv","elevation_mode":"relative","unit":"m","vertical_datum":"合成基準高","horizontal_reference":"合成局所座標・m","dataset":{"data_kind":"synthetic","processing":"起伏を含む合成点列、平滑化なし"}});
    let (status, body) = call(
        api.clone(),
        "POST",
        "/api/imports/survey/preview",
        source.clone(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let preview: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(preview["valid"], true, "{body}");
    assert!(preview["warnings"]
        .as_array()
        .unwrap()
        .iter()
        .any(|w| w.as_str().unwrap().contains("連続流路")));
    let mut p = doboku_core::sample();
    p.id = "irregular-survey".into();
    p.river.discharge = 15.0;
    p.river.boundary.depth = 3.6;
    let request = json!({"project":p,"source":source,"confirmed":true,"review_token":preview["review_token"]});
    let (status, body) = call(api.clone(), "POST", "/api/imports/survey/apply", request).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let project: Value = serde_json::from_str(&body).unwrap();
    let expected: Vec<_> = points
        .into_iter()
        .map(|(x, z)| json!({"x":x,"z":z}))
        .collect();
    for station in project["river"]["stations"].as_array().unwrap() {
        assert_eq!(station["section"]["points"], json!(expected));
    }
    let req = json!({"project":project,"scenarios":[],"staged":false});
    let (status, body) = call(api.clone(), "POST", "/api/runs", req.clone()).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let saved: Value = serde_json::from_str(&body).unwrap();
    let id = saved["id"].as_i64().unwrap();
    assert_eq!(
        saved["analysis"]["run"]["river"]["stations"],
        project["river"]["stations"]
    );
    for format in ["csv", "html"] {
        let (status, body) = call(
            api.clone(),
            "GET",
            &format!("/api/runs/{id}/reports/{format}"),
            Value::Null,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(body.contains(saved["analysis"]["run"]["executed_at"].as_str().unwrap()));
        assert!(body.contains("起伏"));
    }
    let mut bad = req;
    bad["project"]["river"]["boundary"] = json!({"regime":"supercritical","depth":0.08});
    let (status, error) = call(api.clone(), "POST", "/api/runs", bad).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(error.contains("分離した流路"));
    let (_, body) = call(
        api.clone(),
        "GET",
        "/api/projects/irregular-survey/runs",
        Value::Null,
    )
    .await;
    assert_eq!(
        serde_json::from_str::<Value>(&body).unwrap()["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let (_, body) = call(api, "GET", &format!("/api/runs/{id}"), Value::Null).await;
    assert_eq!(serde_json::from_str::<Value>(&body).unwrap(), saved);
}
fn request() -> Value {
    json!({"project":doboku_core::sample(),"scenarios":[{"name":"掘削1m","modification":{"kind":"excavate","depth":1.0}}]})
}
fn survey_source() -> Value {
    json!({"csv":include_str!("../../../examples/survey-absolute.csv"),"file_name":"survey-absolute.csv","elevation_mode":"absolute","unit":"m","vertical_datum":"合成サンプルの仮想基準高","horizontal_reference":"局所座標（m）"})
}
fn dataset_declaration() -> Value {
    json!({"data_kind":"synthetic","source_url":"https://example.org/fixtures/v1","attribution":"試験用著作者 <script>window.injected=1</script>","usage_terms":"=未確認の試験用条件\n公開データの採用許可ではありません","survey_date":"","processing":"合成台形を測点CSVに変換\n座標変換・補間なし"})
}

#[tokio::test]
async fn dataset_declarations_require_reconfirmation_and_survive_reopening_and_exports() {
    let path = std::env::temp_dir().join(format!(
        "doboku-source-{}-{}.sqlite",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let api = app(state(path.to_str().unwrap()).unwrap());
    let mut source = survey_source();
    source["dataset"] = dataset_declaration();
    let (status, body) = call(
        api.clone(),
        "POST",
        "/api/imports/survey/preview",
        source.clone(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let preview: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(preview["valid"], true);
    assert_eq!(preview["reference"]["import"]["dataset"], source["dataset"]);
    assert!(preview["warnings"]
        .as_array()
        .unwrap()
        .iter()
        .any(|w| w.as_str().unwrap().contains("合成データ")));
    let mut req = json!({"source":source,"project":doboku_core::sample(),"confirmed":true,"review_token":preview["review_token"]});
    req["source"]["dataset"]["usage_terms"] = json!("プレビュー後の変更");
    assert_eq!(
        call(
            api.clone(),
            "POST",
            "/api/imports/survey/apply",
            req.clone()
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    req["source"] = source.clone();
    let (status, body) = call(api.clone(), "POST", "/api/imports/survey/apply", req).await;
    assert_eq!(status, StatusCode::OK);
    let project: Value = serde_json::from_str(&body).unwrap();
    let reference = project["reference"].clone();
    assert_eq!(
        reference["import"]["sha256"],
        preview["reference"]["import"]["sha256"]
    );
    assert_eq!(
        call(api.clone(), "POST", "/api/projects", project.clone())
            .await
            .0,
        StatusCode::OK
    );
    let (status, body) = call(
        api.clone(),
        "POST",
        "/api/runs",
        json!({"project":project,"scenarios":[]}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let saved: Value = serde_json::from_str(&body).unwrap();
    let (status, body) = call(api.clone(), "POST", "/api/sensitivity/runs", json!({"project":project,"cases":[{"parameter":"discharge","value":80},{"parameter":"discharge","value":-1}]})).await;
    assert_eq!(status, StatusCode::OK);
    let sensitivity: Value = serde_json::from_str(&body).unwrap();
    drop(api);
    let api = app(state(path.to_str().unwrap()).unwrap());
    let (status, body) = call(
        api.clone(),
        "GET",
        "/api/projects/sample-river",
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        serde_json::from_str::<Value>(&body).unwrap()["reference"],
        reference
    );
    for (url, key, expected) in [
        (
            format!("/api/runs/{}", saved["id"]),
            "analysis",
            &saved["analysis"],
        ),
        (
            format!("/api/sensitivity/runs/{}", sensitivity["id"]),
            "comparison",
            &sensitivity["comparison"],
        ),
    ] {
        let (status, body) = call(api.clone(), "GET", &url, Value::Null).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            &serde_json::from_str::<Value>(&body).unwrap()[key],
            expected
        );
        let (status, csv) = call(
            api.clone(),
            "GET",
            &format!("{url}/reports/csv"),
            Value::Null,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        for row in parse_csv(&csv) {
            let restored: Value = if key == "analysis" {
                serde_json::from_str(row["reference_json"].as_str().unwrap()).unwrap()
            } else {
                serde_json::from_str::<Value>(row["project_json"].as_str().unwrap()).unwrap()
                    ["reference"]
                    .clone()
            };
            assert_eq!(restored, reference);
        }
        let (status, html) = call(
            api.clone(),
            "GET",
            &format!("{url}/reports/html"),
            Value::Null,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(html.contains("データ出典（利用者申告）"));
        assert!(html.contains("&lt;script&gt;window.injected=1&lt;/script&gt;"));
        assert!(!html.contains("<script>window.injected"));
        assert!(html.contains("未記録"));
        assert!(html.contains("合成データ"));
    }
    drop(api);
    std::fs::remove_file(path).unwrap();
}

#[tokio::test]
async fn dataset_metadata_rejects_bad_dates_urls_controls_and_limits_on_preview_and_save() {
    let api = app(state(":memory:").unwrap());
    let mut source = survey_source();
    source["dataset"] = dataset_declaration();
    let (_, body) = call(
        api.clone(),
        "POST",
        "/api/imports/survey/preview",
        source.clone(),
    )
    .await;
    let preview: Value = serde_json::from_str(&body).unwrap();
    let (_, body) = call(api.clone(), "POST", "/api/imports/survey/apply", json!({"source":source,"project":doboku_core::sample(),"confirmed":true,"review_token":preview["review_token"]})).await;
    let project: Value = serde_json::from_str(&body).unwrap();
    for (field, invalid) in [
        ("source_url", "javascript:alert(1)".to_owned()),
        (
            "source_url",
            "https://user:secret@example.org/data".to_owned(),
        ),
        ("source_url", "https://example.org/has space".to_owned()),
        ("source_url", "file:///tmp/data".to_owned()),
        ("survey_date", "2025-02-29".to_owned()),
        ("survey_date", "2024-2-9".to_owned()),
        ("attribution", "control\u{0}".to_owned()),
        ("processing", "x".repeat(4001)),
    ] {
        let mut modified = source.clone();
        modified["dataset"][field] = json!(invalid);
        let (_, body) = call(api.clone(), "POST", "/api/imports/survey/preview", modified).await;
        let failed: Value = serde_json::from_str(&body).unwrap();
        assert_eq!(failed["valid"], false, "{field}");
        assert!(failed["stations"].as_array().unwrap().is_empty());
        assert!(failed["review_token"].is_null());
        let mut invalid_project = project.clone();
        invalid_project["reference"]["import"]["dataset"][field] = json!(invalid);
        assert_eq!(
            call(api.clone(), "POST", "/api/projects", invalid_project)
                .await
                .0,
            StatusCode::UNPROCESSABLE_ENTITY,
            "{field}"
        );
    }
    source["dataset"]["data_kind"] = json!("measured");
    source["dataset"]["survey_date"] = json!("2024-02-29");
    let (_, body) = call(api.clone(), "POST", "/api/imports/survey/preview", source).await;
    assert_eq!(serde_json::from_str::<Value>(&body).unwrap()["valid"], true);
    let (_, body) = call(
        api.clone(),
        "POST",
        "/api/imports/survey/preview",
        survey_source(),
    )
    .await;
    let legacy: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(legacy["valid"], true);
    assert!(legacy["reference"]["import"]["dataset"].is_null());
    assert!(legacy["warnings"]
        .as_array()
        .unwrap()
        .iter()
        .any(|w| w.as_str().unwrap().contains("未記録")));
    // A pre-feature project JSON has no dataset field at all.
    let mut old_project = project;
    old_project["reference"]["import"]
        .as_object_mut()
        .unwrap()
        .remove("dataset");
    assert_eq!(
        call(api, "POST", "/api/projects", old_project).await.0,
        StatusCode::OK
    );
}

fn parse_csv(text: &str) -> Vec<Value> {
    use std::{
        io::Write,
        process::{Command, Stdio},
    };
    let mut child = Command::new("python3").args(["-c", "import csv,io,json,sys; print(json.dumps(list(csv.DictReader(io.StringIO(sys.stdin.read().lstrip('\\ufeff'))))))"])
        .stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(text.as_bytes())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success());
    serde_json::from_slice(&output.stdout).unwrap()
}

#[tokio::test]
async fn resolution_requires_confirmation_and_returns_reproducible_results_without_db_writes() {
    let api = app(state(":memory:").unwrap());
    let project = doboku_core::sample();
    let mut req = json!({"project":project,"confirmed_interpolation":false});
    assert_eq!(
        call(api.clone(), "POST", "/api/resolution", req.clone())
            .await
            .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    req["confirmed_interpolation"] = json!(true);
    let (status, body) = call(api.clone(), "POST", "/api/resolution", req.clone()).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let response: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(response["project"], json!(project));
    assert_eq!(response["engine_version"], doboku_core::ENGINE_VERSION);
    assert!(
        chrono::DateTime::parse_from_rfc3339(response["executed_at"].as_str().unwrap()).is_ok()
    );
    assert_eq!(
        response["study"]["baseline"],
        json!(doboku_hydraulics::solve(&project.river).unwrap())
    );
    for (i, factor) in [2, 4].iter().enumerate() {
        let c = &response["study"]["cases"][i];
        assert_eq!(c["status"], "ok");
        assert_eq!(
            c["river"]["stations"].as_array().unwrap().len(),
            10 * factor + 1
        );
        assert_eq!(c["differences"].as_array().unwrap().len(), 11);
        let river: doboku_core::River = serde_json::from_value(c["river"].clone()).unwrap();
        assert_eq!(
            c["profile"],
            json!(doboku_hydraulics::solve(&river).unwrap())
        );
        for j in 0..11 {
            assert_eq!(
                c["river"]["stations"][j * factor],
                json!(project.river.stations[j])
            );
            let expected = c["profile"]["rows"][j * factor]["water_elevation"]
                .as_f64()
                .unwrap()
                - response["study"]["baseline"]["rows"][j]["water_elevation"]
                    .as_f64()
                    .unwrap();
            assert!(
                (c["differences"][j]["water_change"].as_f64().unwrap() - expected).abs() < 1e-12
            );
        }
    }
    for endpoint in [
        "/api/projects/sample-river/runs",
        "/api/projects/sample-river/sensitivity-runs",
    ] {
        let (_, body) = call(api.clone(), "GET", endpoint, Value::Null).await;
        assert_eq!(
            serde_json::from_str::<Value>(&body).unwrap()["items"],
            json!([])
        );
    }
    let (_, body) = call(
        api.clone(),
        "GET",
        "/api/projects/sample-river",
        Value::Null,
    )
    .await;
    assert_eq!(
        serde_json::from_str::<Value>(&body).unwrap(),
        json!(project)
    );
    req["study"] = json!({"forged":true});
    assert!(!call(api, "POST", "/api/resolution", req)
        .await
        .0
        .is_success());
}

#[tokio::test]
async fn resolution_retains_partial_and_geometry_failures_and_rejects_invalid_baseline() {
    let api = app(state(":memory:").unwrap());
    let mut project = doboku_core::sample();
    project.river = doboku_hydraulics::resolution::refine(&project.river, 5).unwrap();
    let (status, body) = call(
        api.clone(),
        "POST",
        "/api/resolution",
        json!({"project":project,"confirmed_interpolation":true}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let result: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(result["study"]["cases"][0]["status"], "ok");
    assert_eq!(result["study"]["cases"][1]["status"], "failed");
    assert!(result["study"]["cases"][1]["error"]
        .as_str()
        .unwrap()
        .contains("上限200"));
    assert!(result["study"]["cases"][1].get("profile").is_none());
    project = doboku_core::sample();
    for s in &mut project.river.stations {
        s.section = doboku_core::Section::Rectangle {
            width: 20.0,
            bank_height: 8.0,
        };
    }
    project.river.stations[1].section = doboku_core::Section::Trapezoid {
        bottom_width: 20.0,
        side_slope: 0.0,
        bank_height: 8.0,
    };
    let (status, body) = call(
        api.clone(),
        "POST",
        "/api/resolution",
        json!({"project":project,"confirmed_interpolation":true}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let result: Value = serde_json::from_str(&body).unwrap();
    for c in result["study"]["cases"].as_array().unwrap() {
        assert_eq!(c["status"], "failed");
        assert!(c["error"].as_str().unwrap().contains("異なる断面形式"));
        assert!(c.get("profile").is_none());
        assert!(c.get("max_abs_water_change").is_none());
    }
    project.river.discharge = -1.0;
    assert_eq!(
        call(
            api,
            "POST",
            "/api/resolution",
            json!({"project":project,"confirmed_interpolation":true})
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
}

#[tokio::test]
async fn sensitivity_snapshots_preserve_exact_results_exports_failures_and_do_not_mutate_projects()
{
    let root = std::env::temp_dir().join(format!(
        "doboku-sensitivity-{}-{}",
        std::process::id(),
        chrono::Utc::now().timestamp_nanos_opt().unwrap()
    ));
    std::fs::create_dir(&root).unwrap();
    let database = root.join("state.sqlite");
    let api = app(state(database.to_str().unwrap()).unwrap());
    let mut project = doboku_core::sample();
    project.name = "<script>test</script>".into();
    project.reference.vertical_datum = "試験基準高 <datum>".into();
    for station in &mut project.river.stations {
        station.bed_elevation -= 20.0;
    }
    let req = json!({"project":project,"cases":[{"parameter":"discharge","value":80},{"parameter":"roughness","value":0.035},{"parameter":"discharge","value":-1},{"parameter":"roughness","value":0.4}]});
    let (status, body) = call(api.clone(), "POST", "/api/sensitivity/runs", req.clone()).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let saved: Value = serde_json::from_str(&body).unwrap();
    let id = saved["id"].as_i64().unwrap();
    let old_time = saved["comparison"]["baseline"]["executed_at"]
        .as_str()
        .unwrap();
    let (_, body) = call(
        api.clone(),
        "GET",
        "/api/projects/sample-river",
        Value::Null,
    )
    .await;
    assert_eq!(
        serde_json::from_str::<Value>(&body).unwrap(),
        json!(doboku_core::sample())
    );
    let mut changed = project.clone();
    changed.river.discharge = 125.0;
    changed.name = "新しい条件".into();
    assert_eq!(
        call(api.clone(), "POST", "/api/projects", json!(changed))
            .await
            .0,
        StatusCode::OK
    );
    let mut invalid = req.clone();
    invalid["project"]["river"]["discharge"] = json!(-1.0);
    assert_eq!(
        call(api.clone(), "POST", "/api/sensitivity/runs", invalid)
            .await
            .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let mut forged = req;
    forged["comparison"] = json!({"baseline":"client supplied"});
    assert!(!call(api.clone(), "POST", "/api/sensitivity/runs", forged)
        .await
        .0
        .is_success());
    drop(api);
    let api = app(state(database.to_str().unwrap()).unwrap());
    let (status, body) = call(
        api.clone(),
        "GET",
        &format!("/api/sensitivity/runs/{id}"),
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(serde_json::from_str::<Value>(&body).unwrap(), saved);
    let (_, html) = call(
        api.clone(),
        "GET",
        &format!("/api/sensitivity/runs/{id}/reports/html"),
        Value::Null,
    )
    .await;
    assert!(html.contains(old_time));
    assert!(html.contains("&lt;script&gt;"));
    assert!(!html.contains("<script>"));
    assert!(html.contains("試験基準高 &lt;datum&gt;"));
    assert_eq!(html.matches("<svg").count(), 12);
    assert!(html.contains("失敗"));
    let (_, csv) = call(
        api.clone(),
        "GET",
        &format!("/api/sensitivity/runs/{id}/reports/csv"),
        Value::Null,
    )
    .await;
    let rows = parse_csv(&csv);
    assert_eq!(rows.len(), 35);
    assert_eq!(rows[0]["executed_at"], old_time);
    assert_eq!(
        rows[0]["water_elevation_m"]
            .as_str()
            .unwrap()
            .parse::<f64>()
            .unwrap(),
        saved["comparison"]["baseline"]["profile"]["rows"][0]["water_elevation"]
            .as_f64()
            .unwrap()
    );
    assert!(
        rows[11]["water_change_m"]
            .as_str()
            .unwrap()
            .parse::<f64>()
            .unwrap()
            < 0.0
    );
    assert_eq!(
        serde_json::from_str::<Value>(rows[11]["conditions_json"].as_str().unwrap()).unwrap()
            ["discharge"],
        80.0
    );
    for row in &rows[33..] {
        assert_eq!(row["status"], "failed");
        assert!(!row["error"].as_str().unwrap().is_empty());
        for key in [
            "chainage_m",
            "water_elevation_m",
            "depth_m",
            "engine_version",
            "executed_at",
            "conditions_json",
        ] {
            assert_eq!(row[key], "");
        }
        assert!(row.get("null").is_none());
    }
    assert_eq!(
        rows[33]["requested_value"]
            .as_str()
            .unwrap()
            .parse::<f64>()
            .unwrap(),
        -1.0
    );
    assert_eq!(
        serde_json::from_str::<Value>(rows[33]["project_json"].as_str().unwrap()).unwrap(),
        json!(project)
    );
    let (_, body) = call(
        api.clone(),
        "GET",
        "/api/projects/sample-river/sensitivity-runs",
        Value::Null,
    )
    .await;
    let page: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(page["items"].as_array().unwrap().len(), 1);
    assert_eq!(page["items"][0]["failed_count"], 2);
    let (_, body) = call(
        api.clone(),
        "GET",
        "/api/projects/sample-river/runs",
        Value::Null,
    )
    .await;
    assert!(serde_json::from_str::<Value>(&body).unwrap()["items"]
        .as_array()
        .unwrap()
        .is_empty());
    for path in [
        "/api/sensitivity/runs/999",
        "/api/sensitivity/runs/999/reports/html",
        "/api/sensitivity/runs/999/reports/csv",
    ] {
        assert_eq!(
            call(api.clone(), "GET", path, Value::Null).await.0,
            StatusCode::NOT_FOUND
        );
    }
    drop(api);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn sensitivity_history_pages_are_project_scoped_and_stable_after_new_insertions() {
    let api = app(state(":memory:").unwrap());
    let req =
        json!({"project":doboku_core::sample(),"cases":[{"parameter":"discharge","value":-1}]});
    for _ in 0..22 {
        assert_eq!(
            call(api.clone(), "POST", "/api/sensitivity/runs", req.clone())
                .await
                .0,
            StatusCode::OK
        );
    }
    let (_, text) = call(
        api.clone(),
        "GET",
        "/api/projects/sample-river/sensitivity-runs",
        Value::Null,
    )
    .await;
    let first: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(first["items"].as_array().unwrap().len(), 20);
    assert_eq!(first["items"][0]["id"], 22);
    assert_eq!(first["next_before"], 3);
    assert_eq!(
        call(api.clone(), "POST", "/api/sensitivity/runs", req)
            .await
            .0,
        StatusCode::OK
    );
    let (_, text) = call(
        api.clone(),
        "GET",
        "/api/projects/sample-river/sensitivity-runs?before=3",
        Value::Null,
    )
    .await;
    let next: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(next["items"].as_array().unwrap().len(), 2);
    assert_eq!(next["items"][0]["id"], 2);
    assert_eq!(next["items"][1]["id"], 1);
    assert!(next["next_before"].is_null());
    assert_eq!(
        call(
            api.clone(),
            "GET",
            "/api/projects/sample-river/sensitivity-runs?before=0",
            Value::Null
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let (_, text) = call(
        api,
        "GET",
        "/api/projects/another-project/sensitivity-runs",
        Value::Null,
    )
    .await;
    assert!(serde_json::from_str::<Value>(&text).unwrap()["items"]
        .as_array()
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn sensitivity_retains_original_conditions_and_reports_failed_cases_separately() {
    let api = app(state(":memory:").unwrap());
    let p = doboku_core::sample();
    let cases = json!([{"parameter":"discharge","value":80},{"parameter":"roughness","value":0.035},{"parameter":"discharge","value":-1},{"parameter":"roughness","value":0.4}]);
    let (code, text) = call(
        api.clone(),
        "POST",
        "/api/sensitivity",
        json!({"project":p,"cases":cases}),
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{text}");
    let result: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(result["project"], json!(p));
    assert_eq!(result["baseline"]["river"], json!(p.river));
    for i in 0..2 {
        let c = &result["cases"][i];
        assert_eq!(c["status"], "ok");
        assert_eq!(c["run"]["river"]["boundary"], json!(p.river.boundary));
        assert_eq!(c["run"]["profile"]["rows"][10]["water_elevation"], 12.2);
        assert_eq!(
            c["run"]["river"]["stations"][0]["section"],
            json!(p.river.stations[0].section)
        );
    }
    assert_eq!(result["cases"][0]["run"]["river"]["discharge"], 80.0);
    assert!(result["cases"][0]["max_water_change"].as_f64().unwrap() < 0.0);
    assert_eq!(result["cases"][1]["run"]["river"]["discharge"], 100.0);
    assert!(result["cases"][1]["max_water_change"].as_f64().unwrap() > 0.0);
    for i in 2..4 {
        assert_eq!(result["cases"][i]["status"], "failed");
        assert!(result["cases"][i]["error"].is_string());
        assert!(result["cases"][i].get("run").is_none());
    }
    let (_, text) = call(
        api.clone(),
        "GET",
        "/api/projects/sample-river/runs",
        Value::Null,
    )
    .await;
    assert!(serde_json::from_str::<Value>(&text).unwrap()["items"]
        .as_array()
        .unwrap()
        .is_empty());
    let (_, text) = call(
        api.clone(),
        "GET",
        "/api/projects/sample-river",
        Value::Null,
    )
    .await;
    assert_eq!(serde_json::from_str::<Value>(&text).unwrap(), json!(p));
    for cases in [
        json!([]),
        json!(vec![json!({"parameter":"discharge","value":100}); 9]),
    ] {
        assert_eq!(
            call(
                api.clone(),
                "POST",
                "/api/sensitivity",
                json!({"project":p,"cases":cases})
            )
            .await
            .0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
}

#[tokio::test]
async fn online_backup_restores_projects_and_original_run_snapshots() {
    let root = std::env::temp_dir().join(format!("doboku-backup-{}", std::process::id()));
    std::fs::create_dir(&root).unwrap();
    let source = root.join("source.sqlite");
    let backup = root.join("backup.sqlite");
    let restored = root.join("restored.sqlite");
    let api = app(state(source.to_str().unwrap()).unwrap());
    let (code, text) = call(api.clone(), "POST", "/api/runs", request()).await;
    assert_eq!(code, StatusCode::OK);
    let saved: Value = serde_json::from_str(&text).unwrap();
    let (code,text)=call(api.clone(),"POST","/api/sensitivity/runs",json!({"project":doboku_core::sample(),"cases":[{"parameter":"discharge","value":80},{"parameter":"discharge","value":-1}]})).await;
    assert_eq!(code, StatusCode::OK);
    let sensitivity: Value = serde_json::from_str(&text).unwrap();
    let script = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../scripts/database.py");
    let (code, text) = call(
        api.clone(),
        "POST",
        "/api/resolution/runs",
        json!({"project":doboku_core::sample(),"confirmed_interpolation":true}),
    )
    .await;
    assert_eq!(code, StatusCode::OK);
    let resolution: Value = serde_json::from_str(&text).unwrap();
    let output = std::process::Command::new("python3")
        .arg(&script)
        .args(["backup", "--source"])
        .arg(&source)
        .arg("--destination")
        .arg(&backup)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let manifest: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(manifest["counts"]["runs"], 1);
    assert_eq!(manifest["counts"]["sensitivity_runs"], 1);
    assert_eq!(manifest["counts"]["resolution_runs"], 1);
    let mut changed = request()["project"].clone();
    changed["river"]["discharge"] = json!(150.0);
    call(api.clone(), "POST", "/api/projects", changed).await;
    let output = std::process::Command::new("python3")
        .arg(&script)
        .args(["restore", "--source"])
        .arg(&backup)
        .arg("--destination")
        .arg(&restored)
        .arg("--expected-sha256")
        .arg(manifest["sha256"].as_str().unwrap())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let restored_api = app(state(restored.to_str().unwrap()).unwrap());
    let (_, text) = call(
        restored_api.clone(),
        "GET",
        &format!("/api/runs/{}", saved["id"]),
        Value::Null,
    )
    .await;
    assert_eq!(serde_json::from_str::<Value>(&text).unwrap(), saved);
    let (_, text) = call(
        restored_api.clone(),
        "GET",
        &format!("/api/sensitivity/runs/{}", sensitivity["id"]),
        Value::Null,
    )
    .await;
    assert_eq!(serde_json::from_str::<Value>(&text).unwrap(), sensitivity);
    let (code, text) = call(
        restored_api.clone(),
        "GET",
        &format!("/api/resolution/runs/{}", resolution["id"]),
        Value::Null,
    )
    .await;
    assert_eq!(code, StatusCode::OK);
    assert_eq!(serde_json::from_str::<Value>(&text).unwrap(), resolution);
    for kind in ["csv", "html"] {
        let url = format!("/api/resolution/runs/{}/reports/{kind}", resolution["id"]);
        let original = call(api.clone(), "GET", &url, Value::Null).await;
        let restored = call(restored_api.clone(), "GET", &url, Value::Null).await;
        assert_eq!(original, restored);
    }
    let (_, text) = call(
        restored_api.clone(),
        "GET",
        "/api/projects/sample-river",
        Value::Null,
    )
    .await;
    assert_eq!(
        serde_json::from_str::<Value>(&text).unwrap()["river"]["discharge"],
        100.0
    );
    drop(api);
    drop(restored_api);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn survey_preview_requires_confirmation_and_preserves_provenance_in_history() {
    let api = app(state(":memory:").unwrap());
    let source = survey_source();
    let (code, body) = call(
        api.clone(),
        "POST",
        "/api/imports/survey/preview",
        source.clone(),
    )
    .await;
    assert_eq!(code, StatusCode::OK);
    let preview: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(preview["valid"], true);
    assert_eq!(preview["stations"].as_array().unwrap().len(), 11);
    assert_eq!(preview["stations"][0]["section"]["points"][0]["z"], 8.0);
    assert_eq!(preview["stations"][10]["section"]["points"][1]["z"], 0.0);
    let mut req = json!({"source":source,"project":doboku_core::sample(),"confirmed":false,"review_token":preview["review_token"]});
    assert_eq!(
        call(
            api.clone(),
            "POST",
            "/api/imports/survey/apply",
            req.clone()
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    req["confirmed"] = json!(true);
    req["source"]["vertical_datum"] = json!("変更後の標高系");
    assert_eq!(
        call(
            api.clone(),
            "POST",
            "/api/imports/survey/apply",
            req.clone()
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    req["source"] = survey_source();
    let (code, body) = call(api.clone(), "POST", "/api/imports/survey/apply", req).await;
    assert_eq!(code, StatusCode::OK);
    let project: Value = serde_json::from_str(&body).unwrap();
    assert!(project["scenarios"].as_array().unwrap().is_empty());
    assert_eq!(project["river"]["discharge"], 100.0);
    assert_eq!(
        project["reference"]["import"]["sha256"]
            .as_str()
            .unwrap()
            .len(),
        64
    );
    assert_eq!(
        project["reference"]["import"]["file_name"],
        "survey-absolute.csv"
    );
    let (status,text)=call(api.clone(),"POST","/api/sensitivity/runs",json!({"project":project,"cases":[{"parameter":"discharge","value":80},{"parameter":"discharge","value":-1}]})).await;
    assert_eq!(status, StatusCode::OK);
    let imported_sensitivity: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(
        imported_sensitivity["comparison"]["project"]["reference"],
        project["reference"]
    );
    for kind in ["csv", "html"] {
        let (status, text) = call(
            api.clone(),
            "GET",
            &format!(
                "/api/sensitivity/runs/{}/reports/{kind}",
                imported_sensitivity["id"]
            ),
            Value::Null,
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(text.contains("survey-absolute.csv"));
        assert!(text.contains(project["reference"]["import"]["sha256"].as_str().unwrap()));
    }
    let (_, body) = call(api.clone(), "GET", "/api/projects", Value::Null).await;
    assert_eq!(
        serde_json::from_str::<Value>(&body).unwrap(),
        json!([doboku_core::sample()])
    );
    let (_, body) = call(
        api.clone(),
        "GET",
        "/api/projects/sample-river/runs",
        Value::Null,
    )
    .await;
    assert!(serde_json::from_str::<Value>(&body).unwrap()["items"]
        .as_array()
        .unwrap()
        .is_empty());
    // Relative heights describe the same geometry, and metadata is never silently converted.
    let mut relative = survey_source();
    relative["elevation_mode"] = json!("relative");
    let mut csv = String::from("station,chainage_m,bed_elevation_m,roughness,x_m,elevation_m\n");
    for i in 0..11 {
        for (x, z) in [(-22, 8), (-10, 0), (10, 0), (22, 8)] {
            csv.push_str(&format!(
                "S{i:02},{},{:.3},0.03,{x},{z}\n",
                i * 100,
                10.0 - i as f64 * 0.1
            ));
        }
    }
    relative["csv"] = json!(csv);
    let (_, body) = call(api.clone(), "POST", "/api/imports/survey/preview", relative).await;
    let rel: Vec<doboku_core::Station> =
        serde_json::from_value(serde_json::from_str::<Value>(&body).unwrap()["stations"].clone())
            .unwrap();
    let abs: Vec<doboku_core::Station> =
        serde_json::from_value(project["river"]["stations"].clone()).unwrap();
    for (a, b) in rel.iter().zip(&abs) {
        assert_eq!(a.chainage, b.chainage);
        assert_eq!(a.bed_elevation, b.bed_elevation);
        assert_eq!(a.roughness, b.roughness);
        if let (
            doboku_core::Section::Survey { points: a },
            doboku_core::Section::Survey { points: b },
        ) = (&a.section, &b.section)
        {
            for (a, b) in a.iter().zip(b) {
                assert_eq!(a.x, b.x);
                // Subtracting absolute decimal heights entails IEEE-754 roundoff.
                assert!((a.z - b.z).abs() < 1e-12);
            }
        } else {
            panic!("survey required");
        }
    }
    let (code, body) = call(
        api.clone(),
        "POST",
        "/api/runs",
        json!({"project":project,"scenarios":[]}),
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{body}");
    let saved: Value = serde_json::from_str(&body).unwrap();
    for kind in ["html", "csv"] {
        let (code, body) = call(
            api.clone(),
            "GET",
            &format!("/api/runs/{}/reports/{kind}", saved["id"]),
            Value::Null,
        )
        .await;
        assert_eq!(code, StatusCode::OK);
        assert!(body.contains("合成サンプルの仮想基準高"));
        assert!(body.contains(project["reference"]["import"]["sha256"].as_str().unwrap()));
    }
}

#[tokio::test]
async fn survey_diagnostics_reject_missing_nonfinite_and_unsupported_geometry() {
    let api = app(state(":memory:").unwrap());
    let original = survey_source()["csv"].as_str().unwrap().to_owned();
    let variants = [
        original.replace("-22,18.000", "-22,"),
        original.replace("S02", "S00"),
        format!("{original}\""),
        original.replace("S00,0", "S\"00,0"),
        original.replace("S00,0", "\"S00\"oops,0"),
        original.replace("elevation_m", "unknown"),
        original.replace("-22,18.000", "-22,NaN"),
        original.replace("-22,18.000", "-10,18.000"),
        original.replace("S00,0,10.000,0.03,-10", "S00,0,10.000,0.04,-10"),
        original.replace("S00,0,10.000,0.03,10,10.000", "S00,0,10.000,0.03,10,9.000"),
        original.replace("S01,100", "S01,-100"),
        original.replace("S01", "S00"),
        original.lines().take(5).collect::<Vec<_>>().join("\n"),
    ];
    for csv in variants {
        let mut source = survey_source();
        source["csv"] = json!(csv);
        let (code, body) = call(
            api.clone(),
            "POST",
            "/api/imports/survey/preview",
            source.clone(),
        )
        .await;
        assert_eq!(code, StatusCode::OK);
        let preview: Value = serde_json::from_str(&body).unwrap();
        assert_eq!(preview["valid"], false, "{body}");
        assert!(preview["stations"].as_array().unwrap().is_empty());
        assert!(!preview["diagnostics"].as_array().unwrap().is_empty());
        assert_eq!(preview["review_token"], Value::Null);
        assert_eq!(call(api.clone(), "POST", "/api/imports/survey/apply", json!({"source":source,"project":doboku_core::sample(),"confirmed":true,"review_token":"forged"})).await.0, StatusCode::UNPROCESSABLE_ENTITY);
    }
}

#[tokio::test]
async fn irregular_shape_preview_is_distinct_from_wetted_connectivity_validation() {
    let api = app(state(":memory:").unwrap());
    let mut source = survey_source();
    source["csv"] = json!(source["csv"].as_str().unwrap().replace(
        "S00,0,10.000,0.03,10,10.000",
        "S00,0,10.000,0.03,0,12.000\nS00,0,10.000,0.03,10,10.000"
    ));
    let (_, body) = call(
        api.clone(),
        "POST",
        "/api/imports/survey/preview",
        source.clone(),
    )
    .await;
    let preview: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(preview["valid"], true);
    let (status,body)=call(api.clone(),"POST","/api/imports/survey/apply",json!({"source":source,"project":doboku_core::sample(),"confirmed":true,"review_token":preview["review_token"]})).await;
    assert_eq!(status, StatusCode::OK);
    let mut project: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(
        project["river"]["stations"][0]["section"]["points"][2],
        json!({"x":0.0,"z":2.0})
    );
    project["river"]["boundary"] = json!({"regime":"supercritical","depth":0.5});
    let (status, error) = call(
        api.clone(),
        "POST",
        "/api/runs",
        json!({"project":project,"scenarios":[]}),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        error.contains("分離") || error.contains("連続流路"),
        "{error}"
    );
    let (_, body) = call(
        api.clone(),
        "GET",
        "/api/projects/sample-river/runs",
        Value::Null,
    )
    .await;
    assert!(serde_json::from_str::<Value>(&body).unwrap()["items"]
        .as_array()
        .unwrap()
        .is_empty());
    let (_, body) = call(api, "GET", "/api/projects/sample-river", Value::Null).await;
    assert_eq!(
        serde_json::from_str::<Value>(&body).unwrap(),
        json!(doboku_core::sample())
    );
}

#[tokio::test]
async fn sample_simulation_and_invalid_input() {
    let api = app(state(":memory:").unwrap());
    let (code, text) = call(api.clone(), "GET", "/api/sample", Value::Null).await;
    assert_eq!(code, StatusCode::OK);
    let p: Value = serde_json::from_str(&text).unwrap();
    let (code, text) = call(api.clone(), "POST", "/api/simulate", p["river"].clone()).await;
    assert_eq!(code, StatusCode::OK);
    let r: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(r["profile"]["rows"].as_array().unwrap().len(), 11);
    assert!(r["executed_at"].is_string());
    let mut invalid = p["river"].clone();
    invalid["discharge"] = json!(-1);
    assert_eq!(
        call(api.clone(), "POST", "/api/simulate", invalid).await.0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        call(api, "GET", "/api/projects/missing", Value::Null)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
}
#[tokio::test]
async fn comparison_and_reproducible_exports() {
    let api = app(state(":memory:").unwrap());
    let (code, text) = call(api.clone(), "POST", "/api/compare", request()).await;
    assert_eq!(code, StatusCode::OK);
    let a: Value = serde_json::from_str(&text).unwrap();
    assert!((a["comparisons"][0]["cut_volume"].as_f64().unwrap() - 32000.0).abs() < 0.01);
    let (code, html) = call(api.clone(), "POST", "/api/reports/html", request()).await;
    assert_eq!(code, StatusCode::OK);
    assert!(html.contains("<svg"));
    assert!(html.contains("再現用条件"));
    assert!(html.contains("32000.00"));
    let (code, csv) = call(api, "POST", "/api/reports/csv", request()).await;
    assert_eq!(code, StatusCode::OK);
    assert_eq!(csv.lines().count(), 23);
    assert!(csv.contains("conditions_json"));
    assert!(csv.contains("cut_area_m2"));
    assert!(html.contains("掘削断面積 m²"));
}
#[tokio::test]
async fn sqlite_survives_reopen() {
    let path = std::env::temp_dir().join(format!("doboku-test-{}.sqlite", std::process::id()));
    let pathstr = path.to_str().unwrap();
    let mut p = doboku_core::sample();
    p.id = "saved-project".into();
    p.name = "保存テスト".into();
    p.river.discharge = 110.0;
    p.staged = true;
    let recorded;
    {
        let api = app(state(pathstr).unwrap());
        assert_eq!(
            call(api.clone(), "POST", "/api/projects", json!(p)).await.0,
            StatusCode::OK
        );
        let (code, text) = call(
            api,
            "POST",
            "/api/runs",
            json!({"project":p,"scenarios":p.scenarios,"staged":true}),
        )
        .await;
        assert_eq!(code, StatusCode::OK);
        recorded = serde_json::from_str::<Value>(&text).unwrap();
    }
    let (code, text) = call(
        app(state(pathstr).unwrap()),
        "GET",
        "/api/projects/saved-project",
        Value::Null,
    )
    .await;
    assert_eq!(code, StatusCode::OK);
    let got: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(got["river"]["discharge"], 110.0);
    assert_eq!(got["staged"], true);
    assert_eq!(got["scenarios"][0]["modification"]["depth"], 1.0);
    let (code, text) = call(
        app(state(pathstr).unwrap()),
        "GET",
        &format!("/api/runs/{}", recorded["id"]),
        Value::Null,
    )
    .await;
    assert_eq!(code, StatusCode::OK);
    assert_eq!(serde_json::from_str::<Value>(&text).unwrap(), recorded);
    std::fs::remove_file(path).unwrap();
}
#[tokio::test]
async fn typed_agent_proposal_is_confirmed_before_application() {
    let api = app(state(":memory:").unwrap());
    let (code, text) = call(
        api.clone(),
        "POST",
        "/api/agent/propose",
        json!({"prompt":"粗度を0.035に変更して比較"}),
    )
    .await;
    assert_eq!(code, StatusCode::OK);
    let reply: Value = serde_json::from_str(&text).unwrap();
    let mut req = request();
    req["proposal"] = reply["proposal"].clone();
    req["confirmed"] = json!(false);
    assert_eq!(
        call(api.clone(), "POST", "/api/agent/apply", req.clone())
            .await
            .0,
        StatusCode::CONFLICT
    );
    req["confirmed"] = json!(true);
    let (code, text) = call(api.clone(), "POST", "/api/agent/apply", req).await;
    assert_eq!(code, StatusCode::OK);
    let result: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(result["project"]["river"]["stations"][0]["roughness"], 0.03);
    assert_eq!(
        result["analysis"]["comparisons"].as_array().unwrap().len(),
        2
    );
    let (code, text) = call(
        api,
        "GET",
        &format!("/api/runs/{}", result["history_id"]),
        Value::Null,
    )
    .await;
    assert_eq!(code, StatusCode::OK);
    assert_eq!(
        serde_json::from_str::<Value>(&text).unwrap()["analysis"],
        result["analysis"]
    );
}

#[tokio::test]
async fn failed_agent_calculation_does_not_change_project_or_append_history() {
    let api = app(state(":memory:").unwrap());
    let mut req = request();
    req["proposal"] = json!({"actions":[{"tool":"set_discharge","value":1000000}],"explanation":"invalid hydraulic case"});
    req["confirmed"] = json!(true);
    assert_eq!(
        call(api.clone(), "POST", "/api/agent/apply", req).await.0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let (_, body) = call(
        api.clone(),
        "GET",
        "/api/projects/sample-river",
        Value::Null,
    )
    .await;
    assert_eq!(
        serde_json::from_str::<Value>(&body).unwrap(),
        json!(doboku_core::sample())
    );
    let (_, body) = call(api, "GET", "/api/projects/sample-river/runs", Value::Null).await;
    assert!(serde_json::from_str::<Value>(&body).unwrap()["items"]
        .as_array()
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn history_preserves_snapshots_and_exports_without_creating_spurious_runs() {
    let api = app(state(":memory:").unwrap());
    let (code, text) = call(api.clone(), "POST", "/api/runs", request()).await;
    assert_eq!(code, StatusCode::OK);
    let first: Value = serde_json::from_str(&text).unwrap();
    let first_id = first["id"].as_i64().unwrap();
    let mut edited = request();
    edited["project"]["name"] = json!("改訂条件");
    edited["project"]["river"]["discharge"] = json!(110.0);
    edited["scenarios"][0]["modification"]["depth"] = json!(0.5);
    assert_eq!(
        call(
            api.clone(),
            "POST",
            "/api/projects",
            edited["project"].clone()
        )
        .await
        .0,
        StatusCode::OK
    );
    let (code, text) = call(api.clone(), "POST", "/api/runs", edited.clone()).await;
    assert_eq!(code, StatusCode::OK);
    let second: Value = serde_json::from_str(&text).unwrap();
    assert!(second["id"].as_i64().unwrap() > first_id);
    edited["project"]["river"]["boundary"]["depth"] = json!(8.0);
    assert_eq!(
        call(api.clone(), "POST", "/api/runs", edited).await.0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    // Preview and freshly recalculated exports are read-only.
    assert_eq!(
        call(api.clone(), "POST", "/api/compare", request()).await.0,
        StatusCode::OK
    );
    assert_eq!(
        call(api.clone(), "POST", "/api/reports/html", request())
            .await
            .0,
        StatusCode::OK
    );
    let (code, text) = call(
        api.clone(),
        "GET",
        &format!("/api/runs/{first_id}"),
        Value::Null,
    )
    .await;
    assert_eq!(code, StatusCode::OK);
    assert_eq!(serde_json::from_str::<Value>(&text).unwrap(), first);
    let analysis: doboku_api::Analysis = serde_json::from_value(first["analysis"].clone()).unwrap();
    for (kind, expected) in [
        ("html", doboku_api::report::html(&analysis)),
        ("csv", doboku_api::report::csv(&analysis)),
    ] {
        let (code, text) = call(
            api.clone(),
            "GET",
            &format!("/api/runs/{first_id}/reports/{kind}"),
            Value::Null,
        )
        .await;
        assert_eq!(code, StatusCode::OK);
        assert_eq!(text, expected);
        assert!(text.contains(analysis.run.executed_at.as_str()));
    }
    let (_, text) = call(
        api.clone(),
        "GET",
        "/api/projects/sample-river/runs",
        Value::Null,
    )
    .await;
    let page: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(page["items"].as_array().unwrap().len(), 2);
    assert_eq!(page["items"][0]["id"], second["id"]);
    assert_eq!(page["items"][0]["project_name"], "改訂条件");
    assert_eq!(page["items"][1]["discharge"], 100.0);
    assert_eq!(page["next_before"], Value::Null);
    let (_, text) = call(
        api.clone(),
        "GET",
        "/api/projects/other-project/runs",
        Value::Null,
    )
    .await;
    assert!(serde_json::from_str::<Value>(&text).unwrap()["items"]
        .as_array()
        .unwrap()
        .is_empty());
    assert_eq!(
        call(api.clone(), "GET", "/api/runs/999999", Value::Null)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        call(
            api,
            "GET",
            "/api/projects/sample-river/runs?before=0",
            Value::Null
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
}

#[tokio::test]
async fn history_cursor_pages_remain_stable_when_new_runs_arrive() {
    let api = app(state(":memory:").unwrap());
    for _ in 0..21 {
        assert_eq!(
            call(api.clone(), "POST", "/api/runs", request()).await.0,
            StatusCode::OK
        );
    }
    let (_, text) = call(
        api.clone(),
        "GET",
        "/api/projects/sample-river/runs",
        Value::Null,
    )
    .await;
    let page: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(page["items"].as_array().unwrap().len(), 20);
    let cursor = page["next_before"].as_i64().unwrap();
    call(api.clone(), "POST", "/api/runs", request()).await;
    let (code, text) = call(
        api,
        "GET",
        &format!("/api/projects/sample-river/runs?before={cursor}"),
        Value::Null,
    )
    .await;
    assert_eq!(code, StatusCode::OK);
    let next: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(next["items"].as_array().unwrap().len(), 1);
    assert!(next["items"][0]["id"].as_i64().unwrap() < cursor);
    assert_eq!(next["next_before"], Value::Null);
}
#[tokio::test]
async fn staged_construction_accumulates_ground_changes() {
    let api = app(state(":memory:").unwrap());
    let mut req = request();
    req["scenarios"] = json!([{"name":"段階1","modification":{"kind":"excavate","depth":0.5}},{"name":"段階2","modification":{"kind":"excavate","depth":0.5}}]);
    req["staged"] = json!(true);
    let (code, text) = call(api, "POST", "/api/compare", req).await;
    assert_eq!(code, StatusCode::OK);
    let result: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(
        result["comparisons"][1]["river"]["stations"][0]["bed_elevation"],
        9.0
    );
    assert!((result["comparisons"][1]["cut_volume"].as_f64().unwrap() - 32000.0).abs() < 0.01);
}
