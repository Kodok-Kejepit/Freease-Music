// Pengaturan disimpan di localStorage (per perangkat/browser).
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const ACCENTS = [
  { name: 'Aurora', a: '#8B5CF6', b: '#EC4899' },
  { name: 'Mint', a: '#10D9A0', b: '#22B8EE' },
  { name: 'Sunset', a: '#FF8A3D', b: '#FF3D71' },
  { name: 'Ocean', a: '#3B82F6', b: '#06D6E0' },
  { name: 'Lime', a: '#A3E635', b: '#22C55E' },
  { name: 'Rose', a: '#F43F5E', b: '#F59E0B' },
];

export interface Settings {
  accent: number;
  amoled: boolean;
  autoplay: boolean;
  normalize: boolean;
  eqEnabled: boolean;
  eqBands: number[]; // dB untuk 10 band
  bass: number; // 0..12 dB
  karaokeVocal: number; // 0..100 (% vokal asli yang tersisa)
  replyVoice: 'dev' | 'tts' | 'off';
  wakeWord: boolean;
  showLyricsCard: boolean;
  /** Sumber pencarian: YouTube Music (lagu, artis, album) atau YouTube biasa (semua video, kanal). */
  searchSource: 'music' | 'youtube';
  /** Subtitle video: '' = mati, 'id' = Indonesia (diterjemahkan bila perlu), 'orig' = bahasa asli. */
  subtitleLang: '' | 'id' | 'orig';
  subtitleSize: number; // 80..160 (%)
  /** Lanjutkan video/lagu panjang dari posisi terakhir. */
  resumeLong: boolean;
  /** Tampilkan terjemahan Indonesia di bawah tiap baris lirik. */
  lyricsTranslate: boolean;
  /** Tampilkan video (bukan hanya audio) untuk lagu YouTube. */
  videoMode: boolean;
  /** Tinggi video maksimal; 0 = otomatis sesuai layar & koneksi. */
  videoQuality: number;
  /** 'high' = audio terbaik (±130–160 kbps opus), 'low' = hemat data (±50 kbps). */
  audioQuality: 'high' | 'low';
  /** Baris lirik tampil di notifikasi media & layar kunci (menggantikan nama artis). */
  lyricsInNotification: boolean;
  set: (p: Partial<Settings>) => void;
}

export const EQ_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_PRESETS: Record<string, number[]> = {
  Datar: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Bass kuat': [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  Pop: [-1, 1, 3, 4, 3, 0, -1, -1, 0, 1],
  Rock: [4, 3, 1, -1, -2, 0, 2, 3, 4, 4],
  Vokal: [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1],
  Akustik: [3, 2, 1, 0, 1, 1, 2, 3, 2, 1],
  Dangdut: [4, 4, 2, 0, -1, 1, 3, 3, 2, 1],
  'Malam (pelan)': [2, 1, 0, -1, -2, -2, -1, -2, -3, -4],
};

export const useSettings = create<Settings>()(
  persist(
    (set) => ({
      accent: 0,
      amoled: false,
      autoplay: true,
      normalize: true,
      eqEnabled: false,
      eqBands: EQ_PRESETS.Datar,
      bass: 0,
      karaokeVocal: 0,
      replyVoice: 'dev',
      wakeWord: false,
      showLyricsCard: true,
      lyricsInNotification: false,
      searchSource: 'music',
      subtitleLang: '',
      subtitleSize: 100,
      resumeLong: true,
      lyricsTranslate: false,
      videoMode: false,
      videoQuality: 0,
      audioQuality: 'high',
      set: (p) => set(p),
    }),
    { name: 'freease-settings' },
  ),
);
