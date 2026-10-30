import { create } from 'zustand';

interface ToastState {
  message: string | null;
  key: number;
  show: (m: string) => void;
}

export const useToast = create<ToastState>((set) => ({
  message: null,
  key: 0,
  show: (m) => set((s) => ({ message: m, key: s.key + 1 })),
}));

export const toast = (m: string) => useToast.getState().show(m);
