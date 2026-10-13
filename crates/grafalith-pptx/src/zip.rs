//! Hand-written ZIP framing for `.pptx` packages.
//!
//! A presentation is an OPC package: plain ZIP entries addressed by
//! `[Content_Types].xml` and `_rels` parts. Only what the writer and the
//! verification reader need is implemented — no archives spanning disks,
//! no ZIP64, no encryption, no data descriptors. Compression itself comes
//! from `flate2` (pure-Rust backend); every byte of framing is owned here
//! so the format stays auditable.
//!
//! All names are UTF-8 (flag bit 11) and all timestamps are zero, so builds
//! are byte-deterministic for a given input.

use flate2::read::DeflateDecoder;
use flate2::write::DeflateEncoder;
use flate2::Compression;
use grafalith_core::{EngineError, EngineResult};
use std::io::{Read, Write};

use crate::crc32::crc32;

const LOCAL_HEADER_SIGNATURE: u32 = 0x0403_4B50;
const CENTRAL_HEADER_SIGNATURE: u32 = 0x0201_4B50;
const END_SIGNATURE: u32 = 0x0605_4B50;
const VERSION_NEEDED: u16 = 20;
const VERSION_MADE_BY: u16 = 0x031E;
const FLAG_UTF8: u16 = 1 << 11;
const METHOD_STORED: u16 = 0;
const METHOD_DEFLATED: u16 = 8;

/// Compression for one written entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ZipMethod {
    /// Raw bytes (valid ZIP, larger output).
    Stored,
    /// Raw DEFLATE stream (standard `.pptx` encoding).
    Deflated,
}

/// One file to place in the archive; names must be unique and non-empty.
pub struct ZipEntry<'a> {
    /// Forward-slash archive path (e.g. `"ppt/slides/slide1.xml"`).
    pub name: &'a str,
    /// Compression for this entry.
    pub method: ZipMethod,
    /// Uncompressed payload.
    pub data: &'a [u8],
}

/// One file read back from an archive (always decompressed).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ZipFile {
    /// Forward-slash archive path.
    pub name: String,
    /// Decompressed payload.
    pub data: Vec<u8>,
}

fn put_u16(out: &mut Vec<u8>, value: u16) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn put_u32(out: &mut Vec<u8>, value: u32) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn get_u16(data: &[u8], offset: usize) -> EngineResult<u16> {
    data.get(offset..offset + 2)
        .and_then(|slice| slice.try_into().ok())
        .map(u16::from_le_bytes)
        .ok_or_else(|| EngineError::InvalidInput("zip entry is truncated".to_string()))
}

fn get_u32(data: &[u8], offset: usize) -> EngineResult<u32> {
    data.get(offset..offset + 4)
        .and_then(|slice| slice.try_into().ok())
        .map(u32::from_le_bytes)
        .ok_or_else(|| EngineError::InvalidInput("zip entry is truncated".to_string()))
}

fn deflate(data: &[u8]) -> Vec<u8> {
    let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(data)
        .expect("deflate encoding cannot fail");
    encoder.finish().expect("deflate finishing cannot fail")
}

