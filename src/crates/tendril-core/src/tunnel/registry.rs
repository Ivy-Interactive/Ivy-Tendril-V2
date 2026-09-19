//! Where the live [`TunnelService`]s live.
//!
//! In the original these are DI singletons (`ServiceRegistration.cs` registers `IShareTunnelService`
//! and `ICloudflaredService` as one each) and every consumer takes them as constructor arguments. V2's
//! equivalent would be fields on `tendril_server::AppState`, and that is where they belong — but
//! `AppState` is not this area's to change, so they are looked up here instead, keyed by `TENDRIL_HOME`
//! and [`TunnelKind`].
//!
//! Keying by home rather than using a bare `OnceLock` is not just tidiness: it means two tests in one
//! binary, each with its own temp home, get their own services, and a daemon can never pick up a
//! tunnel that belongs to a different installation. Keying by kind as well is what lets a share and a
//! full-access tunnel be up at the same time without sharing a supervisor.
//!
//! **Recommended follow-up:** move this to `AppState { share_tunnel, full_tunnel }` and delete the map.
//! Nothing else about the feature changes.

use super::service::TunnelService;
use super::status::TunnelKind;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

/// One entry per (home, kind) pair.
type Key = (PathBuf, TunnelKind);
type Registry = Mutex<HashMap<Key, Arc<TunnelService>>>;

fn registry() -> &'static Registry {
    static REGISTRY: OnceLock<Registry> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn lock() -> std::sync::MutexGuard<'static, HashMap<Key, Arc<TunnelService>>> {
    registry()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// The service for `tendril_home` and `kind`, creating it on first use. Creating one starts nothing: a
/// service with no supervisor is `Disabled` and holds no resources.
pub fn for_kind(kind: TunnelKind, tendril_home: &Path) -> Arc<TunnelService> {
    let mut guard = lock();
    guard
        .entry((tendril_home.to_path_buf(), kind))
        .or_insert_with(|| Arc::new(TunnelService::new(kind, tendril_home.to_path_buf())))
        .clone()
}

/// The share tunnel for `tendril_home`.
pub fn for_home(tendril_home: &Path) -> Arc<TunnelService> {
    for_kind(TunnelKind::Share, tendril_home)
}

/// The full-access tunnel for `tendril_home`.
pub fn full_for_home(tendril_home: &Path) -> Arc<TunnelService> {
    for_kind(TunnelKind::FullAccess, tendril_home)
}

/// The service for `tendril_home` and `kind` only if one has ever been created — for readers that must
/// not cause one to exist as a side effect of asking.
pub fn existing_of_kind(kind: TunnelKind, tendril_home: &Path) -> Option<Arc<TunnelService>> {
    lock().get(&(tendril_home.to_path_buf(), kind)).cloned()
}

/// [`existing_of_kind`] for the share tunnel.
pub fn existing(tendril_home: &Path) -> Option<Arc<TunnelService>> {
    existing_of_kind(TunnelKind::Share, tendril_home)
}

/// Forgets the service for `tendril_home` and `kind`, if any, and returns it so a caller can stop it.
///
/// Dropping the returned handle does *not* stop a running tunnel — the supervisor task owns the
/// session, not this map — so a caller that wants the child dead must `stop().await` it.
pub fn forget_of_kind(kind: TunnelKind, tendril_home: &Path) -> Option<Arc<TunnelService>> {
    lock().remove(&(tendril_home.to_path_buf(), kind))
}

/// [`forget_of_kind`] for the share tunnel.
pub fn forget(tendril_home: &Path) -> Option<Arc<TunnelService>> {
    forget_of_kind(TunnelKind::Share, tendril_home)
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

    /// The two tunnels for one home are two services, so a share and a full-access tunnel can be up
    /// together and stopping one cannot stop the other.
    #[test]
    fn the_two_kinds_are_separate_services_for_the_same_home() {
        let home = temp_home("kinds");
        let share = for_home(&home);
        let full = full_for_home(&home);

        assert!(!Arc::ptr_eq(&share, &full));
        assert_eq!(share.kind(), TunnelKind::Share);
        assert_eq!(full.kind(), TunnelKind::FullAccess);
        assert!(Arc::ptr_eq(&full, &full_for_home(&home)));

        assert!(forget_of_kind(TunnelKind::FullAccess, &home).is_some());
        assert!(
            existing(&home).is_some(),
            "forgetting one kind leaves the other alone"
        );

        forget(&home);
        let _ = std::fs::remove_dir_all(&home);
    }
}
