// Pemutar anime Freease Stream: <video> dengan kontrol sendiri untuk berkas langsung dan HLS (hls.js), tanpa iklan.
// Server gagal/macet → pindah otomatis; server di sumber ini habis → episode yang sama dicari di sumber lain.
// Pemutar situs lain (embed) cuma cadangan terakhir, diputar di iframe ber-sandbox (tanpa pop-up, pengalihan, unduhan).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle, ChevronLeft, Download, FastForward, Gauge, Maximize, Minimize, Pause, PictureInPicture2, Play, RectangleHorizontal,
  RotateCcw, RotateCw, Search, Settings2, SkipBack, SkipForward, Volume1, Volume2, VolumeX,
} from 'lucide-react';
import type HlsType from 'hls.js';
import { toast } from '../../lib/toast';
import { toggle as toggleMusic, usePlayer } from '../../player/player';
import { fs, fmtClock, routes, type EpisodeData, type EpisodeElsewhere, type VideoSource } from '../api';
import { saveProgress, seenItem, seenOf, useStore } from '../store';
import { AltSources, FavButton, Failed, Img, Spinner, useLoad, useTitle } from '../ui';

const ls = {
  get: (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* */ } },
};
const pref = {
  get quality() { return ls.get('fs-quality', ''); },
  set quality(v: string) { ls.set('fs-quality', v); },
  get autoNext() { return ls.get('fs-autonext', '1') !== '0'; },
  set autoNext(v: boolean) { ls.set('fs-autonext', v ? '1' : '0'); },
  get volume() { return Number(ls.get('fs-volume', '1')); },
  set volume(v: number) { ls.set('fs-volume', String(v)); },
  get theater() { return ls.get('fs-theater', '0') === '1'; },
  set theater(v: boolean) { ls.set('fs-theater', v ? '1' : '0'); },
  get fill() { return ls.get('fs-fill', '0') === '1'; },
  set fill(v: boolean) { ls.set('fs-fill', v ? '1' : '0'); },
};
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const height = (q: string) => Number(q.match(/\d+/)?.[0]) || 0;
const hover = () => matchMedia('(hover: hover)').matches;

/** Urutan coba: server langsung dulu (kualitas pilihan, lalu tertinggi), server dari sumber lain, embed paling akhir. */
function ordered(own: VideoSource[], extra: VideoSource[]) {
  const want = pref.quality;
  const direct = (l: VideoSource[]) => l.filter((s) => s.type !== 'embed')
    .sort((a, b) => Number(b.quality === want) - Number(a.quality === want) || height(b.quality) - height(a.quality));
  return [...direct(own), ...direct(extra), ...own.filter((s) => s.type === 'embed'), ...extra.filter((s) => s.type === 'embed')];
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
  const [hov, setHov] = useState<number | null>(null);
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
      onPointerDown={(e) => { if (!dur) return; e.stopPropagation(); (e.target as HTMLElement).setPointerCapture(e.pointerId); setDrag(at(e.clientX)); }}
      onPointerMove={(e) => { if (!dur) return; const t = at(e.clientX); setHov(t); if (drag != null) setDrag(t); }}
      onPointerLeave={() => setHov(null)}
      onPointerUp={(e) => { if (drag == null) return; onSeek(at(e.clientX)); setDrag(null); }}
      onPointerCancel={() => setDrag(null)}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="track"><div className="buf" style={{ width: pct(buf) }} /><div className="fill" style={{ width: pct(cur) }} /></div>
      <div className="knob" style={{ left: pct(cur) }} />
      {(drag ?? hov) != null && <div className="tip" style={{ left: pct(drag ?? hov!) }}>{fmtClock(drag ?? hov!)}</div>}
    </div>
  );
}

