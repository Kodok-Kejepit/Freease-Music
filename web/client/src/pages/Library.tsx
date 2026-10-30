import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  BarChart3, ChevronDown, ChevronUp, Download, Folder, FolderInput, HardDrive, Heart, History as HistoryIcon, Pencil, Pin, Plus, Repeat, Sparkles, Trash2, TrendingUp, X,
} from 'lucide-react';
import { art, fmtTime } from '../lib/api';
import * as db from '../lib/db';
import { useLibrary } from '../lib/hooks';
import { toast } from '../lib/toast';
import type { LocalPlaylist, Song } from '../lib/types';
import { play } from '../player/player';
import { Collection } from '../components/Collection';
import { Artwork, Card, Empty, Sheet } from '../components/ui';
import { DownloadAll } from './Browse';

const grad = (a: string, b: string) => ({ background: `linear-gradient(135deg,${a},${b})`, display: 'flex', alignItems: 'center', justifyContent: 'center' } as const);

function Row({ to, title, sub, cover, pinned }: { to: string; title: string; sub: string; cover: React.ReactNode; pinned?: boolean }) {
  return (
    <Link to={to} className="song-row" style={{ gridTemplateColumns: 'auto 1fr' }}>
      <div style={{ width: 56, height: 56, borderRadius: 8, overflow: 'hidden' }}>{cover}</div>
      <div style={{ minWidth: 0 }}>
        <div className="title ellipsis" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{pinned && <Pin size={14} color="var(--a)" />}{title}</div>
        <div className="sub ellipsis">{sub}</div>
      </div>
    </Link>
  );
}

export const SMART = {
  top: { title: 'Sering kamu putar', sub: 'Lagu paling sering 30 hari terakhir', icon: TrendingUp, c: ['#FF6437', '#E8115B'] },
  repeat: { title: 'Diulang terus', sub: 'Diputar ≥ 3× minggu ini', icon: Repeat, c: ['#7B4DFF', '#2D46B9'] },
  forgotten: { title: 'Lama tak didengar', sub: 'Lagu disukai yang sebulan tidak diputar', icon: HistoryIcon, c: ['#27856A', '#1E3264'] },
  newlikes: { title: 'Baru disukai', sub: 'Lagu yang terakhir kamu sukai', icon: Heart, c: ['#F037A5', '#8C1932'] },
} as const;
type SmartKind = keyof typeof SMART;

async function loadSmart(kind: SmartKind): Promise<Song[]> {
  const now = Date.now();
  if (kind === 'top') return (await db.topStats(now - 30 * 86400_000)).songs.slice(0, 50).map((x) => x.song);
  if (kind === 'repeat') return (await db.topStats(now - 7 * 86400_000)).songs.filter((x) => x.plays >= 3).map((x) => x.song);
  if (kind === 'newlikes') return (await db.likedSongs()).slice(0, 50);
  const liked = await db.likedSongs();
  const out: Song[] = [];
  for (const s of liked) {
    const m = (await db.songMeta(s.id)) as (Song & { lastPlayedAt?: number }) | undefined;
    if (!m?.lastPlayedAt || m.lastPlayedAt < now - 30 * 86400_000) out.push(s);
  }
  return out.sort(() => Math.random() - 0.5).slice(0, 100);
}

