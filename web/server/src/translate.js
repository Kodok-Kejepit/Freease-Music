// Terjemahan teks (judul, deskripsi, lirik, subtitle) lewat Google Translate publik (tanpa kunci).
// Hasil tidak disimpan di server — browser yang menyimpan terjemahannya.

const MAX_CHUNK = 4000;

async function gtx(text, to) {
  const u = new URL('https://translate.googleapis.com/translate_a/single');
  u.searchParams.set('client', 'gtx');
  u.searchParams.set('sl', 'auto');
  u.searchParams.set('tl', to);
  u.searchParams.set('dt', 't');
  const r = await fetch(u, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({ q: text }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw Object.assign(new Error(`Terjemahan gagal (HTTP ${r.status})`), { status: 503 });
  const j = await r.json();
  return { text: (j?.[0] || []).map((s) => s?.[0] || '').join(''), from: j?.[2] || null };
}

/**
 * Terjemahkan banyak baris sekaligus (urutan & jumlah tetap). Baris digabung dengan baris baru supaya
 * hemat permintaan; kalau jumlah baris hasil tidak cocok, potongan itu diterjemahkan per baris.
 */
export async function translateLines(lines, to = 'id') {
  const clean = lines.map((l) => String(l ?? '').replace(/\s*\n\s*/g, ' ').trim());
  const out = new Array(clean.length).fill('');
  let from = null;
  const chunks = [];
  let cur = [];
  let size = 0;
  clean.forEach((l, i) => {
    if (size + l.length + 1 > MAX_CHUNK && cur.length) { chunks.push(cur); cur = []; size = 0; }
    cur.push(i);
    size += l.length + 1;
  });
  if (cur.length) chunks.push(cur);
  for (const idx of chunks) {
    const src = idx.map((i) => clean[i] || '.');
    const r = await gtx(src.join('\n'), to);
    from = from || r.from;
    const parts = r.text.split('\n');
    if (parts.length === idx.length) idx.forEach((i, k) => { out[i] = clean[i] ? parts[k].trim() : ''; });
    else for (const i of idx) out[i] = clean[i] ? (await gtx(clean[i], to)).text.trim() : '';
  }
  return { lines: out, from };
}
