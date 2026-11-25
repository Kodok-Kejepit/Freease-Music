// Pembaca komik: gulir vertikal (webtoon/manhwa) atau per halaman (manga), posisi tersimpan, bab berikut dimuat
// lebih dulu, dan terjemahan teks gambar ke bahasa Indonesia (OCR di perangkat). Ketuk tengah = kontrol.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Columns2, ImageOff, Languages, Rows3, RotateCw, ZoomIn, ZoomOut } from 'lucide-react';
import { toast } from '../../lib/toast';
import { OCR_LANGS, translatePage, type Bubble, type OcrLang } from '../mangaTranslate';
import { fs, routes } from '../api';
import { saveProgress, seenItem } from '../store';
import { Failed, useLoad, useTitle } from '../ui';

const pref = {
  get mode(): 'scroll' | 'paged' { try { return localStorage.getItem('fs-read-mode') === 'paged' ? 'paged' : 'scroll'; } catch { return 'scroll'; } },
  set mode(v) { try { localStorage.setItem('fs-read-mode', v); } catch { /* */ } },
  get width() { try { return Number(localStorage.getItem('fs-read-width')) || 760; } catch { return 760; } },
  set width(v: number) { try { localStorage.setItem('fs-read-width', String(v)); } catch { /* */ } },
  get ocr(): OcrLang | '' { try { return (localStorage.getItem('fs-read-ocr') as OcrLang) || ''; } catch { return ''; } },
  set ocr(v: OcrLang | '') { try { localStorage.setItem('fs-read-ocr', v); } catch { /* */ } },
};

/** Lapisan terjemahan di atas satu gambar halaman; ukurannya mengikuti gambar yang tampil. */
function Overlay({ img, src, lang }: { img: HTMLImageElement; src: string; lang: OcrLang }) {
  const [bubbles, setBubbles] = useState<Bubble[] | null>(null);
  const [state, setState] = useState<'wait' | 'busy' | 'fail'>('wait');
  const [box, setBox] = useState({ l: 0, t: 0, w: 0, h: 0 });
  const [hide, setHide] = useState(false);
  useEffect(() => {
    const upd = () => setBox({ l: img.offsetLeft, t: img.offsetTop, w: img.clientWidth, h: img.clientHeight });
    upd();
    const ro = new ResizeObserver(upd);
    ro.observe(img);
    return () => ro.disconnect();
  }, [img]);
  useEffect(() => {
    let alive = true;
    setBubbles(null); setState('wait');
    // Halaman diterjemahkan saat mendekati layar, supaya HP tidak memproses satu bab sekaligus.
    const io = new IntersectionObserver((es) => {
      if (!es.some((e) => e.isIntersecting)) return;
      io.disconnect();
      setState('busy');
      translatePage(src, lang).then((b) => { if (alive) { setBubbles(b); setState('wait'); } }).catch(() => alive && setState('fail'));
    }, { rootMargin: '150% 0px 150% 0px' });
    io.observe(img);
    return () => { alive = false; io.disconnect(); };
  }, [img, src, lang]);
  return (
    <div className="tr-layer" style={{ left: box.l, top: box.t, width: box.w, height: box.h }}>
      {!hide && bubbles?.map((b, i) => {
        const w = b.w * box.w, h = b.h * box.h;
        const fs = Math.max(9, Math.min(22, Math.sqrt((w * h) / Math.max(8, b.text.length)) * 0.95));
        return <div key={i} className="tr-bubble" style={{ left: b.x * box.w - 4, top: b.y * box.h - 4, width: w + 8, minHeight: h + 8, fontSize: fs }}>{b.text}</div>;
      })}
      {state === 'busy' && <span className="tr-state"><span className="spinner" style={{ width: 14, height: 14 }} />Menerjemahkan…</span>}
      {state === 'fail' && <span className="tr-state">Terjemahan gagal</span>}
      {bubbles && bubbles.length > 0 && <button className="tr-toggle" onClick={(e) => { e.stopPropagation(); setHide((x) => !x); }}>{hide ? 'Tampilkan terjemahan' : 'Lihat asli'}</button>}
    </div>
  );
}

function Page({ src, i, onSeen, tr }: { src: string; i: number; onSeen: (i: number) => void; tr?: OcrLang | '' }) {
  const ref = useRef<HTMLImageElement>(null);
  const [n, setN] = useState(0);
  const [bad, setBad] = useState(false);
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && onSeen(i)), { rootMargin: '-45% 0px -45% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [i, onSeen, bad]);
  if (bad) return <div className="pg-err" data-i={i}><ImageOff size={32} />Halaman {i + 1} gagal dimuat<button className="btn sm" onClick={() => { setBad(false); setN((x) => x + 1); }}><RotateCw size={14} />Muat ulang</button></div>;
  const url = n ? `${src}&retry=${n}` : src;
  const img = <img ref={ref} data-i={i} className={ok ? 'ok' : ''} src={url} alt={`Halaman ${i + 1}`} loading={i < 3 ? 'eager' : 'lazy'} decoding="async" onLoad={() => setOk(true)} onError={() => setBad(true)} />;
  if (!tr) return img;
  return <div className="pg">{img}{ok && ref.current && <Overlay img={ref.current} src={url} lang={tr} />}</div>;
}

