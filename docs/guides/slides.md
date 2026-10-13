# Slides Guide — PowerPoint (`.pptx`) export foundation

The `grafalith-pptx` crate builds valid `.pptx` packages from slide decks.
Stage 1 (this document) covers blank slides at explicit sizes, registered
as an exporter capability. Element-to-shape mapping (text, autoshapes,
images) is the next stage; arbitrary-producer import, charts, SmartArt,
OLE, and encrypted packages are explicitly out of scope.

## Subset profile

- One slide size per deck (PowerPoint model), expressed in EMU
  (`SlideSize::from_px` at 96 DPI, `from_mm`, `from_cm`, or
  `SlideSize::default_16x9`).
- Blank slides with an optional solid background (`#rrggbb`).
- One master, one blank layout, and a minimal theme per package.
- Deflated entries; byte-deterministic output for a given input.

## Ownership (what is hand-written, what is a dependency)

Hand-written and fully owned: ZIP framing, CRC32, base64, and the XML
builders (`crc32`, `base64`, `zip`, `xml` modules, covered by fixed
vectors). Two tiny pure-Rust crates fill the gaps that are genuinely
hard to own: `flate2` (Rust backend, no C — DEFLATE codec) and
`quick-xml` (no-encoding core — package verification and the future
import path). Both are WASM-safe with system dependencies; default
workspace builds pay nothing extra because no other crate depends on
`grafalith-pptx`.

## Usage

```rust
use grafalith_core::extension::ExtensionRegistry;
use grafalith_pptx::{PptxExporter, PptxExtension, SlideDeck, SlideSize, SlideSpec, build_package};

// Direct build: two 16:9 slides, the second with a solid background.
let deck = SlideDeck {
    size: SlideSize::default_16x9(),
    slides: vec![
        SlideSpec { background: None },
        SlideSpec { background: Some("#112233".to_string()) },
    ],
};
let bytes: Vec<u8> = build_package(&deck)?;

// Capability registration: unique extension id plus the `.pptx` MIME
// format id, discoverable through the registry like any other exporter.
let mut registry = ExtensionRegistry::new();
registry.register(Box::new(PptxExtension::new()))?;
let encoded: String = registry.exporters()[0].export(&document)?;
```

The exporter contract is string-only, so the binary package crosses it
base64-encoded; hosts decode and save the bytes. Every fallible
operation returns `EngineResult`; nothing panics across a boundary.

## Verification

```bash
cargo test -p grafalith-pptx
cargo clippy -p grafalith-pptx --all-targets -- -D warnings
```

Conformance beyond unit tests means opening generated packages in
PowerPoint and LibreOffice; collect those fixtures before extending the
profile (shapes, images, import).
