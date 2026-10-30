import {
  BookOpen, Bug, Code2, ExternalLink, Github, Globe, HandHeart, MapPin, Music4, Radar, Share2, Smartphone, Star, Terminal,
} from 'lucide-react';
import { toast } from '../lib/toast';

const GITHUB = 'https://github.com/Kodok-Kejepit';

interface Project {
  name: string;
  tag: string;
  desc: string;
  icon: React.ReactNode;
  tone: string;
  stack: string[];
  links: { label: string; href: string; icon: React.ReactNode; primary?: boolean }[];
}

const PROJECTS: Project[] = [
  {
    name: 'Freease',
    tag: 'Android & Web',
    desc: 'Pemutar musik & video tanpa iklan: lirik berjalan, karaoke, asisten suara berbahasa Indonesia, subtitle terjemahan, dan semua data tersimpan di perangkatmu sendiri.',
    icon: <Music4 size={26} />,
    tone: 'linear-gradient(135deg,#2563eb,#7c3aed)',
    stack: ['Kotlin', 'Jetpack Compose', 'React', 'Node.js'],
    links: [
      { label: 'Kode sumber', href: `${GITHUB}/freease-music`, icon: <Github size={16} />, primary: true },
    ],
  },
  {
    name: 'JawaRustGo++',
    tag: 'Bahasa pemrograman',
    desc: 'JRG — bahasa pemrograman dengan pesan galat berbahasa Indonesia, ditulis dengan Rust. Cocok untuk belajar logika pemrograman tanpa terhalang bahasa.',
    icon: <Code2 size={26} />,
    tone: 'linear-gradient(135deg,#ea580c,#e11d48)',
    stack: ['Rust', 'Compiler', 'Dokumentasi'],
    links: [
      { label: 'Dokumentasi JRG', href: 'https://jawarustgoplusplus.web.id', icon: <BookOpen size={16} />, primary: true },
      { label: 'GitHub', href: `${GITHUB}/jrg`, icon: <Github size={16} /> },
    ],
  },
  {
    name: 'Freease OSINT Tool',
    tag: 'Keamanan & recon',
    desc: 'Tool recon & audit attack surface berbasis terminal: recon domain, port scan, deteksi WAF, WHOIS, cek keamanan email, cek kebocoran, metadata, pemeriksa tautan phishing, dan lainnya — dalam satu perintah.',
    icon: <Radar size={26} />,
    tone: 'linear-gradient(135deg,#059669,#0891b2)',
    stack: ['Python', 'CLI', 'OSINT'],
    links: [
      { label: 'Kode sumber', href: `${GITHUB}/freease`, icon: <Terminal size={16} />, primary: true },
    ],
  },
];

const INTERESTS = [
  { t: 'Bahasa pemrograman & sistem', d: 'Membongkar cara kerja compiler, runtime, dan aplikasi.' },
  { t: 'Bisnis & teknologi digital', d: 'Bagaimana produk teknologi dibangun dan bertahan.' },
  { t: 'Analisis data', d: 'Menemukan pola dan cerita di balik angka.' },
  { t: 'Keamanan siber', d: 'Recon dan audit untuk membuat sistem lebih aman.' },
];

