import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Heart, ListEnd, ListPlus, ListStart, Mic2, Plus, Radio, Share2, Trash2, User, Check } from 'lucide-react';
import { api, art } from '../lib/api';
import * as db from '../lib/db';
import { useLibrary } from '../lib/hooks';
import { toast, useToast } from '../lib/toast';
import { isLocalFile, type Song } from '../lib/types';
import { addToQueue, download, play, playNext, setKaraoke } from '../player/player';
import { Artwork, Sheet } from './ui';
import { useUi } from './uiState';

export async function startRadio(s: Song) {
  toast('Menyiapkan radio…');
  try {
    const more = await api.related(s.id);
    play([s, ...more.filter((x) => x.id !== s.id)], 0, `Radio ${s.title}`);
  } catch {
    play([s], 0, 'Radio');
  }
}

export function share(s: Song) {
  const url = `${location.origin}/song/${s.id}`;
  const text = `${s.title} — ${s.artist}`;
  if (navigator.share) navigator.share({ title: text, text, url }).catch(() => {});
  else navigator.clipboard.writeText(`${text}\n${url}`).then(() => toast('Link disalin'));
}

export function SongMenu() {
  const song = useUi((s) => s.menu);
  const set = useUi((s) => s.set);
  const nav = useNavigate();
  const [liked, setLiked] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  useEffect(() => {
    if (!song) return;
    db.isLiked(song.id).then(setLiked);
    db.getDownload(song.id).then((d) => setDownloaded(!!d));
  }, [song]);
  if (!song) return null;
  const close = () => set({ menu: null });
  const local = isLocalFile(song.id);
  const item = (icon: React.ReactNode, label: string, fn: () => void) => (
    <button className="sheet-item" onClick={() => { close(); fn(); }}>{icon}{label}</button>
  );
  return (
    <Sheet onClose={close}>
      <div className="sheet-head">
        <Artwork src={art(song)} />
        <div style={{ minWidth: 0 }}>
          <div className="title ellipsis">{song.title}</div>
          <div className="sub ellipsis">{song.artist}</div>
        </div>
      </div>
      {!local && item(<Heart size={20} fill={liked ? 'var(--a)' : 'none'} color={liked ? 'var(--a)' : undefined} />, liked ? 'Hapus dari Lagu yang Disukai' : 'Suka', () => db.setLiked(song, !liked).then(() => toast(liked ? 'Dihapus dari Lagu yang Disukai' : 'Ditambahkan ke Lagu yang Disukai')))}
      {item(<ListStart size={20} />, 'Putar berikutnya', () => { playNext([song]); toast('Diputar setelah lagu ini'); })}
      {item(<ListEnd size={20} />, 'Tambahkan ke antrean', () => { addToQueue([song]); toast('Ditambahkan ke antrean'); })}
      {!local && item(<ListPlus size={20} />, 'Tambahkan ke playlist', () => set({ addTo: [song] }))}
      {!local && item(<Radio size={20} />, 'Mulai radio lagu', () => startRadio(song))}
      {item(<Mic2 size={20} />, 'Putar dengan Mode Karaoke', () => { play([song], 0, 'Karaoke'); setTimeout(() => setKaraoke(true), 300); })}
      {!local && (downloaded
        ? item(<Trash2 size={20} />, 'Hapus unduhan', () => db.deleteDownload(song.id).then(() => toast('Unduhan dihapus')))
        : item(<Download size={20} />, 'Unduh (dengar offline)', async () => { toast(`Mengunduh "${song.title}"…`); if (await download(song)) toast(`"${song.title}" siap didengar offline`); }))}
      {song.artistId && item(<User size={20} />, 'Lihat artis', () => nav(`/artist/${song.artistId}`))}
      {!local && item(<Share2 size={20} />, 'Bagikan', () => share(song))}
    </Sheet>
  );
}

export function AddToPlaylistSheet() {
  const songs = useUi((s) => s.addTo);
  const set = useUi((s) => s.set);
  const lists = useLibrary(db.playlists, []);
  const [name, setName] = useState('');
  if (!songs) return null;
  const close = () => set({ addTo: null });
  return (
    <Sheet onClose={close}>
      <div className="dialog">
        <h3>Tambahkan ke playlist</h3>
        <form onSubmit={async (e) => { e.preventDefault(); if (!name.trim()) return; const p = await db.createPlaylist(name, songs); toast(`Ditambahkan ke ${p.name}`); close(); }} style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input className="field" placeholder="Playlist baru…" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn primary" type="submit" aria-label="Buat playlist"><Plus size={18} /></button>
        </form>
      </div>
      {lists.map((p) => (
        <button key={p.id} className="sheet-item" onClick={async () => { const n = await db.addToPlaylist(p.id, songs); toast(n ? `Ditambahkan ke ${p.name}` : `Sudah ada di ${p.name}`); close(); }}>
          <Artwork src={p.songs[0] ? art(p.songs[0]) : null} style={{ width: 40, height: 40, borderRadius: 6 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ellipsis">{p.name}</div>
            <div className="sub">{p.songs.length} lagu</div>
          </div>
          {songs.length === 1 && p.songs.some((s) => s.id === songs[0].id) && <Check size={18} color="var(--a)" />}
        </button>
      ))}
    </Sheet>
  );
}

export function Toast() {
  const message = useToast((s) => s.message);
  const key = useToast((s) => s.key);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!message) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 2800);
    return () => clearTimeout(t);
  }, [key, message]);
  return visible && message ? <div className="toast" key={key} role="status">{message}</div> : null;
}
