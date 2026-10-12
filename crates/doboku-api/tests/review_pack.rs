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
    collections::BTreeMap,
    io::{Cursor, Read},
};
use tower::ServiceExt;

async fn call(api: Router, method: &str, path: &str, data: Value) -> (StatusCode, Vec<u8>) {
    let response = api
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header("content-type", "application/json")
                .body(Body::from(data.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes()
        .to_vec();
    (status, bytes)
}
async fn post(api: Router, path: &str, data: Value) -> Value {
    let (status, body) = call(api, "POST", path, data).await;
    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
    serde_json::from_slice(&body).unwrap()
}
fn entries(bytes: &[u8]) -> BTreeMap<String, Vec<u8>> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
    let mut result = BTreeMap::new();
    for i in 0..zip.len() {
        let mut item = zip.by_index(i).unwrap();
        assert!(item.enclosed_name().is_some());
        let mut content = vec![];
        item.read_to_end(&mut content).unwrap();
        assert!(result.insert(item.name().to_owned(), content).is_none());
    }
    result
}
async fn seed(api: Router) -> (Value, Value, Value, Value) {
    let mut project = serde_json::to_value(doboku_core::sample()).unwrap();
    project["id"] = json!("review-pack-test");
    project["name"] = json!("合成試行 <script>alert(1)</script>");
    post(api.clone(), "/api/projects", project.clone()).await;
    let run=post(api.clone(),"/api/runs",json!({"project":project,"scenarios":[{"name":"河道掘削1m","modification":{"kind":"excavate","depth":1.}}],"staged":false})).await;
    let sensitivity=post(api.clone(),"/api/sensitivity/runs",json!({"project":project,"cases":[{"parameter":"discharge","value":120.},{"parameter":"discharge","value":10000.}]})).await;
    let resolution = post(
        api,
        "/api/resolution/runs",
        json!({"project":project,"confirmed_interpolation":true}),
    )
    .await;
    (project, run, sensitivity, resolution)
}

#[tokio::test]
async fn pack_preserves_original_exports_failures_hashes_and_reopens_after_live_edits() {
    let path = std::env::temp_dir().join(format!(
        "doboku-review-pack-{}-{}.sqlite",
        std::process::id(),
        chrono::Utc::now().timestamp_nanos_opt().unwrap()
    ));
    let api = app(state(path.to_str().unwrap()).unwrap());
    let (mut project, run, sensitivity, resolution) = seed(api.clone()).await;
    let selection = json!({"run_id":run["id"],"sensitivity_id":sensitivity["id"],"resolution_id":resolution["id"]});
    let preview = post(api.clone(), "/api/review-packs/preview", selection.clone()).await;
    assert_eq!(preview["records"][1]["failed_count"], 1);
    assert_eq!(
        preview["records"][0]["executed_at"],
        run["analysis"]["run"]["executed_at"]
    );
    let (status, bytes) = call(
        api.clone(),
        "POST",
        "/api/review-packs/zip",
        selection.clone(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let files = entries(&bytes);
    assert_eq!(files.len(), 13);
    let manifest: Value = serde_json::from_slice(&files["manifest.json"]).unwrap();
    assert_eq!(manifest["selection"], selection);
    assert_eq!(manifest["files"], preview["files"]);
    assert_eq!(manifest["builder_version"], doboku_core::ENGINE_VERSION);
    chrono::DateTime::parse_from_rfc3339(manifest["assembled_at"].as_str().unwrap()).unwrap();
    for item in manifest["files"].as_array().unwrap() {
        let content = &files[item["path"].as_str().unwrap()];
        assert_eq!(content.len() as u64, item["bytes"].as_u64().unwrap());
        assert_eq!(
            format!("{:x}", Sha256::digest(content)),
            item["sha256"].as_str().unwrap()
        );
    }
    assert_eq!(
        format!("{:x}", Sha256::digest(&files["conditions.json"])),
        manifest["conditions_sha256"]
    );
    for (prefix, stored, endpoint) in [
        ("construction", &run, format!("/api/runs/{}", run["id"])),
        (
            "sensitivity",
            &sensitivity,
            format!("/api/sensitivity/runs/{}", sensitivity["id"]),
        ),
        (
            "resolution",
            &resolution,
            format!("/api/resolution/runs/{}", resolution["id"]),
        ),
    ] {
        assert_eq!(
            serde_json::from_slice::<Value>(&files[&format!("{prefix}.json")]).unwrap(),
            *stored
        );
        for format in ["csv", "html"] {
            let (status, individual) = call(
                api.clone(),
                "GET",
                &format!("{endpoint}/reports/{format}"),
                Value::Null,
            )
            .await;
            assert_eq!(status, StatusCode::OK);
            assert_eq!(files[&format!("{prefix}.{format}")], individual);
        }
    }
    let index = String::from_utf8(files["index.html"].clone()).unwrap();
    assert!(!index.contains("<script>alert(1)</script>"));
    assert!(index.contains("&lt;script&gt;"));
    project["river"]["discharge"] = json!(999999.);
    project["name"] = json!("編集後の条件");
    post(api.clone(), "/api/projects", project.clone()).await;
    drop(api);
    let reopened = app(state(path.to_str().unwrap()).unwrap());
    let (_, bytes) = call(
        reopened.clone(),
        "POST",
        "/api/review-packs/zip",
        selection.clone(),
    )
    .await;
    let mut reopened_files = entries(&bytes);
    let mut originals = files;
    reopened_files.remove("manifest.json");
    originals.remove("manifest.json");
    assert_eq!(originals, reopened_files);
    for kind in ["runs", "sensitivity-runs", "resolution-runs"] {
        let (_, body) = call(
            reopened.clone(),
            "GET",
            &format!("/api/projects/review-pack-test/{kind}"),
            Value::Null,
        )
        .await;
        assert_eq!(
            serde_json::from_slice::<Value>(&body).unwrap()["items"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }
    let (_, body) = call(
        reopened.clone(),
        "GET",
        "/api/projects/review-pack-test",
        Value::Null,
    )
    .await;
    assert_eq!(serde_json::from_slice::<Value>(&body).unwrap(), project);
    let base_only = post(
        reopened.clone(),
        "/api/review-packs/preview",
        json!({"run_id":run["id"]}),
    )
    .await;
    assert_eq!(base_only["records"].as_array().unwrap().len(), 1);
    assert_eq!(base_only["files"].as_array().unwrap().len(), 6);
    drop(reopened);
    std::fs::remove_file(path).unwrap();
}

#[tokio::test]
async fn pack_rejects_different_projects_conditions_and_references_and_invalid_ids() {
    let api = app(state(":memory:").unwrap());
    let (project, run, _, _) = seed(api.clone()).await;
    for field in ["project", "discharge", "reference"] {
        let mut changed = project.clone();
        match field {
            "project" => changed["id"] = json!("other-project"),
            "discharge" => changed["river"]["discharge"] = json!(110.),
            _ => changed["reference"]["vertical_datum"] = json!("異なる標高基準"),
        };
        let other = post(
            api.clone(),
            "/api/sensitivity/runs",
            json!({"project":changed,"cases":[{"parameter":"discharge","value":120.}]}),
        )
        .await;
        let (status, body) = call(
            api.clone(),
            "POST",
            "/api/review-packs/preview",
            json!({"run_id":run["id"],"sensitivity_id":other["id"]}),
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert!(String::from_utf8(body).unwrap().contains("一致しません"));
    }
    for request in [
        json!({"run_id":0}),
        json!({"run_id":run["id"],"resolution_id":-1}),
    ] {
        assert_eq!(
            call(api.clone(), "POST", "/api/review-packs/zip", request)
                .await
                .0,
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
    assert_eq!(
        call(
            api.clone(),
            "POST",
            "/api/review-packs/zip",
            json!({"run_id":999999})
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let (_, body) = call(
        api,
        "GET",
        "/api/projects/review-pack-test/runs",
        Value::Null,
    )
    .await;
    assert_eq!(
        serde_json::from_slice::<Value>(&body).unwrap()["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}
