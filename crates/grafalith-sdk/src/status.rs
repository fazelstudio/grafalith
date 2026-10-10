//!
//! Extension status machine (mirrors `apps/desktop/.../extensionStatus.ts`).
//!
//! Every installed extension moves `Discovered` → `Validating` → `Valid` →
//! `Loading` → `Active`, with one failure state per phase. The Tauri host
//! persists failure/disabled states so known-bad extensions skip on the
//! next startup; this module owns the vocabulary and the skip rule, never
//! storage I/O (the host owns paths — see `storage`).

/// Lifecycle state of one installed extension.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
/// Status of one installed extension.
pub enum ExtensionStatus {
    /// Found on disk, not yet validated.
    Discovered,
    /// Manifest checks running.
    Validating,
    /// Manifest valid, staged for activation.
    Valid,
    /// Entry module loading.
    Loading,
    /// Activated and running.
    Active,
    /// Manifest failed schema validation.
    InvalidManifest,
    /// `engines.grafalith` range rejects this host.
    IncompatibleVersion,
    /// A declared dependency is not installed.
    MissingDependency,
    /// Dependency chain contains a cycle.
    CircularDependency,
    /// Entry module failed to load.
    LoadFailed,
    /// Entry module has no callable `activate`.
    InvalidEntry,
    /// `activate()` threw or rejected.
    ActivationFailed,
    /// `activate()` exceeded its deadline.
    ActivationTimeout,
    /// Disabled by the user (stays skipped until re-enabled).
    Disabled,
    /// Deactivated on editor close or app shutdown.
    Deactivated,
}

impl ExtensionStatus {
    /// Whether the status is a failure that skips future startups.
    #[must_use]
    pub fn is_failure(self) -> bool {
        matches!(
            self,
            Self::InvalidManifest
                | Self::IncompatibleVersion
                | Self::MissingDependency
                | Self::CircularDependency
                | Self::LoadFailed
                | Self::InvalidEntry
                | Self::ActivationFailed
                | Self::ActivationTimeout
        )
    }

    /// Whether the extension is currently running.
    #[must_use]
    pub fn is_active(self) -> bool {
        matches!(self, Self::Active)
    }

    /// Whether the extension must stay skipped until the user re-enables it.
    #[must_use]
    pub fn is_disabled(self) -> bool {
        matches!(self, Self::Disabled)
    }
}
