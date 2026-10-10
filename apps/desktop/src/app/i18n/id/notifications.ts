import type { EnDict } from '../en';

const notifications: EnDict['notifications'] = {
  themeChanged: 'Tema: {theme}',
  localeChanged: 'Bahasa: {language}',
  layoutChanged: 'Tata letak proyek: {layout}',
  settingsReset: 'Pengaturan dikembalikan ke bawaan.',
  extensions: {
    manifestInvalid: 'Ekstensi {id} gagal dimuat: manifes tidak valid — {detail}',
    engineIncompatible: 'Ekstensi {id} membutuhkan versi Grafalith yang kompatibel — dilewati',
    archiveNoManifest: 'Ekstensi dilewati: manifes tidak ditemukan di arsip .grlt',
    archiveManifestInvalid: 'Arsip ekstensi gagal dimuat: manifes tidak valid — {detail}',
    entryMissing: 'Ekstensi {id}: berkas entry point tidak ditemukan',
    invalidEntry: 'Ekstensi {id}: activate() tidak ditemukan atau bukan fungsi',
    activationFailed: 'Ekstensi {id} gagal saat aktivasi: {message}',
    activationTimeout: 'Ekstensi {id} kehabisan waktu saat aktivasi — dinonaktifkan',
    permissionDenied: 'Ekstensi {id} mencoba memakai izin yang tidak dideklarasikan — akses ditolak',
    missingDependency: 'Ekstensi {id} dilewati: dependensi {dependency} tidak terpasang',
    blockedDependency: 'Ekstensi {id} dilewati karena dependensi {dependency} bermasalah',
    circularDependency: 'Dependensi sirkular terdeteksi: {cycle}. Ekstensi-ekstensi ini dilewati',
    dependencyIncompatible: 'Ekstensi {id} dilewati: dependensi {dependency} tidak kompatibel',
    contributionsSkipped: 'Ekstensi {id}: {count} kontribusi tidak valid dilewati, sisanya tetap aktif',
    disabled: 'Ekstensi {id} dinonaktifkan',
    reloaded: 'Ekstensi {id} dimuat ulang',
    uninstalled: 'Ekstensi {id} dicopot',
    reloadFailed: 'Ekstensi {id} gagal dimuat ulang — tetap dinonaktifkan sampai berhasil',
    toolFailed: 'Alat ekstensi gagal: {title} — {reason}',
  },
};

export default notifications;
