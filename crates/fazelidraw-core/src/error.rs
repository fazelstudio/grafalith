//! Typed engine errors (module 01 §F).
//!
//! Expected user/domain failures (invalid input, missing ids, violated
//! invariants) are values, never panics. `panic!` is reserved for
//! must-never-fail internal invariants and must never cross an FFI
//! boundary. See `docs/architecture/ADR-0004-error-handling.md`.
//!
//! [`EngineError`] is `#[non_exhaustive]` because later phases (02–06) will
//! add variants as domain logic lands; matching code must carry a wildcard
//! arm from day one.

use std::fmt;

/// Fallible-operation result alias used by every public engine API.
pub type EngineResult<T> = Result<T, EngineError>;

/// Typed engine failure.
#[non_exhaustive]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EngineError {
    /// Input failed validation (malformed import payload, NaN/Infinity in
    /// persistent state, bad dimensions, …). Holds a human-readable reason.
    InvalidInput(String),
    /// A stable id referenced nothing in the document.
    NotFound(String),
    /// A document invariant was violated
    /// (duplicate id, dangling reference, cyclic parent, …).
    InvariantViolation(String),
}

impl fmt::Display for EngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            EngineError::InvalidInput(reason) => write!(f, "invalid input: {reason}"),
            EngineError::NotFound(id) => write!(f, "not found: {id}"),
            EngineError::InvariantViolation(reason) => {
                write!(f, "invariant violation: {reason}")
            }
        }
    }
}

impl std::error::Error for EngineError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_messages_are_stable() {
        assert_eq!(
            EngineError::InvalidInput("bad width".to_string()).to_string(),
            "invalid input: bad width"
        );
        assert_eq!(
            EngineError::NotFound("abc".to_string()).to_string(),
            "not found: abc"
        );
        assert_eq!(
            EngineError::InvariantViolation("dup id".to_string()).to_string(),
            "invariant violation: dup id"
        );
    }

    #[test]
    fn result_alias_propagates_with_question_mark() {
        fn lookup(fail: bool) -> EngineResult<String> {
            if fail {
                return Err(EngineError::NotFound("x".to_string()));
            }
            Ok("ok".to_string())
        }

        fn caller(fail: bool) -> EngineResult<usize> {
            Ok(lookup(fail)?.len())
        }

        assert_eq!(caller(false), Ok(2));
        assert_eq!(caller(true), Err(EngineError::NotFound("x".to_string())));
    }
}
