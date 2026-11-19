//! End-to-end MCP tests: a real node child process acting as the MCP
//! server, the full spawn → handshake → tools/list → tools/call path.
//! Skips silently when node is unavailable (the framing and mapping
//! logic is covered by the unit tests in `src/mcp.rs`).

use prism_core::agent::Tool as _;
use prism_core::mcp::{self, McpSurface, StdioMcpServer};
use std::time::Duration;

fn node_available() -> bool {
    std::process::Command::new("node")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn server_path() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/mcp-fake-server.mjs")
}

fn timeout() -> Duration {
    Duration::from_secs(10)
}

#[test]
fn handshake_tools_and_calls_against_a_real_child() {
    if !node_available() {
        eprintln!("skipping: node not available");
        return;
    }
    let file = mcp::McpFile {
        mcp_servers: [(
            "calc".to_string(),
            mcp::McpServerConfig {
                command: "node".into(),
                args: vec![server_path().to_string_lossy().into()],
                env: Default::default(),
            },
        )]
        .into_iter()
        .collect(),
        subagents: Vec::new(),
    };
    let surface = McpSurface::connect(&file, timeout());
    assert!(surface.errors.is_empty(), "{:?}", surface.errors);

    let mut names: Vec<&str> = surface
        .tools
        .iter()
        .map(|t| t.advertised.as_str())
        .collect();
    names.sort();
    assert_eq!(
        names,
        vec!["mcp__calc__add", "mcp__calc__boom", "mcp__calc__echo"]
    );

    let echo = surface
        .tools
        .iter()
        .find(|t| t.advertised == "mcp__calc__echo")
        .unwrap();
    // JSON args pass through; bare strings wrap into the declared arg.
    assert_eq!(echo.execute("{\"text\":\"hi\"}"), "echo:{\"text\":\"hi\"}");
    assert_eq!(echo.execute("hello"), "echo:{\"text\":\"hello\"}");
    // isError results reach the model under the classified prefix.
    assert_eq!(
        echo.execute("{\"text\":\"fail\"}"),
        "Error: requested failure"
    );

    let add = surface
        .tools
        .iter()
        .find(|t| t.advertised == "mcp__calc__add")
        .unwrap();
    assert_eq!(add.execute("{\"a\":2,\"b\":3}"), "5");

    let boom = surface
        .tools
        .iter()
        .find(|t| t.advertised == "mcp__calc__boom")
        .unwrap();
    assert_eq!(boom.execute("x"), "sanitized ok");
    assert_eq!(boom.description(), "MCP (calc): name that needs sanitizing");
}

#[test]
fn dead_and_hung_servers_are_reported_not_fatal() {
    if !node_available() {
        eprintln!("skipping: node not available");
        return;
    }
    let file = mcp::McpFile {
        mcp_servers: [
            (
                "ghost".to_string(),
                mcp::McpServerConfig {
                    command: "prism-definitely-not-a-binary-xyz".into(),
                    args: Vec::new(),
                    env: Default::default(),
                },
            ),
            (
                "calc".to_string(),
                mcp::McpServerConfig {
                    command: "node".into(),
                    args: vec![server_path().to_string_lossy().into()],
                    env: Default::default(),
                },
            ),
        ]
        .into_iter()
        .collect(),
        subagents: Vec::new(),
    };
    let surface = McpSurface::connect(&file, timeout());
    assert!(
        surface.errors.iter().any(|e| e.starts_with("ghost")),
        "{:?}",
        surface.errors
    );
    // The surviving server still advertises and answers.
    assert_eq!(surface.tools.len(), 3);
    let add = surface
        .tools
        .iter()
        .find(|t| t.advertised == "mcp__calc__add")
        .unwrap();
    assert_eq!(add.execute("{\"a\":1,\"b\":1}"), "2");
}

#[test]
fn a_hung_server_times_out_and_ends_up_dead() {
    let server = StdioMcpServer::spawn(
        "silent",
        &mcp::McpServerConfig {
            // Never answers: init can only time out.
            command: "sleep".into(),
            args: vec!["30".into()],
            env: Default::default(),
        },
        Duration::from_millis(300),
    );
    let err = match server {
        Ok(_) => panic!("silent server should fail the handshake"),
        Err(e) => e,
    };
    assert!(err.contains("timed out"), "{err}");
}
