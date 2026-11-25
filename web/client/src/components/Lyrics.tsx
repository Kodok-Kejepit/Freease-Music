import { useEffect, useMemo, useRef, useState } from 'react';
import { Languages, Minus, Plus, RotateCcw } from 'lucide-react';
import { api } from '../lib/api';
import * as db from '../lib/db';
import { useSettings } from '../lib/settings';
import { cachedLyrics, lineAt, loadLyrics, parseLrc, setLyricsOffset, useLyricsOffset, type LrcLine, type LyricsData } from '../lib/lyrics';
import type { Song } from '../lib/types';
import { usePosition } from '../lib/hooks';
import { seek, usePlayer } from '../player/player';

export { parseLrc, type LrcLine } from '../lib/lyrics';

/** Lirik lagu: memori → simpanan offline → server. */
export function useLyrics(song: Song | null) {
  const [state, setState] = useState<{ id: string | null; data: LyricsData | null; loading: boolean }>({ id: null, data: null, loading: false });
  useEffect(() => {
    if (!song || song.id.startsWith('file:')) { setState({ id: song?.id ?? null, data: null, loading: false }); return; }
    const id = song.id;
    const hit = cachedLyrics(id);
    if (hit) { setState({ id, data: hit, loading: false }); return; }
    let alive = true;
    setState({ id, data: null, loading: true });
    loadLyrics(song)
      .then((l) => alive && setState({ id, data: l, loading: false }))
      .catch(() => alive && setState({ id, data: null, loading: false }));
    return () => { alive = false; };
  }, [song?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

export function LyricsView({ song, compact }: { song: Song; compact?: boolean }) {
  const { data, loading } = useLyrics(song);
  const karaoke = usePlayer((s) => s.karaoke);
  const lines = useMemo(() => (data?.synced ? parseLrc(data.synced) : []), [data?.synced]);
  const pos = usePosition(200);
  const offset = useLyricsOffset((o) => o.map[song.id] ?? 0);
  const trOn = useSettings((x) => x.lyricsTranslate);
  const setSettings = useSettings((x) => x.set);
  const tr = useLyricsTranslation(song.id, lines, trOn);
  const active = useMemo(() => lineAt(lines, pos - offset), [lines, pos, offset]);
  const box = useRef<HTMLDivElement>(null);
  const userScroll = useRef(0);
  useEffect(() => {
    if (active < 0 || !box.current || Date.now() - userScroll.current < 4000) return;
    const el = box.current.querySelector<HTMLElement>(`[data-i="${active}"]`);
    if (el) box.current.scrollTo({ top: el.offsetTop - box.current.clientHeight * (compact ? 0.3 : 0.38), behavior: 'smooth' });
  }, [active, compact]);

  if (loading) return <div className="lyrics"><div className="spinner" style={{ margin: '30px auto' }} /></div>;
  if (!data || (!data.synced && !data.plain)) return <div className="lyrics"><div className="plain" style={{ color: 'var(--muted)' }}>Lirik belum tersedia untuk lagu ini.</div></div>;
  if (!lines.length) return <div className="lyrics"><div className="plain">{data.plain}</div><div className="sub" style={{ marginTop: 18 }}>Sumber: {data.source}</div></div>;
  return (
    <div
      className={`lyrics ${karaoke ? 'karaoke' : ''}`}
      ref={box}
      onWheel={() => (userScroll.current = Date.now())}
      onTouchMove={() => (userScroll.current = Date.now())}
    >
      {lines.map((l, i) => (
        <p key={i} data-i={i} className={`line ${i === active ? 'on' : i < active ? 'past' : ''}`} onClick={() => { userScroll.current = 0; seek(l.t + offset); }}>
          {l.text && l.text !== '♪' ? l.text : '• • •'}
          {tr.lines?.[i] && <span className="tr">{tr.lines[i]}</span>}
        </p>
      ))}
      <div className="lyr-sync" onClick={(e) => e.stopPropagation()}>
        <button className={`chip ${trOn ? 'on' : ''}`} onClick={() => setSettings({ lyricsTranslate: !trOn })}>
          <Languages size={15} style={{ verticalAlign: -3, marginRight: 6 }} />
          {tr.loading ? 'Menerjemahkan…' : tr.same ? 'Lirik sudah berbahasa Indonesia' : 'Terjemahan Indonesia'}
        </button>
      </div>
      <LyricsSync id={song.id} offset={offset} diff={data.durationDiff ?? 0} source={data.source} />
    </div>
  );
}

/** Geser waktu lirik bila tidak pas (mis. video klip dengan intro). */
function LyricsSync({ id, offset, diff, source }: { id: string; offset: number; diff: number; source: string | null }) {
  const set = (v: number) => setLyricsOffset(id, Math.max(-30, Math.min(60, v)));
  return (
    <div className="lyr-sync" onClick={(e) => e.stopPropagation()}>
      {diff >= 4 && !offset && (
        <button className="chip" onClick={() => set(diff)} title="Video ini lebih panjang dari versi lagunya">
          Lirik terlalu cepat? Geser +{diff} dtk
        </button>
      )}
      <div className="row-c">
        <span className="sub">Waktu lirik</span>
        <button className="icon-btn sm" aria-label="Lirik lebih cepat" onClick={() => set(offset - 0.5)}><Minus size={16} /></button>
        <b style={{ minWidth: 64, textAlign: 'center' }}>{offset > 0 ? '+' : ''}{offset.toFixed(1)} dtk</b>
        <button className="icon-btn sm" aria-label="Lirik lebih lambat" onClick={() => set(offset + 0.5)}><Plus size={16} /></button>
        {offset !== 0 && <button className="icon-btn sm" aria-label="Kembalikan" onClick={() => set(0)}><RotateCcw size={15} /></button>}
      </div>
      <div className="sub">Sumber: {source}</div>
    </div>
  );
}

/**
 * Terjemahan Indonesia untuk baris-baris lirik (sekali per lagu, lalu dari simpanan browser). Bila hasilnya
 * sama dengan aslinya, liriknya memang sudah berbahasa Indonesia → tidak ditampilkan dobel.
 */
function useLyricsTranslation(id: string, lines: LrcLine[], on: boolean) {
  const [st, setSt] = useState<{ id: string; lines: string[] | null; loading: boolean; same: boolean }>({ id: '', lines: null, loading: false, same: false });
  useEffect(() => {
    if (!on || !lines.length) { setSt({ id, lines: null, loading: false, same: false }); return; }
    let alive = true;
    const src = lines.map((l) => (l.text && l.text !== '♪' ? l.text : ''));
    const done = (out: string[]) => {
      const same = out.every((t, i) => !t || t.toLowerCase() === src[i].toLowerCase());
      if (alive) setSt({ id, lines: same ? null : out.map((t, i) => (t && t.toLowerCase() !== src[i].toLowerCase() ? t : '')), loading: false, same });
    };
    setSt({ id, lines: null, loading: true, same: false });
    (async () => {
      const saved = await db.lyricsTranslation(id).catch(() => undefined);
      if (saved && saved.length === src.length) return done(saved);
      try {
        const out = await api.translate(src);
        db.saveLyricsTranslation(id, out).catch(() => {});
        done(out);
      } catch {
        if (alive) setSt({ id, lines: null, loading: false, same: false });
      }
    })();
    return () => { alive = false; };
  }, [id, on, lines]);
  return st.id === id ? st : { lines: null, loading: on, same: false };
}
