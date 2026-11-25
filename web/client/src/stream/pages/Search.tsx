// Cari anime & komik sekaligus (semua sumber), hasil dikelompokkan per jenis.
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search as SearchIcon, X } from 'lucide-react';
import { fs, routes } from '../api';
import { Failed, GridSkeleton, PosterCard, useLoad, useTitle } from '../ui';

const IDEAS = ['One Piece', 'Solo Leveling', 'Jujutsu Kaisen', 'Naruto', 'Frieren', 'Kimetsu no Yaiba', 'Spy x Family', 'Omniscient Reader', 'Blue Lock', 'Chainsaw Man'];

export default function StreamSearch() {
  const [sp, setSp] = useSearchParams();
  const q = sp.get('q') ?? '';
  const tab = (sp.get('tab') as 'all' | 'anime' | 'manga') || 'all';
  const [text, setText] = useState(q);
  const input = useRef<HTMLInputElement>(null);
  useTitle(q ? `Cari “${q}”` : 'Cari');
  useEffect(() => setText(q), [q]);
  useEffect(() => { if (!q) input.current?.focus(); }, [q]);
  // ketik → cari setelah jeda singkat
  useEffect(() => {
    const t = setTimeout(() => { if (text.trim() !== q && text.trim().length >= 2) { const n = new URLSearchParams(sp); n.set('q', text.trim()); setSp(n, { replace: true }); } }, 600);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  const res = useLoad(q ? (s) => fs.search(q, s) : null, [q]);
  const setTab = (t: string) => { const n = new URLSearchParams(sp); n.set('tab', t); setSp(n, { replace: true }); };
  const anime = res.data?.anime ?? [];
  const manga = res.data?.manga ?? [];

  return (
    <div className="page">
      <div className="h1">Cari</div>
      <form style={{ position: 'relative' }} onSubmit={(e) => { e.preventDefault(); const n = new URLSearchParams(sp); if (text.trim()) n.set('q', text.trim()); setSp(n, { replace: true }); input.current?.blur(); }}>
        <SearchIcon size={20} style={{ position: 'absolute', left: 14, top: 12, color: 'var(--muted)' }} />
        <input ref={input} className="field" style={{ paddingLeft: 44, paddingRight: 44, height: 46 }} placeholder="Judul anime, manga, manhwa, manhua…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Cari anime dan komik" enterKeyHint="search" />
        {text && <button type="button" className="icon-btn sm" style={{ position: 'absolute', right: 6, top: 7 }} aria-label="Hapus" onClick={() => { setText(''); setSp(new URLSearchParams(), { replace: true }); input.current?.focus(); }}><X size={18} /></button>}
      </form>

      {!q ? (
        <>
          <div className="h2">Coba cari</div>
          <div className="chips" style={{ flexWrap: 'wrap' }}>{IDEAS.map((i) => <button key={i} className="chip" onClick={() => setSp(new URLSearchParams({ q: i }), { replace: true })}>{i}</button>)}</div>
        </>
      ) : (
        <>
          <div className="chips" style={{ marginTop: 12 }}>
            {(['all', 'anime', 'manga'] as const).map((t) => <button key={t} className={`chip ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>{t === 'all' ? 'Semua' : t === 'anime' ? `Anime${res.data ? ` · ${anime.length}` : ''}` : `Komik${res.data ? ` · ${manga.length}` : ''}`}</button>)}
          </div>
          {res.loading ? <GridSkeleton /> : res.error ? <Failed error={res.error} retry={res.retry} /> : !anime.length && !manga.length ? (
            <div className="empty"><SearchIcon size={40} /><div className="title">Tidak ketemu “{q}”</div>Coba ejaan lain atau judul bahasa Inggris/Jepang.</div>
          ) : (
            <>
              {tab !== 'manga' && anime.length > 0 && (
                <>
                  {tab === 'all' && <div className="h2">Anime</div>}
                  <div className="grid-posters">{(tab === 'all' ? anime.slice(0, 12) : anime).map((a) => <PosterCard key={a.id} to={routes.anime(a.id)} image={a.cover} title={a.title} sub={[a.source, a.type, a.year, a.status].filter(Boolean).join(' • ')} badge={a.type} />)}</div>
                  {tab === 'all' && anime.length > 12 && <div className="load-more"><button className="btn" onClick={() => setTab('anime')}>Semua anime ({anime.length})</button></div>}
                </>
              )}
              {tab !== 'anime' && manga.length > 0 && (
                <>
                  {tab === 'all' && <div className="h2">Komik</div>}
                  <div className="grid-posters">{(tab === 'all' ? manga.slice(0, 18) : manga).map((m) => <PosterCard key={m.id} kind="manga" to={routes.manga(m.id)} image={m.cover} title={m.title} sub={`${m.source} · ${m.lang.toUpperCase()}`} badge={m.type ?? null} />)}</div>
                  {tab === 'all' && manga.length > 18 && <div className="load-more"><button className="btn" onClick={() => setTab('manga')}>Semua komik ({manga.length})</button></div>}
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
