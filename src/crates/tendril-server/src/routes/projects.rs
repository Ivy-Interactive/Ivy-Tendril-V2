//! `/api/projects` — the project registry the app and CLI both drive.
//!
//! One module per sub-resource, mirroring the route tree this crate's router builds: `crud` for the
//! project record, then `repos`, `verifications`, `review_actions` and `hooks` for the
//! collections hanging off it. `payloads` holds the request bodies, which are shared across
//! several of those, and `cloning` the remote-URL-to-local-clone pass that create and update and
//! add-repo all need.
//!
//! Every handler is re-exported here so the router keeps naming them `projects::<handler>`.

mod cloning;
mod crud;
mod hooks;
mod payloads;
mod repos;
mod review_actions;
mod verifications;

pub use crud::{
    create_project, delete_project, get_project, get_project_issues, get_project_issues_metadata,
    list_projects, purge_project, update_project,
};
pub use hooks::{add_project_hook, remove_project_hook};
pub use repos::{add_project_repo, remove_project_repo, sync_project_repos};
pub use review_actions::{
    add_project_review_action, execute_review_action, remove_project_review_action,
    review_action_conditions, review_action_input, review_action_resize,
};
pub use verifications::{
    add_project_verification, move_project_verification_route, remove_project_verification,
};
