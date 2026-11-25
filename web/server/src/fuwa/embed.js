// Server video yang tidak bisa dibuka jadi berkas langsung, tapi terbukti bisa diputar di dalam iframe ber-sandbox
// (tanpa allow-popups / allow-top-navigation / allow-downloads / allow-forms / allow-modals): jendela iklan,
// pengalihan halaman, dan unduhan otomatis diblokir browser. Host yang menolak sandbox (Vidhide) tidak didaftar.
// Daftar ini juga menjadi frame-src di Content-Security-Policy, jadi host lain tidak bisa dimuat sama sekali.

export const EMBED_HOSTS = [
  { name: 'Abyss', test: /(^|\.)abyssplayer\.com$/, origin: 'https://*.abyssplayer.com' },
  { name: 'Mecdn', test: /(^|\.)mecdn\.website$/, origin: 'https://*.mecdn.website' },
  { name: 'MEGA', test: /^mega\.nz$/, origin: 'https://mega.nz' },
];

export const FRAME_SRC = EMBED_HOSTS.map((h) => h.origin).join(' ');

/** URL embed → sumber `type: 'embed'` (diputar di iframe ber-sandbox), atau [] kalau host-nya tidak diizinkan. */
export function embedSource(url, quality = 'Auto') {
  let u;
  try { u = new URL(String(url ?? '').trim()); } catch { return []; }
  if (u.protocol !== 'https:') return [];
  const h = EMBED_HOSTS.find((x) => x.test.test(u.hostname));
  if (!h) return [];
  if (h.name === 'MEGA' && !/^\/embed\//.test(u.pathname)) return [];
  return [{ label: h.name, quality, type: 'embed', url: u.href }];
}

/** Urutan server: berkas langsung dulu (pemutar Freease sendiri), embed paling akhir; lalu kualitas tertinggi. */
export function sortSources(list) {
  const h = (q) => Number(String(q).match(/\d+/)?.[0]) || 0;
  return list.sort((a, b) => Number(a.type === 'embed') - Number(b.type === 'embed') || h(b.quality) - h(a.quality));
}
