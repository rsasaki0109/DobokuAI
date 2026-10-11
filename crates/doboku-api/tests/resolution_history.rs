use axum::{
    body::Body,
    http::{Request, StatusCode},
    Router,
};
use doboku_api::{app, state};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

async fn call(api: Router, method: &str, url: &str, body: Value) -> (StatusCode, String) {
    let response = api
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
    let status = response.status();
    (
        status,
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
fn rows(text: &str) -> Vec<Value> {
    // Separate Python parser verifies multiline quoting and complete CSV column alignment.
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
async fn load(api: &Router, url: &str) -> Value {
    let (code, text) = call(api.clone(), "GET", url, Value::Null).await;
    assert_eq!(code, StatusCode::OK);
    serde_json::from_str(&text).unwrap()
}

#[tokio::test]
async fn resolution_snapshots_preserve_metadata_exact_numbers_and_exports_after_reopen() {
    let root = std::env::temp_dir().join(format!(
        "doboku-resolution-{}-{}",
        std::process::id(),
        chrono::Utc::now().timestamp_nanos_opt().unwrap()
    ));
    std::fs::create_dir(&root).unwrap();
    let path = root.join("state.sqlite");
    let api = app(state(path.to_str().unwrap()).unwrap());
    let source = json!({"csv":include_str!("../../../examples/survey-absolute.csv"),"file_name":"synthetic.csv","elevation_mode":"absolute","unit":"m","vertical_datum":"試験基準高 <datum>","horizontal_reference":"局所座標m","dataset":{"data_kind":"synthetic","attribution":"作成者 <script>unsafe</script>","usage_terms":"未確認の試験宣言\n引用符 \" とカンマ ,","processing":"合成CSV、座標変換なし"}});
    let (_, text) = call(
        api.clone(),
        "POST",
        "/api/imports/survey/preview",
        source.clone(),
    )
    .await;
    let preview: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(preview["valid"], true);
    let (_,text)=call(api.clone(),"POST","/api/imports/survey/apply",json!({"source":source,"project":doboku_core::sample(),"confirmed":true,"review_token":preview["review_token"]})).await;
    let mut project: Value = serde_json::from_str(&text).unwrap();
    project["name"] = json!("=case <script>unsafe</script>");
    for station in project["river"]["stations"].as_array_mut().unwrap() {
        station["bed_elevation"] = json!(station["bed_elevation"].as_f64().unwrap() - 20.0);
    }
    let req = json!({"project":project,"confirmed_interpolation":true});
    let (code, text) = call(api.clone(), "POST", "/api/resolution/runs", req).await;
    assert_eq!(code, StatusCode::OK, "{text}");
    let saved: Value = serde_json::from_str(&text).unwrap();
    let id = saved["id"].as_i64().unwrap();
    let url = format!("/api/resolution/runs/{id}");
    let comparison = &saved["comparison"];
    assert_eq!(comparison["project"], project);
    assert_eq!(
        load(&api, "/api/projects/sample-river").await,
        json!(doboku_core::sample())
    );
    for kind in ["runs", "sensitivity-runs"] {
        assert!(
            load(&api, &format!("/api/projects/sample-river/{kind}")).await["items"]
                .as_array()
                .unwrap()
                .is_empty()
        );
    }
    let original_csv = call(
        api.clone(),
        "GET",
        &format!("{url}/reports/csv"),
        Value::Null,
    )
    .await;
    let original_html = call(
        api.clone(),
        "GET",
        &format!("{url}/reports/html"),
        Value::Null,
    )
    .await;
    let mut changed = project.clone();
    changed["river"]["discharge"] = json!(125.0);
    changed["name"] = json!("編集後");
    assert_eq!(
        call(api.clone(), "POST", "/api/projects", changed).await.0,
        StatusCode::OK
    );
    drop(api);
    let api = app(state(path.to_str().unwrap()).unwrap());
    assert_eq!(load(&api, &url).await, saved);
    assert_eq!(
        call(
            api.clone(),
            "GET",
            &format!("{url}/reports/csv"),
            Value::Null
        )
        .await,
        original_csv
    );
    assert_eq!(
        call(
            api.clone(),
            "GET",
            &format!("{url}/reports/html"),
            Value::Null
        )
        .await,
        original_html
    );
    assert_eq!(original_csv.0, StatusCode::OK);
    assert_eq!(original_html.0, StatusCode::OK);
    let csv = rows(&original_csv.1);
    assert_eq!(csv.len(), 33);
    for row in &csv {
        assert!(row.get("null").is_none());
        assert_eq!(row["study_executed_at"], comparison["executed_at"]);
        assert_eq!(row["engine_version"], comparison["engine_version"]);
        assert_eq!(
            row["project"],
            format!("'{}", project["name"].as_str().unwrap())
        );
        assert_eq!(
            serde_json::from_str::<Value>(row["project_json"].as_str().unwrap()).unwrap(),
            project
        );
        assert!(
            row["water_elevation_m"]
                .as_str()
                .unwrap()
                .parse::<f64>()
                .unwrap()
                < 0.0
        );
    }
    assert_eq!(
        csv[11]["water_change_m"]
            .as_str()
            .unwrap()
            .parse::<f64>()
            .unwrap(),
        comparison["study"]["cases"][0]["differences"][0]["water_change"]
            .as_f64()
            .unwrap()
    );
    assert_eq!(
        serde_json::from_str::<Value>(csv[11]["conditions_json"].as_str().unwrap()).unwrap(),
        comparison["study"]["cases"][0]["river"]
    );
    let html = &original_html.1;
    assert!(html.contains("&lt;script&gt;unsafe&lt;/script&gt;"));
    assert!(!html.contains("<script>unsafe"));
    assert!(html.contains("試験基準高 &lt;datum&gt;"));
    assert!(html.contains("未記録"));
    assert!(html.contains("合成データ"));
    assert!(html.contains("水位差の軸は指数表記"));
    assert_eq!(html.matches("<svg").count(), 5);
    assert!(html.contains(&format!(
        "{:.6e}",
        comparison["study"]["cases"][0]["max_abs_water_change"]
            .as_f64()
            .unwrap()
    )));
    let page = load(&api, "/api/projects/sample-river/resolution-runs").await;
    assert_eq!(page["items"].as_array().unwrap().len(), 1);
    assert_eq!(page["items"][0]["failed_count"], 0);
    for suffix in ["", "/reports/csv", "/reports/html"] {
        assert_eq!(
            call(
                api.clone(),
                "GET",
                &format!("/api/resolution/runs/999{suffix}"),
                Value::Null
            )
            .await
            .0,
            StatusCode::NOT_FOUND
        );
    }
    drop(api);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn resolution_history_retains_partial_and_total_refinement_failures_but_rejects_bad_baselines(
) {
    let api = app(state(":memory:").unwrap());
    let mut project = doboku_core::sample();
    let template = project.river.stations[0].clone();
    project.river.stations = (0..51)
        .map(|i| doboku_core::Station {
            chainage: i as f64 * 20.0,
            bed_elevation: 10.0 - i as f64 * 0.02,
            ..template.clone()
        })
        .collect();
    let (code, text) = call(
        api.clone(),
        "POST",
        "/api/resolution/runs",
        json!({"project":project,"confirmed_interpolation":true}),
    )
    .await;
    assert_eq!(code, StatusCode::OK);
    let partial: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(
        partial["comparison"]["study"]["cases"][1]["status"],
        "failed"
    );
    let (code, text) = call(
        api.clone(),
        "GET",
        &format!("/api/resolution/runs/{}/reports/csv", partial["id"]),
        Value::Null,
    )
    .await;
    assert_eq!(code, StatusCode::OK);
    let parsed = rows(&text);
    assert_eq!(parsed.len(), 103);
    let failed = parsed.last().unwrap();
    assert_eq!(failed["status"], "failed");
    assert!(failed["error"].as_str().unwrap().contains("上限200"));
    for key in [
        "chainage_m",
        "water_elevation_m",
        "water_change_m",
        "depth_change_m",
        "velocity_change_m",
        "conditions_json",
    ] {
        assert_eq!(failed[key], "");
    }
    assert!(failed.get("null").is_none());
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
    let mut req = json!({"project":project,"confirmed_interpolation":true});
    let (code, text) = call(api.clone(), "POST", "/api/resolution/runs", req.clone()).await;
    assert_eq!(code, StatusCode::OK);
    let failed: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(
        failed["comparison"]["study"]["cases"][0]["status"],
        "failed"
    );
    let (_, html) = call(
        api.clone(),
        "GET",
        &format!("/api/resolution/runs/{}/reports/html", failed["id"]),
        Value::Null,
    )
    .await;
    assert!(html.contains("異なる断面形式"));
    assert_eq!(html.matches("<svg").count(), 4);
    assert!(!html.contains("<h2>元測点の水位差</h2>"));
    let page = load(&api, "/api/projects/sample-river/resolution-runs").await;
    assert_eq!(page["items"][0]["failed_count"], 2);
    assert_eq!(page["items"][1]["failed_count"], 1);
    req["confirmed_interpolation"] = json!(false);
    assert_eq!(
        call(api.clone(), "POST", "/api/resolution/runs", req.clone())
            .await
            .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    req["confirmed_interpolation"] = json!(true);
    req["forged_result"] = json!({"study":"client results"});
    assert!(
        !call(api.clone(), "POST", "/api/resolution/runs", req.clone())
            .await
            .0
            .is_success()
    );
    req.as_object_mut().unwrap().remove("forged_result");
    req["project"]["river"]["discharge"] = json!(1000000.0);
    assert_eq!(
        call(api.clone(), "POST", "/api/resolution/runs", req)
            .await
            .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        load(&api, "/api/projects/sample-river/resolution-runs").await,
        page
    );
}

#[tokio::test]
async fn resolution_history_pagination_remains_scoped_and_stable_after_new_runs() {
    let api = app(state(":memory:").unwrap());
    let mut req = json!({"project":doboku_core::sample(),"confirmed_interpolation":true});
    for _ in 0..22 {
        assert_eq!(
            call(api.clone(), "POST", "/api/resolution/runs", req.clone())
                .await
                .0,
            StatusCode::OK
        );
    }
    let first = load(&api, "/api/projects/sample-river/resolution-runs").await;
    assert_eq!(first["items"].as_array().unwrap().len(), 20);
    assert_eq!(first["items"][0]["id"], 22);
    assert_eq!(first["next_before"], 3);
    assert_eq!(
        call(api.clone(), "POST", "/api/resolution/runs", req.clone())
            .await
            .0,
        StatusCode::OK
    );
    req["project"]["id"] = json!("other-project");
    assert_eq!(
        call(api.clone(), "POST", "/api/resolution/runs", req)
            .await
            .0,
        StatusCode::OK
    );
    let next = load(&api, "/api/projects/sample-river/resolution-runs?before=3").await;
    assert_eq!(next["items"].as_array().unwrap().len(), 2);
    assert_eq!(next["items"][0]["id"], 2);
    assert_eq!(next["items"][1]["id"], 1);
    assert!(next["next_before"].is_null());
    assert_eq!(
        load(&api, "/api/projects/other-project/resolution-runs").await["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    for cursor in ["0", "-1", "oops"] {
        assert!(!call(
            api.clone(),
            "GET",
            &format!("/api/projects/sample-river/resolution-runs?before={cursor}"),
            Value::Null
        )
        .await
        .0
        .is_success());
    }
}
