// Pemutar anime Freease Stream: <video> dengan kontrol sendiri untuk berkas langsung; server gagal → pindah otomatis.
// Server yang cuma ada sebagai pemutar situs lain diputar di iframe ber-sandbox (tanpa pop-up, pengalihan, unduhan).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle, ChevronLeft, Download, FastForward, Maximize, Minimize, Pause, PictureInPicture2, Play, RotateCcw, RotateCw,
  Settings2, SkipBack, SkipForward, Volume1, Volume2, VolumeX,
} from 'lucide-react';
import { toast } from '../../lib/toast';
import { toggle as toggleMusic, usePlayer } from '../../player/player';
import { fs, fmtClock, routes, type EpisodeData, type VideoSource } from '../api';
import { saveProgress, seenItem, seenOf, useStore } from '../store';
import { AltSources, FavButton, Failed, Img, Spinner, useLoad, useTitle } from '../ui';

const pref = {
  get quality() { try { return localStorage.getItem('fs-quality') || ''; } catch { return ''; } },
  set quality(v: string) { try { localStorage.setItem('fs-quality', v); } catch { /* */ } },
  get autoNext() { try { return localStorage.getItem('fs-autonext') !== '0'; } catch { return true; } },
  set autoNext(v: boolean) { try { localStorage.setItem('fs-autonext', v ? '1' : '0'); } catch { /* */ } },
  get volume() { try { return Number(localStorage.getItem('fs-volume') ?? 1); } catch { return 1; } },
  set volume(v: number) { try { localStorage.setItem('fs-volume', String(v)); } catch { /* */ } },
};
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/** Urutan coba: kualitas pilihan dulu, lalu yang tertinggi. */
function ordered(sources: VideoSource[]) {
  const want = pref.quality;
  return [...sources].sort((a, b) => Number(a.type === 'embed') - Number(b.type === 'embed') || Number(b.quality === want) - Number(a.quality === want));
}

/** Sandbox tanpa allow-popups/top-navigation/downloads/forms/modals: iklan pop-up, pengalihan & unduhan diblokir. */
const SANDBOX = 'allow-scripts allow-same-origin allow-presentation';

function EmbedFrame({ src }: { src: VideoSource }) {
  return <iframe key={src.url} src={src.url} sandbox={SANDBOX} allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="origin" title={`Server ${src.label}`} className="vembed" />;
}

function SeekBar({ v, onSeek }: { v: HTMLVideoElement | null; onSeek: (t: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [, force] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => { const t = setInterval(() => force((x) => x + 1), 250); return () => clearInterval(t); }, []);
  const dur = v?.duration && isFinite(v.duration) ? v.duration : 0;
  const cur = drag ?? v?.currentTime ?? 0;
  let buf = 0;
  if (v && dur) for (let i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= v.currentTime + 1) buf = Math.max(buf, v.buffered.end(i));
  const at = (x: number) => { const r = ref.current!.getBoundingClientRect(); return Math.max(0, Math.min(1, (x - r.left) / r.width)) * dur; };
  const pct = (t: number) => `${dur ? (t / dur) * 100 : 0}%`;
  return (
    <div
      ref={ref} className={`vseek ${drag != null ? 'drag' : ''}`} role="slider" aria-label="Posisi video" aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(cur)}
      onPointerDown={(e) => { if (!dur) return; (e.target as HTMLElement).setPointerCapture(e.pointerId); setDrag(at(e.clientX)); }}
      onPointerMove={(e) => { if (!dur) return; const t = at(e.clientX); setHover(t); if (drag != null) setDrag(t); }}
      onPointerLeave={() => setHover(null)}
      onPointerUp={(e) => { if (drag == null) return; onSeek(at(e.clientX)); setDrag(null); }}
      onPointerCancel={() => setDrag(null)}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="track"><div className="buf" style={{ width: pct(buf) }} /><div className="fill" style={{ width: pct(cur) }} /></div>
      <div className="knob" style={{ left: pct(cur) }} />
      {(drag ?? hover) != null && <div className="tip" style={{ left: pct(drag ?? hover!) }}>{fmtClock(drag ?? hover!)}</div>}
    </div>
  );
}