export default function Library() {
  const lists = useLibrary(db.playlists, []);
  const liked = useLibrary(db.likedSongs, []);
  const dls = useLibrary(db.downloads, []);
  const artists = useLibrary(db.followedArtists, []);
  const [filter, setFilter] = useState(0);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [smartOpen, setSmartOpen] = useState(true);
  const [creating, setCreating] = useState(false);
  const nav = useNavigate();
  const folders = new Map<string, LocalPlaylist[]>();
  lists.filter((p) => p.folder).forEach((p) => folders.set(p.folder, [...(folders.get(p.folder) || []), p]));

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="h1">Koleksi Kamu</div>
        <button className="icon-btn" aria-label="Playlist baru" onClick={() => setCreating(true)}><Plus size={24} /></button>
      </div>
      <div className="chips">
        {['Semua', 'Playlist', 'Artis', 'Unduhan'].map((t, i) => <button key={t} className={`chip ${filter === i ? 'on' : ''}`} onClick={() => setFilter(i)}>{t}</button>)}
      </div>
      {(filter === 0 || filter === 1) && <Row to="/liked" title="Lagu yang Disukai" sub={`Playlist • ${liked.length} lagu`} cover={<div style={{ ...grad('#4b2bd1', '#a78bfa'), width: '100%', height: '100%' }}><Heart fill="#fff" color="#fff" /></div>} />}
      {(filter === 0 || filter === 3) && <Row to="/downloads" title="Unduhan" sub={`Offline • ${dls.length} lagu`} cover={<div style={{ ...grad('#0fb57d', '#0d5e91'), width: '100%', height: '100%' }}><Download color="#fff" /></div>} />}
      {filter === 0 && (
        <>
          <Row to="/local" title="Musik & video di perangkat" sub="Putar berkas MP3, FLAC, M4A, MP4, MKV…" cover={<div style={{ ...grad('#FF8A3D', '#B4235A'), width: '100%', height: '100%' }}><HardDrive color="#fff" /></div>} />
          <Row to="/history" title="Riwayat putar" sub="Semua yang pernah kamu dengar" cover={<div style={{ ...grad('#3A3A55', '#1E1E2C'), width: '100%', height: '100%' }}><HistoryIcon color="#fff" /></div>} />
          <Row to="/stats" title="Rekap & statistik" sub="Menit dengar, artis & lagu teratas, jam favorit" cover={<div style={{ ...grad('#8B5CF6', '#EC4899'), width: '100%', height: '100%' }}><BarChart3 color="#fff" /></div>} />
        </>
      )}
      {(filter === 0 || filter === 1) && (
        <>
          <button className="song-row" style={{ gridTemplateColumns: 'auto 1fr auto', width: '100%', textAlign: 'left' }} onClick={() => setSmartOpen(!smartOpen)}>
            <div style={{ width: 56, height: 56, borderRadius: 8, background: 'color-mix(in srgb, var(--a) 25%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Sparkles color="var(--a)" /></div>
            <div><div className="title">Playlist pintar</div><div className="sub">4 playlist yang tersusun sendiri</div></div>
            {smartOpen ? <ChevronUp size={20} color="var(--muted)" /> : <ChevronDown size={20} color="var(--muted)" />}
          </button>
          {smartOpen && (Object.keys(SMART) as SmartKind[]).map((k) => {
            const m = SMART[k];
            return <Row key={k} to={`/smart/${k}`} title={m.title} sub={`Playlist pintar • ${m.sub}`} cover={<div style={{ ...grad(m.c[0], m.c[1]), width: '100%', height: '100%' }}><m.icon color="#fff" /></div>} />;
          })}
          {[...folders.entries()].sort().map(([name, ps]) => (
            <div key={name}>
              <button className="song-row" style={{ gridTemplateColumns: 'auto 1fr auto', width: '100%', textAlign: 'left' }} onClick={() => setOpen((o) => { const n = new Set(o); n.has(name) ? n.delete(name) : n.add(name); return n; })}>
                <div style={{ width: 56, height: 56, borderRadius: 8, background: 'var(--card)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Folder /></div>
                <div><div className="title">{name}</div><div className="sub">Folder • {ps.length} playlist</div></div>
                {open.has(name) ? <ChevronUp size={20} color="var(--muted)" /> : <ChevronDown size={20} color="var(--muted)" />}
              </button>
              {open.has(name) && ps.map((p) => <div key={p.id} style={{ paddingLeft: 24 }}><Row to={`/playlist/${p.id}`} title={p.name} sub={`Playlist • ${p.songs.length} lagu`} cover={<Artwork src={p.songs[0] ? art(p.songs[0]) : null} style={{ width: '100%', height: '100%' }} />} /></div>)}
            </div>
          ))}
          {lists.filter((p) => !p.folder).map((p) => (
            <Row key={p.id} to={`/playlist/${p.id}`} title={p.name} pinned={p.pinned} sub={`Playlist • ${p.songs.length} lagu`} cover={<Artwork src={p.songs[0] ? art(p.songs[0]) : null} style={{ width: '100%', height: '100%' }} />} />
          ))}
        </>
      )}
      {(filter === 0 || filter === 2) && artists.length > 0 && (
        <>
          <div className="h2">Artis yang diikuti</div>
          <div className="grid-cards">{artists.map((a) => <Card key={a.id} to={`/artist/${a.id}`} image={a.thumbnail} title={a.name} sub="Artis" round />)}</div>
        </>
      )}
      {filter === 2 && !artists.length && <Empty icon={null} title="Belum mengikuti artis" sub="Buka halaman artis lalu ketuk Ikuti." />}
      {filter === 3 && dls.map((d) => <Row key={d.id} to="/downloads" title={d.song.title} sub={d.song.artist} cover={<Artwork src={art(d.song)} style={{ width: '100%', height: '100%' }} />} />)}
      {creating && <NameDialog title="Playlist baru" initial="" onClose={() => setCreating(false)} onSave={async (n) => { const p = await db.createPlaylist(n); setCreating(false); nav(`/playlist/${p.id}`); }} />}
    </div>
  );
}

export function NameDialog({ title, initial, onClose, onSave, placeholder = 'Nama' }: { title: string; initial: string; onClose: () => void; onSave: (v: string) => void; placeholder?: string }) {
  const [v, setV] = useState(initial);
  return (
    <Sheet onClose={onClose}>
      <form className="dialog" onSubmit={(e) => { e.preventDefault(); if (v.trim()) onSave(v.trim()); }}>
        <h3>{title}</h3>
        <input className="field" autoFocus value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} />
        <div className="row"><button type="button" className="btn" onClick={onClose}>Batal</button><button type="submit" className="btn primary">Simpan</button></div>
      </form>
    </Sheet>
  );
}

export function Liked() {
  const songs = useLibrary(db.likedSongs, null);
  return (
    <Collection
      title="Lagu yang Disukai" kind="Playlist" songs={songs ?? []} from="Lagu yang Disukai" loading={!songs}
      coverNode={<div style={{ ...grad('#4b2bd1', '#a78bfa'), width: '100%', height: '100%' }}><Heart size={72} fill="#fff" color="#fff" /></div>}
      actions={songs && songs.length > 0 && <DownloadAll songs={songs} />}
      empty={<Empty icon={<Heart size={40} />} title="Lagu yang kamu sukai ada di sini" sub="Ketuk ikon hati pada lagu untuk menyimpannya." />}
    />
  );
}

export function Downloads() {
  const dls = useLibrary(db.downloads, null);
  const size = (dls ?? []).reduce((a, d) => a + d.blob.size, 0);
  return (
    <Collection
      title="Unduhan" kind="Offline" songs={(dls ?? []).map((d) => d.song)} from="Unduhan" loading={!dls}
      subtitle={`${(size / 1048576).toFixed(0)} MB • bisa diputar tanpa internet`}
      coverNode={<div style={{ ...grad('#0fb57d', '#0d5e91'), width: '100%', height: '100%' }}><Download size={72} color="#fff" /></div>}
      rowExtra={(s) => <button className="icon-btn sm" aria-label="Hapus unduhan" onClick={(e) => { e.stopPropagation(); db.deleteDownload(s.id).then(() => toast('Unduhan dihapus')); }}><Trash2 size={16} /></button>}
      empty={<Empty icon={<Download size={40} />} title="Belum ada unduhan" sub="Pilih ⋮ → Unduh pada lagu supaya bisa didengar tanpa kuota. Unduhan tersimpan di browser ini." />}
    />
  );
}

export function LocalPlaylistPage() {
  const { id = '' } = useParams();
  const p = useLibrary(() => db.getPlaylist(id), undefined as LocalPlaylist | undefined, [id]);
  const all = useLibrary(db.playlists, []);
  const [dialog, setDialog] = useState<'rename' | 'folder' | 'newfolder' | 'delete' | null>(null);
  const nav = useNavigate();
  if (!p) return <div className="page"><Empty icon={null} title="Playlist tidak ditemukan" /></div>;
  const folders = [...new Set(all.map((x) => x.folder).filter(Boolean))];
  const save = (patch: Partial<LocalPlaylist>) => db.savePlaylist({ ...p, ...patch });
  return (
    <>
      <Collection
        title={p.name} kind="Playlist" subtitle={p.description || undefined} songs={p.songs} from={p.name}
        cover={p.songs[0] ? art(p.songs[0], true) : null}
        actions={
          <>
            <button className="btn outline sm" onClick={() => setDialog('rename')}><Pencil size={16} />Ubah</button>
            <button className="btn outline sm" onClick={() => save({ pinned: !p.pinned }).then(() => toast(p.pinned ? 'Sematan dilepas' : 'Disematkan di atas'))}><Pin size={16} />{p.pinned ? 'Lepas sematan' : 'Sematkan'}</button>
            <button className="btn outline sm" onClick={() => setDialog('folder')}><FolderInput size={16} />{p.folder ? `Folder: ${p.folder}` : 'Masukkan ke folder'}</button>
            {p.songs.length > 0 && <DownloadAll songs={p.songs} />}
            <button className="btn outline sm" onClick={() => setDialog('delete')}><Trash2 size={16} />Hapus</button>
          </>
        }
        rowExtra={(_, i) => <button className="icon-btn sm" aria-label="Hapus dari playlist" onClick={(e) => { e.stopPropagation(); save({ songs: p.songs.filter((__, k) => k !== i) }); }}><X size={16} /></button>}
        empty={<Empty icon={null} title="Playlist ini masih kosong" sub="Cari lagu lalu pilih ⋮ → Tambahkan ke playlist." action={<Link className="btn" to="/search">Cari lagu</Link>} />}
      />
      {dialog === 'rename' && <NameDialog title="Ubah nama playlist" initial={p.name} onClose={() => setDialog(null)} onSave={(n) => save({ name: n }).then(() => setDialog(null))} />}
      {dialog === 'newfolder' && <NameDialog title="Nama folder baru" initial="" onClose={() => setDialog(null)} onSave={(n) => save({ folder: n }).then(() => setDialog(null))} />}
      {dialog === 'folder' && (
        <Sheet onClose={() => setDialog(null)}>
          <div className="dialog"><h3>Folder untuk “{p.name}”</h3></div>
          {folders.map((f) => <button key={f} className="sheet-item" onClick={() => save({ folder: f }).then(() => setDialog(null))}><Folder size={20} color={f === p.folder ? 'var(--a)' : undefined} />{f}</button>)}
          <button className="sheet-item" onClick={() => setDialog('newfolder')}><Plus size={20} />Folder baru…</button>
          {p.folder && <button className="sheet-item" onClick={() => save({ folder: '' }).then(() => setDialog(null))}><X size={20} />Keluarkan dari folder</button>}
        </Sheet>
      )}
      {dialog === 'delete' && (
        <Sheet onClose={() => setDialog(null)}>
          <div className="dialog">
            <h3>Hapus playlist?</h3>
            <p className="sub">“{p.name}” akan dihapus permanen dari browser ini.</p>
            <div className="row"><button className="btn" onClick={() => setDialog(null)}>Batal</button><button className="btn primary" onClick={async () => { await db.deletePlaylist(p.id); nav('/library'); }}>Hapus</button></div>
          </div>
        </Sheet>
      )}
    </>
  );
}

export function SmartPage() {
  const { kind = 'top' } = useParams();
  const k = (kind in SMART ? kind : 'top') as SmartKind;
  const m = SMART[k];
  const songs = useLibrary(() => loadSmart(k), null, [k]);
  return (
    <Collection
      title={m.title} kind="Playlist pintar" subtitle={m.sub} songs={songs ?? []} from={m.title} loading={!songs}
      coverNode={<div style={{ ...grad(m.c[0], m.c[1]), width: '100%', height: '100%' }}><m.icon size={72} color="#fff" /></div>}
      empty={<Empty icon={<Sparkles size={40} />} title="Belum ada lagu di sini" sub="Playlist ini terisi sendiri seiring kamu mendengarkan musik." />}
    />
  );
}

export function HistoryPage() {
  const data = useLibrary(async () => {
    const ev = (await db.historySince(Date.now() - 90 * 86400_000)).sort((a, b) => b.timestamp - a.timestamp).slice(0, 300);
    const out: { song: Song; at: number }[] = [];
    for (const e of ev) { const s = await db.songMeta(e.songId); if (s) out.push({ song: s, at: e.timestamp }); }
    return out;
  }, null);
  const fmt = new Intl.DateTimeFormat('id', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const songs = (data ?? []).map((d) => d.song);
  return (
    <Collection
      title="Riwayat putar" songs={songs} from="Riwayat" loading={!data}
      coverNode={<div style={{ ...grad('#3A3A55', '#1E1E2C'), width: '100%', height: '100%' }}><HistoryIcon size={72} color="#fff" /></div>}
      rowExtra={(s, i) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="sub">{fmt.format(data![i].at)}</span>
          <button className="icon-btn sm" aria-label={`Hapus ${s.title} dari riwayat`} title="Hapus dari riwayat" onClick={(e) => { e.stopPropagation(); db.forgetSong(s.id).then(() => toast('Dihapus dari riwayat')); }}><X size={16} /></button>
        </span>
      )}
      actions={songs.length > 0 && <button className="btn outline sm" onClick={() => { if (confirm('Hapus semua riwayat putar?')) db.clearHistory().then(() => toast('Riwayat dihapus')); }}><Trash2 size={16} />Hapus riwayat</button>}
      empty={<Empty icon={<HistoryIcon size={40} />} title="Belum ada riwayat" sub="Lagu yang kamu dengar (≥ 15 detik) akan muncul di sini." />}
    />
  );
}

export function fmtMinutes(ms: number) {
  return Math.round(ms / 60000).toLocaleString('id');
}
export { fmtTime, play };
