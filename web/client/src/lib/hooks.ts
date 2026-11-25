import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { onLibraryChange } from './db';
import { position, usePlayer } from '../player/player';

/** Jalankan [load] dan muat ulang setiap koleksi berubah (suka, playlist, riwayat, unduhan). */
export function useLibrary<T>(load: () => Promise<T>, initial: T, deps: unknown[] = []): T {
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    let alive = true;
    const run = () => load().then((x) => alive && setV(x)).catch(() => {});
    run();
    const off = onLibraryChange(run);
    return () => { alive = false; off(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return v;
}

/** Data dari server: { data, error, loading }; dibatalkan otomatis saat komponen berganti. */
export function useFetch<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const ac = new AbortController();
    setState((s) => ({ data: s.data, error: null, loading: true }));
    load(ac.signal)
      .then((data) => !ac.signal.aborted && setState({ data, error: null, loading: false }))
      .catch((e) => !ac.signal.aborted && setState({ data: null, error: e.message || 'Gagal memuat', loading: false }));
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, retry]);
  return { ...state, retry: () => setRetry((r) => r + 1) };
}

/** Posisi putar (detik), diperbarui ±4×/detik hanya selama ada yang memakai. */
export function usePosition(intervalMs = 250): number {
  const [pos, setPos] = useState(position());
  const playing = usePlayer((s) => s.playing);
  const index = usePlayer((s) => s.index);
  useEffect(() => {
    setPos(position());
    const iv = setInterval(() => setPos(position()), playing ? intervalMs : 1000);
    return () => clearInterval(iv);
  }, [playing, index, intervalMs]);
  return pos;
}

export function useMedia(query: string) {
  const [m, setM] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const h = () => setM(mq.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [query]);
  return m;
}

export function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v);
  const t = useRef<number>();
  useEffect(() => {
    window.clearTimeout(t.current);
    t.current = window.setTimeout(() => setD(v), ms);
    return () => window.clearTimeout(t.current);
  }, [v, ms]);
  return d;
}

/**
 * Daftar yang terus dimuat saat di-scroll: halaman pertama dari [first], berikutnya lewat token `next`.
 * Pasang `sentinel` di bawah daftar — begitu mendekati layar, halaman berikut diambil.
 */
export function useInfinite<T>(first: (signal: AbortSignal) => Promise<{ items: T[]; next: string | null }>, deps: unknown[]) {
  const [st, setSt] = useState<{ items: T[]; next: string | null; loading: boolean; more: boolean; error: string | null; moreError: boolean; expired?: boolean }>(
    { items: [], next: null, loading: true, more: false, error: null, moreError: false },
  );
  const gen = useRef(0);
  const busy = useRef(false);
  const load = useCallback(() => {
    const g = ++gen.current;
    const ac = new AbortController();
    setSt({ items: [], next: null, loading: true, more: false, error: null, moreError: false });
    first(ac.signal)
      .then((r) => g === gen.current && setSt({ items: r.items, next: r.next, loading: false, more: false, error: null, moreError: false }))
      .catch((e) => g === gen.current && !ac.signal.aborted && setSt((x) => ({ ...x, loading: false, error: e?.message || 'Gagal memuat' })));
    return () => ac.abort();
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load]);
  const loadMore = useCallback(async () => {
    const next = st.next;
    if (!next || busy.current) return;
    busy.current = true;
    const g = gen.current;
    setSt((x) => ({ ...x, more: true, moreError: false }));
    try {
      const r = await api.searchMore<T>(next);
      if (g === gen.current) setSt((x) => ({ ...x, items: [...x.items, ...r.items], next: r.next, more: false }));
    } catch (e) {
      // Token kedaluwarsa (tab dibiarkan lama; server hanya mengingat halaman 15 menit) → tawarkan muat ulang.
      const expired = e instanceof ApiError && e.status === 410;
      if (g === gen.current) setSt((x) => ({ ...x, more: false, moreError: !expired, expired, next: expired ? null : x.next }));
    } finally {
      busy.current = false;
    }
  }, [st.next]);
  const sentinel = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) void loadMore(); }, { rootMargin: '900px 0px' });
    io.observe(el);
    // React memanggil ref dengan null saat elemen dilepas; pengamat lama dibersihkan lewat penanda ini.
    (el as HTMLElement & { _io?: IntersectionObserver })._io?.disconnect();
    (el as HTMLElement & { _io?: IntersectionObserver })._io = io;
  }, [loadMore]);
  return { ...st, loadMore, sentinel, retry: load };
}
