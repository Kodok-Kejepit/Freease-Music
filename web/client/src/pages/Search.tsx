import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowUpLeft, Search as SearchIcon, X, Clock, Mic, MonitorPlay, Music2, Play } from 'lucide-react';
import { api } from '../lib/api';
import { useDebounced, useFetch, useInfinite } from '../lib/hooks';
import type { Song } from '../lib/types';
import { MOODS } from '../lib/moods';
import { useSettings } from '../lib/settings';
import { play } from '../player/player';
import { setVideoMode } from '../player/video';
import { Card, ErrorBox, SongListSkeleton, SongRow, VideoCard } from '../components/ui';
import { useUi } from '../components/uiState';

// Dua sumber pencarian: YouTube Music (musik) dan YouTube biasa (semua video: film, kartun, vlog, …).
const TABS = {
  music: [
    { k: 'songs', label: 'Lagu' },
    { k: 'artists', label: 'Artis' },
    { k: 'albums', label: 'Album' },
    { k: 'playlists', label: 'Playlist' },
  ],
  youtube: [
    { k: 'videos', label: 'Video' },
    { k: 'channels', label: 'Kanal' },
    { k: 'ytplaylists', label: 'Playlist' },
  ],
} as const;
type Src = keyof typeof TABS;
const YT_TOPICS = ['Film', 'Kartun', 'Musik', 'Gaming', 'Berita', 'Olahraga', 'Podcast', 'Kuliner', 'Edukasi', 'Komedi', 'Otomotif', 'Teknologi'];

function recentSearches(): string[] {
  try { return JSON.parse(localStorage.getItem('freease-searches') || '[]'); } catch { return []; }
}
function removeSearch(q: string) {
  localStorage.setItem('freease-searches', JSON.stringify(recentSearches().filter((x) => x !== q)));
}
function saveSearch(q: string) {
  const list = [q, ...recentSearches().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 12);
  localStorage.setItem('freease-searches', JSON.stringify(list));
}

