#![no_main]

//! Fuzz the scene import pipeline: arbitrary bytes must never panic.
//! Typed errors are the only acceptable outcome (the deterministic
//! `adversarial_parsers` corpus pins the known shapes; the fuzzer hunts
//! the unknown ones).

use libfuzzer_sys::fuzz_target;
use grafalith_io::import_str;
use grafalith_core::document::Document;

fuzz_target!(|data: &[u8]| {
    let Ok(text) = std::str::from_utf8(data) else {
        return;
    };
    let mut doc = Document::new();
    let _ = std::hint::black_box(import_str(&mut doc, text));
});
