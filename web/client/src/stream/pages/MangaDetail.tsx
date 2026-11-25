// Detail komik: info, sinopsis, daftar bab (tanda sudah dibaca), lanjut membaca, dan judul yang sama di sumber lain.
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowDownUp, BookOpen, Info, Layers, Share2 } from 'lucide-react';
import { ago, fs, routes, type Manga } from '../api';
import { progressOf, seenOf, useStore } from '../store';
import { FavButton, Failed, Img, PosterCard, Spinner, useLoad, useTitle } from '../ui';
import { share } from './AnimeDetail';

const label = (n: string | null, t: string | null) => (n ? `Chapter ${n}` : t || 'Bab tanpa nomor');

export default function MangaDetail() {
  const id = decodeURIComponent(useParams().id ?? '');
  const nav = useNavigate();
  const { data: m, error, loading, retry } = useLoad((s) => fs.manga(id, s), [id]);
  const prog = useStore(() => progressOf('manga', id), undefined, [id]);
  const seen = useStore(() => seenOf('manga', id), new Map(), [id]);
  const [newest, setNewest] = useState(true);
  const [filter, setFilter] = useState('');
  const [more, setMore] = useState(false);
  const [showAlt, setShowAlt] = useState(false);
  const alts = useLoad(showAlt && m ? (s) => fs.alternatives(m, s) : null, [showAlt, m?.id]);
  useTitle(m?.title);

  const chapters = useMemo(() => {
    const list = (m?.chapters ?? []).filter((c) => !filter || (c.number ?? '').includes(filter.trim()) || (c.title ?? '').toLowerCase().includes(filter.trim().toLowerCase()));
    return newest ? [...list].reverse() : list;
  }, [m, filter, newest]);

  if (loading && !m) return <div className="page"><Spinner label="Memuat komik…" /></div>;
  if (error || !m) return <div className="page"><Failed error={error ?? 'Tidak ditemukan'} retry={retry} /></div>;
  const first = m.chapters[0];
  const latest = m.chapters[m.chapters.length - 1];
  const target = prog && m.chapters.some((c) => c.id === prog.itemId) ? { id: prog.itemId, text: `Lanjutkan ${prog.itemLabel}` } : first ? { id: first.id, text: `Mulai baca ${label(first.number, first.title)}` } : null;

  return (
    <div className="page" style={{ position: 'relative', isolation: 'isolate' }}>
      <div className="hero-bg" style={{ backgroundImage: m.cover ? `url("${m.cover}")` : undefined }} />
      <div className="dhead">
        <div className="poster"><Img src={m.cover} kind="manga" /></div>
        <div className="info">
          <div className="sub" style={{ fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', fontSize: 12 }}>{m.type || 'Komik'} · {m.source} · {m.lang === 'id' ? 'Bahasa Indonesia' : 'English'}</div>
          <h1>{m.title}</h1>
          {(m.altTitles ?? []).length > 0 && <div className="alt ellipsis">{m.altTitles!.slice(0, 3).join(' · ')}</div>}
          <div className="meta-row">
            {m.status && <span className={`pill ${m.status === 'Ongoing' ? 'grad' : ''}`}>{m.status}</span>}
            {m.author && <span>{m.author}</span>}
            <span className="dot">{m.chapters.length} bab</span>
            {latest?.at && <span className="dot">update {ago(latest.at)}</span>}
          </div>
          <div className="actions">
            {target && <button className="btn primary" onClick={() => nav(routes.read(m.id, target.id))}><BookOpen size={18} />{target.text}</button>}
            {latest && latest !== first && <button className="btn" onClick={() => nav(routes.read(m.id, latest.id))}>Bab terbaru</button>}
            <FavButton kind="manga" id={m.id} title={m.title} cover={m.cover} sub={`${m.type || 'Komik'} · ${m.source}`} big />
            <button className="icon-btn" aria-label="Bagikan" title="Bagikan" onClick={() => void share(m.title)}><Share2 size={20} /></button>
          </div>
        </div>
      </div>

      {m.genres.length > 0 && <div className="genres">{m.genres.map((g) => <span key={g}>{g}</span>)}</div>}
      {m.description && (
        <div style={{ marginTop: 12 }}>
          <p className={`synopsis ${more ? '' : 'clamp'}`} onClick={() => setMore(true)}>{m.description}</p>
          {!more && m.description.length > 280 && <button className="more sub" style={{ fontWeight: 700 }} onClick={() => setMore(true)}>Selengkapnya</button>}
        </div>
      )}
      {m.partial && <div className="note"><Info size={18} />Sumber ini hanya memberi sebagian daftar bab (awal & terbaru). Bab tengah bisa dibaca dari sumber lain di bawah.</div>}

      <div className="h2">
        <span>Bab</span>
        <button className="more" style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => setShowAlt((x) => !x)}><Layers size={15} />Sumber lain</button>
      </div>
      {showAlt && (
        <div style={{ marginBottom: 16 }}>
          {alts.loading ? <div className="sub" style={{ display: 'flex', alignItems: 'center', gap: 10 }}><div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />Mencari judul yang sama di sumber lain…</div>
            : (alts.data ?? []).length === 0 ? <div className="sub">Tidak ketemu di sumber lain.</div>
              : <div className="shelf posters">{(alts.data as Manga[]).map((x) => <PosterCard key={x.id} kind="manga" to={routes.manga(x.id)} image={x.cover} title={x.title} sub={`${x.source} · ${x.lang.toUpperCase()}`} />)}</div>}
        </div>
      )}
      {m.chapters.length === 0 ? <div className="empty"><div className="title">Belum ada bab</div>Coba buka “Sumber lain”.</div> : (
        <>
          <div className="ep-tools">
            {m.chapters.length > 15 && <input className="field" placeholder="Cari nomor bab…" value={filter} onChange={(e) => setFilter(e.target.value)} inputMode="decimal" aria-label="Cari bab" />}
            <button className="btn sm" onClick={() => setNewest((x) => !x)}><ArrowDownUp size={15} />{newest ? 'Terbaru dulu' : 'Terlama dulu'}</button>
            {seen.size > 0 && <span className="sub">{seen.size} sudah dibaca</span>}
          </div>
          <div className="ch-list">
            {chapters.slice(0, 400).map((c) => (
              <div key={c.id} className={`ch-row ${seen.has(c.id) ? 'seen' : ''}`} role="link" tabIndex={0} onClick={() => nav(routes.read(m.id, c.id))} onKeyDown={(e) => e.key === 'Enter' && nav(routes.read(m.id, c.id))}>
                <div className="n">{label(c.number, c.title)}{c.number && c.title && <small className="ellipsis">{c.title}</small>}</div>
                {prog?.itemId === c.id && <span className="pill grad">Terakhir</span>}
                {c.at ? <span className="when">{ago(c.at)}</span> : null}
              </div>
            ))}
          </div>
          {chapters.length > 400 && <div className="sub" style={{ padding: 12 }}>Menampilkan 400 dari {chapters.length} bab — pakai kotak cari untuk bab lain.</div>}
        </>
      )}
    </div>
  );
}
