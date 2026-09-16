//! Where the live [`ShareTunnelService`] lives.
//!
//! In the original this is a DI singleton (`ServiceRegistration.cs` registers `IShareTunnelService`
//! as one) and every consumer takes it as a constructor argument. V2's equivalent would be a field on
//! `tendril_server::AppState`, and that is where it belongs — but `AppState` is not this area's to
//! change, so the service is looked up here instead, keyed by `TENDRIL_HOME`.
//!
//! Keying by home rather than using a bare `OnceLock` is not just tidiness: it means two tests in one
//! binary, each with its own temp home, get their own service, and a daemon can never pick up a
//! tunnel that belongs to a different installation.
//!
//! **Recommended follow-up:** move this to `AppState { share_tunnel: Arc<ShareTunnelService> }` and
//! delete the map. Nothing else about the feature changes.

use super::service::ShareTunnelService;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

type Registry = Mutex<HashMap<PathBuf, Arc<ShareTunnelService>>>;

fn registry() -> &'static Registry {
    static REGISTRY: OnceLock<Registry> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn lock() -> std::sync::MutexGuard<'static, HashMap<PathBuf, Arc<ShareTunnelService>>> {
    registry()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// The service for `tendril_home`, creating it on first use. Creating one starts nothing: a service
/// with no supervisor is `Disabled` and holds no resources.
pub fn for_home(tendril_home: &Path) -> Arc<ShareTunnelService> {
    let mut guard = lock();
    guard
        .entry(tendril_home.to_path_buf())
        .or_insert_with(|| Arc::new(ShareTunnelService::new(tendril_home.to_path_buf())))
        .clone()
}

/// The service for `tendril_home` only if one has ever been created — for readers that must not cause
/// one to exist as a side effect of asking.
pub fn existing(tendril_home: &Path) -> Option<Arc<ShareTunnelService>> {
    lock().get(tendril_home).cloned()
}

/// Forgets the service for `tendril_home`, if any, and returns it so a caller can stop it.
///
/// Dropping the returned handle does *not* stop a running tunnel — the supervisor task owns the
/// session, not this map — so a caller that wants the child dead must `stop().await` it.
pub fn forget(tendril_home: &Path) -> Option<Arc<ShareTunnelService>> {
    lock().remove(tendril_home)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_home(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "tendril-tunnel-registry-{label}-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn the_same_home_always_gets_the_same_service() {
        let home = temp_home("same");
        let first = for_home(&home);
        let second = for_home(&home);
        assert!(Arc::ptr_eq(&first, &second));
        forget(&home);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn different_homes_get_different_services() {
        let a = temp_home("a");
        let b = temp_home("b");
        assert!(!Arc::ptr_eq(&for_home(&a), &for_home(&b)));
        assert_eq!(for_home(&a).tendril_home(), a.as_path());
        forget(&a);
        forget(&b);
        let _ = std::fs::remove_dir_all(&a);
        let _ = std::fs::remove_dir_all(&b);
    }

    #[test]
    fn asking_for_an_existing_service_does_not_create_one() {
        let home = temp_home("existing");
        assert!(existing(&home).is_none());
        let _ = for_home(&home);
        assert!(existing(&home).is_some());
        assert!(forget(&home).is_some());
        assert!(existing(&home).is_none());
        let _ = std::fs::remove_dir_all(&home);
    }
}
