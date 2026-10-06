#![no_main]

//! Fuzz the clipboard codec: arbitrary bytes must never panic. Decoding is
//! pure (no state touched), so any panic here is a parser bug.

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let Ok(text) = std::str::from_utf8(data) else {
        return;
    };
    let _ = std::hint::black_box(nary_io::decode_clipboard(text));
});
