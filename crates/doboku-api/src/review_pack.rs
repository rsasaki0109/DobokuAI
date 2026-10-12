//! Package immutable stored evidence. This module never calls a calculation engine.
use crate::{
    history, internal, provenance, report, resolution_history, resolution_report,
    sensitivity_history, sensitivity_report, Analysis, ApiError, ApiResult, AppState,
};
use axum::{
    extract::State,
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use doboku_core::{Error, Project, ENGINE_VERSION};
use doboku_hydraulics::Profile;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Cursor, Write};

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Selection {
    pub run_id: i64,
    pub sensitivity_id: Option<i64>,
    pub resolution_id: Option<i64>,
}
#[derive(Serialize)]
pub struct Record {
    kind: &'static str,
    id: i64,
    engine_version: String,
    executed_at: String,
    case_count: usize,
    failed_count: usize,
}
#[derive(Serialize)]
pub struct FileInfo {
    path: &'static str,
    bytes: usize,
    sha256: String,
}
#[derive(Serialize)]
pub struct Manifest {
    format_version: &'static str,
    builder_version: &'static str,
    assembled_at: String,
    pub selection: Selection,
    project_id: String,
    project_name: String,
    pub conditions_sha256: String,
    baseline_profile_sha256: String,
    discharge_m3_s: f64,
    station_count: usize,
    scenario_count: usize,
    staged: bool,
    reference: doboku_core::SpatialReference,
    records: Vec<Record>,
    files: Vec<FileInfo>,
    notes: Vec<String>,
}
struct File {
    path: &'static str,
    content: Vec<u8>,
}
struct Pack {
    manifest: Manifest,
    files: Vec<File>,
}
fn hash(content: &[u8]) -> String {
    format!("{:x}", Sha256::digest(content))
}
fn json<T: Serialize>(value: &T) -> ApiResult<Vec<u8>> {
    serde_json::to_vec_pretty(value).map_err(|_| internal())
}
fn conditions(project: &Project) -> ApiResult<String> {
    Ok(hash(&condition_bytes(project)?))
}
fn condition_bytes(project: &Project) -> ApiResult<Vec<u8>> {
    #[derive(Serialize)]
    struct Conditions<'a> {
        river: &'a doboku_core::River,
        reference: &'a doboku_core::SpatialReference,
    }
    json(&Conditions {
        river: &project.river,
        reference: &project.reference,
    })
}
const MAX_PACK_BYTES: usize = 64 * 1024 * 1024;
fn too_large() -> ApiError {
    Error::Unsupported("記録パックの上限64 MiBを超える見込みです。収録する比較履歴を減らすか、個別の成果を出力してください（数値の間引きは行いません）".into()).into()
}
// CSV repeats conditions/context for each row. Reserve before materializing it.
fn reserve_rows<R: Serialize, C: Serialize>(
    budget: &mut usize,
    rows: usize,
    river: &R,
    context: &C,
) -> ApiResult<()> {
    let row = serde_json::to_vec(river)
        .map_err(|_| internal())?
        .len()
        .saturating_add(serde_json::to_vec(context).map_err(|_| internal())?.len())
        .saturating_mul(2)
        .saturating_add(8192);
    *budget = budget.saturating_add(row.saturating_mul(rows.max(1)));
    if *budget > MAX_PACK_BYTES {
        return Err(too_large());
    }
    Ok(())
}
fn same_baseline(
    base: &Analysis,
    project: &Project,
    engine: &str,
    profile: &Profile,
    label: &str,
) -> ApiResult<()> {
    let mismatch = if base.project.id != project.id {
        Some("プロジェクトID")
    } else if conditions(&base.project)? != conditions(project)? {
        Some("基本条件または基準高・出典")
    } else if base.run.engine_version != engine {
        Some("エンジン版")
    } else if json(&base.run.profile)? != json(profile)? {
        Some("保存された基本計算結果")
    } else {
        None
    };
    if let Some(field) = mismatch {
        return Err(Error::Invalid(format!("{label}の{field}が計算履歴と一致しません。同じ保存条件から作成した比較履歴を選んでください")).into());
    }
    Ok(())
}
fn file(path: &'static str, text: String) -> File {
    File {
        path,
        content: text.into_bytes(),
    }
}

