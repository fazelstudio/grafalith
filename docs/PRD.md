# PRD — Fazelidraw

**Product Requirements Document**
Status: v4 (Professional-Grade) · Owner: (isi nama kamu) · Terakhir diubah: 2026-09-01

---

## 1. Ringkasan

Fazelidraw adalah **engine canvas 2D profesional untuk design & prototyping** (kelas Figma/TLDraw/Excalidraw), dibangun sebagai library headless yang bisa di-embed di aplikasi lain. Goal produk berkembang seiring waktu — riwayat singkat:

- **v1-v2**: Canvas engine ringan mirip Excalidraw/TLDraw dengan fitur draw dasar + full customization (theme, UI overrides, custom shape).
- **v3**: Headless architecture — `packages/core` bisa dipakai penuh tanpa UI bawaan (`packages/react`), lewat `Editor` API publik + event system.
- **v4 (saat ini)**: Naik kelas jadi **engine profesional** — behavior tiap fitur harus sama persis dengan tool mapan (Figma/TLDraw), ditambah fitur kelas profesional yang belum ada (vector path editing, boolean operations, component/instance system, constraints & auto-layout), plus dukungan canvas infinite ATAU bounded (ukuran tetap).

Prinsip inti tetap sama di semua versi:

1. **Ringan** — bundle size kecil, tidak bergantung pada framework berat untuk core engine.
2. **Efisien** — mampu menangani ribuan elemen tanpa drop frame, memory footprint rendah.
3. **Kaya fitur setara tool profesional** — bukan lagi "cukup untuk draw dasar" (v1), tapi mendekati kemampuan Figma/Illustrator untuk kebutuhan design & prototyping (lihat §4 dan §12).
4. **Behavior conformance** — setiap interaksi harus terasa familiar bagi user yang sudah biasa pakai tool desain profesional, bukan sekadar "berfungsi".

## 2. Masalah yang Dipecahkan

Tools seperti Excalidraw/TLDraw sudah bagus, tapi:
- Sulit di-embed secara ringan ke aplikasi lain tanpa membawa banyak dependency.
- Struktur data & rendering-nya dioptimalkan untuk kasus umum mereka, bukan kebutuhan spesifik kita.
- Kita ingin engine yang **kita pahami sepenuhnya** — mudah diperluas, mudah di-debug, tidak black-box.

## 3. Target Pengguna

- **Primer**: Developer (termasuk pembuat produk ini) yang ingin embed canvas drawing ke aplikasinya sendiri.
- **Sekunder**: End-user yang memakai aplikasi hasil embed tersebut untuk membuat diagram/sketsa/wireframe sederhana.

## 4. Scope Fitur (v1)

> **Status: v1 selesai dibangun (Fase 0–8).** Scope di bawah ini adalah baseline yang sudah diimplementasikan. Untuk fitur v2 (organisasi elemen, precision tools, image/media, dan **Customization API**), lihat §4.5 dan `docs/phases/09-*.md` s.d. `docs/phases/14-*.md`.

### 4.1 Harus Ada (Must Have) — v1, SELESAI
- [ ] Shape dasar: rectangle, ellipse/circle, line, arrow, freehand draw (pen)
- [ ] Text element (dengan editing in-place)
- [ ] Select single & multi (rubber-band selection)
- [ ] Move, resize, rotate elemen
- [ ] Copy, paste, duplicate, cut, delete
- [ ] Style: warna solid, warna gradient (linear), border (width, style: solid/dashed), fill opacity
- [ ] Undo/redo
- [ ] Pan & zoom (infinite canvas)
- [ ] Grouping/ungroup elemen
- [ ] Layering (bring to front/back, send forward/backward)
- [ ] Export ke PNG dan JSON (scene serialization)
- [ ] Import dari JSON

### 4.2 Sebaiknya Ada (Should Have)
- [ ] Crop untuk image element
- [ ] Arrow binding (arrow menempel & mengikuti elemen yang dihubungkan)
- [ ] Snap-to-grid / snap-to-object saat drag
- [ ] Keyboard shortcuts standar (Ctrl+C/V/D/Z/Y, Delete, Arrow keys untuk nudge)
- [ ] Alignment tools (align left/center/right, distribute)

### 4.3 Nice to Have (v2+, bukan prioritas v1)
- [ ] Real-time collaboration (multiplayer)
- [ ] Image upload & embed
- [ ] Custom shape plugin API
- [ ] Library/template komponen

