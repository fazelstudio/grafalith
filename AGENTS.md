# AGENTS.md — Instruksi untuk AI Coding Agent

Dokumen ini WAJIB dibaca sebelum mengerjakan task apapun di repo ini. Jika ada instruksi task yang bertentangan dengan file ini, **file ini menang** — berhenti dan tanya user, jangan menebak.

## 1. Ringkasan Proyek

Fazelidraw: canvas engine drawing (mirip Excalidraw/TLDraw), fokus ringan & efisien. TypeScript. Monorepo. Core engine di `packages/core` harus **zero framework dependency** (tidak boleh import React/Vue/dsb).

## 2. Dokumen Wajib Dibaca Sebelum Kerja

1. `docs/PRD.md` — scope fitur, apa yang IN dan OUT.
2. `docs/ARCHITECTURE.md` — kontrak teknis: struktur data, pola rendering, spatial index. **Tidak boleh disimpangi tanpa izin eksplisit.**
3. `docs/phases/00-overview.md` — urutan fase kerja saat ini.
4. Dokumen fase yang sedang dikerjakan (misal `docs/phases/02-shapes.md`) — scope spesifik & Definition of Done untuk task saat ini.

## 3. Scope per Sesi — ATURAN PALING PENTING

- **Kerjakan HANYA fase yang diminta user di sesi ini.** Jangan mengerjakan fase berikutnya "sekalian" meski terlihat berhubungan.
- Jangan mengubah struktur data di `docs/ARCHITECTURE.md` §2 (interface elemen) kecuali user secara eksplisit minta itu.
- Jangan menambah dependency baru ke `packages/core/package.json` kecuali sudah disebutkan di dokumen fase terkait.
- Kalau task terasa butuh mengubah keputusan arsitektur yang sudah ditetapkan (misal: "sepertinya lebih gampang pakai Array daripada Map"), **STOP. Laporkan ke user, jangan langsung ubah.**

## 4. Perintah Proyek

Package manager: **Bun**. Jangan pakai npm/yarn/pnpm — jangan generate `package-lock.json`/`pnpm-lock.yaml`, hanya `bun.lock`.

```bash
# Install
bun install

# Dev (demo app)
bun run --filter demo dev

# Test (Bun punya test runner bawaan — pakai itu, jangan tambah Vitest/Jest kecuali dibahas dulu)
bun test --filter core

# Type check (WAJIB jalan bersih sebelum task dianggap selesai)
bun run --filter core typecheck

# Build core package
bun run --filter core build
```

Jika salah satu command di atas belum ada di `package.json` karena fase project belum sampai sana, buat dulu sesuai kebutuhan fase yang sedang dikerjakan — jangan skip begitu saja.

**Catatan workspace**: Bun mendukung workspaces lewat field `"workspaces"` di root `package.json` (format sama seperti npm/yarn workspaces, BUKAN `pnpm-workspace.yaml`). Filter per-package pakai `bun run --filter <nama-package> <script>` (Bun ≥1.2) atau, kalau versi Bun yang dipakai belum mendukung `--filter`, jalankan langsung `cd packages/core && bun run <script>` sebagai fallback — cek versi Bun yang tersedia dulu sebelum memilih pendekatan.

## 5. Struktur Repo & Batasan

```
packages/core/src/
  scene/        # boleh diedit sesuai fase terkait
  render/       # boleh diedit sesuai fase terkait
  spatial/      # HANYA disentuh di Fase 7, kecuali diminta lain
  history/      # HANYA disentuh di Fase 6
  interaction/  # boleh diedit sesuai fase terkait
  theme/         # v2 — HANYA disentuh mulai Fase 9
  shapes/        # boleh diedit sesuai fase terkait; jadi registry publik mulai Fase 11
  assets/         # v2 — HANYA disentuh di Fase 14
  io/             # export/import — Fase 7 (v1), extended di Fase 15 (schema versioning)
  editor/         # v3 — HANYA disentuh mulai Fase 16 (Editor class, event-emitter)
  geometry/       # v4 — HANYA disentuh di Fase 21 (boolean ops, path math)
  components/     # v4 — HANYA disentuh di Fase 22 (component registry, instance sync)
packages/react/src/    # v2 — HANYA disentuh mulai Fase 10. Boleh depend ke React (beda dengan packages/core). Di-REFACTOR di Fase 18 untuk memakai Editor API.
docs/           # JANGAN diedit oleh agent kecuali diminta eksplisit ("update dokumentasi")
apps/demo/      # bebas diedit untuk keperluan testing manual fitur
apps/demo-headless/  # v3 — HANYA dibuat di Fase 18, sebagai bukti UI custom independen
```

## 6. Konvensi Kode (yang tidak di-enforce linter)

