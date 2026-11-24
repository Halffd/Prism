//! `prism-native-server`: a Rust-native local chat and image backend.
//! See the library docs for the wire surface.

use prism_native_server::{ServerConfig, DEFAULT_BIND};

fn main() {
    let mut bind = DEFAULT_BIND.to_string();
    let mut config = ServerConfig::from_env();
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--bind" => {
                if let Some(value) = args.next() {
                    bind = value;
                }
            }
            "--sd-model" => {
                if let Some(value) = args.next() {
                    config.sd_model = Some(value);
                }
            }
            "--sd-version" => {
                if let Some(value) = args.next() {
                    config.sd_version = Some(value);
                }
            }
            "--llm-model" => {
                if let Some(value) = args.next() {
                    config.llm_model = Some(value);
                }
            }
            "--llm-tokenizer" => {
                if let Some(value) = args.next() {
                    config.llm_tokenizer = Some(value);
                }
            }
            "--llm-format" => {
                if let Some(value) = args.next() {
                    config.llm_format = Some(value);
                }
            }
            "--help" | "-h" => {
                println!(
                    "prism-native-server [--bind ADDR] [--sd-model DIR] [--sd-version ID] [--llm-model FILE] [--llm-tokenizer FILE] [--llm-format ID]"
                );
                println!("  default: {DEFAULT_BIND}");
                println!("  chat:     POST /v1/chat/completions, /api/chat");
                println!("  models:   GET  /v1/models, /api/tags");
                println!("  images:   POST /sdapi/v1/txt2img, /sdapi/v1/img2img");
                println!("  sd-model: local Diffusers-style weights (needs --features candle-sd)");
                println!("  sd-version: v1-5 | v2-1 | sdxl | sdxl-turbo (default: autodetect)");
                println!("  llm-model: local GGUF weights (needs --features candle-llm)");
                println!("  llm-tokenizer: tokenizer.json file/dir (default: beside the GGUF)");
                println!("  llm-format: auto | chatml | llama3 | llama2 | mistral | zephyr | deepseek | gemma | plain");
                return;
            }
            other => {
                eprintln!("unknown argument: {other}");
                std::process::exit(2);
            }
        }
    }

    if config.sd_model.is_some() && !cfg!(feature = "candle-sd") {
        eprintln!("--sd-model requires prism-native-server built with --features candle-sd");
        std::process::exit(2);
    }
    if config.llm_model.is_some() && !cfg!(feature = "candle-llm") {
        eprintln!("--llm-model requires prism-native-server built with --features candle-llm");
        std::process::exit(2);
    }

    if let Err(error) = prism_native_server::serve_with_config(&bind, config) {
        eprintln!("server failed: {error}");
        std::process::exit(1);
    }
}
