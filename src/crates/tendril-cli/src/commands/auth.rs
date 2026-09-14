//! `tendril auth hash-password` — the only way to produce the `auth.password` / `auth.hashSecret`
//! pair, ported from `Commands/HashPasswordCommand.cs`.
//!
//! Nothing is written to `config.yaml` here: the command prints the values and the operator pastes
//! them in. That is the original's behaviour, and it keeps a command that handles a plaintext password
//! from also needing write access to the config.

use tendril_core::auth::password::{generate_hash_secret, hash_password};

#[derive(clap::Subcommand)]
pub enum AuthCommands {
    #[command(
        name = "hash-password",
        about = "Hash a password for config.yaml's auth section"
    )]
    HashPassword(HashPasswordArgs),
}

#[derive(clap::Args)]
pub struct HashPasswordArgs {
    /// The password to hash.
    pub password: String,

    /// Existing base64 `auth.hashSecret` to hash against. A new one is generated when omitted —
    /// reuse the existing value when changing the password of an install that already has one, or
    /// every previously issued session token stops being honoured.
    #[arg(long = "hash-secret")]
    pub hash_secret: Option<String>,
}

pub fn handle_auth_command(command: AuthCommands) -> anyhow::Result<()> {
    match command {
        AuthCommands::HashPassword(args) => handle_hash_password(args),
    }
}

fn handle_hash_password(args: HashPasswordArgs) -> anyhow::Result<()> {
    let generated = args.hash_secret.is_none();
    let hash_secret = args
        .hash_secret
        .map(|secret| secret.trim().to_string())
        .unwrap_or_else(generate_hash_secret);

    let hash = hash_password(&args.password, &hash_secret)?;

    println!("Password hash:");
    println!("{hash}");
    println!();
    println!(
        "Hash secret{}:",
        if generated {
            " (newly generated)"
        } else {
            " (as supplied)"
        }
    );
    println!("{hash_secret}");
    println!();
    println!("Add to config.yaml:");
    println!();
    println!("auth:");
    println!("  username: your-username");
    println!("  password: \"{hash}\"");
    println!("  hashSecret: \"{hash_secret}\"");

    Ok(())
}
