//! Explicit CSV coordinate interpretation; no sorting, interpolation or repair.
use crate::{validate_project, ApiError, ApiResult};
use axum::{http::StatusCode, Json};
use doboku_core::{
    DatasetProvenance, ImportProvenance, Point, Project, Section, SpatialReference, Station,
};
use doboku_geometry::DepthRange;
use doboku_hydraulics::diagnostics::{inspect_geometry, TransitionCheck};
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
pub(crate) fn metres_per_unit(unit: &str) -> Option<f64> {
    match unit {
        "m" => Some(1.0),
        "ft" => Some(0.3048),
        "us_survey_ft" => Some(1200.0 / 3937.0),
        _ => None,
    }
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Source {
    pub csv: String,
    pub file_name: String,
    pub elevation_mode: ElevationMode,
    pub unit: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vertical_unit: Option<String>,
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
    pub engine_version: &'static str,
    pub inspected_at: String,
    pub valid: bool,
    pub stations: Vec<Station>,
    pub reference: SpatialReference,
    pub diagnostics: Vec<Diagnostic>,
    pub warnings: Vec<String>,
    pub review_token: Option<String>,
    pub geometry: Option<GeometryPreview>,
}
#[derive(Serialize)]
pub struct GeometryPreview {
    sections: Vec<PreviewSection>,
    transitions: Vec<TransitionCheck>,
    can_import: bool,
    note: &'static str,
}
#[derive(Serialize)]
pub struct PreviewSection {
    id: String,
    line: Option<u64>,
    station: Station,
    connected_depth_ranges: Vec<DepthRange>,
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
    field: &str,
    errors: &mut Vec<Diagnostic>,
) -> Option<f64> {
    match record.get(index).unwrap_or("").parse::<f64>() {
        Ok(value) if value.is_finite() => Some(value),
        _ => {
            errors.push(diagnostic(
                line,
                record.get(0),
                field,
                "有限の数値を指定してください",
            ));
            None
        }
    }
}
pub fn inspect(source: &Source) -> Preview {
    let inspected_at = chrono::Utc::now().to_rfc3339();
    let mut errors = Vec::new();
    let mut warnings = vec!["全測点の置換と施工案のクリアを行います。流量m³/s・参照勾配・境界水深m・粗度nは保持します。反映後に条件を確認して再計算してください。".into(), "水平CRSや基準高の変換は行いません。横断x・流下距離は距離の単位、河床標高・高さは高さの単位と一致するヘッダーが必要です。標高は共通の基準高が必要です。".into()];
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
    let height_unit = source.vertical_unit.as_deref().unwrap_or(&source.unit);
    let distance_scale = metres_per_unit(&source.unit);
    let height_scale = metres_per_unit(height_unit);
    for (field, label, unit, scale) in [
        ("unit", "距離", source.unit.as_str(), distance_scale),
        ("vertical_unit", "高さ", height_unit, height_scale),
    ] {
        if let Some(scale) = scale {
            warnings.push(format!("CSVの{label}は {unit} × {scale:.17} でmに換算します。ftは国際フィート、us_survey_ftはUS Survey Foot（1200/3937 m）です。単位の選択は原資料で確認してください。"));
        } else {
            errors.push(diagnostic(
                None,
                None,
                field,
                "単位はm・ft（国際フィート）・us_survey_ftのみ対応。推定や別名の解釈は行いません",
            ));
        }
    }
    if let Some(data) = &source.dataset {
        if let Err(error) = crate::provenance::validate(data) {
            errors.push(diagnostic(None, None, "dataset", error));
        }
    }
    warnings.extend(crate::provenance::warnings(source.dataset.as_ref()));
    warnings.push("起伏のある地盤点を保持します。計算水深で単一の連続流路となり、限界水深・等流水深が一意になる範囲だけ計算します。取込みの成功は水理計算や標高基準の確認成功を意味しません。".into());
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
            imported_at: inspected_at.clone(),
            elevation_mode: match source.elevation_mode {
                ElevationMode::Absolute => "absolute",
                ElevationMode::Relative => "relative",
            }
            .into(),
            unit: source.unit.clone(),
            vertical_unit: source.vertical_unit.clone(),
            dataset: source.dataset.clone(),
        }),
    };
    let mut stations: Vec<Station> = Vec::new();
    let mut geometry = None;
    if errors.is_empty() {
        let distance_scale = distance_scale.expect("distance unit validated");
        let height_scale = height_scale.expect("height unit validated");
        let headers = std::array::from_fn::<_, 6, _>(|i| {
            let unit = if matches!(i, 2 | 5) {
                height_unit
            } else {
                &source.unit
            };
            HEADERS[i].replace("_m", &format!("_{unit}"))
        });
        let mut reader = csv::ReaderBuilder::new()
            .trim(csv::Trim::All)
            .from_reader(source.csv.trim_start_matches('\u{feff}').as_bytes());
        match reader.headers() {
            Ok(h) if h.iter().eq(headers.iter().map(String::as_str)) => {}
            _ => errors.push(diagnostic(
                Some(1),
                None,
                "header",
                format!(
                    "選択単位（距離 {} / 高さ {}）のヘッダーと順序は {}",
                    source.unit,
                    height_unit,
                    headers.join(",")
                ),
            )),
        }
        if errors.is_empty() {
            let mut seen = HashSet::new();
            let mut current = String::new();
            let mut native_conditions = None;
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
                    .map(|i| number(&record, i, line, &headers[i], &mut errors))
                    .collect();
                let [Some(chainage), Some(bed), Some(n), Some(x), Some(elevation)] =
                    values.as_slice()
                else {
                    continue;
                };
                let original_conditions = (*chainage, *bed, *n);
                // Subtract the original absolute heights before scaling. Never round or repair vertices.
                let native_z = match source.elevation_mode {
                    ElevationMode::Absolute => elevation - bed,
                    ElevationMode::Relative => *elevation,
                };
                if native_z < 0.0 {
                    errors.push(diagnostic(
                        line,
                        Some(id),
                        &headers[5],
                        "元単位での河床からの相対高さは0以上が必要です",
                    ));
                    continue;
                }
                let z = native_z * height_scale;
                let (chainage, bed, x) = (
                    *chainage * distance_scale,
                    *bed * height_scale,
                    *x * distance_scale,
                );
                if [chainage, bed, x, z].iter().any(|v| !v.is_finite()) {
                    errors.push(diagnostic(
                        line,
                        Some(id),
                        "coordinates",
                        "相対高さの差またはm換算後の値が非有限です",
                    ));
                    continue;
                }
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
                    native_conditions = Some(original_conditions);
                    locations.push((line, id.to_owned()));
                    stations.push(Station {
                        chainage,
                        bed_elevation: bed,
                        roughness: *n,
                        section: Section::Survey { points: Vec::new() },
                    });
                }
                let st = stations.last_mut().expect("station added");
                if native_conditions != Some(original_conditions) {
                    errors.push(diagnostic(
                        line,
                        Some(id),
                        "station",
                        "同一断面内の流下距離・河床標高・粗度が一致しません",
                    ));
                }
                if let Section::Survey { points } = &mut st.section {
                    points.push(Point { x, z });
                }
            }
            for (st, (line, id)) in stations.iter().zip(&locations) {
                if let Err(e) = doboku_geometry::validate(&st.section) {
                    errors.push(diagnostic(*line, Some(id), "section", e));
                }
            }
            if errors.is_empty() {
                match inspect_geometry(&stations) {
                    Ok(checks) => {
                        for (i, transition) in checks.transitions.iter().enumerate() {
                            let label = format!("{} → {}", locations[i].1, locations[i + 1].1);
                            for issue in &transition.issues {
                                errors.push(diagnostic(
                                    locations[i + 1].0,
                                    Some(&label),
                                    "transition",
                                    issue,
                                ));
                            }
                        }
                        let sections = stations
                            .iter()
                            .zip(&locations)
                            .zip(checks.sections)
                            .map(|((station, (line, id)), check)| PreviewSection {
                                id: id.clone(),
                                line: *line,
                                station: station.clone(),
                                connected_depth_ranges: check.connected_depth_ranges,
                            })
                            .collect();
                        geometry = Some(GeometryPreview {
                            sections,
                            transitions: checks.transitions,
                            can_import: checks.can_import,
                            note: checks.note,
                        });
                    }
                    Err(error) => errors.push(diagnostic(None, None, "river", error)),
                }
            }
        }
    }
    let valid = errors.is_empty();
    if !valid {
        stations.clear();
        if geometry.is_some() {
            warnings.push("取込みは拒否しました。元の点列を幾何点検用に表示します。プレビューの形状を確認しても、拒否条件のまま反映・計算はできません。".into());
        }
    }
    let review_token =
        valid.then(|| hash(&serde_json::to_vec(source).expect("source serializable")));
    Preview {
        engine_version: doboku_core::ENGINE_VERSION,
        inspected_at,
        valid,
        stations,
        reference,
        diagnostics: errors,
        warnings,
        review_token,
        geometry,
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
