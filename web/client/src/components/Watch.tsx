import { useEffect, useMemo, useState } from 'react';
import {
  Captions, ChevronDown, ChevronUp, Clapperboard, Headphones, Heart, Languages, ListPlus, Maximize, Settings2, Share2, SkipBack, SkipForward,
} from 'lucide-react';
import { api, fmtTime, type VideoInfo } from '../lib/api';
import * as db from '../lib/db';
import { useFetch, usePosition } from '../lib/hooks';
import { useSettings } from '../lib/settings';
import { toast } from '../lib/toast';
import type { Song } from '../lib/types';
import { media, next, playNext, prev, seek, skipTo, usePlayer, videoHost } from '../player/player';
import { useSubtitles } from '../player/subtitles';
import { enterFullscreen, setVideoMode, useVideo } from '../player/video';
import { FloatingLyricsButton, MoreSheet, RepeatButton, ShuffleButton, useLiked } from './Shell';
import { PlayPause, Seekbar, Sheet } from './ui';
import { useUi } from './uiState';
import { VideoSlot } from './VideoSlot';

const num = new Intl.NumberFormat('id', { notation: 'compact', maximumFractionDigits: 1 });
const ymd = (s: string | null) => (s && /^\d{8}$/.test(s) ? new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}`).toLocaleDateString('id', { day: 'numeric', month: 'long', year: 'numeric' }) : '');

/** Bab dari yt-dlp, atau dari baris "0:00 Judul" di deskripsi. */
function chaptersOf(info: VideoInfo | null): { start: number; title: string }[] {
  if (!info) return [];
  if (info.chapters.length) return info.chapters;
  const out: { start: number; title: string }[] = [];
  for (const line of info.description.split('\n')) {
    const m = line.match(/^\s*[[(]?((?:\d{1,2}:)?\d{1,2}:\d{2})[\])]?\s*[-–—:|]?\s*(.+)$/);
    if (!m) continue;
    const start = m[1].split(':').map(Number).reduce((a, b) => a * 60 + b, 0);
    out.push({ start, title: m[2].trim() });
  }
  return out.length >= 3 && out[0].start === 0 ? out : [];
}

/** Teks deskripsi: link & stempel waktu (0:00) bisa diketuk. */
function RichText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/\S+|\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (/^https?:\/\//.test(p)) return <a key={i} href={p} target="_blank" rel="noreferrer noopener">{p}</a>;
        if (/^(?:\d{1,2}:)?\d{1,2}:\d{2}$/.test(p)) {
          const t = p.split(':').map(Number).reduce((a, b) => a * 60 + b, 0);
          return <button key={i} className="ts" onClick={() => seek(t)}>{p}</button>;
        }
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

/**
 * Layar tonton ala YouTube untuk video dari mode YouTube: video menempel di atas, judul & info, tombol
 * aksi (subtitle, suka, simpan, hanya audio, bagikan), deskripsi (bisa diterjemahkan) & bab, kontrol,
 * lalu Terkait/Antrean. Di laptop panel Terkait/Antrean ada di kanan.
 */
export function WatchView({ close }: { close: () => void }) {
  const song = usePlayer((s) => s.queue[s.index]);
  const index = usePlayer((s) => s.index);
  const queue = usePlayer((s) => s.queue);
  const hasVideo = usePlayer((s) => s.hasVideo);
  const duration = usePlayer((s) => s.duration);
  const from = usePlayer((s) => s.from);
  const videoMode = useSettings((s) => s.videoMode);
  const subLang = useSettings((s) => s.subtitleLang);
  const sub = useSubtitles();
  const video = useVideo();
  const pos = usePosition();
  const openMenu = useUi((s) => s.openMenu);
  const [more, setMore] = useState(false);
  const [ccOpen, setCcOpen] = useState(false);
  const [tab, setTab] = useState<'related' | 'queue'>('related');
  const liked = useLiked(song?.id);
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && !document.fullscreenElement && close();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [close]);
  const info = useFetch((s) => (song ? api.videoInfo(song.id, s) : Promise.resolve(null)), [song?.id]);
  const related = useFetch(() => (song ? api.related(song.id, true).then((l) => l.map((x) => ({ ...x, yt: true }))) : Promise.resolve([])), [song?.id]);
  if (!song) return null;
  const showVideo = (video.active && video.ready) || (hasVideo && media.videoWidth > 0);
  const host = videoHost;
  const meta = [song.views, song.published].filter(Boolean).join(' • ');
  const upNext = queue.slice(index + 1, index + 41);
  const share = async () => {
    const url = `https://youtu.be/${song.id}`;
    try {
      if (navigator.share) await navigator.share({ title: song.title, url });
      else { await navigator.clipboard.writeText(url); toast('Link disalin'); }
    } catch { /* dibatalkan */ }
  };
  const playRelated = (s: Song) => { playNext([s]); skipTo(usePlayer.getState().index + 1); };
  return (
    <div className="np watch" role="dialog" aria-label="Sedang ditonton">
      <div className="watch-top">
        <button className="icon-btn" aria-label="Kecilkan" onClick={close}><ChevronDown size={26} /></button>
        <div className="from ellipsis">{from}</div>
        <button className="icon-btn" aria-label="Kecepatan, kualitas & timer" onClick={() => setMore(true)}><Settings2 size={20} /></button>
      </div>
      <div className="watch-body">
        <div className="watch-main">
          <div className="watch-video">
            {showVideo ? <VideoSlot host={host} className="watch-slot" /> : (
              <div className="watch-slot poster" style={{ backgroundImage: `url("https://i.ytimg.com/vi/${song.id}/hqdefault.jpg")` }}>
                {videoMode && video.active && !video.ready && <div className="spinner" />}
                {!videoMode && <span className="audio-only"><Headphones size={18} />Hanya audio</span>}
              </div>
            )}
          </div>
          <div className="watch-info">
            <h1 className="watch-title">{song.title}</h1>
            <div className="sub">{[song.artist, meta].filter(Boolean).join(' • ')}</div>
            <div className="watch-actions">
              <button className={`pill ${subLang ? 'on' : ''}`} onClick={() => setCcOpen(true)}><Captions size={17} />{subLang === 'id' ? 'Subtitle: Indonesia' : subLang === 'orig' ? 'Subtitle: Asli' : 'Subtitle'}</button>
              {showVideo && <button className="pill" onClick={() => void enterFullscreen(host)}><Maximize size={17} />Layar penuh</button>}
              <button className={`pill ${liked ? 'on' : ''}`} onClick={() => db.setLiked(song, !liked).then(() => toast(liked ? 'Dihapus dari disukai' : 'Ditambahkan ke disukai'))}><Heart size={17} fill={liked ? 'currentColor' : 'none'} />{liked ? 'Disukai' : 'Suka'}</button>
              <button className="pill" onClick={() => openMenu(song)}><ListPlus size={17} />Simpan</button>
              <button className={`pill ${!videoMode ? 'on' : ''}`} onClick={() => setVideoMode(!videoMode)}>{videoMode ? <Headphones size={17} /> : <Clapperboard size={17} />}{videoMode ? 'Hanya audio' : 'Tampilkan video'}</button>
              <button className="pill" onClick={() => void share()}><Share2 size={17} />Bagikan</button>
              <FloatingLyricsButton />
            </div>
            {subLang && (sub.loading || sub.error) && <div className="sub watch-note">{sub.loading ? 'Memuat subtitle…' : `Subtitle: ${sub.error}`}</div>}
            <Seekbar pos={pos} duration={duration} onSeek={seek} />
            <div className="watch-controls">
              <ShuffleButton />
              <button className="icon-btn" aria-label="Sebelumnya" onClick={prev}><SkipBack size={26} fill="currentColor" /></button>
              <PlayPause big />
              <button className="icon-btn" aria-label="Berikutnya" onClick={() => next()}><SkipForward size={26} fill="currentColor" /></button>
              <RepeatButton />
            </div>
            <Description key={song.id} song={song} info={info.data} loading={info.loading} pos={pos} />
          </div>
        </div>
        <aside className="watch-next">
          <div className="tabs" style={{ padding: '0 0 8px' }}>
            <button className={`tab ${tab === 'related' ? 'on' : ''}`} onClick={() => setTab('related')}>Terkait</button>
            <button className={`tab ${tab === 'queue' ? 'on' : ''}`} onClick={() => setTab('queue')}>Antrean{upNext.length ? ` (${upNext.length})` : ''}</button>
          </div>
          {tab === 'related' ? (
            related.loading ? <div className="spinner" style={{ margin: '20px auto' }} />
              : (related.data ?? []).length === 0 ? <div className="sub" style={{ padding: '8px 0' }}>Belum ada video terkait.</div>
                : (related.data ?? []).map((s) => <UpNextRow key={s.id} song={s} onClick={() => playRelated(s)} />)
          ) : (
            upNext.length === 0 ? <div className="sub" style={{ padding: '8px 0' }}>Antrean kosong — video terkait akan diputar otomatis.</div>
              : upNext.map((s, j) => <UpNextRow key={`${s.id}-${j}`} song={s} onClick={() => skipTo(index + 1 + j)} />)
          )}
        </aside>
      </div>
      {more && <MoreSheet onClose={() => setMore(false)} />}
      {ccOpen && <SubtitleSheet info={info.data} onClose={() => setCcOpen(false)} />}
    </div>
  );
}

