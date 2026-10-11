use doboku_agent::CompatibleProvider;
use std::sync::Arc;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::var("DATABASE_PATH").unwrap_or_else(|_| ".local/doboku.sqlite".into());
    if let Some(parent) = std::path::Path::new(&path).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    let mut state = doboku_api::state(&path)?;
    if let (Ok(endpoint), Ok(model), Ok(api_key)) = (
        std::env::var("LLM_ENDPOINT"),
        std::env::var("LLM_MODEL"),
        std::env::var("LLM_API_KEY"),
    ) {
        if !api_key.is_empty() {
            state.llm = Some(Arc::new(CompatibleProvider {
                endpoint,
                model,
                api_key,
            }));
        }
    }
    let bind = std::env::var("API_BIND").unwrap_or_else(|_| "127.0.0.1:3001".into());
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    println!("DobokuAI API listening on {bind}");
    axum::serve(listener, doboku_api::app(state))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