/// Assembles a complete archive; entries are stored in the given order.
pub fn zip_write(entries: &[ZipEntry<'_>]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut central = Vec::new();
    for entry in entries {
        let name = entry.name.as_bytes();
        let payload = match entry.method {
            ZipMethod::Stored => entry.data.to_vec(),
            ZipMethod::Deflated => deflate(entry.data),
        };
        let checksum = crc32(entry.data);
        let method = match entry.method {
            ZipMethod::Stored => METHOD_STORED,
            ZipMethod::Deflated => METHOD_DEFLATED,
        };
        let local_offset = out.len() as u32;
        put_u32(&mut out, LOCAL_HEADER_SIGNATURE);
        put_u16(&mut out, VERSION_NEEDED);
        put_u16(&mut out, FLAG_UTF8);
        put_u16(&mut out, method);
        put_u16(&mut out, 0);
        put_u16(&mut out, 0);
        put_u32(&mut out, checksum);
        put_u32(&mut out, payload.len() as u32);
        put_u32(&mut out, entry.data.len() as u32);
        put_u16(&mut out, name.len() as u16);
        put_u16(&mut out, 0);
        out.extend_from_slice(name);
        out.extend_from_slice(&payload);
        put_u32(&mut central, CENTRAL_HEADER_SIGNATURE);
        put_u16(&mut central, VERSION_MADE_BY);
        put_u16(&mut central, VERSION_NEEDED);
        put_u16(&mut central, FLAG_UTF8);
        put_u16(&mut central, method);
        put_u16(&mut central, 0);
        put_u16(&mut central, 0);
        put_u32(&mut central, checksum);
        put_u32(&mut central, payload.len() as u32);
        put_u32(&mut central, entry.data.len() as u32);
        put_u16(&mut central, name.len() as u16);
        put_u16(&mut central, 0);
        put_u16(&mut central, 0);
        put_u16(&mut central, 0);
        put_u16(&mut central, 0);
        put_u32(&mut central, 0);
        put_u32(&mut central, local_offset);
        central.extend_from_slice(name);
    }
    let central_offset = out.len() as u32;
    let central_size = central.len() as u32;
    out.extend_from_slice(&central);
    put_u32(&mut out, END_SIGNATURE);
    put_u16(&mut out, 0);
    put_u16(&mut out, 0);
    let count = entries.len() as u16;
    put_u16(&mut out, count);
    put_u16(&mut out, count);
    put_u32(&mut out, central_size);
    put_u32(&mut out, central_offset);
    put_u16(&mut out, 0);
    out
}

fn inflate(data: &[u8]) -> EngineResult<Vec<u8>> {
    let mut decoder = DeflateDecoder::new(data);
    let mut out = Vec::new();
    decoder.read_to_end(&mut out).map_err(|err| {
        EngineError::InvalidInput(format!("zip deflate payload is corrupt: {err}"))
    })?;
    Ok(out)
}

/// Opens an archive produced by [`zip_write`] (or any conforming writer):
/// parses the central directory, extracts every file entry, verifies sizes
/// and checksums, and rejects duplicate names, unknown methods, and
/// directory entries. Directory entries (trailing `/`) carry no payload
/// and are skipped.
pub fn zip_read(bytes: &[u8]) -> EngineResult<Vec<ZipFile>> {
    if bytes.len() < 22 {
        return Err(EngineError::InvalidInput(
            "zip archive is truncated".to_string(),
        ));
    }
    let scan_from = bytes.len().saturating_sub(65_557);
    let mut end_offset = None;
    let mut cursor = bytes.len() - 22;
    loop {
        if get_u32(bytes, cursor).is_ok_and(|signature| signature == END_SIGNATURE) {
            end_offset = Some(cursor);
            break;
        }
        if cursor == scan_from {
            break;
        }
        cursor -= 1;
    }
    let end_offset = end_offset
        .ok_or_else(|| EngineError::InvalidInput("zip end record not found".to_string()))?;
    let entry_count = get_u16(bytes, end_offset + 10)? as usize;
    let central_size = get_u32(bytes, end_offset + 12)? as usize;
    let central_offset = get_u32(bytes, end_offset + 16)? as usize;
    let central = bytes
        .get(central_offset..central_offset + central_size)
        .ok_or_else(|| {
            EngineError::InvalidInput("zip central directory is truncated".to_string())
        })?;
    let mut files = Vec::with_capacity(entry_count);
    let mut offset = 0;
    for _ in 0..entry_count {
        if get_u32(central, offset)? != CENTRAL_HEADER_SIGNATURE {
            return Err(EngineError::InvalidInput(
                "zip central directory is corrupt".to_string(),
            ));
        }
        let method = get_u16(central, offset + 10)?;
        let checksum = get_u32(central, offset + 16)?;
        let compressed_size = get_u32(central, offset + 20)? as usize;
        let uncompressed_size = get_u32(central, offset + 24)? as usize;
        let name_len = get_u16(central, offset + 28)? as usize;
        let extra_len = get_u16(central, offset + 30)? as usize;
        let comment_len = get_u16(central, offset + 32)? as usize;
        let local_offset = get_u32(central, offset + 42)? as usize;
        let name_bytes = central
            .get(offset + 46..offset + 46 + name_len)
            .ok_or_else(|| {
                EngineError::InvalidInput("zip central directory is truncated".to_string())
            })?;
        let name = String::from_utf8(name_bytes.to_vec())
            .map_err(|_| EngineError::InvalidInput("zip entry name is not UTF-8".to_string()))?;
        offset += 46 + name_len + extra_len + comment_len;
        if name.ends_with('/') {
            continue;
        }
        if files.iter().any(|file: &ZipFile| file.name == name) {
            return Err(EngineError::InvalidInput(format!(
                "zip archive has a duplicate entry: {name}"
            )));
        }
        if get_u32(bytes, local_offset)? != LOCAL_HEADER_SIGNATURE {
            return Err(EngineError::InvalidInput(format!(
                "zip local header missing for: {name}"
            )));
        }
        let local_name_len = get_u16(bytes, local_offset + 26)? as usize;
        let local_extra_len = get_u16(bytes, local_offset + 28)? as usize;
        let data_start = local_offset + 30 + local_name_len + local_extra_len;
        let payload = bytes
            .get(data_start..data_start + compressed_size)
            .ok_or_else(|| {
                EngineError::InvalidInput(format!("zip payload truncated for: {name}"))
            })?;
        let data = match method {
            METHOD_STORED => payload.to_vec(),
            METHOD_DEFLATED => inflate(payload)?,
            other => {
                return Err(EngineError::InvalidInput(format!(
                    "zip entry uses unsupported method {other}: {name}"
                )));
            }
        };
        if data.len() != uncompressed_size || crc32(&data) != checksum {
            return Err(EngineError::InvalidInput(format!(
                "zip checksum mismatch for: {name}"
            )));
        }
        files.push(ZipFile { name, data });
    }
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry<'a>(name: &'a str, method: ZipMethod, data: &'a [u8]) -> ZipEntry<'a> {
        ZipEntry { name, method, data }
    }

    #[test]
    fn stored_and_deflated_entries_round_trip() {
        let payload: Vec<u8> = (0..2048).map(|index| (index % 251) as u8).collect();
        let archive = zip_write(&[
            entry("a.txt", ZipMethod::Stored, b"hello"),
            entry("b.bin", ZipMethod::Deflated, &payload),
            entry("dir/c.xml", ZipMethod::Deflated, b"<a/>"),
        ]);
        assert!(archive.starts_with(b"PK\x03\x04"));
        let files = zip_read(&archive).expect("written archive reads back");
        assert_eq!(files.len(), 3);
        assert_eq!(
            files[0],
            ZipFile {
                name: "a.txt".to_string(),
                data: b"hello".to_vec()
            }
        );
        assert_eq!(files[1].data, payload);
        assert_eq!(files[2].data, b"<a/>");
    }

    #[test]
    fn deflated_output_is_smaller_than_stored_for_repetitive_data() {
        let payload = vec![b'A'; 4096];
        let stored = zip_write(&[entry("a.bin", ZipMethod::Stored, &payload)]);
        let deflated = zip_write(&[entry("a.bin", ZipMethod::Deflated, &payload)]);
        assert!(deflated.len() < stored.len());
        assert_eq!(zip_read(&deflated).expect("reads back")[0].data, payload);
    }

    #[test]
    fn corrupt_archives_are_rejected() {
        assert!(zip_read(b"").is_err());
        assert!(zip_read(b"PK\x03\x04").is_err());
        let mut archive = zip_write(&[entry("a.txt", ZipMethod::Stored, b"hello")]);
        let signature_byte = archive.len() - 22;
        archive[signature_byte] ^= 0xFF;
        assert!(zip_read(&archive).is_err());
        let mut payload = zip_write(&[entry("a.txt", ZipMethod::Stored, b"hello")]);
        let flip = payload.len() / 2;
        payload[flip] ^= 0xFF;
        assert!(zip_read(&payload).is_err());
    }

    #[test]
    fn duplicate_names_are_rejected() {
        let archive = zip_write(&[
            entry("a.txt", ZipMethod::Stored, b"one"),
            entry("a.txt", ZipMethod::Stored, b"two"),
        ]);
        assert!(zip_read(&archive).is_err());
    }
}
