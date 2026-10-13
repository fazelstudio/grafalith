import type { EnDict } from '../en';

const errors: EnDict['errors'] = {
  engineUnavailable: 'Engine belum siap. Tunggu sebentar lalu coba lagi.',
  boot: {
    title: 'Grafalith gagal dimulai',
    description:
      'Layanan inti gagal diinisialisasi, sehingga aplikasi berhenti daripada berjalan setengah rusak.',
    retry: 'Coba lagi',
  },
};

export default errors;