### 4.4 Eksplisit Di Luar Scope
- Real-time collaboration di v1 (kompleksitas CRDT/sync terpisah dari core rendering — jangan dicampur sebelum fondasi solid)
- Rendering 3D / WebGL pipeline penuh (v1 pakai Canvas 2D API murni)
- Mobile native app (fokus web dulu; touch-friendly tapi bukan native)

### 4.5 Scope v2 — Fitur Profesional & Customization API

Ditambahkan setelah evaluasi v1: engine sudah fungsional tapi belum "terasa profesional" dibanding TLDraw/Excalidraw/Figma, dan belum bisa dikustomisasi konsumennya (developer yang embed engine ini). v2 menutup dua gap sekaligus:

**A. Full Customization** (prioritas tertinggi — lihat §10 di bawah)
Developer yang meng-embed Fazelidraw harus bisa mengubah theme, icon set, color picker, font, ukuran/posisi UI, dan menambah/mengganti shape sendiri — **tanpa fork source code engine**. Ini bukan fitur tambahan biasa, ini lapisan arsitektur yang mempengaruhi cara semua fitur lain dibangun.

**B. Organisasi elemen**: grouping/ungroup, layer management, lock elemen, frame/container.

**C. Precision tools**: alignment (left/center/right/distribute), snap-to-grid, snap-to-object, smart guides, numeric input untuk posisi/ukuran/rotasi.

**D. Image & media**: upload/paste/drag-drop gambar, crop, resize dengan aspect-ratio lock.

**E. Skalabilitas & robustness**: schema versioning untuk file lama, large-paste handling.

Detail teknis lengkap tiap area v2 ada di `docs/phases/09-*.md` s.d. `docs/phases/15-*.md`. Lihat `docs/phases/00-overview.md` (bagian v2) untuk urutan dan ketergantungan antar fase.

## 5. Target Performa (Non-Negotiable)

Ini bukan aspirasi — ini **kriteria lulus/gagal** yang harus diverifikasi dengan profiling nyata, bukan asumsi:

| Metrik | Target |
|---|---|
| Elemen di scene sebelum FPS drop di bawah 60fps saat pan/zoom | ≥ 5.000 elemen |
| Waktu render 1 frame (viewport culled) | < 16ms |
| Hit-test (klik untuk select) pada scene 5.000 elemen | < 5ms |
| Bundle size core engine (tanpa UI/React wrapper) | < 150KB gzipped |
| Waktu dari cold start ke canvas interaktif | < 500ms |

Lihat `docs/phases/07-performance-optimization.md` untuk metodologi pengukuran.

## 6. Prinsip Arsitektur (Ringkasan — detail di ARCHITECTURE.md)

1. **Core engine framework-agnostic.** Logic canvas (scene, rendering, hit-test) ditulis di TypeScript murni, tidak bergantung React/Vue. UI toolbar boleh pakai framework apapun di layer terpisah.
2. **Dual-canvas rendering** — canvas statis untuk elemen, canvas interaktif untuk selection/handle (lihat referensi Excalidraw).
3. **Data-oriented, bukan object-oriented berlebihan.** Elemen adalah plain data object yang serializable, bukan class dengan behavior tertanam.
4. **Immutable update pattern** untuk mempermudah undo/redo & change detection (mirip `sceneVersion`/nonce di Excalidraw).

## 7. Metrik Sukses Produk

- Engine bisa di-embed ke aplikasi contoh (demo app) dalam < 30 menit setup oleh developer baru.
- Semua fitur di §4.1 lulus manual QA checklist (lihat `docs/phases/`).
- Tidak ada regresi performa di bawah target §5 setelah setiap fase selesai.

## 8. Milestone & Urutan Kerja

Lihat `docs/phases/00-overview.md` untuk breakdown fase teknis. Ringkasan:

1. Fase 0 — Fondasi tipe data & setup project
2. Fase 1 — Render loop, viewport, kamera
3. Fase 2 — Shape primitif & hit-testing
4. Fase 3 — Selection & transform (move/resize/rotate)
5. Fase 4 — Style system (warna, gradient, border)
6. Fase 5 — Text & arrow (+ binding)
7. Fase 6 — Clipboard & history (undo/redo)
8. Fase 7 — Spatial index, optimisasi performa, export/import

**v2 (Customization — selesai):**

9. Fase 9 — Customization API: Theme & Design Tokens
10. Fase 10 — Customization API: UI Overrides (icon, komponen, layout)
11. Fase 11 — Customization API: Custom Shape Registry
12. Fase 12 — Organisasi elemen (grouping, layer, lock, frame)
13. Fase 13 — Precision tools (alignment, snapping, smart guides, numeric input)
14. Fase 14 — Image & media (upload, crop, resize)
15. Fase 15 — Robustness (schema versioning, large-paste handling)

