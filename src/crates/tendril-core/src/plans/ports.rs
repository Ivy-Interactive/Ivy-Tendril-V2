//! Assigns a concrete TCP port to each of a project's named service ports for one plan.
//!
//! A multi-service repo binds static defaults (3000/3001/3002), so a host process already on one of
//! them — or a second plan under review at the same time — makes the whole stack fail with
//! `EADDRINUSE`. Assignments are recorded in `plan.yaml`'s `allocatedPorts` so a review session
//! keeps stable URLs across re-executions.

use crate::error::{Result, TendrilError};
use crate::models::{PlanStatus, PlanYaml, ProjectConfig, ProjectPortConfig};
use crate::plans::reader::read_plan_yaml;
use crate::plans::writer::write_plan_yaml;
use chrono::Utc;
use std::collections::{BTreeMap, HashSet};
use std::path::Path;

/// First port scanned when a service's default port is unavailable.
pub const EPHEMERAL_RANGE_START: u16 = 30000;

/// Last port scanned (inclusive) when a service's default port is unavailable.
pub const EPHEMERAL_RANGE_END: u16 = 45000;

/// Plan states whose allocated ports are treated as taken. A finished plan's worktree is gone, so
/// holding its ports back would exhaust the range over time.
const ACTIVE_STATES: [PlanStatus; 6] = [
    PlanStatus::Draft,
    PlanStatus::Creating,
    PlanStatus::Updating,
    PlanStatus::Executing,
    PlanStatus::Review,
    PlanStatus::Blocked,
];

/// True when a listener can bind `port` on loopback. Only loopback is probed: review actions and
/// verifications bind 127.0.0.1 (binding 0.0.0.0 is blocked on some hosts), so a service occupying
/// only an external interface must not count as a collision.
pub fn is_port_available(port: u16) -> bool {
    if port == 0 {
        return false;
    }

    std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).is_ok()
}

/// Pure allocation logic, separated from disk and socket access so it can be exercised
/// deterministically. Iterates the project's ports in name order.
///
/// * `existing` — ports already recorded on the plan, retained when still free.
/// * `reserved` — ports held by other plans; names assigned earlier in this pass are added as we go.
/// * `is_available` — availability probe ([`is_port_available`] in production).
pub fn resolve_ports(
    ports: &BTreeMap<String, ProjectPortConfig>,
    existing: Option<&BTreeMap<String, u16>>,
    reserved: &HashSet<u16>,
    is_available: &dyn Fn(u16) -> bool,
) -> Result<BTreeMap<String, u16>> {
    let mut taken: HashSet<u16> = reserved.clone();
    let mut resolved: BTreeMap<String, u16> = BTreeMap::new();

    for (name, port_config) in ports {
        if let Some(previous) = existing.and_then(|e| e.get(name)).copied() {
            if !taken.contains(&previous) && is_available(previous) {
                resolved.insert(name.clone(), previous);
                taken.insert(previous);
                continue;
            }
        }

        let assigned =
            pick_port(port_config.default_port, &taken, is_available).ok_or_else(|| {
                TendrilError::Plan(format!(
                "No free TCP port available for '{}': the default port {} is in use and the range \
                 {}-{} is exhausted.",
                name, port_config.default_port, EPHEMERAL_RANGE_START, EPHEMERAL_RANGE_END
            ))
            })?;

        resolved.insert(name.clone(), assigned);
        taken.insert(assigned);
    }

    // Names dropped from the project config keep no reservation, but a plan that recorded them is
    // not rewritten to lose data an in-flight worktree may still be using.
    if let Some(existing) = existing {
        for (name, port) in existing {
            resolved.entry(name.clone()).or_insert(*port);
        }
    }

    Ok(resolved)
}

/// The default port when usable, otherwise the first free ephemeral port.
fn pick_port(
    default_port: u16,
    taken: &HashSet<u16>,
    is_available: &dyn Fn(u16) -> bool,
) -> Option<u16> {
    if default_port > 0 && !taken.contains(&default_port) && is_available(default_port) {
        return Some(default_port);
    }

    (EPHEMERAL_RANGE_START..=EPHEMERAL_RANGE_END)
        .find(|candidate| !taken.contains(candidate) && is_available(*candidate))
}

/// Collects the ports recorded by every other plan in `plans_dir` that is still active, so two
/// concurrent reviews never receive the same port. Unreadable plans are skipped: a corrupt
/// neighbour must not block allocation.
pub fn collect_reserved_ports(
    plans_dir: &Path,
    exclude_plan_folder: Option<&Path>,
) -> HashSet<u16> {
    let mut reserved = HashSet::new();

    let entries = match std::fs::read_dir(plans_dir) {
        Ok(entries) => entries,
        Err(_) => return reserved,
    };

    let excluded = exclude_plan_folder.map(canonical_or_owned);

    for entry in entries.flatten() {
        let folder = entry.path();
        if !folder.is_dir() {
            continue;
        }
        if excluded
            .as_ref()
            .is_some_and(|e| canonical_or_owned(&folder) == *e)
        {
            continue;
        }

        let Ok((other, _)) = read_plan_yaml(&folder) else {
            continue;
        };
        let Some(ports) = other.allocated_ports.as_ref().filter(|p| !p.is_empty()) else {
            continue;
        };
        let is_active = PlanStatus::from_str_loose(&other.state)
            .is_some_and(|state| ACTIVE_STATES.contains(&state));
        if !is_active {
            continue;
        }

        reserved.extend(ports.values().copied());
    }

    reserved
}

fn canonical_or_owned(path: &Path) -> std::path::PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

/// Ensures every named port in `project` has an assignment for `plan`, persisting `plan.yaml` when
/// anything changed, and returns the full mapping. Ports already recorded on the plan are retained
/// when still free, so the URLs a reviewer has open survive a re-execution — which is also what
/// makes repeated calls idempotent.
pub fn allocate_ports(
    project: &ProjectConfig,
    plan: &mut PlanYaml,
    plan_folder: &Path,
) -> Result<BTreeMap<String, u16>> {
    if project.ports.is_empty() {
        return Ok(plan.allocated_ports.clone().unwrap_or_default());
    }

    let reserved = match plan_folder.parent() {
        Some(plans_dir) => collect_reserved_ports(plans_dir, Some(plan_folder)),
        None => HashSet::new(),
    };

    let resolved = resolve_ports(
        &project.ports,
        plan.allocated_ports.as_ref(),
        &reserved,
        &is_port_available,
    )?;

    if plan.allocated_ports.as_ref() != Some(&resolved) {
        plan.allocated_ports = Some(resolved.clone());
        plan.updated = Utc::now();
        write_plan_yaml(plan_folder, plan)?;
    }

    Ok(resolved)
}
