// Terjemahan komik di perangkat sendiri: teks di gambar dibaca Tesseract.js (OCR, jalan di browser, tanpa akun &
// tanpa kuota), lalu diterjemahkan ke bahasa Indonesia lewat /api/translate. Hasil per halaman disimpan di memori.

export const OCR_LANGS = [
  { key: 'eng', label: 'Inggris' },
  { key: 'jpn_vert', label: 'Jepang (vertikal)' },
  { key: 'jpn', label: 'Jepang' },
  { key: 'kor', label: 'Korea' },
  { key: 'chi_sim', label: 'China' },
] as const;
export type OcrLang = (typeof OCR_LANGS)[number]['key'];

/** Kotak teks dalam pecahan ukuran gambar (0..1), sudah diterjemahkan. */
export interface Bubble { x: number; y: number; w: number; h: number; text: string }

type TWorker = { recognize: (img: HTMLImageElement, o?: object, out?: object) => Promise<{ data: any }>; terminate: () => Promise<unknown> };
let worker: Promise<TWorker> | null = null;
let workerLang = '';
async function getWorker(lang: OcrLang): Promise<TWorker> {
  if (worker && workerLang === lang) return worker;
  const old = worker;
  workerLang = lang;
  worker = (async () => {
    if (old) void old.then((w) => w.terminate()).catch(() => {});
    const T = await import('tesseract.js');
    return (await T.createWorker(lang, 1)) as unknown as TWorker;
  })();
  worker.catch(() => { worker = null; workerLang = ''; });
  return worker;
}

/** Huruf kapital semua (gaya teks komik) diubah ke kalimat biasa supaya terjemahannya lebih wajar. */
function tidy(input: string) {
  let s = input;
  // Potongan tanpa huruf/angka (garis, kurung, simbol yang terbaca dari gambar) dibuang.
  s = s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w) || /^[.!?…]+$/.test(w)).join(' ').replace(/^[^\p{L}\p{N}"'(]+/u, '');
  const t = s.replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').replace(/-\s+(?=\p{Ll})/gu, '').trim();
  const letters = t.replace(/[^\p{L}]/gu, '');
  if (letters && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) {
    const low = t.toLowerCase().replace(/(^|[.!?]\s+)(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
    return low.replace(/\bi\b/g, 'I');
  }
  return t;
}

interface Line { x0: number; y0: number; x1: number; y1: number; text: string }

/**
 * Baris hasil OCR → balon kata: baris yang meyakinkan (bukan derau gambar) dikumpulkan bila letaknya bertumpuk
 * rapat dan sejajar, seperti teks dalam satu balon.
 */
function groupLines(data: any, W: number, H: number) {
  const lines: Line[] = [];
  for (const b of data.blocks ?? []) for (const p of b.paragraphs ?? []) for (const l of p.lines ?? []) {
    const text = String(l.text ?? '').replace(/\s+/g, ' ').trim();
    const chars = text.replace(/\s/g, '');
    const letters = chars.replace(/[^\p{L}]/gu, '');
    const { x0, y0, x1, y1 } = l.bbox;
    if (Number(l.confidence ?? 0) < 60 || letters.length < 2 || letters.length / Math.max(1, chars.length) < 0.6) continue;
    if (x1 - x0 < 10 || y1 - y0 < 6 || y1 - y0 > H * 0.2) continue;
    lines.push({ x0, y0, x1, y1, text });
  }
  lines.sort((a, b) => a.y0 - b.y0);
  const groups: (Line & { n: number; lh: number })[] = [];
  for (const l of lines) {
    const lh = l.y1 - l.y0;
    const g = groups.find((g) => {
      const overlap = Math.min(g.x1, l.x1) - Math.max(g.x0, l.x0);
      return l.y0 - g.y1 < Math.max(lh, g.lh) * 1.1 && l.y0 >= g.y0 && overlap > Math.min(g.x1 - g.x0, l.x1 - l.x0) * 0.3;
    });
    if (g) {
      g.x0 = Math.min(g.x0, l.x0); g.x1 = Math.max(g.x1, l.x1); g.y1 = Math.max(g.y1, l.y1);
      g.text += ' ' + l.text; g.lh = (g.lh * g.n + lh) / (g.n + 1); g.n++;
    } else groups.push({ ...l, n: 1, lh });
  }
  return groups.map((g) => ({ ...g, text: tidy(g.text) })).filter((g) => g.x1 - g.x0 < W * 0.98);
}

async function translate(lines: string[]): Promise<string[]> {
  if (!lines.length) return [];
  const r = await fetch('/api/translate', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ lines, to: 'id' }) });
  if (!r.ok) throw new Error('Terjemahan gagal');
  return (await r.json()).lines as string[];
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('Gambar gagal dimuat'));
    im.src = src;
  });
}

// Satu halaman diproses sekali-sekali (OCR berat untuk HP), urut sesuai permintaan.
let queue: Promise<unknown> = Promise.resolve();
const done = new Map<string, Promise<Bubble[]>>();

export function translatePage(src: string, lang: OcrLang): Promise<Bubble[]> {
  const key = lang + '|' + src;
  const hit = done.get(key);
  if (hit) return hit;
  const job = queue.then(async () => {
    const img = await loadImage(src);
    const w = await getWorker(lang);
    const { data } = await w.recognize(img, {}, { blocks: true, text: false });
    const W = img.naturalWidth || 1;
    const H = img.naturalHeight || 1;
    const found = groupLines(data, W, H);
    const out = await translate(found.map((p) => p.text));
    return found.map((p, i) => ({
      x: p.x0 / W, y: p.y0 / H, w: (p.x1 - p.x0) / W, h: (p.y1 - p.y0) / H, text: out[i] || p.text,
    })).filter((b) => b.text.trim());
  });
  queue = job.catch(() => {});
  done.set(key, job);
  job.catch(() => done.delete(key));
  return job;
}
