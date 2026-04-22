//! A map whose entries expire after a configurable time-to-live.
//!
//! Used by the registry to track pending replies, in-flight routed
//! requests, and recently-seen event IDs (for mesh deduplication).
//!
//! Expiry is **lazy**: the map has no background sweep task, so it
//! introduces no runtime dependency. Entries are removed when `get`,
//! `has`, or `insert` notices they are stale. An optional
//! `on_expire(key, value)` callback fires at that moment.

use std::collections::HashMap;
use std::hash::Hash;
use std::time::{Duration, Instant};

use parking_lot::Mutex;

type OnExpire<K, V> = Box<dyn Fn(&K, V) + Send + Sync>;

/// A `HashMap` whose entries expire after `ttl`.
pub struct TtlMap<K, V>
where
    K: Eq + Hash,
{
    ttl: Duration,
    inner: Mutex<HashMap<K, (V, Instant)>>,
    on_expire: Option<OnExpire<K, V>>,
}

impl<K, V> TtlMap<K, V>
where
    K: Eq + Hash + Clone,
{
    /// Creates a new map with the given TTL.
    ///
    /// A `ttl` of zero disables expiry entirely — entries stay until
    /// explicitly removed.
    pub fn new(ttl: Duration) -> Self {
        Self {
            ttl,
            inner: Mutex::new(HashMap::new()),
            on_expire: None,
        }
    }

    /// Sets a callback invoked whenever an entry is removed due to TTL
    /// expiry.
    ///
    /// The registry uses this to reject pending request promises with a
    /// timeout error.
    pub fn with_on_expire<F>(mut self, cb: F) -> Self
    where
        F: Fn(&K, V) + Send + Sync + 'static,
    {
        self.on_expire = Some(Box::new(cb));
        self
    }

    fn is_expired(&self, inserted_at: Instant) -> bool {
        !self.ttl.is_zero() && inserted_at.elapsed() > self.ttl
    }

    /// Inserts a value, returning the previous entry if any.
    pub fn insert(&self, key: K, value: V) -> Option<V> {
        self.inner
            .lock()
            .insert(key, (value, Instant::now()))
            .map(|(v, _)| v)
    }

    /// Removes and returns the value for `key`, bypassing expiry.
    pub fn remove(&self, key: &K) -> Option<V> {
        self.inner.lock().remove(key).map(|(v, _)| v)
    }

    /// Returns whether `key` is present and unexpired.
    ///
    /// Triggers `on_expire` as a side effect if the entry is stale.
    pub fn contains_key(&self, key: &K) -> bool {
        self.take_if_expired(key);
        self.inner.lock().contains_key(key)
    }

    /// Returns a clone of the value for `key` if present and unexpired.
    pub fn get_cloned(&self, key: &K) -> Option<V>
    where
        V: Clone,
    {
        self.take_if_expired(key);
        self.inner.lock().get(key).map(|(v, _)| v.clone())
    }

    /// Returns the current size of the map (including any stale entries
    /// that have not yet been touched).
    pub fn len(&self) -> usize {
        self.inner.lock().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Drops all entries without firing `on_expire`.
    pub fn clear(&self) {
        self.inner.lock().clear();
    }

    /// Removes every entry that has exceeded the TTL, firing
    /// `on_expire` for each. Callers may invoke this periodically to
    /// bound memory in long-running processes.
    pub fn sweep_expired(&self) {
        if self.ttl.is_zero() {
            return;
        }
        let expired: Vec<(K, V)> = {
            let mut inner = self.inner.lock();
            let keys: Vec<K> = inner
                .iter()
                .filter(|(_, (_, t))| self.is_expired(*t))
                .map(|(k, _)| k.clone())
                .collect();
            keys.into_iter()
                .filter_map(|k| inner.remove(&k).map(|(v, _)| (k, v)))
                .collect()
        };
        if let Some(cb) = &self.on_expire {
            for (k, v) in expired {
                cb(&k, v);
            }
        }
    }

    /// Returns every key whose (unexpired) value satisfies `pred`.
    ///
    /// The registry uses this during channel-close cleanup to find all
    /// pending replies and routes associated with the dead channel.
    pub fn snapshot_keys_where<F>(&self, pred: F) -> Vec<K>
    where
        F: Fn(&V) -> bool,
    {
        let inner = self.inner.lock();
        inner
            .iter()
            .filter(|(_, (v, t))| !self.is_expired(*t) && pred(v))
            .map(|(k, _)| k.clone())
            .collect()
    }

    /// If `key` is present but stale, drop it and invoke `on_expire`.
    fn take_if_expired(&self, key: &K) {
        if self.ttl.is_zero() {
            return;
        }
        let expired = {
            let mut inner = self.inner.lock();
            match inner.get(key) {
                Some((_, t)) if self.is_expired(*t) => inner.remove(key).map(|(v, _)| v),
                _ => None,
            }
        };
        if let (Some(v), Some(cb)) = (expired, &self.on_expire) {
            cb(key, v);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::thread::sleep;

    #[test]
    fn insert_and_get() {
        let m: TtlMap<&'static str, i32> = TtlMap::new(Duration::from_secs(60));
        m.insert("a", 1);
        assert_eq!(m.get_cloned(&"a"), Some(1));
        assert!(m.contains_key(&"a"));
    }

    #[test]
    fn remove_returns_value() {
        let m: TtlMap<&'static str, i32> = TtlMap::new(Duration::from_secs(60));
        m.insert("a", 1);
        assert_eq!(m.remove(&"a"), Some(1));
        assert!(!m.contains_key(&"a"));
    }

    #[test]
    fn zero_ttl_disables_expiry() {
        let m: TtlMap<&'static str, i32> = TtlMap::new(Duration::ZERO);
        m.insert("a", 1);
        sleep(Duration::from_millis(20));
        assert_eq!(m.get_cloned(&"a"), Some(1));
    }

    #[test]
    fn lazy_expiry_drops_stale_entries_on_access() {
        let fired = Arc::new(AtomicUsize::new(0));
        let f = fired.clone();
        let m: TtlMap<&'static str, i32> =
            TtlMap::new(Duration::from_millis(10)).with_on_expire(move |_, _| {
                f.fetch_add(1, Ordering::SeqCst);
            });
        m.insert("a", 1);
        sleep(Duration::from_millis(25));
        assert_eq!(m.get_cloned(&"a"), None);
        assert_eq!(fired.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn sweep_removes_all_stale() {
        let fired = Arc::new(AtomicUsize::new(0));
        let f = fired.clone();
        let m: TtlMap<i32, i32> =
            TtlMap::new(Duration::from_millis(10)).with_on_expire(move |_, _| {
                f.fetch_add(1, Ordering::SeqCst);
            });
        for i in 0..5 {
            m.insert(i, i * 10);
        }
        sleep(Duration::from_millis(25));
        m.sweep_expired();
        assert!(m.is_empty());
        assert_eq!(fired.load(Ordering::SeqCst), 5);
    }
}