export default function Search() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const src: Src = useSettings((x) => x.searchSource);
  const setSettings = useSettings((x) => x.set);
  const tabs = TABS[src];
  const tab = (tabs.find((t) => t.k === params.get('t'))?.k ?? tabs[0].k) as string;
  const switchSource = (next: Src) => {
    setSettings({ searchSource: next });
    setParams(q ? { q, t: TABS[next][0].k } : {});
  };
  const [input, setInput] = useState(q);
  const box = useRef<HTMLInputElement>(null);
  const [focus, setFocus] = useState(false);
  const [pick, setPick] = useState(-1);
  const [, refresh] = useState(0); // gambar ulang setelah riwayat pencarian dihapus
  const debounced = useDebounced(input, 250);
  const nav = useNavigate();
  const set = useUi((s) => s.set);
  useEffect(() => setInput(q), [q]);
  useEffect(() => setPick(-1), [input]);

  const suggestions = useFetch((s) => (debounced.trim().length > 1 && debounced !== q ? api.suggest(debounced, s, src) : Promise.resolve([])), [debounced, q, src]);
  const submit = (v: string) => {
    const t = v.trim();
    if (!t) { box.current?.focus(); return; }
    saveSearch(t);
    setFocus(false);
    setPick(-1);
    (document.activeElement as HTMLElement)?.blur();
    setParams({ q: t, t: tab });
  };

  const shown = focus ? (input ? suggestions.data ?? [] : recentSearches()) : [];
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!shown.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setPick((p) => (p + 1) % shown.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setPick((p) => (p <= 0 ? shown.length - 1 : p - 1)); }
    else if (e.key === 'Escape') { setFocus(false); setPick(-1); }
  };

  return (
    <div className="page">
      <div className="search-head">
        <div className="h1">Cari</div>
        <div className="seg src-switch" role="group" aria-label="Sumber pencarian">
          <button className={src === 'music' ? 'on' : ''} onClick={() => switchSource('music')}><Music2 size={15} />YouTube Music</button>
          <button className={src === 'youtube' ? 'on' : ''} onClick={() => switchSource('youtube')}><MonitorPlay size={15} />YouTube</button>
        </div>
      </div>
      {/* Enter & tombol kaca pembesar mencari teks yang diketik; saran dipakai bila diketuk (atau dipilih dengan
          panah lalu Enter). Panah serong di tiap saran menyalin saran ke kotak tanpa langsung mencari. */}
      <form onSubmit={(e) => {
        e.preventDefault();
        const byButton = (e.nativeEvent as SubmitEvent).submitter?.classList.contains('search-go');
        submit(!byButton && pick >= 0 && shown[pick] ? shown[pick] : input);
      }} style={{ position: 'relative', marginBottom: 12 }}>
        <SearchIcon size={20} style={{ position: 'absolute', left: 14, top: 12, color: 'var(--muted)' }} />
        <input
          className="field"
          ref={box}
          style={{ paddingLeft: 44, paddingRight: 124, height: 46, background: '#fff', color: '#111', fontWeight: 600 }}
          placeholder={src === 'youtube' ? 'Cari video, film, kartun, kanal di YouTube' : 'Lagu, artis, album, atau tempel link YouTube'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setFocus(true)}
          onBlur={() => setTimeout(() => setFocus(false), 150)}
          onKeyDown={onKey}
          enterKeyHint="search"
          aria-label="Cari"
        />
        {input && <button type="button" className="icon-btn sm" style={{ position: 'absolute', right: 84, top: 7, color: '#555' }} aria-label="Hapus" onClick={() => { setInput(''); box.current?.focus(); }}><X size={18} /></button>}
        <button type="button" className="icon-btn sm" style={{ position: 'absolute', right: 48, top: 7, color: '#555' }} aria-label="Cari dengan suara" onClick={() => set({ assistant: true, assistantWake: false })}><Mic size={18} /></button>
        <button type="submit" className="search-go" aria-label="Cari" title="Cari teks yang diketik" onMouseDown={(e) => e.preventDefault()}><SearchIcon size={18} /></button>
        {shown.length ? (
          <div className="card-box" style={{ position: 'absolute', left: 0, right: 0, top: 52, zIndex: 20, padding: 6, boxShadow: '0 12px 40px rgba(0,0,0,.5)' }}>
            {shown.map((s, i) => (
              <div key={s} className={`sugg ${i === pick ? 'picked' : ''}`}>
                <button type="button" className="sheet-item" style={{ padding: '10px 12px', flex: 1, minWidth: 0 }} onMouseDown={(e) => e.preventDefault()} onClick={() => { setInput(s); submit(s); }}>
                  {input ? <SearchIcon size={16} /> : <Clock size={16} />}<span className="ellipsis">{s}</span>
                </button>
                {input ? (
                  <button type="button" className="icon-btn sm" aria-label={`Salin “${s}” ke kotak cari`} title="Salin ke kotak cari" onMouseDown={(e) => e.preventDefault()} onClick={() => { setInput(`${s} `); box.current?.focus(); }}>
                    <ArrowUpLeft size={16} />
                  </button>
                ) : (
                  <button type="button" className="icon-btn sm" aria-label={`Hapus “${s}” dari riwayat`} title="Hapus dari riwayat" onMouseDown={(e) => e.preventDefault()} onClick={() => { removeSearch(s); refresh((n) => n + 1); }}>
                    <X size={16} />
                  </button>
                )}
              </div>
            ))}
            {!input && (
              <button type="button" className="sugg-clear" onMouseDown={(e) => e.preventDefault()} onClick={() => { localStorage.removeItem('freease-searches'); refresh((n) => n + 1); }}>
                Hapus semua riwayat pencarian
              </button>
            )}
          </div>
        ) : null}
      </form>

      {!q && src === 'youtube' ? (
        <>
          <div className="h2">Jelajahi YouTube</div>
          <div className="chips" style={{ flexWrap: 'wrap' }}>
            {YT_TOPICS.map((t) => <button key={t} className="chip" onClick={() => { setInput(t); submit(`${t} terbaru`); }}>{t}</button>)}
          </div>
          <div className="sub" style={{ marginTop: 14 }}>Semua video YouTube bisa ditonton di sini tanpa iklan — film, kartun, vlog, siaran ulang, dan lainnya.</div>
        </>
      ) : !q ? (
        <>
          <div className="h2">Jelajahi semua</div>
          <div className="mood-grid">
            {MOODS.map((m) => (
              <button key={m.title} className="mood" style={{ background: m.color }} onClick={() => nav(`/category?title=${encodeURIComponent(m.title)}&q=${encodeURIComponent(m.query)}`)}>{m.title}</button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="chips">
            {tabs.map((t) => <button key={t.k} className={`chip ${tab === t.k ? 'on' : ''}`} onClick={() => setParams({ q, t: t.k })}>{t.label}</button>)}
          </div>
          <Results q={q} tab={tab} />
        </>
      )}
    </div>
  );
}

function linkId(q: string): { song?: string; list?: string } | null {
  const m = q.match(/(?:v=|youtu\.be\/|shorts\/)([A-Za-z0-9_-]{11})/);
  const l = q.match(/list=([A-Za-z0-9_-]+)/);
  if (l) return { list: l[1] };
  if (m) return { song: m[1] };
  return null;
}

function Results({ q, tab }: { q: string; tab: string }) {
  const nav = useNavigate();
  const openPlayer = () => useUi.getState().set({ nowPlaying: true });
  const link = linkId(q);
  useEffect(() => {
    if (link?.list) nav(`/remote/${link.list}`, { replace: true });
    else if (link?.song) nav(`/song/${link.song}`, { replace: true });
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const r = useInfinite<any>((s) => api.searchPage(q, tab, s), [q, tab]);
  if (r.loading) return <SongListSkeleton n={8} />;
  if (r.error) return <ErrorBox error={r.error} retry={r.retry} />;
  const data = r.items;
  if (!data.length) return <div className="empty">Tidak ada hasil untuk “{q}”.</div>;
  let list;
  if (tab === 'channels') list = <div className="grid-cards">{data.map((a) => <Card key={a.id} to={`/artist/${a.id}`} image={a.thumbnail} title={a.name} sub={a.subscribers || 'Kanal'} round />)}</div>;
  else if (tab === 'ytplaylists') list = <div className="grid-cards">{data.map((p) => <Card key={p.id} to={`/remote/${p.id}`} image={p.thumbnail} title={p.title} sub={p.subtitle} />)}</div>;
  else if (tab === 'artists') list = <div className="grid-cards">{data.map((a) => <Card key={a.id} to={`/artist/${a.id}`} image={a.thumbnail} title={a.name} sub="Artis" round />)}</div>;
  else if (tab === 'playlists' || tab === 'albums') list = <div className="grid-cards">{data.map((p) => <Card key={p.id} to={`/remote/${p.id}`} image={p.thumbnail} title={p.title} sub={p.subtitle} />)}</div>;
  // Dari tab Video → kartu ala YouTube dan langsung tampil videonya.
  // YouTube: tandai sebagai video YouTube → layar tonton ala YouTube langsung terbuka.
  else if (tab === 'videos') list = <div className="video-grid">{data.map((s, i) => <VideoCard key={s.id} song={s} onPlay={() => { setVideoMode(true); play(data.map((x) => ({ ...x, yt: true })), i, `YouTube: “${q}”`); openPlayer(); }} />)}</div>;
  else list = <div>{data.map((s, i) => <SongRow key={s.id} song={s} onPlay={() => play(data, i, `Pencarian “${q}”`)} wide />)}</div>;
  return (
    <>
      {list}
      <MoreFooter inf={r} />
    </>
  );
}

/** Ujung daftar: memuat halaman berikut otomatis saat di-scroll; "coba lagi" bila gagal. */
function MoreFooter({ inf }: { inf: { next: string | null; more: boolean; moreError: boolean; expired?: boolean; loadMore: () => void; retry: () => void; sentinel: (el: HTMLElement | null) => void; items: unknown[] } }) {
  if (inf.expired) return <div className="more-foot"><button className="btn" onClick={inf.retry}>Muat ulang hasil pencarian</button></div>;
  if (inf.moreError) return <div className="more-foot"><button className="btn" onClick={inf.loadMore}>Gagal memuat — coba lagi</button></div>;
  if (!inf.next) return <div className="more-foot sub">{inf.items.length} hasil · sudah semua</div>;
  return <div className="more-foot" ref={inf.sentinel}>{inf.more ? <div className="spinner" /> : <button className="btn" onClick={inf.loadMore}>Muat lagi</button>}</div>;
}

export function Category() {
  const [params] = useSearchParams();
  const title = params.get('title') || 'Kategori';
  const q = params.get('q') || title;
  const songs = useInfinite<Song>((s) => api.searchPage<Song>(q, 'songs', s), [q]);
  const lists = useFetch((s) => api.searchPlaylists(q, false, s), [q]);
  return (
    <div className="page">
      <div className="h1">{title}</div>
      {songs.items.length > 0 && (
        <div className="actions">
          <button className="play-btn big grad" aria-label="Putar" onClick={() => play(songs.items, 0, title)}><Play size={28} fill="currentColor" style={{ marginLeft: 3 }} /></button>
          <button className="btn" onClick={() => play(songs.items, 0, title, true)}>Acak</button>
        </div>
      )}
      {lists.data && lists.data.length > 0 && (
        <>
          <div className="h2">Playlist</div>
          <div className="shelf">{lists.data.map((p) => <Card key={p.id} to={`/remote/${p.id}`} image={p.thumbnail} title={p.title} sub={p.subtitle} />)}</div>
        </>
      )}
      <div className="h2">Lagu</div>
      {songs.loading ? <SongListSkeleton /> : songs.error ? <ErrorBox error={songs.error} retry={songs.retry} /> : (
        <>
          {songs.items.map((s, i) => <SongRow key={s.id} song={s} onPlay={() => play(songs.items, i, title)} wide />)}
          <MoreFooter inf={songs} />
        </>
      )}
    </div>
  );
}

