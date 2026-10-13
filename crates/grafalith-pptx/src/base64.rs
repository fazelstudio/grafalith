//! Hand-written RFC 4648 base64 (standard alphabet, `=` padding).
//!
//! The exporter capability contract is string-only, so binary packages
//! cross it base64-encoded. Encoding and decoding are both implemented so
//! round-trips stay testable without an external crate.

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Encodes `data` with the standard alphabet and `=` padding.
pub fn encode(data: &[u8]) -> String {
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(ALPHABET[((triple >> 18) & 0x3F) as usize] as char);
        out.push(ALPHABET[((triple >> 12) & 0x3F) as usize] as char);
        out.push(if chunk.len() > 1 {
            ALPHABET[((triple >> 6) & 0x3F) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            ALPHABET[(triple & 0x3F) as usize] as char
        } else {
            '='
        });
    }
    out
}

/// Decodes standard-alphabet base64; rejects length errors, padding errors,
/// and out-of-alphabet bytes.
pub fn decode(text: &str) -> Option<Vec<u8>> {
    if !text.len().is_multiple_of(4) {
        return None;
    }
    let padding = text.bytes().rev().take_while(|byte| *byte == b'=').count();
    if padding > 2 || text.bytes().filter(|byte| *byte == b'=').count() != padding {
        return None;
    }
    let mut sextets = Vec::with_capacity(text.len());
    for byte in text.bytes() {
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => 0,
            _ => return None,
        };
        sextets.push(value);
    }
    let mut out = Vec::with_capacity(text.len() / 4 * 3);
    for chunk in sextets.chunks_exact(4) {
        let triple = (u32::from(chunk[0]) << 18)
            | (u32::from(chunk[1]) << 12)
            | (u32::from(chunk[2]) << 6)
            | u32::from(chunk[3]);
        out.push((triple >> 16) as u8);
        out.push((triple >> 8) as u8);
        out.push(triple as u8);
    }
    let padding = text.bytes().rev().take_while(|byte| *byte == b'=').count();
    out.truncate(out.len().saturating_sub(padding));
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rfc_vectors_encode() {
        assert_eq!(encode(b""), "");
        assert_eq!(encode(b"f"), "Zg==");
        assert_eq!(encode(b"fo"), "Zm8=");
        assert_eq!(encode(b"foo"), "Zm9v");
        assert_eq!(encode(b"foob"), "Zm9vYg==");
        assert_eq!(encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(encode(b"foobar"), "Zm9vYmFy");
        assert_eq!(encode(b"PK\x03\x04"), "UEsDBA==");
    }

    #[test]
    fn decode_round_trips_and_rejects_garbage() {
        for fixture in [
            b"".as_slice(),
            b"f",
            b"fo",
            b"foo",
            b"hello world",
            b"\x00\xff\x10 binary \x00",
        ] {
            assert_eq!(decode(&encode(fixture)).as_deref(), Some(fixture));
        }
        assert_eq!(decode("Zg=="), Some(b"f".to_vec()));
        assert_eq!(decode(""), Some(Vec::new()));
        assert_eq!(decode("abc"), None);
        assert_eq!(decode("===="), None);
        assert_eq!(decode("ab=c"), None);
        assert_eq!(decode("ab$c"), None);
    }
}
