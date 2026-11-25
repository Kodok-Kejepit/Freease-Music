import { create } from 'zustand';
import type { Song } from '../lib/types';

/** Status tampilan global: layar pemutar, panel samping, menu lagu, asisten. */
interface UiState {
  nowPlaying: boolean;
  npTab: 'lyrics' | 'queue' | null;
  panel: 'queue' | 'lyrics' | null;
  menu: Song | null;
  addTo: Song[] | null;
  assistant: boolean;
  assistantWake: boolean;
  /** Perintah yang langsung dijalankan saat asisten dibuka ("oke freease, putar Tulus"). */
  assistantInitial: string;
  openMenu: (s: Song) => void;
  set: (p: Partial<UiState>) => void;
}

export const useUi = create<UiState>((set) => ({
  nowPlaying: false,
  npTab: null,
  panel: null,
  menu: null,
  addTo: null,
  assistant: false,
  assistantWake: false,
  assistantInitial: '',
  openMenu: (s) => set({ menu: s }),
  set: (p) => set(p),
}));
