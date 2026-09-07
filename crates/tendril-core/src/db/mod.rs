pub mod costs;
pub mod jobs;
pub mod migrations;
pub mod plans;

pub use costs::*;
pub use jobs::*;
pub use migrations::*;
pub use plans::*;

use crate::error::Result;
use rusqlite::Connection;
use std::path::Path;

pub fn open_database(path: &Path) -> Result<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let conn = Connection::open(path)?;
    migrations::apply_migrations(&conn)?;
    Ok(conn)
}
