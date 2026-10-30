import { useRef, useState } from 'react';
import { GripVertical, X } from 'lucide-react';
import { art } from '../lib/api';
import { clearUpcoming, move, removeAt, skipTo, usePlayer } from '../player/player';
import { Artwork, PlayingBars } from './ui';

/** Antrean: seret ≡ untuk mengurutkan (mouse & sentuh), × untuk menghapus. */
export function QueueList() {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const playing = usePlayer((s) => s.playing);
  const from = usePlayer((s) => s.from);
  const [drag, setDrag] = useState<{ i: number; y: number; dy: number } | null>(null);
  const rowH = 60;
  const dragRef = useRef(drag);
  dragRef.current = drag;

  if (!queue.length) return <div className="empty">Antrean kosong</div>;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px 8px' }}>
        <div className="sub">{from ? `Diputar dari ${from}` : `${queue.length} lagu`}</div>
        <button className="btn sm outline" onClick={clearUpcoming}>Bersihkan</button>
      </div>
      {queue.map((s, i) => {
        const cur = i === index;
        const d = drag?.i === i ? drag : null;
        return (
          <div key={`${s.id}-${i}`}>
            {i === index + 1 && <div className="sub" style={{ padding: '10px 10px 4px', fontWeight: 700 }}>Berikutnya</div>}
            <div
              className={`song-row ${cur ? 'playing' : ''}`}
              style={{ gridTemplateColumns: 'auto 1fr auto auto', opacity: i < index ? 0.5 : 1, transform: d ? `translateY(${d.dy}px)` : undefined, position: 'relative', zIndex: d ? 2 : 0, background: d ? 'var(--card-hover)' : undefined, height: rowH }}
              onClick={() => skipTo(i)}
            >
              <div style={{ position: 'relative' }}>
                <Artwork src={art(s)} />
                {cur && <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6 }}><PlayingBars paused={!playing} /></div>}
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="title ellipsis">{s.title}</div>
                <div className="sub ellipsis">{s.artist}</div>
              </div>
              {!cur ? (
                <button className="icon-btn sm" aria-label="Hapus dari antrean" onClick={(e) => { e.stopPropagation(); removeAt(i); }}><X size={16} /></button>
              ) : <span />}
              {!cur ? (
                <div
                  className="icon-btn sm"
                  style={{ cursor: 'grab', touchAction: 'none' }}
                  aria-label="Seret untuk mengurutkan"
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => { e.stopPropagation(); (e.target as HTMLElement).setPointerCapture(e.pointerId); setDrag({ i, y: e.clientY, dy: 0 }); }}
                  onPointerMove={(e) => {
                    const cur0 = dragRef.current;
                    if (!cur0) return;
                    let dy = e.clientY - cur0.y;
                    let at = cur0.i;
                    if (dy > rowH * 0.6 && at < queue.length - 1 && at + 1 !== index) { move(at, at + 1); at++; dy -= rowH; }
                    else if (dy < -rowH * 0.6 && at > 0 && at - 1 !== index) { move(at, at - 1); at--; dy += rowH; }
                    setDrag({ i: at, y: e.clientY - dy, dy });
                  }}
                  onPointerUp={() => setDrag(null)}
                  onPointerCancel={() => setDrag(null)}
                >
                  <GripVertical size={18} />
                </div>
              ) : <span />}
            </div>
          </div>
        );
      })}
    </div>
  );
}
