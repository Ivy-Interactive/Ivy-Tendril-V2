//! Debounce and escalation, with no I/O and no timers.
//!
//! Between them, upstream's `ScheduleDebounce` (in `PlanWatcherService`) and `RefreshCoalescer`
//! define the behaviour ported here. The clock is a parameter rather than `Instant::now()` so every
//! rule below is testable by arithmetic instead of by sleeping.

use super::{ChangeEvent, ChangeTarget};
use std::time::{Duration, Instant};

/// One class of pending change: what is pending, and when the burst that produced it started.
struct Pending<T> {
    value: T,
    /// The *first* push of the burst, not the most recent one — see [`Coalescer::poll`].
    first_push: Instant,
}

/// Collapses a burst of raw change notifications into at most one event per target class per window.
pub struct Coalescer {
    plans_window: Duration,
    config_window: Duration,
    /// `Some(Pending { value: None })` is a pending full rescan; `Some(Pending { value: Some(f) })`
    /// is a pending refresh of the single folder `f`.
    plans: Option<Pending<Option<String>>>,
    config: Option<Pending<()>>,
    inbox: Option<Pending<()>>,
}

impl Coalescer {
    pub fn new(plans_window: Duration, config_window: Duration) -> Self {
        Self {
            plans_window,
            config_window,
            plans: None,
            config: None,
            inbox: None,
        }
    }

    /// Records an event. No I/O, no timers.
    pub fn push(&mut self, target: ChangeTarget, now: Instant) {
        match target {
            ChangeTarget::Plans { folder } => match self.plans.as_mut() {
                None => {
                    self.plans = Some(Pending {
                        value: folder,
                        first_push: now,
                    })
                }
                Some(pending) => {
                    // A burst that names two different folders is cheaper to serve as one full
                    // rescan than as two targeted ones, and `None` is absorbing: once escalated, a
                    // later specific folder cannot narrow the pending event back down.
                    let escalate = match (&pending.value, &folder) {
                        (None, _) | (_, None) => true,
                        (Some(existing), Some(incoming)) => existing != incoming,
                    };
                    if escalate {
                        pending.value = None;
                    }
                }
            },
            ChangeTarget::Config => {
                if self.config.is_none() {
                    self.config = Some(Pending {
                        value: (),
                        first_push: now,
                    });
                }
            }
            ChangeTarget::Inbox => {
                if self.inbox.is_none() {
                    self.inbox = Some(Pending {
                        value: (),
                        first_push: now,
                    });
                }
            }
        }
    }

    /// Emits whatever is due at `now`, in target order (plans, config, inbox). Empty until a window
    /// has elapsed.
    ///
    /// The comparison is against the *first* push of the burst, not the last. `RefreshCoalescer`
    /// deliberately uses `Sample` rather than `Throttle` for the same reason: under a sustained
    /// stream of writes, a last-push comparison would defer forever and a busy writer could starve
    /// refreshes entirely.
    pub fn poll(&mut self, now: Instant) -> Vec<ChangeEvent> {
        let mut out = Vec::new();

        if let Some(pending) = self.plans.as_ref() {
            if now.saturating_duration_since(pending.first_push) >= self.plans_window {
                let folder = pending.value.clone();
                out.push(ChangeEvent::new(ChangeTarget::Plans { folder }));
                self.plans = None;
            }
        }

        if let Some(pending) = self.config.as_ref() {
            if now.saturating_duration_since(pending.first_push) >= self.config_window {
                out.push(ChangeEvent::new(ChangeTarget::Config));
                self.config = None;
            }
        }

        // The inbox has no window of its own upstream; it is plan-shaped work, so it shares the
        // plans window.
        if let Some(pending) = self.inbox.as_ref() {
            if now.saturating_duration_since(pending.first_push) >= self.plans_window {
                out.push(ChangeEvent::new(ChangeTarget::Inbox));
                self.inbox = None;
            }
        }

        out
    }

    /// When the driving task should next wake, or `None` when nothing is pending.
    pub fn next_deadline(&self) -> Option<Instant> {
        let candidates = [
            self.plans
                .as_ref()
                .map(|p| p.first_push + self.plans_window),
            self.config
                .as_ref()
                .map(|p| p.first_push + self.config_window),
            self.inbox
                .as_ref()
                .map(|p| p.first_push + self.plans_window),
        ];
        candidates.into_iter().flatten().min()
    }

    /// Whether anything is waiting to be emitted.
    pub fn is_empty(&self) -> bool {
        self.plans.is_none() && self.config.is_none() && self.inbox.is_none()
    }
}
