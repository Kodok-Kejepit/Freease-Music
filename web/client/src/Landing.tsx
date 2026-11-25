// Halaman pertama freease.cloud: pilih Freease Musik atau Freease Stream.
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Clapperboard, Music2 } from 'lucide-react';
import './stream/stream.css';

export default function Landing() {
  useEffect(() => { document.title = 'Freease'; }, []);
  return (
    <div className="landing">
      <div className="brand-big"><img src="/logo.svg" alt="" />Freease</div>
      <div className="tag">Musik, anime, donghua, dan komik dalam satu tempat, tanpa iklan.</div>
      <div className="choices">
        <Link to="/music" className="choice music">
          <div className="glow" />
          <div className="ico"><Music2 size={30} /></div>
          <h2>Freease Musik</h2>
          <p>Dengarkan lagu & video musik tanpa iklan.</p>
          <div className="feat"><span>Lirik berwaktu</span><span>Karaoke</span><span>Offline</span></div>
          <span className="go"><ArrowRight size={22} /></span>
        </Link>
        <Link to="/stream" className="choice stream">
          <div className="glow" />
          <div className="ico"><Clapperboard size={30} /></div>
          <h2>Freease Stream</h2>
          <p>Nonton anime & donghua, baca manga, manhwa, manhua.</p>
          <div className="feat"><span>Sub Indonesia</span><span>1080p</span><span>Terjemahan komik</span></div>
          <span className="go"><ArrowRight size={22} /></span>
        </Link>
      </div>
      <Link to="/profile" className="foot"><img src="/pp-96.webp" alt="" />Dibuat oleh Kodok-Kejepit</Link>
    </div>
  );
}
