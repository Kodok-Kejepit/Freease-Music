// Lanjutkan menonton: posisi terakhir video/lagu panjang (≥ 10 menit) disimpan di browser, lalu dipakai
// lagi saat diputar ulang. Daftarnya juga tampil di Beranda ("Lanjutkan menonton").
import { create } from 'zustand';
import { useSettings } from '../lib/settings';
import { toast } from '../lib/toast';
import { fmtTime } from '../lib/api';
import { isLocalFile, type Song } from '../lib/types';
import { currentSong, media, position, seek, usePlayer } from './player';

const KEY = 'freease-resume';
export interface ResumeItem { song: Song; t: number; d: number; at: number }
const read = (): Record<string, ResumeItem> => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
export const useResume = create<{ map: Record<string, ResumeItem> }>(() => ({ map: read() }));

function write(map: Record<string, ResumeItem>) {
  const list = Object.values(map).sort((a, b) => b.at - a.at).slice(0, 40);
  const next = Object.fromEntries(list.map((x) => [x.song.id, x]));
  useResume.setState({ map: next });
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* penuh */ }
}

export function forgetResume(id: string) {
  const map = { ...useResume.getState().map };
  delete map[id];
  write(map);
}

/** Daftar untuk Beranda: yang terakhir ditonton dulu. */
export const resumeList = (map: Record<string, ResumeItem>) => Object.values(map).sort((a, b) => b.at - a.at);

const LONG = 600;
let pendingFor = '';

// Simpan posisi tiap 5 detik selama diputar.
setInterval(() => {
  const s = currentSong();
  const p = usePlayer.getState();
  if (!s || !p.playing || isLocalFile(s.id) || !useSettings.getState().resumeLong) return;
  const d = p.duration || s.duration;
  if (!d || d < LONG) return;
  const t = position();
  const map = { ...useResume.getState().map };
  if (t > d - 30) delete map[s.id]; // hampir selesai → anggap sudah ditonton
  else if (t > 20) map[s.id] = { song: s, t, d, at: Date.now() };
  else return;
  write(map);
}, 5000);

// Saat lagu panjang yang pernah diputar dimuat lagi → lompat ke posisi terakhir.
usePlayer.subscribe((s, p) => {
  if (s.index === p.index && s.queue === p.queue) return;
  const cur = s.queue[s.index];
  pendingFor = cur && useSettings.getState().resumeLong ? cur.id : '';
});
function apply() {
  const s = currentSong();
  if (!s || s.id !== pendingFor) return;
  pendingFor = '';
  const r = useResume.getState().map[s.id];
  if (r && r.t > 20 && r.t < (r.d || Infinity) - 30) {
    seek(r.t);
    toast(`Melanjutkan dari ${fmtTime(r.t)}`);
  }
}
media.addEventListener('loadedmetadata', apply);
