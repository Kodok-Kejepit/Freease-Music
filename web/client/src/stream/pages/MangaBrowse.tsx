// Jelajah komik per sumber: Komiku, Shinigami, WEBTOON (Indonesia), MangaPark & MangaGoku (Inggris).
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { fs, routes, type Manga } from '../api';
import { Failed, GridSkeleton, PosterCard, useLoad, useTitle } from '../ui';

const SOURCES = [
  { key: 'km', name: 'Komiku', lang: 'ID', order: true, type: true },
  { key: 'sh', name: 'Shinigami', lang: 'ID', order: true, type: true },
  { key: 'ki', name: 'Komikindo', lang: 'ID', order: true, type: true },
  { key: 'bk', name: 'Bacakomik', lang: 'ID', order: true, type: true },
  { key: 'wt', name: 'WEBTOON', lang: 'ID', order: false, type: false, onePage: true },
  { key: 'mp', name: 'MangaPark', lang: 'EN', order: false, type: false },
  { key: 'kk', name: 'MangaGoku', lang: 'EN', order: true, type: false },
];
const TYPES = [['', 'Semua'], ['manga', 'Manga'], ['manhwa', 'Manhwa'], ['manhua', 'Manhua']] as const;

export default function MangaBrowse() {
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const src = SOURCES.find((s) => s.key === sp.get('src')) ?? SOURCES[0];
  const order = sp.get('order') === 'latest' ? 'latest' : 'popular';
  const type = src.type ? sp.get('type') || '' : '';
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Manga[]>([]);
  const [term, setTerm] = useState('');
  const key = `${src.key}|${order}|${type}`;
  useEffect(() => { setPage(1); setItems([]); }, [key]);
  const res = useLoad((s) => fs.mangaBrowse(src.key, { order, type, page }, s), [key, page]);
  useEffect(() => { if (res.data) setItems((old) => (page === 1 ? res.data! : [...old, ...res.data!.filter((x) => !old.some((o) => o.id === x.id))])); }, [res.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  useTitle('Komik');

  return (
    <div className="page">
      <div className="h1">Komik</div>
      <form style={{ position: 'relative', marginBottom: 12 }} onSubmit={(e) => { e.preventDefault(); if (term.trim()) nav(`/stream/cari?q=${encodeURIComponent(term.trim())}&tab=manga`); }}>
        <input className="field" placeholder="Cari manga, manhwa, manhua…" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Cari komik" style={{ paddingRight: 48 }} />
        <button className="search-go" aria-label="Cari"><Search size={18} /></button>
      </form>
      <div className="chips">{SOURCES.map((s) => <button key={s.key} className={`chip ${s.key === src.key ? 'on' : ''}`} onClick={() => { const n = new URLSearchParams(); n.set('src', s.key); setSp(n, { replace: true }); }}>{s.name} <span style={{ opacity: .55, fontSize: 11, marginLeft: 4 }}>{s.lang}</span></button>)}</div>
      {(src.order || src.type) && (
        <div className="chips">
          {src.order && (['popular', 'latest'] as const).map((o) => <button key={o} className={`chip ${order === o ? 'on' : ''}`} onClick={() => set('order', o === 'popular' ? '' : o)}>{o === 'popular' ? 'Populer' : 'Baru update'}</button>)}
          {src.order && src.type && <span style={{ width: 1, background: 'var(--line)', flex: 'none' }} />}
          {src.type && TYPES.map(([v, l]) => <button key={v} className={`chip ${type === v ? 'on' : ''}`} onClick={() => set('type', v)}>{l}</button>)}
        </div>
      )}
      {res.error && !items.length ? <Failed error={res.error} retry={res.retry} /> : (
        <>
          <div className="grid-posters">
            {items.map((m) => <PosterCard key={m.id} kind="manga" to={routes.manga(m.id)} image={m.cover} title={m.title} sub={m.author || m.source} badge={m.type ?? null} badgeR={m.latest ? `Ch ${m.latest}` : null} />)}
          </div>
          {res.loading && <div style={{ marginTop: items.length ? 16 : 0 }}><GridSkeleton n={items.length ? 6 : 18} /></div>}
          {!res.loading && !src.onePage && (res.data?.length ?? 0) > 0 && <div className="load-more"><button className="btn" onClick={() => setPage((p) => p + 1)}>Muat lebih banyak</button></div>}
          {!res.loading && !items.length && !res.error && <div className="empty"><div className="title">Kosong</div>Sumber ini belum mengirim daftar. Coba sumber lain.</div>}
        </>
      )}
    </div>
  );
}
