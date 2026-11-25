// Jelajah anime: urutan, jenis, status, genre — tersimpan di URL supaya bisa dibagikan & kembali ke posisi sama.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SlidersHorizontal } from 'lucide-react';
import { fs, routes, type Anime, type ReleaseItem } from '../api';
import { Failed, GridSkeleton, PosterCard, useLoad, useTitle } from '../ui';

const ORDERS = [['popular', 'Populer'], ['latest', 'Terbaru'], ['rating', 'Rating'], ['title', 'A–Z']] as const;
const TYPES = [['', 'Semua'], ['tv', 'TV'], ['movie', 'Movie'], ['ona', 'ONA'], ['ova', 'OVA'], ['special', 'Special']] as const;
const STATUS = [['', 'Semua'], ['ongoing', 'Sedang tayang'], ['completed', 'Tamat']] as const;
const SOURCES = [['', 'Animekompi'], ['od', 'Otakudesu'], ['ac', 'Anichin · Donghua']] as const;
const OD_STATUS = [['', 'Sedang tayang'], ['completed', 'Tamat']] as const;

export default function AnimeBrowse() {
  const [sp, setSp] = useSearchParams();
  const order = sp.get('order') || 'popular';
  const type = sp.get('type') || '';
  const status = sp.get('status') || '';
  const genre = sp.get('genre') || '';
  const source = sp.get('src') === 'od' ? 'od' : sp.get('src') === 'ac' ? 'ac' : '';
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Anime[]>([]);
  const [showGenres, setShowGenres] = useState(!!genre);
  const genres = useLoad((s) => fs.genres(source || undefined, s), [source]);
  const key = `${source}|${order}|${type}|${status}|${genre}`;
  useEffect(() => { setPage(1); setItems([]); }, [key]);
  const res = useLoad((s) => fs.browse(source === 'od' ? { source, status, genre, page } : source === 'ac' ? { source, order, status, genre, page } : { order, type, status, genre, page }, s), [key, page]);
  useEffect(() => { if (res.data) setItems((old) => (page === 1 ? res.data!.items : [...old, ...res.data!.items.filter((x) => !old.some((o) => o.id === x.id))])); }, [res.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  // Ganti sumber: filter milik sumber lama tidak berlaku lagi.
  const setSource = (v: string) => { const n = new URLSearchParams(); if (v) n.set('src', v); setSp(n, { replace: true }); };
  const gName = genres.data?.find((g) => g.id === genre)?.name;
  useTitle(gName ? `Anime ${gName}` : 'Jelajah anime');

  return (
    <div className="page">
      <div className="h1" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span>{source === 'ac' ? 'Donghua' : 'Anime'}{gName ? ` · ${gName}` : ''}</span>
        <button className={`btn sm ${showGenres ? 'primary' : ''}`} onClick={() => setShowGenres((x) => !x)}><SlidersHorizontal size={15} />Genre</button>
      </div>
      <div className="chips"><span className="sub" style={{ alignSelf: 'center', fontWeight: 700, flex: 'none' }}>Sumber</span>{SOURCES.map(([v, l]) => <button key={'src' + v} className={`chip ${source === v ? 'on' : ''}`} onClick={() => setSource(v)}>{l}</button>)}</div>
      {source === 'ac' ? (
        <>
          <div className="chips">{ORDERS.map(([v, l]) => <button key={v} className={`chip ${order === v ? 'on' : ''}`} onClick={() => set('order', v === 'popular' ? '' : v)}>{l}</button>)}</div>
          <div className="chips">{STATUS.map(([v, l]) => <button key={'s' + v} className={`chip ${status === v ? 'on' : ''}`} onClick={() => set('status', v)}>{l}</button>)}</div>
        </>
      ) : source ? (
        <div className="chips">{OD_STATUS.map(([v, l]) => <button key={'s' + v} className={`chip ${status === v && !genre ? 'on' : ''}`} onClick={() => { const n = new URLSearchParams(sp); n.delete('genre'); if (v) n.set('status', v); else n.delete('status'); setSp(n, { replace: true }); }}>{l}</button>)}</div>
      ) : (
        <>
          <div className="chips">{ORDERS.map(([v, l]) => <button key={v} className={`chip ${order === v ? 'on' : ''}`} onClick={() => set('order', v === 'popular' ? '' : v)}>{l}</button>)}</div>
          <div className="chips">{TYPES.map(([v, l]) => <button key={v} className={`chip ${type === v ? 'on' : ''}`} onClick={() => set('type', v)}>{l}</button>)}
            <span style={{ width: 1, background: 'var(--line)', flex: 'none' }} />
            {STATUS.map(([v, l]) => <button key={'s' + v} className={`chip ${status === v ? 'on' : ''}`} onClick={() => set('status', v)}>{l}</button>)}</div>
        </>
      )}
      {showGenres && (
        <div className="genres" style={{ marginBottom: 14 }}>
          <a href="#" onClick={(e) => { e.preventDefault(); set('genre', ''); }} style={!genre ? { background: 'var(--text)', color: '#000' } : undefined}>Semua genre</a>
          {(genres.data ?? []).filter((g) => g.count == null || g.count >= 5).map((g) => (
            <a key={g.id} href="#" onClick={(e) => { e.preventDefault(); set('genre', g.id); }} style={genre === g.id ? { background: 'var(--text)', color: '#000' } : undefined}>{g.name}</a>
          ))}
        </div>
      )}
      {res.data?.total != null && page === 1 && <div className="sub" style={{ margin: '2px 0 14px' }}>{res.data.total.toLocaleString('id-ID')} judul</div>}
      {res.error && !items.length ? <Failed error={res.error} retry={res.retry} /> : (
        <>
          <div className="grid-posters">
            {items.map((a) => {
              const r = a as Partial<ReleaseItem>;
              return <PosterCard key={a.id} to={routes.anime(a.id)} image={a.cover} title={a.title} sub={[a.type, a.year, r.day ?? r.date].filter(Boolean).join(' • ') || a.source} badge={r.episode ? `Ep ${r.episode}` : a.status === 'Ongoing' ? 'Ongoing' : null} badgeR={a.rating ? `Skor ${a.rating}` : null} />;
            })}
          </div>
          {res.loading && <div style={{ marginTop: items.length ? 16 : 0 }}><GridSkeleton n={items.length ? 6 : 18} /></div>}
          {!res.loading && res.data && page < res.data.totalPages && <div className="load-more"><button className="btn" onClick={() => setPage((p) => p + 1)}>Muat lebih banyak</button></div>}
          {!res.loading && !items.length && !res.error && <div className="empty"><div className="title">Tidak ada judul</div>Coba ubah filter.</div>}
        </>
      )}
    </div>
  );
}