function Player({ ep, onEnded }: { ep: EpisodeData; onEnded: () => void }) {
  const nav = useNavigate();
  const box = useRef<HTMLDivElement>(null);
  const vid = useRef<HTMLVideoElement>(null);
  const list = useMemo(() => ordered(ep.sources), [ep]);
  const [idx, setIdx] = useState(0);
  const [useFallback, setUseFallback] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [idle, setIdle] = useState(false);
  const [menu, setMenu] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ t: string; side: 'l' | 'r' | 'c'; k: number } | null>(null);
  const [full, setFull] = useState(false);
  const [vol, setVol] = useState(pref.volume);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [, tick] = useState(0);
  const resumeAt = useRef<number | null>(null);
  const src = list[idx];
  const embed = src?.type === 'embed';
  const url = src && !embed ? (useFallback && src.fallback ? src.fallback : src.url) : '';
  const anime = ep.anime;

  // posisi terakhir episode ini
  useEffect(() => {
    let alive = true;
    resumeAt.current = null;
    void seenItem('anime', ep.id).then((s) => { if (alive && s && s.pos > 15 && (!s.dur || s.pos < s.dur - 30)) resumeAt.current = s.pos; });
    return () => { alive = false; };
  }, [ep.id]);
  useEffect(() => { setIdx(0); setUseFallback(false); setFail(null); setCountdown(null); }, [ep.id]);
  // Pemutar embed tidak memberi tahu posisinya: cukup catat bahwa episode ini sedang ditonton.
  useEffect(() => {
    if (embed && anime) void saveProgress({ kind: 'anime', id: anime.id, title: anime.title, cover: anime.cover, itemId: ep.id, itemLabel: `Episode ${ep.number}`, pos: 0, dur: 0 });
  }, [embed, anime, ep]);

  const save = useCallback(() => {
    const v = vid.current;
    if (!v || !anime || !v.duration || !isFinite(v.duration) || v.currentTime < 3) return;
    void saveProgress({ kind: 'anime', id: anime.id, title: anime.title, cover: anime.cover, itemId: ep.id, itemLabel: `Episode ${ep.number}`, pos: v.currentTime, dur: v.duration });
  }, [anime, ep]);
  useEffect(() => {
    const t = setInterval(() => { if (vid.current && !vid.current.paused) save(); }, 5000);
    const h = () => save();
    window.addEventListener('pagehide', h);
    return () => { clearInterval(t); window.removeEventListener('pagehide', h); save(); };
  }, [save]);

  const show = useCallback(() => {
    setIdle(false);
    clearTimeout((show as any).t);
    (show as any).t = setTimeout(() => { if (vid.current && !vid.current.paused) { setIdle(true); setMenu(false); } }, 3000);
  }, []);
  useEffect(() => { show(); }, [show]);
  const say = (t: string, side: 'l' | 'r' | 'c' = 'c') => setFlash({ t, side, k: Date.now() });
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(null), 700); return () => clearTimeout(t); }, [flash]);

  const v = vid.current;
  const toggle = () => { const x = vid.current; if (!x) return; if (x.paused) void x.play().catch(() => {}); else x.pause(); };
  const seekBy = (d: number) => { const x = vid.current; if (!x) return; x.currentTime = Math.max(0, Math.min((x.duration || 0) - 0.5, x.currentTime + d)); say(`${d > 0 ? '+' : ''}${d} dtk`, d > 0 ? 'r' : 'l'); show(); };
  const setVolume = (n: number) => { const x = vid.current; n = Math.max(0, Math.min(1, n)); setVol(n); pref.volume = n; if (x) { x.volume = n; x.muted = n === 0; } setMuted(n === 0); };
  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else { await box.current?.requestFullscreen(); try { await (screen.orientation as any)?.lock?.('landscape'); } catch { /* HP tertentu */ } }
    } catch { /* */ }
  };
  useEffect(() => { const h = () => setFull(!!document.fullscreenElement); document.addEventListener('fullscreenchange', h); return () => document.removeEventListener('fullscreenchange', h); }, []);
  const pip = async () => {
    try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); else await vid.current?.requestPictureInPicture(); } catch { toast('Gambar-dalam-gambar tidak didukung browser ini'); }
  };

  const nextServer = useCallback((why: string) => {
    if (src?.fallback && !useFallback) { setUseFallback(true); return; }
    if (idx + 1 < list.length) {
      const resume = vid.current?.currentTime ?? 0;
      if (resume > 5) resumeAt.current = resume;
      toast(`${src?.label ?? 'Server'} ${src?.quality ?? ''} gagal, pindah ke ${list[idx + 1].label} ${list[idx + 1].quality}`);
      setIdx(idx + 1); setUseFallback(false);
    } else setFail(why);
  }, [idx, list, src, useFallback]);

  // pintasan keyboard
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return;
      const x = vid.current;
      if (!x) return;
      const k = e.key.toLowerCase();
      if (k === ' ' || k === 'k') { e.preventDefault(); toggle(); }
      else if (k === 'arrowright' || k === 'l') { e.preventDefault(); seekBy(k === 'l' ? 10 : 5); }
      else if (k === 'arrowleft' || k === 'j') { e.preventDefault(); seekBy(k === 'j' ? -10 : -5); }
      else if (k === 'arrowup') { e.preventDefault(); setVolume(x.volume + 0.1); say(`Volume ${Math.round(Math.min(1, x.volume + 0.1) * 100)}%`); }
      else if (k === 'arrowdown') { e.preventDefault(); setVolume(x.volume - 0.1); say(`Volume ${Math.round(Math.max(0, x.volume - 0.1) * 100)}%`); }
      else if (k === 'f') void fullscreen();
      else if (k === 'm') { setVolume(x.muted || x.volume === 0 ? (pref.volume || 1) : 0); }
      else if (k === 'n' && e.shiftKey && ep.next) nav(routes.watch(ep.next.id));
      else if (k === 'p' && e.shiftKey && ep.prev) nav(routes.watch(ep.prev.id));
      else if (k === 'i') void pip();
      else if (/^[0-9]$/.test(k) && x.duration) x.currentTime = (Number(k) / 10) * x.duration;
      else return;
      show();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // hitung mundur episode berikutnya
  useEffect(() => {
    if (countdown == null) return;
    if (countdown <= 0) { setCountdown(null); if (ep.next) nav(routes.watch(ep.next.id)); return; }
    const t = setTimeout(() => setCountdown((c) => (c == null ? null : c - 1)), 1000);
    return () => clearTimeout(t);
  }, [countdown, ep.next, nav]);

  // Media Session (kontrol di layar kunci / notifikasi)
  useEffect(() => {
    if (!('mediaSession' in navigator) || !anime) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: `${anime.title} — Episode ${ep.number}`, artist: 'Freease Stream', artwork: anime.cover ? [{ src: anime.cover, sizes: '512x512' }] : [] });
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => void vid.current?.play());
    ms.setActionHandler('pause', () => vid.current?.pause());
    ms.setActionHandler('seekbackward', () => seekBy(-10));
    ms.setActionHandler('seekforward', () => seekBy(10));
    ms.setActionHandler('nexttrack', ep.next ? () => nav(routes.watch(ep.next!.id)) : null);
    ms.setActionHandler('previoustrack', ep.prev ? () => nav(routes.watch(ep.prev!.id)) : null);
  }, [anime, ep]); // eslint-disable-line react-hooks/exhaustive-deps

  // ketuk dua kali di sisi kiri/kanan = mundur/maju 10 dtk (HP)
  const lastTap = useRef(0);
  const onTap = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, .vseek, .vmenu, .vnext')) return;
    const r = box.current!.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const now = Date.now();
    if (now - lastTap.current < 300 && (x < 0.35 || x > 0.65)) { seekBy(x < 0.5 ? -10 : 10); lastTap.current = 0; return; }
    lastTap.current = now;
    if (matchMedia('(hover: hover)').matches) { toggle(); show(); }
    else if (idle) show(); else setIdle(true);
  };

  const dur = v?.duration && isFinite(v.duration) ? v.duration : 0;
  const VolIcon = muted || vol === 0 ? VolumeX : vol < 0.5 ? Volume1 : Volume2;
  const qualities = [...new Set(ep.sources.filter((s) => s.type !== 'embed').map((s) => s.quality))];
  const showSkip = playing && v && v.currentTime > 5 && v.currentTime < 240 && dur > 600;

  return (
    <div ref={box} className={`vplayer ${idle && playing ? 'idle' : ''}`} onMouseMove={show} onClick={onTap} onDoubleClick={(e) => { if (matchMedia('(hover: hover)').matches && !(e.target as HTMLElement).closest('button, .vseek, .vmenu')) void fullscreen(); }} tabIndex={-1}>
      {url && (
        <video
          ref={vid} key={url} src={url} autoPlay playsInline preload="auto"
          onLoadedMetadata={(e) => {
            const x = e.currentTarget; x.volume = vol; x.playbackRate = speed;
            if (resumeAt.current) { x.currentTime = resumeAt.current; say(`Melanjutkan dari ${fmtClock(resumeAt.current)}`); resumeAt.current = null; }
            tick((n) => n + 1);
          }}
          onPlay={() => { setPlaying(true); setFail(null); if (usePlayer.getState().playing) toggleMusic(); show(); }}
          onPause={() => { setPlaying(false); setIdle(false); save(); }}
          onWaiting={() => setWaiting(true)} onPlaying={() => setWaiting(false)} onCanPlay={() => setWaiting(false)}
          onError={() => nextServer('Semua server gagal memutar episode ini. Coba lagi nanti atau pilih episode lain.')}
          onEnded={() => { save(); onEnded(); if (ep.next && pref.autoNext) setCountdown(8); }}
          onRateChange={(e) => setSpeed(e.currentTarget.playbackRate)}
        />
      )}
      {embed && src && (
        <>
          <EmbedFrame src={src} />
          <div className="vembed-bar" onClick={(e) => e.stopPropagation()}>
            <span className="pill" title="Pemutar dari situs lain, dikunci sandbox: pop-up, pengalihan & unduhan diblokir">{src.label} · sandbox</span>
            <button className={`icon-btn sm ${menu ? 'on' : ''}`} aria-label="Ganti server" onClick={() => setMenu((m) => !m)}><Settings2 size={18} /></button>
          </div>
        </>
      )}
      {!src && <div className="verr"><AlertTriangle size={40} /><b>Belum ada server yang bisa diputar langsung</b><span className="sub">Episode ini hanya tersedia di server yang memakai pemutar berisi iklan, jadi tidak ditampilkan di Freease.{ep.downloads.length ? ' Coba unduh di bawah.' : ''}</span></div>}
      {waiting && src && !embed && !fail && <div className="vspinner"><div className="spinner" style={{ width: 44, height: 44 }} /></div>}
      {flash && <div key={flash.k} className={`vflash ${flash.side}`}>{flash.side === 'l' ? <RotateCcw size={18} /> : flash.side === 'r' ? <RotateCw size={18} /> : null}{flash.t}</div>}

      {!embed && <div className="vctl">
        <div className="vtop">
          <button className="icon-btn" style={{ color: '#fff' }} aria-label="Kembali" onClick={(e) => { e.stopPropagation(); if (document.fullscreenElement) void document.exitFullscreen(); else nav(anime ? routes.anime(anime.id) : '/stream'); }}><ChevronLeft size={24} /></button>
          <div className="t ellipsis">{anime?.title} · Episode {ep.number}</div>
          {src && <span className="pill" style={{ background: 'rgba(0,0,0,.45)' }}>{src.quality}</span>}
        </div>
        <div className="vmid">
          <button className="icon-btn" aria-label="Mundur 10 detik" onClick={(e) => { e.stopPropagation(); seekBy(-10); }}><RotateCcw size={24} /></button>
          <button className="play-btn grad" aria-label={playing ? 'Jeda' : 'Putar'} onClick={(e) => { e.stopPropagation(); toggle(); }}>{playing ? <Pause size={30} fill="currentColor" /> : <Play size={30} fill="currentColor" style={{ marginLeft: 3 }} />}</button>
          <button className="icon-btn" aria-label="Maju 10 detik" onClick={(e) => { e.stopPropagation(); seekBy(10); }}><RotateCw size={24} /></button>
        </div>
        <div className="vbottom">
          {showSkip && <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}><button className="btn sm" style={{ background: 'rgba(0,0,0,.6)' }} onClick={(e) => { e.stopPropagation(); seekBy(85); }}><FastForward size={15} />Lewati intro</button></div>}
          <SeekBar v={v} onSeek={(t) => { if (vid.current) vid.current.currentTime = t; }} />
          <div className="row">
            <button className="icon-btn sm" aria-label={playing ? 'Jeda' : 'Putar'} onClick={(e) => { e.stopPropagation(); toggle(); }}>{playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}</button>
            {ep.prev && <button className="icon-btn sm" aria-label="Episode sebelumnya" title="Episode sebelumnya (Shift+P)" onClick={(e) => { e.stopPropagation(); nav(routes.watch(ep.prev!.id)); }}><SkipBack size={19} fill="currentColor" /></button>}
            {ep.next && <button className="icon-btn sm" aria-label="Episode berikutnya" title="Episode berikutnya (Shift+N)" onClick={(e) => { e.stopPropagation(); nav(routes.watch(ep.next!.id)); }}><SkipForward size={19} fill="currentColor" /></button>}
            <button className="icon-btn sm" aria-label="Bisukan" onClick={(e) => { e.stopPropagation(); setVolume(muted || vol === 0 ? (pref.volume || 1) : 0); }}><VolIcon size={19} /></button>
            <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : vol} onChange={(e) => setVolume(Number(e.target.value))} onClick={(e) => e.stopPropagation()} aria-label="Volume" style={{ width: 80 }} className="hide-mobile" />
            <span className="time">{fmtClock(v?.currentTime ?? 0)} / {fmtClock(dur)}</span>
            <span className="sp" />
            {speed !== 1 && <span className="pill" style={{ background: 'rgba(0,0,0,.45)' }}>{speed}×</span>}
            <button className={`icon-btn sm ${menu ? 'on' : ''}`} aria-label="Server, kualitas & kecepatan" onClick={(e) => { e.stopPropagation(); setMenu((m) => !m); }}><Settings2 size={19} /></button>
            {'pictureInPictureEnabled' in document && <button className="icon-btn sm" aria-label="Gambar dalam gambar" onClick={(e) => { e.stopPropagation(); void pip(); }}><PictureInPicture2 size={19} /></button>}
            <button className="icon-btn sm" aria-label="Layar penuh" onClick={(e) => { e.stopPropagation(); void fullscreen(); }}>{full ? <Minimize size={19} /> : <Maximize size={19} />}</button>
          </div>
        </div>
      </div>}

      {menu && (
        <div className="vmenu" onClick={(e) => e.stopPropagation()}>
          {qualities.length > 1 && <><h4>Kualitas</h4>{qualities.map((q) => (
            <button key={q} className={src?.quality === q ? 'on' : ''} onClick={() => { const i = list.findIndex((s) => s.quality === q); if (i >= 0) { resumeAt.current = vid.current?.currentTime ?? null; pref.quality = q; setIdx(i); setUseFallback(false); setMenu(false); } }}>{q}</button>
          ))}</>}
          <h4>Server</h4>
          {list.map((s, i) => <button key={s.url} className={i === idx ? 'on' : ''} onClick={() => { resumeAt.current = vid.current?.currentTime ?? null; setIdx(i); setUseFallback(false); setFail(null); setMenu(false); }}><span>{s.label}{s.type === 'embed' ? ' (sandbox)' : ''}</span><span className="sub">{s.quality}</span></button>)}
          {!embed && <><h4>Kecepatan</h4>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '0 6px 6px' }}>{SPEEDS.map((r) => <button key={r} className={`chip ${speed === r ? 'on' : ''}`} style={{ width: 'auto', height: 30, padding: '0 10px', fontSize: 13 }} onClick={() => { if (vid.current) vid.current.playbackRate = r; setSpeed(r); }}>{r}×</button>)}</div>
          </>}<h4>Putar otomatis</h4>
          <button onClick={() => { pref.autoNext = !pref.autoNext; tick((n) => n + 1); }}>Episode berikutnya otomatis<span className="sub">{pref.autoNext ? 'Nyala' : 'Mati'}</span></button>
        </div>
      )}

      {countdown != null && ep.next && (
        <div className="vnext" onClick={(e) => e.stopPropagation()}>
          <div><div className="sub">Episode berikutnya dalam {countdown}</div><b>Episode {ep.next.number}</b></div>
          <button className="btn sm primary" onClick={() => nav(routes.watch(ep.next!.id))}><Play size={14} fill="currentColor" />Putar</button>
          <button className="btn sm" onClick={() => setCountdown(null)}>Batal</button>
        </div>
      )}

      {fail && (
        <div className="verr" onClick={(e) => e.stopPropagation()}>
          <AlertTriangle size={40} />
          <b>{fail}</b>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn primary" onClick={() => { setFail(null); setIdx(0); setUseFallback(false); }}><RotateCw size={16} />Coba lagi</button>
            {ep.next && <button className="btn" onClick={() => nav(routes.watch(ep.next!.id))}>Episode berikutnya</button>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Watch() {
  const id = decodeURIComponent(useParams().id ?? '');
  const nav = useNavigate();
  const { data: ep, error, loading, retry } = useLoad((s) => fs.episode(id, s), [id]);
  const animeId = ep?.anime?.id ?? '';
  const seen = useStore(() => (animeId ? seenOf('anime', animeId) : Promise.resolve(new Map())), new Map(), [animeId, id]);
  useTitle(ep ? `${ep.anime?.title ?? ''} Episode ${ep.number}` : null);
  const epList = useMemo(() => [...(ep?.episodes ?? [])].sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0)), [ep]);
  useEffect(() => { document.querySelector(`.ep-btn[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' }); }, [epList, id]);

  return (
    <div className="page watch-page">
      {loading && !ep ? <div className="vplayer" style={{ display: 'grid', placeItems: 'center' }}><div className="spinner" style={{ width: 44, height: 44 }} /></div>
        : error || !ep ? <Failed error={error ?? 'Episode tidak ditemukan'} retry={retry} />
          : (
            <div className="watch">
              <div style={{ minWidth: 0 }}>
                <Player ep={ep} onEnded={() => {}} />
                <div className="dhead" style={{ padding: '16px 0 4px', alignItems: 'center', flexWrap: 'nowrap', textAlign: 'left', flexDirection: 'row' }}>
                  {ep.anime && <Link to={routes.anime(ep.anime.id)} className="poster" style={{ width: 64 }}><Img src={ep.anime.cover} /></Link>}
                  <div className="info" style={{ minWidth: 0 }}>
                    <Link to={ep.anime ? routes.anime(ep.anime.id) : '#'} className="title ellipsis" style={{ display: 'block', fontSize: 18 }}>{ep.anime?.title}</Link>
                    <div className="sub">Episode {ep.number}{ep.anime?.status ? ` · ${ep.anime.status}` : ''}{ep.sources.length ? ` · ${ep.sources.length} server` : ''}{ep.anime?.source ? ` · ${ep.anime.source}` : ''}</div>
                  </div>
                  {ep.anime && <FavButton kind="anime" id={ep.anime.id} title={ep.anime.title} cover={ep.anime.cover} />}
                </div>
                {ep.anime && <AltSources anime={ep.anime} epNumber={ep.number} title={ep.sources.length ? 'Tonton dari sumber lain' : 'Coba episode ini di sumber lain'} />}
                <div className="actions" style={{ marginTop: 12 }}>
                  <button className="btn" disabled={!ep.prev} onClick={() => ep.prev && nav(routes.watch(ep.prev.id))}><SkipBack size={16} />Sebelumnya</button>
                  <button className="btn primary" disabled={!ep.next} onClick={() => ep.next && nav(routes.watch(ep.next.id))}>Berikutnya<SkipForward size={16} /></button>
                </div>
                {ep.downloads.length > 0 && (
                  <details style={{ marginTop: 6 }}>
                    <summary className="sub" style={{ cursor: 'pointer', fontWeight: 700 }}><Download size={14} style={{ verticalAlign: -2 }} /> Unduh episode ({ep.downloads.length} tautan)</summary>
                    <div className="server-chips" style={{ marginTop: 10 }}>{ep.downloads.map((d, i) => <a key={i} className="chip" style={{ display: 'inline-flex', alignItems: 'center' }} href={d.url} target="_blank" rel="noopener noreferrer">{d.label}{d.resolution ? ` · ${d.resolution}` : ''}</a>)}</div>
                    <div className="sub" style={{ marginTop: 8 }}>Tautan unduh membuka situs pihak ketiga (bisa berisi iklan).</div>
                  </details>
                )}
              </div>
              <div className="watch-side">
                <div className="box">
                  <div style={{ fontWeight: 800, marginBottom: 10 }}>Episode ({epList.length})</div>
                  <div className="ep-grid">
                    {epList.map((e) => {
                      const s = seen.get(e.id);
                      return (
                        <button key={e.id} data-id={e.id} className={`ep-btn ${e.id === id ? 'cur' : s ? 'seen' : ''}`} title={e.title} onClick={() => nav(routes.watch(e.id), { replace: true })}>
                          {e.number || '?'}{s && e.id !== id && s.dur > 0 && <i style={{ width: `${Math.min(100, (s.pos / s.dur) * 100)}%` }} />}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="sub" style={{ padding: '0 4px' }}>Pintasan: Spasi putar/jeda · J/L ±10 dtk · ←/→ ±5 dtk · F layar penuh · M bisu · I gambar-dalam-gambar · Shift+N/P episode</div>
              </div>
            </div>
          )}
      {!ep && !loading && !error && <Spinner />}
    </div>
  );
}
