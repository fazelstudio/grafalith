import type { EnDict } from '../en';

const settings: EnDict['settings'] = {
  title: 'Pengaturan',
  subtitle: 'Preferensi tampilan dan umum. Perubahan langsung diterapkan.',
  general: {
    title: 'Umum',
    description: 'Bahasa dan preferensi dasar aplikasi.',
    offlineNote: 'Grafalith bekerja luring. Preferensi disimpan secara lokal di perangkat ini.',
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
    layoutLabel: 'Tata letak proyek',
    layoutDescription: 'Susunan grid atau daftar untuk proyek di halaman beranda.',
  },
  editor: {
    title: 'Editor',
    description: 'Preferensi ruang kerja kanvas. Hanya opsi dengan perilaku nyata yang tampil di sini.',
    canvasHintLabel: 'Tampilkan petunjuk kanvas',
    canvasHintDescription: 'Tampilkan petunjuk mulai pada kanvas kosong.',
    restoreViewportLabel: 'Pulihkan posisi kanvas',
    restoreViewportDescription: 'Buka setiap proyek pada posisi kanvas terakhir.',
    autosaveLabel: 'Simpan otomatis',
    autosaveDescription: 'Simpan proyek yang terbuka secara otomatis setelah setiap perubahan.',
    autosaveDelayLabel: 'Jeda simpan otomatis',
    autosaveDelayDescription: 'Tunggu setelah perubahan terakhir sebelum menyimpan otomatis, dalam milidetik.',
  },
  shortcuts: {
    title: 'Pintasan',
    description: 'Semua pintasan papan ketik dalam satu daftar yang dapat dicari.',
    searchLabel: 'Cari pintasan',
    searchPlaceholder: 'Cari pintasan…',
    empty: 'Tidak ada pintasan yang cocok.',
    fixedNote: 'Pintasan bersifat tetap pada rilis ini. Sistem perintah belum mendukung penimpaan yang aman.',
  },
  extensions: {
    title: 'Ekstensi',
    description: 'Pengaturan yang dideklarasikan ekstensi terpasang. Berlaku pada aktivasi berikutnya.',
    empty: 'Belum ada ekstensi terpasang yang mendeklarasikan pengaturan.',
  },
  actions: {
    resetSection: 'Kembalikan ke bawaan',
  },
  search: {
    label: 'Cari pengaturan',
    placeholder: 'Cari pengaturan…',
    empty: 'Tidak ada pengaturan yang cocok.',
  },
};

export default settings;