export default function Reader() {
  const p = useParams();
  const mangaId = decodeURIComponent(p.mangaId ?? '');
  const chapterId = decodeURIComponent(p.chapterId ?? '');
  const nav = useNavigate();
  const manga = useLoad((s) => fs.manga(mangaId, s), [mangaId]);
  const pages = useLoad((s) => fs.pages(chapterId, s), [chapterId]);
  const [mode, setMode] = useState(pref.mode);
  const [width, setWidth] = useState(pref.width);
  const [ui, setUi] = useState(true);
  const [page, setPage] = useState(0);
  const [tr, setTr] = useState<OcrLang | ''>(pref.ocr);
  const [trMenu, setTrMenu] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const m = manga.data;
  const list = pages.data ?? [];
  const chIdx = m ? m.chapters.findIndex((c) => c.id === chapterId) : -1;
  const ch = chIdx >= 0 ? m!.chapters[chIdx] : null;
  const prev = chIdx > 0 ? m!.chapters[chIdx - 1] : null;
  const next = m && chIdx >= 0 && chIdx < m.chapters.length - 1 ? m.chapters[chIdx + 1] : null;
  const chLabel = ch ? (ch.number ? `Chapter ${ch.number}` : ch.title || 'Bab') : 'Bab';
  useTitle(m ? `${m.title} ${chLabel}` : null);

  // lanjut dari halaman terakhir bab ini
  const resumed = useRef<string | null>(null);
  useEffect(() => {
    if (!list.length || resumed.current === chapterId) return;
    resumed.current = chapterId;
    setPage(0);
    void seenItem('manga', chapterId).then((s) => {
      const at = s && s.dur > 1 && s.pos < s.dur - 1 ? Math.min(list.length - 1, Math.round(s.pos)) : 0;
      if (!at) { scroller.current?.scrollTo({ top: 0 }); return; }
      setPage(at);
      if (pref.mode === 'scroll') setTimeout(() => scroller.current?.querySelector(`[data-i="${at}"]`)?.scrollIntoView(), 120);
    });
  }, [list, chapterId]);

  // simpan posisi (halaman ke-n dari total)
  useEffect(() => {
    if (!m || !ch || !list.length) return;
    const t = setTimeout(() => void saveProgress({ kind: 'manga', id: m.id, title: m.title, cover: m.cover, itemId: ch.id, itemLabel: chLabel, pos: page, dur: list.length, page, pages: list.length }), 600);
    return () => clearTimeout(t);
  }, [m, ch, page, list.length, chLabel]);

  // bab berikutnya dimuat lebih dulu (server menyimpannya di cache)
  useEffect(() => { if (next && list.length && page > list.length * 0.6) void fs.pages(next.id).catch(() => {}); }, [next, page, list.length]);

  const go = useCallback((c: { id: string } | null) => { if (c && m) nav(routes.read(m.id, c.id), { replace: true }); }, [m, nav]);
  const turn = useCallback((d: number) => {
    if (mode === 'paged') {
      const n = page + d;
      if (n < 0) go(prev); else if (n >= list.length) go(next); else setPage(n);
    } else scroller.current?.scrollBy({ top: d * scroller.current.clientHeight * 0.85, behavior: 'smooth' });
  }, [mode, page, list.length, go, prev, next]);
  const onSeen = useCallback((i: number) => setPage(i), []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, select, textarea')) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' && mode === 'paged' || e.key === ' ' && mode === 'paged') { e.preventDefault(); turn(1); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' && mode === 'paged') { e.preventDefault(); turn(-1); }
      else if (e.key === 'n') go(next);
      else if (e.key === 'p') go(prev);
      else if (e.key === 'Escape') nav(routes.manga(mangaId));
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [turn, go, next, prev, mode, nav, mangaId]);

  const chapters = useMemo(() => [...(m?.chapters ?? [])].reverse(), [m]);
  const setM = (x: 'scroll' | 'paged') => { setMode(x); pref.mode = x; };
  const pickTr = (v: OcrLang | '') => {
    setTr(v); pref.ocr = v; setTrMenu(false);
    if (v) toast('Terjemahan nyala. Halaman pertama butuh beberapa detik (data bahasa diunduh sekali).');
  };
  const zoom = (d: number) => { const w = Math.max(360, Math.min(1400, width + d)); setWidth(w); pref.width = w; };

  return (
    <div className={`reader ${ui ? '' : 'hide-ui'} ${mode === 'paged' ? 'paged' : ''}`}>
      <div className="rtop">
        <button className="icon-btn" aria-label="Kembali ke detail" onClick={() => nav(routes.manga(mangaId))}><ChevronLeft size={24} /></button>
        <div className="t">
          <b className="ellipsis">{m?.title ?? 'Memuat…'}</b>
          {m && (
            <select className="field" style={{ height: 30, padding: '0 8px', width: 'auto', maxWidth: '100%', fontSize: 13, background: 'transparent' }} value={chapterId} onChange={(e) => go({ id: e.target.value })} aria-label="Pilih bab">
              {chapters.map((c) => <option key={c.id} value={c.id}>{c.number ? `Chapter ${c.number}` : c.title || 'Bab'}</option>)}
            </select>
          )}
        </div>
        <button className={`icon-btn ${mode === 'scroll' ? 'on' : ''}`} aria-label="Mode gulir" title="Gulir vertikal (webtoon)" onClick={() => setM('scroll')}><Rows3 size={20} /></button>
        <button className={`icon-btn ${mode === 'paged' ? 'on' : ''}`} aria-label="Mode per halaman" title="Per halaman (manga)" onClick={() => setM('paged')}><Columns2 size={20} /></button>
        <div style={{ position: 'relative' }}>
          <button className={`icon-btn ${tr ? 'on' : ''}`} aria-label="Terjemahkan ke bahasa Indonesia" title="Terjemahkan ke bahasa Indonesia" onClick={() => setTrMenu((x) => !x)}><Languages size={20} /></button>
          {trMenu && (
            <div className="vmenu tr-menu" onClick={(e) => e.stopPropagation()}>
              <h4>Terjemahkan dari</h4>
              <button className={!tr ? 'on' : ''} onClick={() => pickTr('')}>Mati</button>
              {OCR_LANGS.map((l) => <button key={l.key} className={tr === l.key ? 'on' : ''} onClick={() => pickTr(l.key)}>{l.label}</button>)}
              <div className="sub" style={{ padding: '6px 10px', fontSize: 12 }}>Teks dibaca di perangkatmu, lalu diterjemahkan ke bahasa Indonesia.</div>
            </div>
          )}
        </div>
        {mode === 'scroll' && <><button className="icon-btn hide-mobile" aria-label="Perkecil" onClick={() => zoom(-80)}><ZoomOut size={20} /></button><button className="icon-btn hide-mobile" aria-label="Perbesar" onClick={() => zoom(80)}><ZoomIn size={20} /></button></>}
      </div>

      <div className="scroll" ref={scroller} onClick={(e) => { if (mode === 'scroll' && !(e.target as HTMLElement).closest('button, a, select')) setUi((x) => !x); }}>
        {pages.loading ? <div className="empty" style={{ height: '100%', justifyContent: 'center' }}><div className="spinner" />Memuat halaman…</div>
          : pages.error ? <div style={{ paddingTop: 80 }}><Failed error={pages.error} retry={pages.retry} /></div>
            : mode === 'paged' ? (
              <div className="pages" style={{ width: '100%' }}>
                {list[page] && <Page key={list[page]} src={list[page]} i={page} onSeen={() => {}} tr={tr} />}
                {list[page + 1] && <link rel="prefetch" href={list[page + 1]} />}
                <button className="tapzone l" aria-label="Halaman sebelumnya" onClick={() => turn(-1)} />
                <button className="tapzone r" aria-label="Halaman berikutnya" onClick={() => turn(1)} />
                <button aria-label="Tampilkan kontrol" style={{ position: 'absolute', left: '30%', right: '30%', top: 0, bottom: 0, zIndex: 1 }} onClick={() => setUi((x) => !x)} />
              </div>
            ) : (
              <>
                <div className="pages" style={{ maxWidth: width, paddingTop: ui ? 64 : 0 }}>
                  {list.map((src, i) => <Page key={src} src={src} i={i} onSeen={onSeen} tr={tr} />)}
                </div>
                <div className="rend">
                  <b style={{ fontSize: 18 }}>Selesai: {chLabel}</b>
                  {next ? <button className="btn primary" onClick={() => go(next)}>Lanjut {next.number ? `Chapter ${next.number}` : 'bab berikutnya'}<ChevronRight size={18} /></button>
                    : <span className="sub">Ini bab terakhir yang tersedia.</span>}
                  <button className="btn" onClick={() => nav(routes.manga(mangaId))}>Kembali ke daftar bab</button>
                </div>
              </>
            )}
      </div>

      <div className="rbot">
        <button className="icon-btn" aria-label="Bab sebelumnya" title="Bab sebelumnya (P)" disabled={!prev} onClick={() => go(prev)}><ChevronLeft size={22} /></button>
        <div className="prog">
          <input type="range" min={0} max={Math.max(0, list.length - 1)} value={page} aria-label="Halaman" onChange={(e) => {
            const i = Number(e.target.value); setPage(i);
            if (mode === 'scroll') scroller.current?.querySelector(`[data-i="${i}"]`)?.scrollIntoView();
          }} />
          <div className="sub" style={{ textAlign: 'center' }}>{list.length ? `Halaman ${page + 1} / ${list.length}` : ''}</div>
        </div>
        <button className="icon-btn" aria-label="Bab berikutnya" title="Bab berikutnya (N)" disabled={!next} onClick={() => go(next)}><ChevronRight size={22} /></button>
      </div>
    </div>
  );
}
