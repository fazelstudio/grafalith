//! Command extension boundary for plugin-registered custom commands.
//!
//! A [`CommandExtension`] is a plugin-provided command that integrates
//! with the engine's history machinery. Unlike built-in commands (which
//! are hardcoded in the [`crate::command`] module), custom commands are
//! registered at runtime through the plugin system.
//!
//! Design rules: the trait is object-safe so the registry can store
//! `Box<dyn CommandExtension>`; custom commands execute through the same
//! [`crate::history`] transaction machinery as built-in commands (one undo
//! entry per execution); the trait is `Send + Sync` for Tauri host
//! compatibility.

use crate::command::CommandContext;
use crate::EngineResult;

/// A plugin-registered custom command.
///
/// Custom commands are executed through the engine's history machinery,
/// so they participate in undo/redo like built-in commands. The command
/// receives a [`CommandContext`] for document access and returns a
/// result indicating success or failure.
///
/// The command is identified by a string id (e.g. `"star-burst"`) that
/// hosts use to invoke it through the protocol.
pub trait CommandExtension: Send + Sync {
    /// The command identifier (unique within the plugin's namespace).
    fn command_id(&self) -> &str;

    /// Executes the command against the document context.
    ///
    /// The command should perform its mutation through `ctx.upsert()`
    /// and `ctx.soft_delete()` so the history machinery tracks changes
    /// correctly. Returns `Ok(())` on success, `Err` on failure (the
    /// transaction rolls back).
    fn execute(&self, ctx: &mut CommandContext) -> EngineResult<()>;
}
