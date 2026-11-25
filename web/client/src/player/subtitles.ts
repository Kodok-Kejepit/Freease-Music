// Subtitle untuk video YouTube yang sedang diputar (termasuk terjemahan Indonesia). Teks yang sedang tampil
// disimpan di store kecil; overlay di atas video (components/SubtitleOverlay) membacanya.
import { create } from 'zustand';
import { api, type Cue } from '../lib/api';
import { useSettings } from '../lib/settings';
import { isLocalFile } from '../lib/types';
import { currentSong, position, usePlayer } from './player';

export const useSubtitles = create<{ text: string; name: string; loading: boolean; error: string | null }>(() => ({
  text: '', name: '', loading: false, error: null,
}));

let cues: Cue[] = [];
let key = '';
let idx = 0;
let ctrl: AbortController | null = null;

function load() {
  const s = currentSong();
  const lang = useSettings.getState().subtitleLang;
  const k = s && lang && !isLocalFile(s.id) ? `${s.id}|${lang}` : '';
  if (k === key) return;
  key = k;
  cues = [];
  idx = 0;
  ctrl?.abort();
  useSubtitles.setState({ text: '', name: '', loading: !!k, error: null });
  if (!k || !s) return;
  ctrl = new AbortController();
  const mine = k;
  api.captions(s.id, lang, ctrl.signal)
    .then((r) => { if (key === mine) { cues = r.cues; useSubtitles.setState({ name: r.name, loading: false }); } })
    .catch((e) => { if (key === mine && e.name !== 'AbortError') useSubtitles.setState({ loading: false, error: e.message || 'Subtitle tidak tersedia' }); });
}

/** Potongan subtitle pada detik [t] (pencarian maju dari posisi terakhir; mundur bila pengguna lompat). */
function cueAt(t: number): string {
  if (!cues.length) return '';
  if (idx >= cues.length || cues[idx].s > t) idx = 0;
  while (idx < cues.length - 1 && cues[idx + 1].s <= t) idx++;
  const c = cues[idx];
  return c && c.s <= t && t < c.e ? c.t : '';
}

setInterval(() => {
  if (!cues.length) return;
  const t = cueAt(position());
  if (t !== useSubtitles.getState().text) useSubtitles.setState({ text: t });
}, 150);

usePlayer.subscribe((s, p) => { if (s.index !== p.index || s.queue !== p.queue) load(); });
useSettings.subscribe((s, p) => { if (s.subtitleLang !== p.subtitleLang) load(); });
load();
