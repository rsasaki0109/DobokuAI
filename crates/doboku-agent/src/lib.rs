//! Natural language produces typed, reviewable proposals; never executes calculations.
use doboku_core::{positive, Error, Result};
use doboku_planning::Modification;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "tool", rename_all = "snake_case", deny_unknown_fields)]
pub enum Action {
    SetDischarge { value: f64 },
    CompareRoughness { value: f64 },
    CompareExcavation { depth: f64 },
    CreateReport,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Proposal {
    pub actions: Vec<Action>,
    pub explanation: String,
}
impl Proposal {
    pub fn validate(&self) -> Result<()> {
        if self.actions.is_empty() || self.actions.len() > 4 || self.explanation.len() > 4000 {
            return Err(Error::Invalid(
                "提案は1〜4個のツール、説明4000バイト以内".into(),
            ));
        }
        for a in &self.actions {
            match a {
                Action::SetDischarge { value } => {
                    positive("提案流量", *value)?;
                    if *value > 1e6 {
                        return Err(Error::Invalid("流量の上限は10⁶".into()));
                    }
                }
                Action::CompareRoughness { value } => {
                    if !value.is_finite() || !(0.005..=0.2).contains(value) {
                        return Err(Error::Invalid("粗度は0.005〜0.2".into()));
                    }
                }
                Action::CompareExcavation { depth } => {
                    positive("掘削深", *depth)?;
                    if *depth > 10.0 {
                        return Err(Error::Invalid("掘削深の上限は10m".into()));
                    }
                }
                Action::CreateReport => {}
            }
        }
        Ok(())
    }
}
impl Action {
    pub fn modification(&self) -> Option<Modification> {
        match self {
            Self::CompareRoughness { value } => Some(Modification::Roughness { value: *value }),
            Self::CompareExcavation { depth } => Some(Modification::Excavate { depth: *depth }),
            _ => None,
        }
    }
}
pub trait Provider {
    fn propose(&self, prompt: &str) -> impl std::future::Future<Output = Result<Proposal>> + Send;
}
pub struct LocalRules;
impl LocalRules {
    pub fn parse(prompt: &str) -> Result<Proposal> {
        if prompt.len() > 2000 {
            return Err(Error::Invalid("入力は2000バイト以内".into()));
        }
        // Deliberately restrict local mode to one explicit command, avoiding silent guesses.
        let number = Regex::new(r"[-+]?\d+(?:\.\d+)?").unwrap();
        let values: Vec<f64> = number
            .find_iter(prompt)
            .filter_map(|m| m.as_str().parse().ok())
            .collect();
        let value = values.first().copied();
        let report = prompt.contains("レポート") || prompt.to_lowercase().contains("report");
        let keywords = [
            prompt.contains("流量"),
            prompt.contains("粗度"),
            prompt.contains("掘削"),
            report,
        ];
        if keywords.iter().filter(|v| **v).count() != 1 || (!report && values.len() != 1) {
            return Err(Error::Invalid("ローカル操作は1条件ずつ。例: 流量を100に変更 / 粗度を0.03に変更して比較 / 1m掘削 / レポート".into()));
        }
        let a = if report {
            Action::CreateReport
        } else if prompt.contains("流量") {
            Action::SetDischarge {
                value: value.unwrap(),
            }
        } else if prompt.contains("粗度") {
            Action::CompareRoughness {
                value: value.unwrap(),
            }
        } else {
            Action::CompareExcavation {
                depth: value.unwrap(),
            }
        };
        let p=Proposal{actions:vec![a],explanation:"ローカルルールによる操作提案です。条件を確認して適用するとRustエンジンが再計算します。数値結果の生成にAIは使用しません。".into()};
        p.validate()?;
        Ok(p)
    }
}
impl Provider for LocalRules {
    async fn propose(&self, prompt: &str) -> Result<Proposal> {
        Self::parse(prompt)
    }
}
/// Configurable OpenAI-compatible transport, replaceable through Provider.
/// API keys are read by the host, never serialized into project data.
pub struct CompatibleProvider {
    pub endpoint: String,
    pub model: String,
    pub api_key: String,
}
impl Provider for CompatibleProvider {
    async fn propose(&self, prompt: &str) -> Result<Proposal> {
        if prompt.len() > 2000 {
            return Err(Error::Invalid("入力は2000バイト以内".into()));
        }
        let url =
            reqwest::Url::parse(&self.endpoint).map_err(|_| Error::Invalid("LLM URL".into()))?;
        if url.scheme() != "https" {
            return Err(Error::Invalid("LLM endpoint はHTTPSが必要".into()));
        }
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| Error::Numerical("LLM client".into()))?;
        self.request(prompt, url, client).await
    }
}
impl CompatibleProvider {
    // Private transport seam permits loopback HTTP contract tests. The public
    // Provider always validates HTTPS and builds the production TLS client above.
    async fn request(
        &self,
        prompt: &str,
        url: reqwest::Url,
        client: reqwest::Client,
    ) -> Result<Proposal> {
        let system="You propose tools for civil engineering. Return ONLY JSON with actions (1 to 4) and explanation (Japanese). Actions are {tool:set_discharge,value:number}, {tool:compare_roughness,value:number}, {tool:compare_excavation,depth:number}, {tool:create_report}. Do not invent input values, costs, durations or numerical results. If no supported explicit action is requested return actions:[] and explain. No markdown.";
        let response=client.post(url).bearer_auth(&self.api_key).json(&serde_json::json!({"model":self.model,"temperature":0,"max_tokens":1000,"messages":[{"role":"system","content":system},{"role":"user","content":prompt}]})).send().await.map_err(|_|Error::Numerical("LLMへの接続に失敗。数値計算は引き続き使用できます".into()))?;
        if !response.status().is_success() {
            return Err(Error::Numerical(format!("LLM HTTP {}", response.status())));
        }
        if response.content_length().is_some_and(|v| v > 65536) {
            return Err(Error::Invalid("LLM応答が大きすぎます".into()));
        }
        let mut response = response;
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| Error::Numerical("LLM応答読み取り".into()))?
        {
            if bytes.len() + chunk.len() > 65536 {
                return Err(Error::Invalid("LLM応答上限".into()));
            }
            bytes.extend(chunk);
        }
        let body: serde_json::Value =
            serde_json::from_slice(&bytes).map_err(|_| Error::Invalid("LLM JSON応答".into()))?;
        let content = body["choices"][0]["message"]["content"]
            .as_str()
            .ok_or_else(|| Error::Invalid("LLM contentがありません".into()))?;
        let proposal: Proposal = serde_json::from_str(content)
            .map_err(|_| Error::Invalid("LLMが型付きツールに適合しません".into()))?;
        proposal.validate()?;
        Ok(proposal)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    fn provider() -> CompatibleProvider {
        CompatibleProvider {
            endpoint: "http://127.0.0.1/".into(),
            model: "test-model".into(),
            api_key: "test-key".into(),
        }
    }
    async fn fixture(response: String, timeout: Duration, delay: Duration) -> Result<Proposal> {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = reqwest::Url::parse(&format!(
            "http://{}/chat/completions",
            listener.local_addr().unwrap()
        ))
        .unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut bytes = Vec::new();
            loop {
                let mut chunk = [0; 2048];
                let n = socket.read(&mut chunk).await.unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&chunk[..n]);
                if let Some(index) = bytes.windows(4).position(|v| v == b"\r\n\r\n") {
                    let header = String::from_utf8_lossy(&bytes[..index]).to_lowercase();
                    let length: usize = header
                        .lines()
                        .find_map(|line| line.strip_prefix("content-length: "))
                        .unwrap()
                        .trim()
                        .parse()
                        .unwrap();
                    if bytes.len() >= index + 4 + length {
                        assert!(header.contains("authorization: bearer test-key"));
                        let body: serde_json::Value =
                            serde_json::from_slice(&bytes[index + 4..index + 4 + length]).unwrap();
                        assert_eq!(body["model"], "test-model");
                        assert_eq!(body["messages"][1]["content"], "流量を100");
                        assert!(body.get("project").is_none());
                        break;
                    }
                }
            }
            tokio::time::sleep(delay).await;
            let _ = socket.write_all(response.as_bytes()).await;
        });
        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(timeout)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        let result = provider().request("流量を100", url, client).await;
        server.await.unwrap();
        result
    }
    fn reply(status: &str, body: &str) -> String {
        format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len())
    }
    fn envelope(content: &str) -> String {
        serde_json::json!({"choices":[{"message":{"content":content}}]}).to_string()
    }

    #[tokio::test]
    async fn provider_contract_accepts_only_valid_typed_proposals() {
        let body = envelope(
            r#"{"actions":[{"tool":"set_discharge","value":100}],"explanation":"確認してください"}"#,
        );
        assert!(matches!(
            fixture(
                reply("200 OK", &body),
                Duration::from_secs(2),
                Duration::ZERO
            )
            .await
            .unwrap()
            .actions[0],
            Action::SetDischarge { value: 100.0 }
        ));
        for body in [
            "not JSON".into(),
            "{}".into(),
            envelope("```json\n{}\n```"),
            envelope(r#"{"actions":[],"explanation":"unsupported"}"#),
            envelope(r#"{"actions":[{"tool":"set_discharge","value":-1}],"explanation":"bad"}"#),
            envelope(r#"{"actions":[{"tool":"execute_shell"}],"explanation":"bad"}"#),
        ] {
            assert!(fixture(
                reply("200 OK", &body),
                Duration::from_secs(2),
                Duration::ZERO
            )
            .await
            .is_err());
        }
        assert!(provider()
            .propose("流量を100")
            .await
            .unwrap_err()
            .to_string()
            .contains("HTTPS"));
    }
    #[tokio::test]
    async fn provider_contract_handles_status_size_and_timeout_without_exposing_response_secrets() {
        for status in ["401 Unauthorized", "429 Too Many Requests", "302 Found"] {
            let error = fixture(
                reply(status, "secret-body"),
                Duration::from_secs(2),
                Duration::ZERO,
            )
            .await
            .unwrap_err()
            .to_string();
            assert!(error.contains("LLM HTTP"));
            assert!(!error.contains("secret-body") && !error.contains("test-key"));
        }
        let large = "x".repeat(65537);
        assert!(fixture(
            reply("200 OK", &large),
            Duration::from_secs(2),
            Duration::ZERO
        )
        .await
        .unwrap_err()
        .to_string()
        .contains("大きすぎ"));
        let streamed = format!("HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n{large}");
        assert!(fixture(streamed, Duration::from_secs(2), Duration::ZERO)
            .await
            .unwrap_err()
            .to_string()
            .contains("上限"));
        assert!(fixture(
            reply("200 OK", "{}"),
            Duration::from_millis(50),
            Duration::from_millis(200)
        )
        .await
        .unwrap_err()
        .to_string()
        .contains("接続"));
    }
    #[test]
    fn japanese_examples_map_to_closed_tools() {
        assert!(matches!(
            LocalRules::parse("流量を100m³/sに変更して再計算して")
                .unwrap()
                .actions[0],
            Action::SetDischarge { value: 100.0 }
        ));
        assert!(matches!(
            LocalRules::parse("粗度係数を0.03に変更した場合の水位を比較して")
                .unwrap()
                .actions[0],
            Action::CompareRoughness { .. }
        ));
        assert!(matches!(
            LocalRules::parse("河道を1m掘削した場合の水面形を表示して")
                .unwrap()
                .actions[0],
            Action::CompareExcavation { depth: 1.0 }
        ));
        assert!(matches!(
            LocalRules::parse("施工前後の計算結果をレポートにまとめて")
                .unwrap()
                .actions[0],
            Action::CreateReport
        ));
    }
    #[test]
    fn ambiguous_or_dangerous_inputs_are_not_guessed() {
        for s in [
            "流量を-1",
            "粗度を0",
            "掘削を20m",
            "適当に設計して",
            "流量100と粗度0.03",
            "流量100から200",
        ] {
            assert!(LocalRules::parse(s).is_err(), "{s}");
        }
        assert!(
            serde_json::from_str::<Action>(r#"{"tool":"execute_shell","command":"rm"}"#).is_err()
        );
    }
}