**v3 (Headless API — saat ini dikerjakan):**

16. Fase 16 — Public Editor API (kontrak stabil untuk semua operasi engine)
17. Fase 17 — Event/Subscription System (reaktivitas untuk UI eksternal)
18. Fase 18 — Headless Mode Audit & Contoh UI Custom Independen

**v4 (saat ini — Professional-Grade & Behavior Conformance):**

19. Fase 19 — Behavior Conformance Audit (WAJIB paling awal di v4)
20. Fase 20 — Canvas Mode: Infinite vs Bounded
21. Fase 21 — Path Editing & Boolean Operations
22. Fase 22 — Component/Instance System
23. Fase 23 — Constraints & Auto-layout

Setiap fase = 1 dokumen terpisah di `docs/phases/`, dikerjakan berurutan oleh AI agent, dengan Definition of Done masing-masing.

## 9. Referensi Riset

Keputusan arsitektur di dokumen ini didasarkan pada studi terhadap:
- Excalidraw (dual-canvas architecture, sceneNonce cache invalidation, viewport culling) — https://github.com/excalidraw/excalidraw
- TLDraw (signal-based reactive store — **tidak** kita adopsi untuk v1 karena overhead tidak diperlukan tanpa multiplayer)
- Riset spatial indexing (grid hashing vs quadtree vs R-tree) untuk hit-testing skala besar
- **v2**: Pola extensibility TLDraw (`ShapeUtil` class per tipe shape + `ShapeUtil.configure()` untuk kustomisasi tanpa subclass, UI overrides terpisah dari core, theme system dengan display-values pipeline) — dipakai sebagai referensi utama arsitektur Customization API v2. Lihat `docs/phases/09-customization-theme.md` §0 untuk detail.
- **v3**: Pola `Editor` API TLDraw (satu object publik sebagai kontrak stabil untuk semua operasi, terpisah dari komponen UI React yang cuma "consumer" dari Editor itu) — dipakai sebagai referensi arsitektur headless. Lihat `docs/ARCHITECTURE.md` §10.

## 10. Prinsip Full Customization (v2 — Non-Negotiable)

Ini requirement produk yang **sama pentingnya dengan target performa di §5**, bukan fitur pelengkap:

> Developer yang meng-embed Fazelidraw harus punya kontrol penuh terhadap tampilan dan perilaku default engine — theme/warna, icon, font, color picker, ukuran & posisi elemen UI, dan shape — **tanpa perlu fork atau modifikasi source code `packages/core` atau `packages/react`.**

Prinsip turunan:
1. **Tidak ada nilai hardcoded** untuk hal yang berpotensi ingin diganti developer (warna, font, ukuran icon, komponen UI) — semua harus lewat token/config yang bisa di-override.
2. **Override lewat komposisi, bukan modifikasi.** Developer memberi object config/props ke engine (`theme={...}`, `components={...}`, `shapeUtils={...}`), BUKAN mengedit file di `node_modules` atau fork repo.
3. **Default tetap harus lengkap dan bagus.** Customization API tidak boleh memaksa developer mengisi semua konfigurasi hanya untuk pakai engine — semua override bersifat opsional dengan default yang masuk akal (sensible defaults).
4. **Tidak menambah beban performa untuk yang tidak pakai custom.** Developer yang tidak melakukan kustomisasi apapun harus tetap dapat performa penuh sesuai target §5 — layer indirection untuk customization tidak boleh jadi overhead permanen.

Detail teknis lengkap ada di `docs/phases/09-customization-theme.md`, `docs/phases/10-customization-ui.md`, dan `docs/phases/11-customization-shapes.md`.

## 11. Prinsip Headless / Full Control (v3 — Non-Negotiable)

**Ini bukan perpanjangan §10, ini level kontrol yang lebih dalam.** §10 (v2) mengasumsikan developer tetap memakai `packages/react` dan cuma mengganti sebagian komponennya. §11 (v3) mengasumsikan developer **mungkin tidak memakai `packages/react` sama sekali** — mereka bikin UI sendiri dari nol (React lain, Vue, vanilla JS, bahkan native mobile lewat WebView) dan hanya memanggil logic dari `packages/core`.

> `packages/core` harus 100% dapat dipakai TANPA `packages/react`. Semua kemampuan yang dibutuhkan sebuah UI untuk berfungsi penuh — membuat elemen, memilih tool, mengatur style, undo/redo, mengetahui kapan sesuatu berubah — harus tersedia lewat satu **Editor API publik** yang terdokumentasi dan stabil, bukan lewat fungsi internal yang kebetulan bisa diakses.