fn build(state: &AppState, selection: Selection) -> ApiResult<Pack> {
    if [
        Some(selection.run_id),
        selection.sensitivity_id,
        selection.resolution_id,
    ]
    .into_iter()
    .flatten()
    .any(|id| id <= 0)
    {
        return Err(Error::Invalid("履歴IDは正の整数が必要です".into()).into());
    }
    let base = history::snapshot(state, selection.run_id)?;
    let mut budget = json(&base)?.len().saturating_mul(4);
    reserve_rows(
        &mut budget,
        base.run.profile.rows.len(),
        &base.run.river,
        &(&base.project.reference, &base.run.profile.warnings),
    )?;
    for c in &base.comparisons {
        reserve_rows(
            &mut budget,
            c.profile.rows.len(),
            &c.river,
            &(&base.project.reference, &c.profile.warnings),
        )?;
    }
    // Do not validate against today's solver: archived results may use an older engine.
    let mut records = vec![Record {
        kind: "construction",
        id: selection.run_id,
        engine_version: base.run.engine_version.clone(),
        executed_at: base.run.executed_at.clone(),
        case_count: base.comparisons.len(),
        failed_count: 0,
    }];
    let mut files = vec![
        File {
            path: "conditions.json",
            content: condition_bytes(&base.project)?,
        },
        File {
            path: "construction.json",
            content: json(&history::StoredAnalysis {
                id: selection.run_id,
                analysis: base.clone(),
            })?,
        },
        file("construction.csv", report::csv(&base)),
        file("construction.html", report::html(&base)),
    ];
    if let Some(id) = selection.sensitivity_id {
        let study = sensitivity_history::snapshot(state, id)?;
        same_baseline(
            &base,
            &study.project,
            &study.baseline.engine_version,
            &study.baseline.profile,
            "感度比較",
        )?;
        budget = budget.saturating_add(json(&study)?.len().saturating_mul(4));
        reserve_rows(
            &mut budget,
            study.baseline.profile.rows.len(),
            &study.baseline.river,
            &(&study.project, &study.note),
        )?;
        for c in &study.cases {
            match c {
                crate::sensitivity::Outcome::Ok { run, .. } => reserve_rows(
                    &mut budget,
                    run.profile.rows.len(),
                    &run.river,
                    &(&study.project, &study.note),
                )?,
                crate::sensitivity::Outcome::Failed { .. } => {
                    reserve_rows(&mut budget, 1, &(), &(&study.project, &study.note))?
                }
            }
        }
        records.push(Record {
            kind: "sensitivity",
            id,
            engine_version: study.baseline.engine_version.clone(),
            executed_at: study.baseline.executed_at.clone(),
            case_count: study.cases.len(),
            failed_count: study
                .cases
                .iter()
                .filter(|c| matches!(c, crate::sensitivity::Outcome::Failed { .. }))
                .count(),
        });
        files.push(file("sensitivity.csv", sensitivity_report::csv(&study)));
        files.push(file("sensitivity.html", sensitivity_report::html(&study)));
        files.push(File {
            path: "sensitivity.json",
            content: json(&sensitivity_history::StoredComparison {
                id,
                comparison: study,
            })?,
        });
    }
    if let Some(id) = selection.resolution_id {
        let study = resolution_history::snapshot(state, id)?;
        same_baseline(
            &base,
            &study.project,
            &study.engine_version,
            &study.study.baseline,
            "測点間隔比較",
        )?;
        budget = budget.saturating_add(json(&study)?.len().saturating_mul(4));
        reserve_rows(
            &mut budget,
            study.study.baseline.rows.len(),
            &study.project.river,
            &(&study.project, &study.note),
        )?;
        for c in &study.study.cases {
            match c {
                doboku_hydraulics::resolution::Outcome::Ok {
                    river, differences, ..
                } => reserve_rows(
                    &mut budget,
                    differences.len(),
                    river,
                    &(&study.project, &study.note),
                )?,
                doboku_hydraulics::resolution::Outcome::Failed { .. } => {
                    reserve_rows(&mut budget, 1, &(), &(&study.project, &study.note))?
                }
            }
        }
        records.push(Record {
            kind: "resolution",
            id,
            engine_version: study.engine_version.clone(),
            executed_at: study.executed_at.clone(),
            case_count: study.study.cases.len(),
            failed_count: study
                .study
                .cases
                .iter()
                .filter(|c| matches!(c, doboku_hydraulics::resolution::Outcome::Failed { .. }))
                .count(),
        });
        files.push(file("resolution.csv", resolution_report::csv(&study)));
        files.push(file("resolution.html", resolution_report::html(&study)));
        files.push(File {
            path: "resolution.json",
            content: json(&resolution_history::StoredComparison {
                id,
                comparison: study,
            })?,
        });
    }
    let mut notes = provenance::warnings(
        base.project
            .reference
            .import
            .as_ref()
            .and_then(|p| p.dataset.as_ref()),
    );
    notes.push("保存済みの条件・結果・元の計算日時を収録し、再計算していません。施工案は感度・測点間隔の比較には適用されません。".into());
    notes.push("元の取込みCSV自体は履歴DBに保存されていません。出典・ファイル名・SHA-256は取込み記録を参照し、原ファイルを別途保管してください。".into());
    notes.push("このパックは成果の取りまとめです。実河川試行・独立照査・復旧・CIの完了やデータ採用を判定するものではありません。".into());
    let readme = "DobokuAI river review pack\n\nUnzip the archive, then open index.html in a browser.\nOriginal stored results are in construction.json and optional sensitivity.json / resolution.json.\nCSV and standalone HTML reports are generated from those stored results without solving.\nmanifest.json lists UTF-8 file sizes and SHA-256 hashes.\nIts file list excludes manifest.json itself. ZIP uses stored entries without compression.\nOriginal uploaded CSV is not included; retain it separately using the import's hash.\nThis pack is not a project import, backup restore, field-data adoption or review certificate.\n";
    files.push(file("README.txt", readme.into()));
    let mut manifest = Manifest {
        format_version: "doboku-review-pack-1",
        builder_version: ENGINE_VERSION,
        assembled_at: chrono::Utc::now().to_rfc3339(),
        selection,
        project_id: base.project.id.clone(),
        project_name: base.project.name.clone(),
        conditions_sha256: conditions(&base.project)?,
        baseline_profile_sha256: hash(&json(&base.run.profile)?),
        discharge_m3_s: base.run.river.discharge,
        station_count: base.run.river.stations.len(),
        scenario_count: base.comparisons.len(),
        staged: base.staged,
        reference: base.project.reference.clone(),
        records,
        files: vec![],
        notes,
    };
    files.push(file("index.html", index(&manifest, &base)));
    if files.iter().map(|f| f.content.len()).sum::<usize>() > MAX_PACK_BYTES {
        return Err(too_large());
    }
    manifest.files = files
        .iter()
        .map(|f| FileInfo {
            path: f.path,
            bytes: f.content.len(),
            sha256: hash(&f.content),
        })
        .collect();
    Ok(Pack { manifest, files })
}
fn index(manifest: &Manifest, base: &Analysis) -> String {
    use report::escape;
    let mut body = format!("<!doctype html><html lang=\"ja\"><meta charset=\"utf-8\"><title>DobokuAI 試行記録パック</title><style>body{{max-width:1000px;margin:40px auto;padding:0 24px;font:16px/1.6 sans-serif;color:#244238}}table{{border-collapse:collapse;width:100%}}td,th{{border:1px solid #cbd6cf;padding:10px;text-align:left}}pre{{white-space:pre-wrap}}a{{color:#286d9e}}</style><h1>河川の試行記録パック</h1><p>{}</p><p>基本計算履歴 #{} · 計算日時 {} · engine {}</p><p>パック作成日時はmanifest.jsonに記録 · 出力版 {}</p><p>流量 {} m³/s · {}断面 · {}施工案 · 累積段階 {}</p><p>標高系: {} / 水平座標: {}</p><h2>収録した保存履歴</h2><table><tr><th>種別 / ID</th><th>元の計算日時 / エンジン版</th><th>案数 / 失敗数</th><th>成果</th></tr>",
        escape(&manifest.project_name),manifest.selection.run_id,escape(&base.run.executed_at),escape(&base.run.engine_version),manifest.builder_version,manifest.discharge_m3_s,manifest.station_count,manifest.scenario_count,manifest.staged,escape(&manifest.reference.vertical_datum),escape(&manifest.reference.horizontal_reference));
    for r in &manifest.records {
        let (label, prefix) = match r.kind {
            "sensitivity" => ("感度比較", "sensitivity"),
            "resolution" => ("測点間隔比較", "resolution"),
            _ => ("施工比較", "construction"),
        };
        body.push_str(&format!("<tr><td>{label} #{}</td><td>{}<br>{}</td><td>{} / {}</td><td><a href=\"{prefix}.html\">図付きHTML</a> · <a href=\"{prefix}.csv\">CSV</a> · <a href=\"{prefix}.json\">保存JSON</a></td></tr>",r.id,escape(&r.executed_at),escape(&r.engine_version),r.case_count,r.failed_count));
    }
    body.push_str("</table><h2>出典・取込み</h2>");
    body.push_str(&provenance::html(
        manifest
            .reference
            .import
            .as_ref()
            .and_then(|p| p.dataset.as_ref()),
    ));
    if let Some(import) = &manifest.reference.import {
        body.push_str(&format!(
            "<p>取込みファイル: {}</p><p>取込み日時: {}</p><pre>CSV SHA-256: {}</pre>",
            escape(&import.file_name),
            escape(&import.imported_at),
            escape(&import.sha256)
        ));
    }
    body.push_str(&format!("<h2>条件の識別</h2><pre>条件 SHA-256: {}\n基本結果 SHA-256: {}</pre><p><a href=\"manifest.json\">マニフェスト・ファイル一覧・SHA-256</a></p><h2>記録の範囲</h2>",manifest.conditions_sha256,manifest.baseline_profile_sha256));
    for note in &manifest.notes {
        body.push_str(&format!("<p>{}</p>", escape(note)));
    }
    body.push_str("</html>");
    body
}
fn archive_bytes(pack: Pack) -> ApiResult<Vec<u8>> {
    let mut archive = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    for file in pack.files {
        archive
            .start_file(file.path, options)
            .map_err(|_| internal())?;
        archive.write_all(&file.content).map_err(|_| internal())?;
    }
    archive
        .start_file("manifest.json", options)
        .map_err(|_| internal())?;
    archive
        .write_all(&json(&pack.manifest)?)
        .map_err(|_| internal())?;
    Ok(archive.finish().map_err(|_| internal())?.into_inner())
}
async fn assemble<T: Send + 'static>(
    state: AppState,
    selection: Selection,
    finish: impl FnOnce(Pack) -> ApiResult<T> + Send + 'static,
) -> ApiResult<T> {
    let permit = state.slots.clone().try_acquire_owned().map_err(|_| {
        ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "成果生成が混雑しています".into(),
        )
    })?;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        finish(build(&state, selection)?)
    })
    .await
    .map_err(|_| internal())?
}
pub async fn preview(
    State(state): State<AppState>,
    Json(selection): Json<Selection>,
) -> ApiResult<Json<Manifest>> {
    Ok(Json(
        assemble(state, selection, |pack| Ok(pack.manifest)).await?,
    ))
}
pub async fn archive(
    State(state): State<AppState>,
    Json(selection): Json<Selection>,
) -> ApiResult<Response> {
    let run_id = selection.run_id;
    let body = assemble(state, selection, archive_bytes).await?;
    Ok((
        [
            (header::CONTENT_TYPE, "application/zip".to_owned()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=doboku-review-run-{run_id}.zip"),
            ),
        ],
        body,
    )
        .into_response())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn matching_requires_original_engine_and_profile_but_not_project_display_name() {
        let project = doboku_core::sample();
        let base = crate::analyze(crate::AnalysisRequest {
            project: project.clone(),
            scenarios: vec![],
            staged: false,
        })
        .unwrap();
        assert!(same_baseline(
            &base,
            &project,
            "older-engine",
            &base.run.profile,
            "感度比較"
        )
        .unwrap_err()
        .1
        .contains("エンジン版"));
        let mut profile = base.run.profile.clone();
        profile.rows[0].water_elevation += 0.01;
        assert!(same_baseline(
            &base,
            &project,
            &base.run.engine_version,
            &profile,
            "感度比較"
        )
        .unwrap_err()
        .1
        .contains("保存された基本計算結果"));
        let mut renamed = project;
        renamed.name = "名前の変更のみ".into();
        same_baseline(
            &base,
            &renamed,
            &base.run.engine_version,
            &base.run.profile,
            "感度比較",
        )
        .unwrap();
    }
    #[test]
    fn large_valid_history_is_rejected_before_materializing_repeated_csv_conditions() {
        let mut project = doboku_core::sample();
        let template = project.river.stations[0].clone();
        project.river.stations = (0..200)
            .map(|i| {
                let mut s = template.clone();
                s.chainage = i as f64 * 5.;
                s.bed_elevation = 10. - s.chainage * 0.001;
                s
            })
            .collect();
        let scenarios = (0..6)
            .map(|i| doboku_core::Scenario {
                name: format!("合成粗度案{i}"),
                modification: doboku_core::Modification::Roughness {
                    value: 0.03 + i as f64 * 0.001,
                },
            })
            .collect();
        let analysis = crate::analyze(crate::AnalysisRequest {
            project,
            scenarios,
            staged: false,
        })
        .unwrap();
        let state = crate::state(":memory:").unwrap();
        let id = history::save(&state, &analysis).unwrap();
        let result = build(
            &state,
            Selection {
                run_id: id,
                sensitivity_id: None,
                resolution_id: None,
            },
        );
        assert!(result.err().unwrap().1.contains("64 MiB"));
    }
}