/** Halaman profil pembuat Freease (Kodok-Kejepit) + ajakan mendukung proyek lainnya. */
export default function Profile() {
  const share = async () => {
    const url = location.origin;
    try {
      if (navigator.share) await navigator.share({ title: 'Freease', text: 'Musik & video tanpa iklan — coba Freease', url });
      else { await navigator.clipboard.writeText(url); toast('Link Freease disalin'); }
    } catch { /* dibatalkan */ }
  };
  return (
    <div className="page profile">
      <section className="pf-hero">
        <div className="pf-glow" aria-hidden />
        <svg className="pf-wave" viewBox="0 0 600 120" preserveAspectRatio="none" aria-hidden>
          <path d="M0 70 C 60 20, 120 120, 180 70 S 300 20, 360 70 S 480 120, 540 70 S 600 40, 600 40" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M0 85 C 70 45, 140 125, 210 85 S 350 45, 420 85 S 560 125, 600 70" fill="none" stroke="currentColor" strokeWidth="1.2" opacity=".6" />
        </svg>
        <div className="pf-avatar"><img src="/kodok-kejepit.webp" alt="Foto Kodok-Kejepit" width={160} height={160} /></div>
        <div className="pf-id">
          <span className="pf-badge">Pembuat Freease</span>
          <h1>Kodok-Kejepit</h1>
          <p className="pf-tagline">Suka membongkar cara kerja sesuatu — dari software sampai bisnis modern — lalu membangun versinya sendiri. Sebagian besar waktu luangnya habis untuk ngoding.</p>
          <div className="pf-meta"><MapPin size={15} />Bogor, Jawa Barat</div>
          <div className="pf-actions">
            <a className="pf-btn primary" href={GITHUB} target="_blank" rel="noreferrer noopener"><Github size={18} />GitHub</a>
            <a className="pf-btn" href="https://jawarustgoplusplus.web.id" target="_blank" rel="noreferrer noopener"><Globe size={18} />Web JRG</a>
            <button className="pf-btn" onClick={() => void share()}><Share2 size={18} />Bagikan Freease</button>
          </div>
        </div>
      </section>

      <div className="pf-stats">
        <div><b>3</b><span>Proyek terbuka</span></div>
        <div><b>Android · Web · CLI</b><span>Platform</span></div>
        <div><b>Rust · Kotlin · Python · TS</b><span>Bahasa favorit</span></div>
      </div>

      <h2 className="pf-h2">Proyek</h2>
      <div className="pf-projects">
        {PROJECTS.map((p) => (
          <article key={p.name} className="pf-card">
            <div className="pf-card-head">
              <div className="pf-icon" style={{ background: p.tone }}>{p.icon}</div>
              <div>
                <h3>{p.name}</h3>
                <span className="sub">{p.tag}</span>
              </div>
            </div>
            <p>{p.desc}</p>
            <div className="pf-stack">{p.stack.map((s) => <span key={s}>{s}</span>)}</div>
            <div className="pf-links">
              {p.links.map((l) => (
                <a key={l.href + l.label} className={`pf-btn sm ${l.primary ? 'primary' : ''}`} href={l.href} target="_blank" rel="noreferrer noopener">
                  {l.icon}{l.label}<ExternalLink size={13} style={{ opacity: .7 }} />
                </a>
              ))}
            </div>
          </article>
        ))}
      </div>

      <section className="pf-support">
        <div className="pf-support-head"><HandHeart size={26} /><h2>Ayo dukung proyek-proyeknya!</h2></div>
        <p className="sub">Semua proyek ini gratis dan terbuka. Dukunganmu bikin pengembangannya terus jalan:</p>
        <div className="pf-support-grid">
          <a href={GITHUB} target="_blank" rel="noreferrer noopener"><Star size={20} /><b>Beri bintang di GitHub</b><span>Freease, JRG, dan Freease OSINT Tool</span></a>
          <a href="https://jawarustgoplusplus.web.id" target="_blank" rel="noreferrer noopener"><BookOpen size={20} /><b>Coba JRG</b><span>Belajar ngoding dengan pesan galat berbahasa Indonesia</span></a>
          <a href={`${GITHUB}/freease-music/issues`} target="_blank" rel="noreferrer noopener"><Bug size={20} /><b>Laporkan bug & ide</b><span>Lewat GitHub Issues</span></a>
          <button onClick={() => void share()}><Smartphone size={20} /><b>Bagikan Freease</b><span>Ajak teman dengar musik tanpa iklan</span></button>
        </div>
      </section>

      <h2 className="pf-h2">Minat</h2>
      <div className="pf-interests">
        {INTERESTS.map((i) => <div key={i.t}><b>{i.t}</b><span className="sub">{i.d}</span></div>)}
      </div>

      <div className="pf-foot sub">Freease Web · dibuat oleh Kodok-Kejepit di Bogor</div>
    </div>
  );
}
