//! Explicit CSV coordinate interpretation; no sorting, interpolation or repair.
use crate::{validate_project, ApiError, ApiResult};
use axum::{http::StatusCode, Json};
use doboku_core::{
    Boundary, DatasetProvenance, ImportProvenance, Point, Project, Regime, River, Section,
    SpatialReference, Station,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;

const HEADERS: [&str; 6] = [
    "station",
    "chainage_m",
    "bed_elevation_m",
    "roughness",
    "x_m",
    "elevation_m",
];
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Source {
    pub csv: String,
    pub file_name: String,
    pub elevation_mode: ElevationMode,
    pub unit: String,
    pub vertical_datum: String,
    pub horizontal_reference: String,
    #[serde(default)]
    pub dataset: Option<DatasetProvenance>,
}
#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ElevationMode {
    Absolute,
    Relative,
}
#[derive(Serialize)]
pub struct Diagnostic {
    line: Option<u64>,
    station: Option<String>,
    field: String,
    message: String,
}
#[derive(Serialize)]
pub struct Preview {
    pub valid: bool,
    pub stations: Vec<Station>,
    pub reference: SpatialReference,
    pub diagnostics: Vec<Diagnostic>,
    pub warnings: Vec<String>,
    pub review_token: Option<String>,
}
fn diagnostic(
    line: Option<u64>,
    station: Option<&str>,
    field: &str,
    message: impl ToString,
) -> Diagnostic {
    Diagnostic {
        line,
        station: station.map(str::to_owned),
        field: field.into(),
        message: message.to_string(),
    }
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
// csv's reader intentionally accepts malformed quoting; reject that ambiguity
// before parsing rather than silently repairing a survey record.
fn check_quotes(csv: &str) -> Option<u64> {
    let mut state = 0; // field start / unquoted / quoted / after closing quote
    let mut line = 1;
    for c in csv.trim_start_matches('\u{feff}').chars() {
        match (state, c) {
            (0, '"') => state = 2,
            (0 | 1 | 3, ',' | '\n' | '\r') => state = 0,
            (0, _) => state = 1,
            (1, '"') => return Some(line),
            (2, '"') => state = 3,
            (3, '"') => state = 2,
            (3, _) => return Some(line),
            _ => {}
        }
        if c == '\n' {
            line += 1;
        }
    }
    (state == 2).then_some(line)
}
fn number(
    record: &csv::StringRecord,
    index: usize,
    line: Option<u64>,
    errors: &mut Vec<Diagnostic>,
) -> Option<f64> {
    match record.get(index).unwrap_or("").parse::<f64>() {
        Ok(value) if value.is_finite() => Some(value),
        _ => {
            errors.push(diagnostic(
                line,
                record.get(0),
                HEADERS[index],
                "有限の数値を指定してください",
            ));
            None
        }
    }
}
pub fn inspect(source: &Source) -> Preview {
    let mut errors = Vec::new();
    let mut warnings = vec!["全測点の置換と施工案のクリアを行います。流量・参照勾配・境界水深は保持します。反映後に条件を確認して再計算してください。".into(), "座標や基準高の変換は行いません。横断xと流下距離は同じ単位m、標高は共通の基準高が必要です。".into()];
    for (field, value) in [
        ("file_name", &source.file_name),
        ("vertical_datum", &source.vertical_datum),
        ("horizontal_reference", &source.horizontal_reference),
    ] {
        if value.trim().is_empty() || value.len() > 200 {
            errors.push(diagnostic(
                None,
                None,
                field,
                "1〜200バイトの名称が必要です",
            ));
        }
    }
    if source.unit != "m" {
        errors.push(diagnostic(
            None,
            None,
            "unit",
            "単位はmのみ対応。単位変換は行いません",
        ));
    }
    if let Some(data) = &source.dataset {
        if let Err(error) = crate::provenance::validate(data) {
            errors.push(diagnostic(None, None, "dataset", error));
        }
    }
    warnings.extend(crate::provenance::warnings(source.dataset.as_ref()));
    if source.csv.len() > 65536 {
        errors.push(diagnostic(None, None, "csv", "CSVはUTF-8で64KiB以内"));
    }
    if let Some(line) = check_quotes(&source.csv) {
        errors.push(diagnostic(
            Some(line),
            None,
            "csv",
            "CSVの引用符が不正です。閉じていない引用符や引用符の後の文字を確認してください",
        ));
    }
    if source.vertical_datum.contains("未指定") {
        warnings.push("基準高が未指定です。実データの標高系を確認してください。".into());
    }
    let reference = SpatialReference {
        vertical_datum: source.vertical_datum.clone(),
        horizontal_reference: source.horizontal_reference.clone(),
        import: Some(ImportProvenance {
            file_name: source.file_name.clone(),
            sha256: hash(source.csv.as_bytes()),
            imported_at: chrono::Utc::now().to_rfc3339(),
            elevation_mode: match source.elevation_mode {
                ElevationMode::Absolute => "absolute",
                ElevationMode::Relative => "relative",
            }
            .into(),
            unit: source.unit.clone(),
            dataset: source.dataset.clone(),
        }),
    };
    let mut stations: Vec<Station> = Vec::new();
    if errors.is_empty() {
        let mut reader = csv::ReaderBuilder::new()
            .trim(csv::Trim::All)
            .from_reader(source.csv.trim_start_matches('\u{feff}').as_bytes());
        match reader.headers() {
            Ok(h) if h.iter().eq(HEADERS) => {}
            _ => errors.push(diagnostic(
                Some(1),
                None,
                "header",
                format!("ヘッダーと順序は {}", HEADERS.join(",")),
            )),
        }
        if errors.is_empty() {
            let mut seen = HashSet::new();
            let mut current = String::new();
            let mut locations = Vec::new();
            for (index, item) in reader.records().enumerate() {
                if index >= 2000 {
                    errors.push(diagnostic(None, None, "csv", "データ行は2000行以内"));
                    break;
                }
                if errors.len() >= 50 {
                    break;
                }
                let record = match item {
                    Ok(v) => v,
                    Err(e) => {
                        errors.push(diagnostic(
                            e.position().map(|p| p.line()),
                            None,
                            "csv",
                            "CSVの列数または引用符を確認してください",
                        ));
                        continue;
                    }
                };
                let line = record.position().map(|p| p.line());
                let id = &record[0];
                if id.is_empty() || id.len() > 80 || id.chars().any(char::is_control) {
                    errors.push(diagnostic(line, Some(id), "station", "断面IDは1〜80バイト"));
                    continue;
                }
                let values: Vec<_> = (1..6)
                    .map(|i| number(&record, i, line, &mut errors))
                    .collect();
                let [Some(chainage), Some(bed), Some(n), Some(x), Some(elevation)] =
                    values.as_slice()
                else {
                    continue;
                };
                if current != id {
                    if !seen.insert(id.to_owned()) {
                        errors.push(diagnostic(
                            line,
                            Some(id),
                            "station",
                            "同じ断面の行を連続して配置してください。順序は変更しません",
                        ));
                        continue;
                    }
                    current = id.into();
                    locations.push((line, id.to_owned()));
                    stations.push(Station {
                        chainage: *chainage,
                        bed_elevation: *bed,
                        roughness: *n,
                        section: Section::Survey { points: Vec::new() },
                    });
                }
                let st = stations.last_mut().expect("station added");
                if st.chainage != *chainage || st.bed_elevation != *bed || st.roughness != *n {
                    errors.push(diagnostic(
                        line,
                        Some(id),
                        "station",
                        "同一断面内の流下距離・河床標高・粗度が一致しません",
                    ));
                }
                let z = match source.elevation_mode {
                    ElevationMode::Absolute => elevation - bed,
                    ElevationMode::Relative => *elevation,
                };
                if let Section::Survey { points } = &mut st.section {
                    points.push(Point { x: *x, z });
                }
            }
            for (st, (line, id)) in stations.iter().zip(locations) {
                if let Err(e) = doboku_geometry::validate(&st.section) {
                    errors.push(diagnostic(line, Some(&id), "section", e));
                }
            }
            if errors.is_empty() {
                let river = River {
                    discharge: 1.,
                    normal_slope: 0.001,
                    boundary: Boundary {
                        regime: Regime::Subcritical,
                        depth: 1.,
                    },
                    stations: stations.clone(),
                };
                if let Err(e) = doboku_hydraulics::validate(&river) {
                    errors.push(diagnostic(None, None, "river", e));
                }
            }
        }
    }
    let valid = errors.is_empty();
    if !valid {
        stations.clear();
    }
    let review_token =
        valid.then(|| hash(&serde_json::to_vec(source).expect("source serializable")));
    Preview {
        valid,
        stations,
        reference,
        diagnostics: errors,
        warnings,
        review_token,
    }
}
pub async fn preview(Json(source): Json<Source>) -> Json<Preview> {
    Json(inspect(&source))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Apply {
    source: Source,
    project: Project,
    confirmed: bool,
    review_token: String,
}
pub async fn apply(Json(mut request): Json<Apply>) -> ApiResult<Json<Project>> {
    if !request.confirmed {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "取込み内容の明示的確認が必要です".into(),
        ));
    }
    let preview = inspect(&request.source);
    if !preview.valid {
        return Err(ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            "CSVの診断を解消して再プレビューしてください".into(),
        ));
    }
    if preview.review_token.as_deref() != Some(&request.review_token) {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "プレビュー後に取込み条件が変わりました。再プレビューしてください".into(),
        ));
    }
    request.project.river.stations = preview.stations;
    request.project.reference = preview.reference;
    request.project.scenarios.clear();
    request.project.staged = false;
    validate_project(&request.project)?;
    Ok(Json(request.project))
}
