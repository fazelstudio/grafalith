import type { EnDict } from '../en';

const settings: EnDict['settings'] = {
  title: 'Pengaturan',
  subtitle: 'Preferensi tampilan dan umum. Perubahan langsung diterapkan.',
  general: {
    title: 'Umum',
    description: 'Bahasa dan preferensi dasar aplikasi.',
    offlineNote: 'OpenNary bekerja luring. Preferensi disimpan secara lokal di perangkat ini.',
    localeLabel: 'Bahasa',
    localeDescription: 'Bahasa antarmuka. Diterapkan tanpa muat ulang.',
    localeNames: {
      en: 'Inggris',
      id: 'Indonesia',
    },
  },
  appearance: {
    title: 'Tampilan',
    description: 'Tema untuk tampilan aplikasi.',
    themeLabel: 'Tema',
    themeDescription: 'Ikuti sistem atau pilih tema tetap.',
    themeModes: {
      system: 'Sistem',
      light: 'Terang',
      dark: 'Gelap',
    },
  },
  editor: {
    title: 'Editor',
    description: 'Preferensi ruang kerja kanvas. Hanya opsi dengan perilaku nyata yang tampil di sini.',
    canvasHintLabel: 'Tampilkan petunjuk kanvas',
    canvasHintDescription: 'Tampilkan petunjuk mulai pada kanvas kosong.',
    restoreViewportLabel: 'Pulihkan posisi kanvas',
    restoreViewportDescription: 'Buka setiap proyek pada posisi kanvas terakhir.',
  },
  shortcuts: {
    title: 'Pintasan',
    description: 'Semua pintasan papan ketik dalam satu daftar yang dapat dicari.',
    searchLabel: 'Cari pintasan',
    searchPlaceholder: 'Cari pintasan…',
    empty: 'Tidak ada pintasan yang cocok.',
    fixedNote: 'Pintasan bersifat tetap pada rilis ini. Sistem perintah belum mendukung penimpaan yang aman.',
  },
  actions: {
    resetSection: 'Kembalikan ke bawaan',
  },
};

export default settings;
