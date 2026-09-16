//! Share *sessions*: who the anonymous visitor on the far end of a share tunnel is, and what they are
//! allowed to do.
//!
//! A port of the original's `Services/Share/**` (`ShareContext`, `IShareContext`,
//! `AnonymousPersonaGenerator`) together with the enforcement that was spread across
//! `AppShell/TendrilAppShell.cs` (`ShareAllowedAppIds`) and `TendrilServer.cs`'s share-mode
//! middleware.
//!
//! The split matters:
//!
//! - [`context`] answers *is this request a share, and who is asking* — the original's `IShareContext`.
//! - [`policy`] answers *what may a share do* — the original's `ShareAllowedAppIds`, moved from the
//!   nav to the API. See that module for why: in V1 filtering the nav was most of the enforcement,
//!   and in V2 it is none of it.
//! - [`persona`] is the friendly name a comment is attributed to.

pub mod context;
pub mod persona;
pub mod policy;

pub use context::{is_share_mode, ShareSignals};
pub use policy::{share_token_allows, SHARE_ALLOWED_APP_IDS};
