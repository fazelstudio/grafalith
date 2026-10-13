//! Hand-written IEEE CRC32 (the ZIP checksum).
//!
//! Kept in-house because the algorithm is twenty lines with fixed test
//! vectors, while a dependency would exist only for this one function.

/// CRC32 table generated at compile time (reflected polynomial `0xEDB88320`).
const fn build_table() -> [u32; 256] {
    let mut table = [0u32; 256];
    let mut n = 0;
    while n < 256 {
        let mut entry = n as u32;
        let mut bit = 0;
        while bit < 8 {
            entry = if entry & 1 == 1 {
                0xEDB8_8320 ^ (entry >> 1)
            } else {
                entry >> 1
            };
            bit += 1;
        }
        table[n] = entry;
        n += 1;
    }
    table
}

const TABLE: [u32; 256] = build_table();

/// IEEE CRC32 of `data` (zip uses the initial `0xFFFF_FFFF` seed and final xor).
pub fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for byte in data {
        crc = TABLE[((crc ^ u32::from(*byte)) & 0xFF) as usize] ^ (crc >> 8);
    }
    crc ^ 0xFFFF_FFFF
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn standard_vectors_match() {
        assert_eq!(crc32(b""), 0x0000_0000);
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
        assert_eq!(crc32(b"hello"), 0x3610_A686);
        assert_eq!(
            crc32(b"The quick brown fox jumps over the lazy dog"),
            0x414F_A339
        );
    }
}