- **Element = plain data, bukan class.** Behavior (render, hitTest) adalah fungsi terpisah `renderRectangle(ctx, element)`, bukan method `element.render()`. Lihat ARCHITECTURE.md §1.
- **Semua elemen disimpan dalam scene coordinates**, bukan screen coordinates. Konversi hanya terjadi di titik render/input. Lihat ARCHITECTURE.md §3.5.
- **Setiap mutasi elemen HARUS increment `version` dan generate `versionNonce` baru**, dan HARUS lewat method `Scene.upsertElement()` — jangan mutate object elemen secara langsung di luar Scene.
- **Delete = soft delete** (`isDeleted = true`), bukan `Map.delete()`, kecuali di fase cleanup/garbage collection eksplisit.
- Nama file: `kebab-case.ts`. Nama tipe/interface: `PascalCase`. Nama fungsi/variabel: `camelCase`.
- Setiap fungsi publik di `packages/core` butuh JSDoc singkat (1-2 baris, apa yang dilakukan + parameter penting) — bukan esai.

## 7. Contoh Pola yang Benar

```typescript
// BENAR — element sebagai data, render terpisah
interface RectangleElement extends BaseElement { type: 'rectangle' }
function renderRectangle(ctx: CanvasRenderingContext2D, el: RectangleElement): void { /* ... */ }

// SALAH — jangan begini
class RectangleElement {
  render(ctx: CanvasRenderingContext2D) { /* ... */ } // behavior menempel di data
}
```

```typescript
// BENAR — mutasi lewat Scene, version di-bump otomatis
scene.upsertElement({ ...element, x: newX, y: newY });

// SALAH — mutasi langsung
element.x = newX; // version tidak ter-update, history rusak
```

## 8. Definition of Done (berlaku untuk semua task)

Sebelum melaporkan task selesai, agent harus:
1. `bun run --filter core typecheck` lulus tanpa error.
2. `bun test --filter core` lulus (kalau ada test untuk area yang disentuh).
3. Fitur diuji manual di `apps/demo` (jelaskan langkah manual yang dilakukan/harus dilakukan user untuk verifikasi).
4. Definition of Done spesifik di dokumen fase terkait (`docs/phases/0X-*.md`) terpenuhi — cek checklist di bagian akhir dokumen fase itu.
5. Tidak ada perubahan di luar file yang relevan dengan fase (jangan "sambil beresin" file lain di luar scope).

## 9. Yang TIDAK Boleh Dilakukan Tanpa Izin Eksplisit

- Menambah dependency besar (state management library, animation library, dsb) ke `packages/core`.
- Mengubah interface `BaseElement` atau elemen spesifik di ARCHITECTURE.md — **termasuk menambah field baru** (misal `hidden`, `frameId`) meski terlihat kecil/aman. Laporkan dulu, tunggu konfirmasi.
- Mengganti pendekatan dual-canvas dengan single-canvas atau sebaliknya.
- Mengganti Map-based scene storage dengan Array.
- Menghapus/mengubah dokumen di `docs/` kecuali diminta eksplisit ("update PRD", "update architecture doc").
- Melompat ke fase yang belum diminta, meski secara teknis "lebih efisien dikerjakan sekalian".
- **(v2)** Menambah dependency React/framework UI ke `packages/core` — komponen React HANYA boleh di `packages/react`.
- **(v2)** Melakukan mutasi global untuk theme/config (lihat ARCHITECTURE.md §9.2) — semua customization lewat config object yang di-pass eksplisit.
- **(v2)** Mengubah `Element` union type jadi bentuk terbuka/generic (untuk custom shape, Fase 11) tanpa melaporkan analisis trade-off dulu — ini keputusan arsitektur besar, bukan detail implementasi.
- **(v3)** Menulis ulang logic Scene/History/dst yang sudah ada dari Fase 0-15 saat membangun `Editor` API (Fase 16) — Editor harus jadi pembungkus tipis, bukan implementasi baru. Kalau ditemukan bug di kode lama saat audit, laporkan dulu, jangan langsung diperbaiki dalam scope Fase 16-18.
- **(v3)** Menambah dependency event/reactive library (RxJS, dst) untuk Event System (Fase 17) — implementasi pub-sub native saja.
- **(v3)** Membiarkan `packages/react` (setelah Fase 18) tetap mengakses modul internal `packages/core` secara langsung alih-alih lewat `Editor` API — ini persis yang harus dihilangkan di Fase 18, bukan hal yang boleh dibiarkan "karena sudah jalan".
- **(v4)** Menambah fitur baru (Fase 20-23) SEBELUM Fase 19 (Behavior Conformance) selesai — Fase 19 adalah fondasi wajib yang harus dikerjakan lebih dulu.
- **(v4)** Menambah dependency library computational geometry (Fase 21, boolean ops) TANPA melaporkan dan mendapat konfirmasi dulu, lengkap dengan analisis ukuran bundle-nya.
- **(v4)** Mengasumsikan/menebak behavior interaksi yang ambigu tanpa mengecek dulu bagaimana Figma/TLDraw menanganinya (lihat PRD §12 poin 2) — untuk kasus yang benar-benar tidak jelas setelah dicek, laporkan dan minta keputusan user, jangan menebak sendiri diam-diam.

## 10. Kalau Ragu

Jika instruksi user ambigu, atau kamu (agent) menemukan bahwa fase saat ini butuh keputusan yang tidak dibahas di ARCHITECTURE.md — **tulis pertanyaan singkat ke user, jangan berasumsi**. Satu asumsi salah di struktur data bisa merusak semua fase berikutnya.