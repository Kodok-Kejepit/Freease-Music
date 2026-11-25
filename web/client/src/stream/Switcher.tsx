// Pindah Freease Musik ⇄ Freease Stream (sidebar laptop & bagian atas beranda HP).
import { Link } from 'react-router-dom';
import { Clapperboard, Music2 } from 'lucide-react';

export function Switcher({ active, top }: { active: 'music' | 'stream'; top?: boolean }) {
  return (
    <div className={`switcher${top ? ' top' : ''}`} role="tablist" aria-label="Pilih Freease">
      <Link to="/music" className={active === 'music' ? 'on' : ''} role="tab" aria-selected={active === 'music'}><Music2 size={15} />Musik</Link>
      <Link to="/stream" className={active === 'stream' ? 'on' : ''} role="tab" aria-selected={active === 'stream'}><Clapperboard size={15} />Stream</Link>
    </div>
  );
}
