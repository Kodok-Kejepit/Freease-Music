import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Minimize, RotateCcw, RotateCw, SkipBack, SkipForward } from 'lucide-react';
import { usePosition } from '../lib/hooks';
import { next, position, prev, seek, usePlayer, videoHost } from '../player/player';
import { PlayPause, Seekbar } from './ui';

/**
 * Kontrol di atas video saat layar penuh (wadah video kita tidak punya kontrol bawaan). Ketuk layar untuk
 * memunculkan/menyembunyikan; hilang sendiri setelah 3 detik saat video berjalan. Ketuk dua kali sisi
 * kiri/kanan = mundur/maju 10 detik, seperti YouTube.
 */
export function FullscreenControls() {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const h = () => setActive(document.fullscreenElement === videoHost);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);
  if (!active) return null;
  return createPortal(<Overlay />, videoHost);
}

function Overlay() {
  const song = usePlayer((s) => s.queue[s.index]);
  const playing = usePlayer((s) => s.playing);
  const duration = usePlayer((s) => s.duration);
  const pos = usePosition(250);
  const [shown, setShown] = useState(true);
  const timer = useRef(0);
  const lastTap = useRef(0);
  const poke = () => {
    setShown(true);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setShown(false), 3000);
  };
  useEffect(() => { poke(); return () => clearTimeout(timer.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!playing) { clearTimeout(timer.current); setShown(true); } else poke(); }, [playing]); // eslint-disable-line react-hooks/exhaustive-deps

  const onTap = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const now = Date.now();
    const x = e.clientX / e.currentTarget.clientWidth;
    if (now - lastTap.current < 300 && (x < 0.35 || x > 0.65)) {
      seek(position() + (x < 0.35 ? -10 : 10));
      lastTap.current = 0;
      poke();
      return;
    }
    lastTap.current = now;
    if (shown) { setShown(false); clearTimeout(timer.current); } else poke();
  };

  return (
    <div className={`fs-ui ${shown ? 'show' : ''}`} onClick={onTap} onDoubleClick={(e) => e.stopPropagation()} onMouseMove={poke}>
      <div className="fs-top">
        <div className="fs-title ellipsis">{song?.title}</div>
        <button className="icon-btn" aria-label="Keluar layar penuh" onClick={() => void document.exitFullscreen()}><Minimize size={22} /></button>
      </div>
      <div className="fs-center">
        <button className="icon-btn" aria-label="Sebelumnya" onClick={() => { prev(); poke(); }}><SkipBack size={28} fill="currentColor" /></button>
        <button className="icon-btn" aria-label="Mundur 10 detik" onClick={() => { seek(position() - 10); poke(); }}><RotateCcw size={28} /></button>
        <PlayPause big />
        <button className="icon-btn" aria-label="Maju 10 detik" onClick={() => { seek(position() + 10); poke(); }}><RotateCw size={28} /></button>
        <button className="icon-btn" aria-label="Berikutnya" onClick={() => { void next(); poke(); }}><SkipForward size={28} fill="currentColor" /></button>
      </div>
      <div className="fs-bottom" onClick={poke}>
        <Seekbar pos={pos} duration={duration} onSeek={(t) => { seek(t); poke(); }} />
      </div>
    </div>
  );
}