function UpNextRow({ song: s, onClick }: { song: Song; onClick: () => void }) {
  return (
    <div className="up-next" role="button" tabIndex={0} onClick={onClick} onKeyDown={(e) => e.key === 'Enter' && onClick()}>
      <div className="vthumb">
        <img src={`https://i.ytimg.com/vi/${s.id}/mqdefault.jpg`} alt="" loading="lazy" />
        {s.duration > 0 && <span className="vbadge">{fmtTime(s.duration)}</span>}
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="vtitle">{s.title}</div>
        <div className="sub ellipsis">{s.artist}</div>
        {(s.views || s.published) && <div className="sub ellipsis">{[s.views, s.published].filter(Boolean).join(' • ')}</div>}
      </div>
    </div>
  );
}

/** Kartu deskripsi ala YouTube: ringkas → "lainnya", tombol terjemahkan, dan bab yang bisa diketuk. */
function Description({ song, info, loading, pos }: { song: Song; info: VideoInfo | null; loading: boolean; pos: number }) {
  const [open, setOpen] = useState(false);
  const [tr, setTr] = useState<{ title: string; desc: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const chapters = useMemo(() => chaptersOf(info), [info]);
  const curCh = chapters.reduce((a, c, i) => (c.start <= pos ? i : a), -1);
  const translate = async () => {
    if (tr) { setTr(null); return; }
    setBusy(true);
    try {
      const desc = (info?.description || '').split('\n');
      const out = await api.translate([song.title, ...desc]);
      setTr({ title: out[0], desc: out.slice(1).join('\n') });
      setOpen(true);
    } catch (e) {
      toast((e as Error).message || 'Terjemahan gagal');
    } finally { setBusy(false); }
  };
  const stats = [
    info?.likes != null && `${num.format(info.likes)} suka`,
    info?.subscribers != null && `${num.format(info.subscribers)} subscriber`,
    ymd(info?.uploadDate ?? null),
  ].filter(Boolean).join(' • ');
  const desc = tr?.desc ?? info?.description ?? '';
  return (
    <div className="desc-card">
      <div className="desc-head">
        <span className="sub">{loading ? 'Memuat info video…' : stats || 'Info video'}</span>
        <button className={`pill sm ${tr ? 'on' : ''}`} disabled={busy || loading} onClick={() => void translate()}>
          <Languages size={15} />{busy ? 'Menerjemahkan…' : tr ? 'Teks asli' : 'Terjemahkan'}
        </button>
      </div>
      {tr && <div className="desc-tr-title">{tr.title}</div>}
      {desc && (
        <div className={`desc-text ${open ? 'open' : ''}`}><RichText text={desc} /></div>
      )}
      {desc.length > 160 && <button className="desc-more" onClick={() => setOpen(!open)}>{open ? <>Ringkas <ChevronUp size={15} /></> : <>…lainnya <ChevronDown size={15} /></>}</button>}
      {chapters.length > 0 && (
        <div className="chapters">
          <div className="h3">Bab</div>
          <div className="chapter-row">
            {chapters.map((c, i) => (
              <button key={i} className={`chapter ${i === curCh ? 'on' : ''}`} onClick={() => seek(c.start)}>
                <span className="ch-time">{fmtTime(c.start)}</span>
                <span className="ch-title">{c.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SubtitleSheet({ info, onClose }: { info: VideoInfo | null; onClose: () => void }) {
  const st = useSettings();
  const sub = useSubtitles();
  const has = (info?.captions.length ?? 1) > 0;
  const pick = (v: '' | 'id' | 'orig') => { st.set({ subtitleLang: v }); onClose(); };
  return (
    <Sheet onClose={onClose}>
      <div className="dialog">
        <h3><Captions size={18} style={{ verticalAlign: -3 }} /> Subtitle</h3>
        {!has && <div className="sub" style={{ marginBottom: 10 }}>Video ini tidak punya subtitle.</div>}
        <div className="chips" style={{ flexWrap: 'wrap' }}>
          <button className={`chip ${st.subtitleLang === '' ? 'on' : ''}`} onClick={() => pick('')}>Mati</button>
          <button className={`chip ${st.subtitleLang === 'id' ? 'on' : ''}`} disabled={!has} onClick={() => pick('id')}>Indonesia (terjemahan)</button>
          <button className={`chip ${st.subtitleLang === 'orig' ? 'on' : ''}`} disabled={!has} onClick={() => pick('orig')}>Bahasa asli</button>
        </div>
        {sub.name && <div className="sub" style={{ marginTop: 10 }}>Sedang dipakai: {sub.name}</div>}
        <h3 style={{ marginTop: 18 }}>Ukuran teks: {st.subtitleSize}%</h3>
        <input type="range" min={70} max={170} step={10} value={st.subtitleSize} onChange={(e) => st.set({ subtitleSize: Number(e.target.value) })} style={{ width: '100%' }} aria-label="Ukuran subtitle" />
        <div className="sub" style={{ marginTop: 10 }}>Pilihan ini diingat untuk video berikutnya.</div>
      </div>
    </Sheet>
  );
}