function Player({ ep, theater, setTheater }: { ep: EpisodeData; theater: boolean; setTheater: (v: boolean) => void }) {
  const nav = useNavigate();
  const box = useRef<HTMLDivElement>(null);
  const vid = useRef<HTMLVideoElement>(null);
  const hls = useRef<HlsType | null>(null);
  const anime = ep.anime;

  // Server dari sumber lain (judul & nomor episode sama), dimuat saat server di sumber ini habis.
  const [extra, setExtra] = useState<EpisodeElsewhere[]>([]);
  const [look, setLook] = useState<'idle' | 'loading' | 'done'>('idle');
  const extraSources = useMemo(() => extra.flatMap((e) => e.sources.map((s) => ({ ...s, from: e.source }))), [extra]);
  const list = useMemo(() => ordered(ep.sources, extraSources), [ep, extraSources]);
  const directCount = list.filter((s) => s.type !== 'embed').length;
  const ownDirect = ep.sources.filter((s) => s.type !== 'embed').length;

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
  const [fast, setFast] = useState(false);
  const [fill, setFill] = useState(pref.fill);
  const [levels, setLevels] = useState<{ h: number; i: number }[]>([]);
  const [level, setLevel] = useState(-1);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [, tick] = useState(0);
  const resumeAt = useRef<number | null>(null);
  // Server sendiri habis dan sumber lain sedang dicari: jangan putar embed dulu.
  const holding = look === 'loading' && idx >= ownDirect;
  const src: VideoSource | undefined = holding ? undefined : list[idx];
  const embed = src?.type === 'embed';
  const url = src && !embed ? (useFallback && src.fallback ? src.fallback : src.url) : '';

  // posisi terakhir episode ini
  useEffect(() => {
    let alive = true;
    resumeAt.current = null;
    void seenItem('anime', ep.id).then((s) => { if (alive && s && s.pos > 15 && (!s.dur || s.pos < s.dur - 30)) resumeAt.current = s.pos; });
    return () => { alive = false; };
  }, [ep.id]);
  useEffect(() => { setIdx(0); setUseFallback(false); setFail(null); setCountdown(null); setExtra([]); setLook('idle'); }, [ep.id]);

  const lookElsewhere = useCallback(() => {
    if (look !== 'idle' || !anime) return false;
    setLook('loading');
    fs.episodeElsewhere(anime, ep.number)
      .then((r) => { setExtra(r); if (r.length) toast(`Server episode ini juga diambil dari ${r.map((x) => x.source).join(', ')}`); })
      .catch(() => {})
      .finally(() => setLook('done'));
    return true;
  }, [look, anime, ep.number]);
  // Tidak ada server langsung sama sekali: cari di sumber lain dulu sebelum memakai embed.
  useEffect(() => { if (ep.sources.every((s) => s.type === 'embed')) lookElsewhere(); }, [ep.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const nextServer = useCallback((why: string) => {
    if (src?.fallback && !useFallback) { setUseFallback(true); return; }
    const resume = vid.current?.currentTime ?? 0;
    if (resume > 5) resumeAt.current = resume;
    const nxt = list[idx + 1];
    // Server langsung habis: cari episode yang sama di sumber lain sebelum jatuh ke embed.
    if ((!nxt || nxt.type === 'embed') && lookElsewhere()) { setIdx(idx + 1); setUseFallback(false); return; }
    if (look === 'loading') { setIdx(idx + 1); setUseFallback(false); return; }
    if (nxt) {
      toast(`${src?.label ?? 'Server'} ${src?.quality ?? ''} gagal, pindah ke ${nxt.from ? `${nxt.from} · ` : ''}${nxt.label} ${nxt.quality}`);
      setIdx(idx + 1); setUseFallback(false);
    } else setFail(why);
  }, [idx, list, src, useFallback, lookElsewhere, look]);
  const nextRef = useRef(nextServer);
  nextRef.current = nextServer;

  // Pasang sumber ke <video>: berkas langsung lewat src, HLS lewat hls.js (atau HLS bawaan Safari/iOS).
  useEffect(() => {
    const v = vid.current;
    setLevels([]); setLevel(-1);
    if (!v || !url) return;
    let dead = false;
    setWaiting(true);
    const failed = () => !dead && nextRef.current('Semua server gagal memutar episode ini. Coba lagi nanti atau pilih episode lain.');
    if (src?.type === 'hls') {
      void import('hls.js/dist/hls.light.mjs').then(({ default: Hls }) => {
        if (dead) return;
        if (!Hls.isSupported()) {
          if (v.canPlayType('application/vnd.apple.mpegurl')) v.src = url; else failed();
          return;
        }
        const h = new Hls({ maxBufferLength: 45, maxMaxBufferLength: 120, startLevel: -1, fragLoadingMaxRetry: 4, manifestLoadingMaxRetry: 2, levelLoadingMaxRetry: 3 });
        hls.current = h;
        let recovered = 0;
        h.on(Hls.Events.MANIFEST_PARSED, () => {
          const found = h.levels.map((l, i) => ({ h: l.height, i })).filter((l) => l.h > 0).sort((a, b) => b.h - a.h);
          setLevels(found);
          const want = height(pref.quality);
          const pick = want ? found.find((l) => l.h === want) : undefined;
          if (pick) { h.currentLevel = pick.i; setLevel(pick.i); }
        });
        h.on(Hls.Events.ERROR, (_e, d) => {
          if (!d.fatal) return;
          if (d.type === Hls.ErrorTypes.MEDIA_ERROR && recovered++ < 2) { h.recoverMediaError(); return; }
          if (d.type === Hls.ErrorTypes.NETWORK_ERROR && recovered++ < 1 && v.currentTime > 0) { h.startLoad(); return; }
          failed();
        });
        h.loadSource(url);
        h.attachMedia(v);
      }).catch(failed);
    } else {
      v.src = url;
    }
    // Server macet (tidak ada gambar dalam 25 dtk) dianggap gagal.
    const stall = setTimeout(() => { if (!dead && v.readyState < 3 && !v.currentTime) failed(); }, 25000);
    return () => {
      dead = true; clearTimeout(stall);
      hls.current?.destroy(); hls.current = null;
      v.removeAttribute('src'); v.load();
    };
  }, [url, src?.type]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tersendat lama di tengah jalan (>30 dtk) → pindah server dari posisi yang sama.
  useEffect(() => {
    if (!waiting || !playing || embed) return;
    const t = setTimeout(() => { if (vid.current && vid.current.readyState < 3) { toast('Server tersendat, mencoba server lain…'); nextRef.current('Semua server gagal memutar episode ini.'); } }, 30000);
    return () => clearTimeout(t);
  }, [waiting, playing, embed, idx]);

  const v = vid.current;
  const toggle = () => { const x = vid.current; if (!x) return; if (x.paused) void x.play().catch(() => {}); else x.pause(); };
  const seekBy = (d: number) => { const x = vid.current; if (!x) return; x.currentTime = Math.max(0, Math.min((x.duration || 0) - 0.5, x.currentTime + d)); say(`${d > 0 ? '+' : ''}${d} dtk`, d > 0 ? 'r' : 'l'); show(); };
  const setVolume = (n: number) => { const x = vid.current; n = Math.max(0, Math.min(1, n)); setVol(n); pref.volume = n; if (x) { x.volume = n; x.muted = n === 0; } setMuted(n === 0); };
  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (box.current?.requestFullscreen) { await box.current.requestFullscreen(); try { await (screen.orientation as any)?.lock?.('landscape'); } catch { /* HP tertentu */ } }
      else (vid.current as any)?.webkitEnterFullscreen?.();
    } catch { /* */ }
  };
  useEffect(() => { const h = () => setFull(!!document.fullscreenElement); document.addEventListener('fullscreenchange', h); return () => document.removeEventListener('fullscreenchange', h); }, []);
  const pip = async () => {
    try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); else await vid.current?.requestPictureInPicture(); } catch { toast('Gambar-dalam-gambar tidak didukung browser ini'); }
  };
  const pickServer = (i: number) => { resumeAt.current = vid.current?.currentTime || resumeAt.current; setIdx(i); setUseFallback(false); setFail(null); setMenu(false); };
  const pickLevel = (i: number, h: number) => {
    if (hls.current) hls.current.currentLevel = i;
    setLevel(i); if (h) pref.quality = `${h}p`; setMenu(false);
  };

  // pintasan keyboard
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return;
      const x = vid.current;
      const k = e.key.toLowerCase();
      if (k === 't' && !e.shiftKey) { setTheater(!theater); return; }
      if (!x || embed) return;
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
      else if (k === '>' || k === '<') { const r = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, SPEEDS.indexOf(x.playbackRate) + (k === '>' ? 1 : -1)))] ?? 1; x.playbackRate = r; say(`${r}×`); }
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

  // HP: ketuk = tampil/sembunyikan kontrol, ketuk dua kali di sisi = ±10 dtk, tahan = 2× cepat.
  const lastTap = useRef(0);
  const hold = useRef<{ t: ReturnType<typeof setTimeout> | null; on: boolean; rate: number }>({ t: null, on: false, rate: 1 });
  const ignore = (e: { target: EventTarget }) => !!(e.target as HTMLElement).closest('button, input, .vseek, .vmenu, .vnext, .verr, .vembed-bar');
  const onDown = (e: React.PointerEvent) => {
    if (ignore(e) || !vid.current || embed) return;
    hold.current.t = setTimeout(() => {
      const x = vid.current;
      if (!x || x.paused) return;
      hold.current = { t: null, on: true, rate: x.playbackRate };
      x.playbackRate = 2; setFast(true);
    }, 500);
  };
  const onUp = () => {
    if (hold.current.t) clearTimeout(hold.current.t);
    hold.current.t = null;
    if (hold.current.on) { const x = vid.current; if (x) x.playbackRate = hold.current.rate; setFast(false); setTimeout(() => { hold.current.on = false; }, 50); }
  };
  const onTap = (e: React.MouseEvent) => {
    if (ignore(e) || hold.current.on || embed) return;
    const r = box.current!.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const now = Date.now();
    if (now - lastTap.current < 300 && (x < 0.35 || x > 0.65)) { seekBy(x < 0.5 ? -10 : 10); lastTap.current = 0; return; }
    lastTap.current = now;
    if (hover()) { toggle(); show(); }
    else if (idle || !playing) show(); else setIdle(true);
  };

  const dur = v?.duration && isFinite(v.duration) ? v.duration : 0;
  const VolIcon = muted || vol === 0 ? VolumeX : vol < 0.5 ? Volume1 : Volume2;
  const qualities = [...new Set(list.filter((s) => s.type !== 'embed' && !s.from).map((s) => s.quality))].filter((q) => q !== 'Auto');
  const showSkip = playing && v && v.currentTime > 5 && v.currentTime < 240 && dur > 600;
  const searching = holding;
  const noSource = !src && !holding;
  const controls = !!url && !fail;
  const curLevel = hls.current && hls.current.currentLevel >= 0 ? hls.current.levels[hls.current.currentLevel]?.height : 0;
  const curQ = levels.length ? (level >= 0 ? `${levels.find((l) => l.i === level)?.h ?? ''}p` : `Auto${curLevel ? ` ${curLevel}p` : ''}`) : src?.quality;
  const label = (s: VideoSource) => `${s.from ? `${s.from} · ` : ''}${s.label}`;

  return (
    <div
      ref={box} className={`vplayer ${idle && playing ? 'idle' : ''} ${fill ? 'fill' : ''}`} tabIndex={-1}
      onMouseMove={() => hover() && show()} onClick={onTap} onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={onUp} onContextMenu={(e) => hold.current.on && e.preventDefault()}
      onDoubleClick={(e) => { if (hover() && !ignore(e) && !embed) void fullscreen(); }}
    >
      <video
        ref={vid} autoPlay playsInline preload="auto" style={{ display: url ? 'block' : 'none' }}
        onLoadedMetadata={(e) => {
          const x = e.currentTarget; x.volume = vol; x.playbackRate = speed;
          if (resumeAt.current) { x.currentTime = resumeAt.current; say(`Melanjutkan dari ${fmtClock(resumeAt.current)}`); resumeAt.current = null; }
          tick((n) => n + 1);
        }}
        onPlay={() => { setPlaying(true); setFail(null); if (usePlayer.getState().playing) toggleMusic(); show(); }}
        onPause={() => { setPlaying(false); setIdle(false); save(); }}
        onWaiting={() => setWaiting(true)} onPlaying={() => setWaiting(false)} onCanPlay={() => setWaiting(false)}
        onError={() => { if (url && src?.type !== 'hls') nextServer('Semua server gagal memutar episode ini. Coba lagi nanti atau pilih episode lain.'); }}
        onEnded={() => { save(); if (ep.next && pref.autoNext) setCountdown(8); }}
        onRateChange={(e) => { if (!hold.current.on) setSpeed(e.currentTarget.playbackRate); }}
      />
      {embed && src && (
        <>
          <EmbedFrame src={src} />
          <div className="vembed-bar" onClick={(e) => e.stopPropagation()}>
            <span className="pill" title="Pemutar dari situs lain, dikunci sandbox: pop-up, pengalihan & unduhan diblokir">{label(src)} · pemutar luar</span>
            {directCount > 0 && <button className="btn sm" onClick={() => pickServer(0)}>Server tanpa iklan</button>}
            <button className={`icon-btn sm ${menu ? 'on' : ''}`} aria-label="Ganti server" onClick={() => setMenu((m) => !m)}><Settings2 size={18} /></button>
          </div>
        </>
      )}
      {searching && <div className="vwait"><div className="spinner" style={{ width: 40, height: 40 }} /><span>Server di sumber ini kosong — mencari episode ini di sumber lain…</span></div>}
      {noSource && (
        <div className="verr" onClick={(e) => e.stopPropagation()}>
          <AlertTriangle size={36} />
          <b>Episode ini belum bisa diputar</b>
          <span className="sub">Semua server untuk episode ini sedang mati atau dihapus, dan judul yang sama di sumber lain juga belum punya episode ini.{ep.downloads.length ? ' Coba tautan unduh di bawah.' : ''}</span>
          {ep.next && <button className="btn" onClick={() => nav(routes.watch(ep.next!.id))}>Episode berikutnya<SkipForward size={16} /></button>}
        </div>
      )}
      {waiting && controls && <div className="vwait"><div className="spinner" style={{ width: 44, height: 44 }} />{!playing && src && <span>{label(src)} · {src.quality}</span>}</div>}
      {flash && <div key={flash.k} className={`vflash ${flash.side}`}>{flash.side === 'l' ? <RotateCcw size={18} /> : flash.side === 'r' ? <RotateCw size={18} /> : null}{flash.t}</div>}
      {fast && <div className="vfast"><FastForward size={16} />2× cepat</div>}

      {controls && <div className="vctl">
        <div className="vtop">
          <button className="icon-btn" aria-label="Kembali" onClick={(e) => { e.stopPropagation(); if (document.fullscreenElement) void document.exitFullscreen(); else nav(anime ? routes.anime(anime.id) : '/stream'); }}><ChevronLeft size={24} /></button>
          <div className="t ellipsis">{anime?.title} · Episode {ep.number}</div>
          {src && <span className="pill">{curQ}</span>}
        </div>
        <div className="vmid">
          <button className="icon-btn" aria-label="Mundur 10 detik" onClick={(e) => { e.stopPropagation(); seekBy(-10); }}><RotateCcw size={24} /></button>
          <button className="play-btn grad" aria-label={playing ? 'Jeda' : 'Putar'} onClick={(e) => { e.stopPropagation(); toggle(); show(); }}>{playing ? <Pause size={30} fill="currentColor" /> : <Play size={30} fill="currentColor" style={{ marginLeft: 3 }} />}</button>
          <button className="icon-btn" aria-label="Maju 10 detik" onClick={(e) => { e.stopPropagation(); seekBy(10); }}><RotateCw size={24} /></button>
        </div>
        <div className="vbottom">
          {showSkip && <div className="vskip"><button className="btn sm" onClick={(e) => { e.stopPropagation(); seekBy(85); }}><FastForward size={15} />Lewati intro</button></div>}
          <SeekBar v={v} onSeek={(t) => { if (vid.current) vid.current.currentTime = t; }} />
          <div className="row">
            <button className="icon-btn sm" aria-label={playing ? 'Jeda' : 'Putar'} onClick={(e) => { e.stopPropagation(); toggle(); }}>{playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}</button>
            {ep.next && <button className="icon-btn sm" aria-label="Episode berikutnya" title="Episode berikutnya (Shift+N)" onClick={(e) => { e.stopPropagation(); nav(routes.watch(ep.next!.id)); }}><SkipForward size={19} fill="currentColor" /></button>}
            <button className="icon-btn sm" aria-label="Bisukan" onClick={(e) => { e.stopPropagation(); setVolume(muted || vol === 0 ? (pref.volume || 1) : 0); }}><VolIcon size={19} /></button>
            <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : vol} onChange={(e) => setVolume(Number(e.target.value))} onClick={(e) => e.stopPropagation()} aria-label="Volume" className="vvol" />
            <span className="time">{fmtClock(v?.currentTime ?? 0)} / {fmtClock(dur)}</span>
            <span className="sp" />
            {speed !== 1 && <span className="pill">{speed}×</span>}
            <button className={`icon-btn sm ${menu ? 'on' : ''}`} aria-label="Server, kualitas & kecepatan" onClick={(e) => { e.stopPropagation(); setMenu((m) => !m); }}><Settings2 size={19} /></button>
            {'pictureInPictureEnabled' in document && <button className="icon-btn sm hide-mobile" aria-label="Gambar dalam gambar" onClick={(e) => { e.stopPropagation(); void pip(); }}><PictureInPicture2 size={19} /></button>}
            <button className={`icon-btn sm theater-btn ${theater ? 'on' : ''}`} aria-label="Mode bioskop" title="Mode bioskop (T)" onClick={(e) => { e.stopPropagation(); setTheater(!theater); }}><RectangleHorizontal size={19} /></button>
            <button className="icon-btn sm" aria-label="Layar penuh" onClick={(e) => { e.stopPropagation(); void fullscreen(); }}>{full ? <Minimize size={19} /> : <Maximize size={19} />}</button>
          </div>
        </div>
      </div>}

      {menu && (
        <div className="vmenu" onClick={(e) => e.stopPropagation()}>
          {levels.length > 1 && <><h4>Kualitas</h4>
            <button className={level === -1 ? 'on' : ''} onClick={() => pickLevel(-1, 0)}>Otomatis<span className="sub">sesuai sinyal</span></button>
            {levels.map((l) => <button key={l.i} className={level === l.i ? 'on' : ''} onClick={() => pickLevel(l.i, l.h)}>{l.h}p</button>)}
          </>}
          {!levels.length && qualities.length > 1 && <><h4>Kualitas</h4>{qualities.map((q) => (
            <button key={q} className={src?.quality === q ? 'on' : ''} onClick={() => { const i = list.findIndex((s) => s.quality === q && s.type !== 'embed'); if (i >= 0) { pref.quality = q; pickServer(i); } }}>{q}</button>
          ))}</>}
          {directCount > 0 && <h4>Server tanpa iklan</h4>}
          {list.map((s, i) => s.type !== 'embed' && <button key={s.url} className={i === idx ? 'on' : ''} onClick={() => pickServer(i)}><span>{label(s)}</span><span className="sub">{s.quality}{s.type === 'hls' ? ' · HLS' : ''}</span></button>)}
          {look === 'idle' && anime && <button onClick={() => { lookElsewhere(); setMenu(false); }}><span><Search size={14} style={{ verticalAlign: -2, marginRight: 6 }} />Cari server di sumber lain</span></button>}
          {look === 'loading' && <button disabled><span>Mencari di sumber lain…</span></button>}
          {list.some((s) => s.type === 'embed') && <><h4>Pemutar luar (sandbox)</h4>
            {list.map((s, i) => s.type === 'embed' && <button key={s.url} className={i === idx ? 'on' : ''} onClick={() => pickServer(i)}><span>{label(s)}</span><span className="sub">{s.quality}</span></button>)}
            <p className="sub vnote">Pemutar situs lain bisa meminta iklan; pop-up, pengalihan dan unduhan sudah diblokir. Pakai kalau server tanpa iklan habis.</p>
          </>}
          {!embed && <><h4><Gauge size={12} style={{ verticalAlign: -1 }} /> Kecepatan</h4>
            <div className="vspeeds">{SPEEDS.map((r) => <button key={r} className={`chip ${speed === r ? 'on' : ''}`} onClick={() => { if (vid.current) vid.current.playbackRate = r; setSpeed(r); }}>{r}×</button>)}</div>
            <h4>Tampilan</h4>
            <button onClick={() => { pref.fill = !fill; setFill(!fill); }}>Penuhi layar (potong tepi)<span className="sub">{fill ? 'Nyala' : 'Mati'}</span></button>
          </>}
          <h4>Putar otomatis</h4>
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
          <AlertTriangle size={36} />
          <b>{fail}</b>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button className="btn primary" onClick={() => { setFail(null); setIdx(0); setUseFallback(false); }}><RotateCw size={16} />Coba lagi</button>
            {list.some((s) => s.type === 'embed') && <button className="btn" onClick={() => pickServer(list.findIndex((s) => s.type === 'embed'))}>Pemutar luar</button>}
            {ep.next && <button className="btn" onClick={() => nav(routes.watch(ep.next!.id))}>Episode berikutnya</button>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Daftar episode: seri panjang dipecah per 50, bisa langsung lompat ke nomor episode. */
function EpisodeList({ eps, id, seen }: { eps: EpisodeData['episodes']; id: string; seen: Map<string, { pos: number; dur: number }> }) {
  const nav = useNavigate();
  const grid = useRef<HTMLDivElement>(null);
  const SIZE = 50;
  const chunks = Math.ceil(eps.length / SIZE);
  const curIdx = Math.max(0, eps.findIndex((e) => e.id === id));
  const [chunk, setChunk] = useState(Math.floor(curIdx / SIZE));
  const [q, setQ] = useState('');
  useEffect(() => { setChunk(Math.floor(curIdx / SIZE)); }, [curIdx]);
  const shown = q.trim() ? eps.filter((e) => e.number === q.trim() || e.number.startsWith(q.trim())) : chunks > 1 ? eps.slice(chunk * SIZE, chunk * SIZE + SIZE) : eps;
  // Gulir di dalam kotak daftar saja (scrollIntoView ikut menggulir seluruh halaman).
  useEffect(() => {
    const g = grid.current;
    const b = g?.querySelector<HTMLElement>('.ep-btn.cur');
    if (g && b && g.scrollHeight > g.clientHeight) g.scrollTop = b.offsetTop - g.offsetTop - g.clientHeight / 2 + b.offsetHeight / 2;
  }, [id, chunk]);
  return (
    <div className="box">
      <div className="ep-head">
        <b>Episode ({eps.length})</b>
        {eps.length > 24 && <input className="ep-find" inputMode="decimal" placeholder="No." value={q} onChange={(e) => setQ(e.target.value.replace(/[^\d.]/g, ''))} aria-label="Cari nomor episode" />}
      </div>
      {chunks > 1 && !q && (
        <div className="ep-chunks">
          {Array.from({ length: chunks }, (_, i) => {
            const a = eps[i * SIZE]?.number, b = eps[Math.min(eps.length, (i + 1) * SIZE) - 1]?.number;
            return <button key={i} className={`chip ${i === chunk ? 'on' : ''}`} onClick={() => setChunk(i)}>{a}–{b}</button>;
          })}
        </div>
      )}
      <div className="ep-grid" ref={grid}>
        {shown.map((e) => {
          const s = seen.get(e.id);
          return (
            <button key={e.id} data-id={e.id} className={`ep-btn ${e.id === id ? 'cur' : s ? 'seen' : ''}`} title={e.title} onClick={() => nav(routes.watch(e.id), { replace: true })}>
              {e.number || '?'}{s && e.id !== id && s.dur > 0 && <i style={{ width: `${Math.min(100, (s.pos / s.dur) * 100)}%` }} />}
            </button>
          );
        })}
        {!shown.length && <div className="sub">Tidak ada episode {q}.</div>}
      </div>
    </div>
  );
}

export default function Watch() {
  const id = decodeURIComponent(useParams().id ?? '');
  const nav = useNavigate();
  const { data: ep, error, loading, retry } = useLoad((s) => fs.episode(id, s), [id]);
  const animeId = ep?.anime?.id ?? '';
  const seen = useStore(() => (animeId ? seenOf('anime', animeId) : Promise.resolve(new Map())), new Map(), [animeId, id]);
  const [theater, setTheaterState] = useState(pref.theater);
  const setTheater = (v: boolean) => { pref.theater = v; setTheaterState(v); };
  useTitle(ep ? `${ep.anime?.title ?? ''} Episode ${ep.number}` : null);
  const epList = useMemo(() => {
    const ids = new Set<string>();
    return [...(ep?.episodes ?? [])].filter((e) => !ids.has(e.id) && ids.add(e.id)).sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0));
  }, [ep]);

  if (loading && !ep) return <div className="page watch-page"><div className="watch"><div className="sw-main"><div className="vplayer vload"><div className="spinner" style={{ width: 44, height: 44 }} /></div></div></div></div>;
  if (error || !ep) return <div className="page watch-page">{!loading ? <Failed error={error ?? 'Episode tidak ditemukan'} retry={retry} /> : <Spinner />}</div>;
  return (
    <div className="page watch-page">
      <div className={`watch ${theater ? 'theater' : ''}`}>
        <div className="sw-main"><Player key={ep.id} ep={ep} theater={theater} setTheater={setTheater} /></div>
        <div className="sw-info">
          <div className="winfo">
            {ep.anime && <Link to={routes.anime(ep.anime.id)} className="poster" style={{ width: 56 }}><Img src={ep.anime.cover} /></Link>}
            <div className="info" style={{ minWidth: 0, flex: 1 }}>
              <Link to={ep.anime ? routes.anime(ep.anime.id) : '#'} className="title ellipsis">{ep.anime?.title}</Link>
              <div className="sub">Episode {ep.number}{ep.anime?.status ? ` · ${ep.anime.status}` : ''}{ep.anime?.source ? ` · ${ep.anime.source}` : ''}</div>
            </div>
            {ep.anime && <FavButton kind="anime" id={ep.anime.id} title={ep.anime.title} cover={ep.anime.cover} />}
          </div>
          <div className="actions wnav">
            <button className="btn" disabled={!ep.prev} onClick={() => ep.prev && nav(routes.watch(ep.prev.id))}><SkipBack size={16} />{ep.prev ? `Ep ${ep.prev.number}` : 'Sebelumnya'}</button>
            <button className="btn primary" disabled={!ep.next} onClick={() => ep.next && nav(routes.watch(ep.next.id))}>{ep.next ? `Ep ${ep.next.number}` : 'Belum ada lanjutan'}<SkipForward size={16} /></button>
          </div>
          {ep.anime && <AltSources anime={ep.anime} epNumber={ep.number} title="Judul ini juga ada di" />}
          {ep.downloads.length > 0 && (
            <details style={{ marginTop: 10 }}>
              <summary className="sub" style={{ cursor: 'pointer', fontWeight: 700 }}><Download size={14} style={{ verticalAlign: -2 }} /> Unduh episode ({ep.downloads.length} tautan)</summary>
              <div className="server-chips" style={{ marginTop: 10 }}>{ep.downloads.map((d, i) => <a key={i} className="chip" style={{ display: 'inline-flex', alignItems: 'center' }} href={d.url} target="_blank" rel="noopener noreferrer">{d.label}{d.resolution ? ` · ${d.resolution}` : ''}</a>)}</div>
              <div className="sub" style={{ marginTop: 8 }}>Tautan unduh membuka situs pihak ketiga (bisa berisi iklan).</div>
            </details>
          )}
        </div>
        <div className="watch-side">
          {epList.length > 0 && <EpisodeList eps={epList} id={id} seen={seen} />}
          <div className="sub keys">Pintasan: Spasi putar/jeda · J/L ±10 dtk · ←/→ ±5 dtk · &lt;/&gt; kecepatan · F layar penuh · T mode bioskop · M bisu · I gambar-dalam-gambar · Shift+N/P episode</div>
        </div>
      </div>
    </div>
  );
}