Prinsip turunan:
1. **`packages/react` adalah CONSUMER dari Editor API, bukan tempat logic berada.** Kalau ada logic yang cuma bisa diakses lewat komponen React (bukan lewat `Editor` object), itu adalah kesalahan arsitektur yang harus diperbaiki.
2. **Full control atas UI berarti granular, bukan cuma ganti komponen.** Developer harus bisa: menyalakan/mematikan tool tertentu satu-satu (bukan cuma ganti seluruh Toolbar), menaruh elemen UI di posisi bebas (bukan cuma pilih dari preset layout), styling granular per elemen UI, dan memanggil operasi engine dari trigger UI apapun buatan mereka sendiri (tombol custom, gesture custom, shortcut custom).
3. **Event system wajib ada** — headless architecture tidak berguna kalau UI eksternal tidak tahu kapan harus re-render. `Editor` harus expose subscription (`editor.on(event, callback)` atau pola serupa) untuk semua perubahan state yang relevan (scene berubah, selection berubah, tool aktif berubah, dst).
4. **Dibuktikan dengan contoh nyata, bukan klaim.** Definition of Done untuk fase headless (`docs/phases/18-headless-audit.md`) mensyaratkan ada UI contoh yang benar-benar dibangun dari nol TANPA `packages/react`, murni memanggil `packages/core`.

Detail teknis lengkap ada di `docs/phases/16-editor-api.md`, `docs/phases/17-event-system.md`, dan `docs/phases/18-headless-audit.md`.

## 12. Prinsip Professional-Grade & Behavior Conformance (v4 — Non-Negotiable)

Ini pergeseran level, bukan sekadar fitur baru:

> Fazelidraw tidak lagi cukup "berfungsi seperti tool draw sederhana" — setiap interaksi harus terasa SAMA PERSIS dengan konvensi yang sudah mapan di tool desain profesional (Figma, TLDraw, Illustrator). Fitur baru yang ditambahkan (path editing, boolean ops, component/instance, constraints/auto-layout) harus setara kemampuannya dengan tool sekelas itu, bukan versi sederhana/terbatas.

Prinsip turunan:
1. **Behavior conformance BUKAN opsional.** Sebelum fitur baru apapun ditambah di v4, fitur LAMA (Fase 0-18) harus diaudit dan diperbaiki dulu supaya perilakunya sesuai konvensi profesional (lihat `docs/phases/19-behavior-conformance.md`) — fondasi yang goyah membuat fitur baru di atasnya ikut terasa asing/tidak natural.
2. **Referensi behavior adalah tool yang sudah mapan, bukan asumsi baru.** Untuk setiap keputusan desain interaksi yang ambigu, cek dulu bagaimana Figma/TLDraw/Illustrator menanganinya sebelum memutuskan sendiri — konsistensi dengan ekspektasi user berpengalaman lebih penting daripada orisinalitas.
3. **Canvas mode fleksibel untuk kebutuhan produk turunan.** Karena Fazelidraw akan dipakai untuk membangun aplikasi web (bukan cuma dipakai langsung), engine harus mendukung baik mode infinite (whiteboard) MAUPUN mode bounded/artboard (ukuran tetap, untuk kebutuhan seperti editor thumbnail, social media template, dst) — dipilih developer saat inisialisasi.
4. **Fitur baru tidak boleh mengorbankan target performa §5** — semua fitur di §12 (terutama boolean ops dan component/instance yang computationally berat) harus tetap menjaga scene besar (5.000+ elemen) tidak drop di bawah 60fps untuk operasi normal (fitur berat seperti boolean ops boleh punya latency sendiri yang wajar untuk operasi eksplisit, tapi tidak boleh membebani render loop/interaksi umum).

### Fitur Baru v4

- **Path Editing & Boolean Operations**: vector pen tool (anchor + Bezier handle), union/subtract/intersect/exclude antar shape apapun.
- **Component/Instance System**: reusable component dengan instance yang tersinkron otomatis dari master, override granular per-property tanpa mengunci property lain.
- **Constraints & Auto-layout**: constraint (pin/stretch/scale) untuk elemen dalam frame biasa saat di-resize; auto-layout (flexbox-like) untuk frame yang menyusun child-nya otomatis.
- **Canvas Mode**: pilihan infinite (whiteboard tanpa batas) atau bounded (ukuran width×height tetap, tetap bisa di-zoom/pan bebas) — ditentukan saat inisialisasi.

Detail teknis lengkap ada di `docs/phases/19-behavior-conformance.md` s.d. `docs/phases/23-constraints-autolayout.md`.