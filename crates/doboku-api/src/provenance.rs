//! Validate declarations without fetching sources or claiming licence approval.
use axum::http::Uri;
use doboku_core::{DataKind, DatasetProvenance, Error, Result};

pub fn validate(data: &DatasetProvenance) -> Result<()> {
    for (name, value, limit, multiline) in [
        ("出典URL", &data.source_url, 1000, false),
        ("出典・著作者", &data.attribution, 1000, true),
        ("利用条件", &data.usage_terms, 2000, true),
        ("測量日", &data.survey_date, 10, false),
        ("変換・処理手順", &data.processing, 4000, true),
    ] {
        if value.len() > limit
            || value
                .chars()
                .any(|c| c.is_control() && !(multiline && matches!(c, '\n' | '\t')))
        {
            return Err(Error::Invalid(format!(
                "{name}は{limit}バイト以内、制御文字不可（説明欄の改行・タブを除く）"
            )));
        }
    }
    if !data.source_url.is_empty() {
        let valid = data.source_url.parse::<Uri>().ok().is_some_and(|uri| {
            matches!(uri.scheme_str(), Some("http" | "https"))
                && uri.host().is_some_and(|host| !host.is_empty())
                && uri.authority().is_some_and(|a| !a.as_str().contains('@'))
        });
        if !valid {
            return Err(Error::Invalid(
                "出典URLは認証情報を含まないhttp/httpsの絶対URLが必要です".into(),
            ));
        }
    }
    if !data.survey_date.is_empty()
        && chrono::NaiveDate::parse_from_str(&data.survey_date, "%Y-%m-%d")
            .ok()
            .is_none_or(|date| date.format("%Y-%m-%d").to_string() != data.survey_date)
    {
        return Err(Error::Invalid(
            "測量日は実在する日付YYYY-MM-DD、または未記入にしてください".into(),
        ));
    }
    Ok(())
}

pub fn warnings(data: Option<&DatasetProvenance>) -> Vec<String> {
    let Some(data) = data else {
        return vec!["データ種別・出典・利用条件・測量日・処理手順は未記録です。実測データとしての試行確認は未完了です。".into()];
    };
    let mut missing = Vec::new();
    if data.data_kind == DataKind::Unspecified {
        missing.push("データ種別");
    }
    for (name, value) in [
        ("出典URL", &data.source_url),
        ("出典・著作者", &data.attribution),
        ("利用条件", &data.usage_terms),
        ("変換・処理手順", &data.processing),
    ] {
        if value.trim().is_empty() {
            missing.push(name);
        }
    }
    if data.data_kind != DataKind::Synthetic && data.survey_date.is_empty() {
        missing.push("測量日");
    }
    let mut warnings = vec![
        "出典情報は利用者の申告です。配布元・利用条件・測量品質を自動確認していません。".into(),
    ];
    if !missing.is_empty() {
        warnings.push(format!(
            "未記録: {}。不明な情報を推測で補わず、一次資料で確認してください。",
            missing.join("・")
        ));
    }
    if data.data_kind == DataKind::Synthetic {
        warnings.push("合成データです。実河川の測量・実務試行の証拠にはなりません。".into());
    }
    warnings
}

pub fn html(data: Option<&DatasetProvenance>) -> String {
    use crate::report::escape;
    let mut result = "<h3>データ出典（利用者申告）</h3>".to_owned();
    if let Some(data) = data {
        let kind = match data.data_kind {
            DataKind::Unspecified => "未指定",
            DataKind::Synthetic => "合成",
            DataKind::Measured => "実測（利用者申告）",
        };
        result.push_str(&format!("<p>データ種別: {kind}</p>"));
        for (name, value) in [
            ("出典URL", &data.source_url),
            ("出典・著作者", &data.attribution),
            ("利用条件", &data.usage_terms),
            ("測量日", &data.survey_date),
            ("変換・処理手順", &data.processing),
        ] {
            result.push_str(&format!(
                "<p>{name}</p><pre>{}</pre>",
                escape(if value.trim().is_empty() {
                    "未記録"
                } else {
                    value
                })
            ));
        }
    }
    for warning in warnings(data) {
        result.push_str(&format!("<p>{}</p>", escape(&warning)));
    }
    result
}
