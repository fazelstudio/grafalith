//! Host-agnostic binary asset storage (images referenced by id).
//!
//! TS source: `packages/core/src/assets/asset-store.ts` (`AssetStore` +
//! `InMemoryAssetStore`).
//!
//! Core stays synchronous while TS is `async` (so remote backends like
//! IndexedDB or S3/CDN fit the same interface):
//! [`crate::document::Document`] mutations are atomic and never await, so
//! awaiting inside core would split a mutation across yield points. Hosts
//! add `async` at the boundary (fetch/decode bytes or resolve a URL), then
//! hand the owned [`AssetData`] to this store. TS `Blob | string` becomes
//! the owned [`AssetData`] enum: [`AssetData::Bytes`] for decoded payloads,
//! [`AssetData::Url`] for data URLs / remote URLs the host resolves later —
//! owned values keep the `Send + Sync + 'static` story trivial for the Tauri
//! managed-state host (the same bound [`crate::element::IdGenerator`]
//! carries). Removal reports whether an entry existed (TS returns `void`);
//! the boolean lets callers distinguish a no-op removal without a second
//! lookup, and ignoring it is still a valid statement.

use std::collections::HashMap;

/// Binary asset payload: decoded bytes or a host-resolved URL.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AssetData {
    /// Decoded payload (TS `Blob`, already read by the host).
    Bytes(Vec<u8>),
    /// Data URL or remote URL the host resolves (TS `string`).
    Url(String),
}

/// Storage for binary assets keyed by id.
///
/// Synchronous by design (see the module docs): fallible or remote
/// backends live in the host layer and commit owned [`AssetData`] here.
/// Removal of an unknown id is a silent no-op returning `false`.
pub trait AssetStore: Send + Sync {
    /// Stores (or replaces) the asset under `id`.
    fn add_asset(&mut self, id: &str, data: AssetData);
    /// Borrows the asset under `id`, or `None` when unknown.
    fn get_asset(&self, id: &str) -> Option<&AssetData>;
    /// Removes the asset under `id`; returns `true` when one existed.
    fn remove_asset(&mut self, id: &str) -> bool;
    /// Returns `true` when an asset exists under `id`.
    fn has_asset(&self, id: &str) -> bool;
    /// Number of stored assets (debugging/testing).
    fn len(&self) -> usize;
    /// Returns `true` when no assets are stored.
    fn is_empty(&self) -> bool;
    /// Removes all assets.
    fn clear(&mut self);
}

/// Default in-memory [`AssetStore`] (TS `InMemoryAssetStore` parity).
/// Persistent backends live in the host layer.
#[derive(Debug, Clone, Default)]
pub struct InMemoryAssetStore {
    /// Assets by id.
    assets: HashMap<String, AssetData>,
}

impl InMemoryAssetStore {
    /// Creates an empty store.
    pub fn new() -> Self {
        Self::default()
    }
}

impl AssetStore for InMemoryAssetStore {
    fn add_asset(&mut self, id: &str, data: AssetData) {
        self.assets.insert(id.to_string(), data);
    }

    fn get_asset(&self, id: &str) -> Option<&AssetData> {
        self.assets.get(id)
    }

    fn remove_asset(&mut self, id: &str) -> bool {
        self.assets.remove(id).is_some()
    }

    fn has_asset(&self, id: &str) -> bool {
        self.assets.contains_key(id)
    }

    fn len(&self) -> usize {
        self.assets.len()
    }

    fn is_empty(&self) -> bool {
        self.assets.is_empty()
    }

    fn clear(&mut self) {
        self.assets.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_send_sync<T: Send + Sync>() {}

    #[test]
    fn store_is_send_sync_for_host_state() {
        assert_send_sync::<InMemoryAssetStore>();
    }

    #[test]
    fn add_and_get_bytes() {
        let mut store = InMemoryAssetStore::new();
        assert!(store.is_empty());
        store.add_asset("img-1", AssetData::Bytes(vec![1, 2, 3]));
        assert!(store.has_asset("img-1"));
        assert_eq!(
            store.get_asset("img-1"),
            Some(&AssetData::Bytes(vec![1, 2, 3]))
        );
        assert_eq!(store.len(), 1);
        assert!(!store.is_empty());
    }

    #[test]
    fn add_and_get_url() {
        let mut store = InMemoryAssetStore::new();
        store.add_asset(
            "img-2",
            AssetData::Url("https://example.com/a.png".to_string()),
        );
        assert_eq!(
            store.get_asset("img-2"),
            Some(&AssetData::Url("https://example.com/a.png".to_string()))
        );
    }

    #[test]
    fn overwrite_replaces_without_growing() {
        let mut store = InMemoryAssetStore::new();
        store.add_asset("img-1", AssetData::Bytes(vec![1]));
        store.add_asset(
            "img-1",
            AssetData::Url("data:image/png;base64,xx".to_string()),
        );
        assert_eq!(store.len(), 1);
        assert!(matches!(store.get_asset("img-1"), Some(AssetData::Url(_))));
    }

    #[test]
    fn missing_assets_read_as_absent() {
        let store = InMemoryAssetStore::new();
        assert_eq!(store.get_asset("ghost"), None);
        assert!(!store.has_asset("ghost"));
    }

    #[test]
    fn remove_present_and_missing() {
        let mut store = InMemoryAssetStore::new();
        store.add_asset("img-1", AssetData::Bytes(vec![9]));
        assert!(store.remove_asset("img-1"));
        assert!(!store.has_asset("img-1"));
        assert_eq!(store.get_asset("img-1"), None);
        assert!(!store.remove_asset("img-1"), "second remove is a no-op");
        assert!(!store.remove_asset("ghost"));
    }

    #[test]
    fn clear_empties_the_store() {
        let mut store = InMemoryAssetStore::new();
        store.add_asset("a", AssetData::Bytes(vec![1]));
        store.add_asset("b", AssetData::Url("u".to_string()));
        assert_eq!(store.len(), 2);
        store.clear();
        assert!(store.is_empty());
        assert_eq!(store.len(), 0);
    }
}
