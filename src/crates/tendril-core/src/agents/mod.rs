pub mod catalog;
// Deliberately not re-exported below: `eventwire::text_event` and `eventwire::event_wire_text` are
// too generically named to live in `agents::*` alongside everything else. Use
// `agents::eventwire::EventWireNormalizer`.
pub mod eventwire;
// Deliberately not re-exported below: `instructions::compile` and `instructions::TEMPLATE` are too
// generically named to live in `agents::*` alongside everything else.
pub mod instructions;
pub mod model_cache;
// Deliberately not re-exported below: `model_sorting::sort_models` and its `Version` are too
// generically named to live in `agents::*` alongside everything else.
pub mod model_sorting;
pub mod model_specs;
pub mod pricing;
// Deliberately not re-exported below: `probe::check_install`, `check_auth` and `validate_model` are
// too generically named to live in `agents::*`. Use `agents::probe::*`.
pub mod probe;
// Deliberately not re-exported below: `provider_models::redact` and `select_model` are too generically
// named to live in `agents::*` alongside everything else. Use `agents::provider_models::*`.
pub mod provider_models;
pub mod providers;
pub mod reconcile;
pub mod resolution;
pub mod runner;
pub mod truncation;
// Deliberately not re-exported below: `usage::format_window` and friends are too generically named
// to live in `agents::*`. Use `agents::usage::*`.
pub mod usage;

pub use catalog::*;
pub use model_cache::*;
pub use model_specs::*;
pub use pricing::*;
pub use providers::*;
pub use reconcile::*;
pub use resolution::*;
pub use runner::*;
pub use truncation::*;
