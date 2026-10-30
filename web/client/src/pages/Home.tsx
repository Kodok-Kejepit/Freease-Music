import { Link, useNavigate } from 'react-router-dom';
import { Download, Heart, Mic, Settings as Gear, X } from 'lucide-react';
import { api, art, fmtTime } from '../lib/api';
import * as db from '../lib/db';
import { useFetch, useLibrary } from '../lib/hooks';
import { greeting, MOODS } from '../lib/moods';
import { play } from '../player/player';
import { forgetResume, resumeList, useResume } from '../player/resume';
import { setVideoMode } from '../player/video';
import { Artwork, Card } from '../components/ui';
import { useUi } from '../components/uiState';
import { toast } from '../lib/toast';

export default function Home() {
  const recent = useLibrary(() => db.recentSongs(20), []);
  const lists = useLibrary(db.playlists, []);
  const top = useLibrary(() => db.topStats(Date.now() - 30 * 86400_000), null);
  const trending = useFetch((s) => api.searchSongs('lagu indonesia terpopuler minggu ini', false, s), []);
  const topArtists = (top?.artists ?? []).slice(0, 3);
  const nav = useNavigate();
  const set = useUi((s) => s.set);

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="h1">{greeting()}</div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button className="icon-btn" aria-label="Freease Smart" onClick={() => set({ assistant: true, assistantWake: false })}><Mic size={22} /></button>
          <button className="icon-btn" aria-label="Pengaturan" onClick={() => nav('/settings')}><Gear size={22} /></button>
          <button className="home-avatar" aria-label="Profil pembuat Freease" title="Kodok-Kejepit" onClick={() => nav('/profile')}><img src="/kodok-kejepit-96.webp" alt="" /></button>
        </div>
      </div>

      <div className="quick-grid">
        <Link to="/liked" className="quick">
          <div className="thumb" style={{ background: 'linear-gradient(135deg,#4b2bd1,#a78bfa)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Heart size={22} fill="#fff" color="#fff" /></div>
          Lagu yang Disukai
        </Link>
        <Link to="/downloads" className="quick">
          <div className="thumb" style={{ background: 'linear-gradient(135deg,#0fb57d,#0d5e91)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Download size={22} color="#fff" /></div>
          Unduhan
        </Link>
        {lists.slice(0, 4).map((p) => (
          <Link key={p.id} to={`/playlist/${p.id}`} className="quick">
            <Artwork src={p.songs[0] ? art(p.songs[0]) : null} />
            <span className="ellipsis">{p.name}</span>
          </Link>
        ))}
      </div>

      <ContinueWatching />

      {recent.length > 0 && (
        <>
          <div className="h2">
            Baru diputar
            <span style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <button className="more" onClick={async () => { if (confirm('Hapus semua riwayat putar?')) { await db.clearHistory(); toast('Riwayat putar dihapus'); } }}>Hapus semua</button>
              <Link className="more" to="/history">Riwayat</Link>
            </span>
          </div>
          <div className="shelf">
            {recent.map((s, i) => (
              <Card
                key={s.id} image={art(s, true)} title={s.title} sub={s.artist}
                onClick={() => play(recent, i, 'Baru diputar')} onPlay={() => play(recent, i, 'Baru diputar')}
                onRemove={() => db.forgetSong(s.id).then(() => toast('Dihapus dari riwayat'))}
              />
            ))}
          </div>
        </>
      )}

      {topArtists.map((a) => <ArtistMix key={a.artist} artist={a.artist} />)}

      <div className="h2">Lagi populer</div>
      <div className="shelf">
        {trending.loading && !trending.data && Array.from({ length: 6 }, (_, i) => <div key={i}><div className="skeleton" style={{ aspectRatio: '1', marginBottom: 10 }} /><div className="skeleton" style={{ height: 12 }} /></div>)}
        {(trending.data ?? []).slice(0, 20).map((s, i, all) => <Card key={s.id} image={art(s, true)} title={s.title} sub={s.artist} onClick={() => play(all, i, 'Lagi populer')} onPlay={() => play(all, i, 'Lagi populer')} />)}
      </div>

      <div className="h2">Jelajahi</div>
      <div className="mood-grid">
        {MOODS.map((m) => (
          <button key={m.title} className="mood" style={{ background: m.color }} onClick={() => nav(`/category?title=${encodeURIComponent(m.title)}&q=${encodeURIComponent(m.query)}`)}>{m.title}</button>
        ))}
      </div>
    </div>
  );
}

/** "Mix <artis>": lagu-lagu mirip artis yang sering kamu dengar. */
function ArtistMix({ artist }: { artist: string }) {
  const r = useFetch((s) => api.searchSongs(`${artist} lagu terbaik`, false, s), [artist]);
  const songs = r.data ?? [];
  if (!songs.length) return null;
  return (
    <>
      <div className="h2">Karena kamu suka {artist}</div>
      <div className="shelf">
        {songs.slice(0, 15).map((s, i) => <Card key={s.id} image={art(s, true)} title={s.title} sub={s.artist} onClick={() => play(songs, i, `Mix ${artist}`)} onPlay={() => play(songs, i, `Mix ${artist}`)} />)}
      </div>
    </>
  );
}

/** "Lanjutkan menonton": video/lagu panjang yang belum selesai, dengan bilah progres. */
function ContinueWatching() {
  const map = useResume((r) => r.map);
  const list = resumeList(map).slice(0, 15);
  if (!list.length) return null;
  const start = (i: number) => {
    const items = list.map((x) => x.song);
    if (items[i].yt) setVideoMode(true);
    play(items, i, 'Lanjutkan menonton');
    if (items[i].yt) useUi.getState().set({ nowPlaying: true });
  };
  return (
    <>
      <div className="h2">Lanjutkan menonton</div>
      <div className="shelf wide">
        {list.map((x, i) => (
          <div key={x.song.id} className="resume-card" role="button" tabIndex={0} onClick={() => start(i)} onKeyDown={(e) => e.key === 'Enter' && start(i)}>
            <div className="vthumb">
              <img src={`https://i.ytimg.com/vi/${x.song.id}/mqdefault.jpg`} alt="" loading="lazy" />
              <span className="vbadge">{fmtTime(x.d - x.t)} lagi</span>
              <div className="resume-bar"><div style={{ width: `${Math.min(100, (x.t / x.d) * 100)}%` }} /></div>
              <button className="card-remove" aria-label={`Hapus ${x.song.title} dari lanjutkan menonton`} onClick={(e) => { e.stopPropagation(); forgetResume(x.song.id); }}><X size={14} /></button>
            </div>
            <div className="vtitle">{x.song.title}</div>
            <div className="sub ellipsis">{x.song.artist}</div>
          </div>
        ))}
      </div>
    </>
  );
}
