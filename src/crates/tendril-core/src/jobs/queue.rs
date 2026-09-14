use std::cmp::Ordering;
use std::collections::BinaryHeap;

/// A job waiting for a slot. Ordered by descending priority, then by insertion sequence, so equal
/// priorities keep FIFO order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueuedJob {
    pub job_id: String,
    pub priority: i32,
    seq: u64,
}

impl Ord for QueuedJob {
    fn cmp(&self, other: &Self) -> Ordering {
        // `BinaryHeap` is a max-heap, so higher priority pops first and, within one priority, the
        // lower sequence number (enqueued earlier) pops first.
        self.priority
            .cmp(&other.priority)
            .then_with(|| other.seq.cmp(&self.seq))
    }
}

impl PartialOrd for QueuedJob {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// Priority queue over [`QueuedJob`], plus the monotonic sequence that breaks ties.
#[derive(Debug, Default)]
pub struct JobQueue {
    heap: BinaryHeap<QueuedJob>,
    next_seq: u64,
}

impl JobQueue {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, job_id: String, priority: i32) {
        let seq = self.next_seq;
        self.next_seq += 1;
        self.heap.push(QueuedJob {
            job_id,
            priority,
            seq,
        });
    }

    /// Pushes ahead of every entry currently queued, and returns the priority used. This is how a
    /// force-started job jumps the queue without disturbing the relative order of the rest.
    pub fn push_front(&mut self, job_id: String) -> i32 {
        let priority = self
            .heap
            .iter()
            .map(|e| e.priority)
            .max()
            .map(|max| max.saturating_add(1))
            .unwrap_or(0);
        self.push(job_id, priority);
        priority
    }

    /// Removes and returns the highest-priority entry.
    pub fn pop(&mut self) -> Option<QueuedJob> {
        self.heap.pop()
    }

    /// Drops a specific id (cancel or force-start of a still-queued job).
    pub fn remove(&mut self, job_id: &str) -> bool {
        let before = self.heap.len();
        let kept: Vec<QueuedJob> = self.heap.drain().filter(|e| e.job_id != job_id).collect();
        self.heap = kept.into_iter().collect();
        self.heap.len() != before
    }

    pub fn contains(&self, job_id: &str) -> bool {
        self.heap.iter().any(|e| e.job_id == job_id)
    }

    pub fn len(&self) -> usize {
        self.heap.len()
    }

    pub fn is_empty(&self) -> bool {
        self.heap.is_empty()
    }

    /// Entries in the order they would be popped. For tests and the queue listing route.
    pub fn snapshot(&self) -> Vec<QueuedJob> {
        let mut entries: Vec<QueuedJob> = self.heap.iter().cloned().collect();
        // Descending, because `Ord` is written for a max-heap.
        entries.sort_by(|a, b| b.cmp(a));
        entries
    }

    /// Ids in the order they would be popped.
    pub fn peek_order(&self) -> Vec<String> {
        self.snapshot().into_iter().map(|e| e.job_id).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn higher_priority_pops_first_and_ties_keep_fifo() {
        let mut q = JobQueue::new();
        q.push("a".to_string(), 0);
        q.push("b".to_string(), 10);
        q.push("c".to_string(), 10);
        q.push("d".to_string(), 5);

        assert_eq!(q.peek_order(), vec!["b", "c", "d", "a"]);
        assert_eq!(q.pop().unwrap().job_id, "b");
        assert_eq!(q.pop().unwrap().job_id, "c");
        assert_eq!(q.pop().unwrap().job_id, "d");
        assert_eq!(q.pop().unwrap().job_id, "a");
        assert!(q.pop().is_none());
    }

    #[test]
    fn remove_drops_only_the_named_entry_and_keeps_order() {
        let mut q = JobQueue::new();
        q.push("a".to_string(), 0);
        q.push("b".to_string(), 0);
        q.push("c".to_string(), 0);

        assert!(q.remove("b"));
        assert!(!q.remove("b"));
        assert_eq!(q.peek_order(), vec!["a", "c"]);
        assert_eq!(q.len(), 2);
    }

    #[test]
    fn push_front_jumps_every_current_entry() {
        let mut q = JobQueue::new();
        q.push("a".to_string(), 7);
        q.push("b".to_string(), 3);

        let used = q.push_front("urgent".to_string());
        assert_eq!(used, 8);
        assert_eq!(q.peek_order(), vec!["urgent", "a", "b"]);
    }

    #[test]
    fn negative_priorities_sort_below_the_default() {
        let mut q = JobQueue::new();
        q.push("low".to_string(), -5);
        q.push("normal".to_string(), 0);
        assert_eq!(q.peek_order(), vec!["normal", "low"]);
    }
}
