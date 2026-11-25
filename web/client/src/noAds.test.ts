import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Penjaga: Freease harus 100% tanpa iklan. Player YouTube resmi bisa menayangkan iklan, jadi tidak boleh dipakai;
// begitu juga skrip jaringan iklan. Iframe hanya untuk pemutar cadangan dan wajib memakai sandbox SANDBOX.
const FORBIDDEN = [
  /youtube(-nocookie)?\.com\/(embed|iframe_api|player_api)/i,
  // Iframe cuma boleh ber-sandbox yang mengunci pop-up, pengalihan halaman, unduhan, formulir & dialog.
  /<iframe(?![^\n]*sandbox=\{SANDBOX\})/i,
  /SANDBOX = ['"][^'"]*allow-(popups|top-navigation|downloads|forms|modals|pointer-lock|storage-access)/i,
  /sandbox=["']/i,
  /createElement\(\s*['"]iframe['"]/i,
  /doubleclick\.net|googlesyndication|adsbygoogle|googleadservices|googletagservices|google_ad|adservice\.google/i,
  /\bima3\.js\b|imasdk|\bvast\b.*\bxml\b/i,
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (f === 'node_modules' || f === 'dist') return [];
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|jsx?|mjs|css|html)$/.test(f) && !/\.test\.[tj]s$/.test(f) ? [p] : [];
  });
}

describe('100% tanpa iklan', () => {
  it('tidak ada player YouTube resmi, iframe, atau skrip iklan', () => {
    const bad: string[] = [];
    for (const f of [...files('src'), 'index.html', 'vite.config.ts', ...files('../server/src')]) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        for (const re of FORBIDDEN) if (re.test(line)) bad.push(`${f}:${i + 1} ${line.trim().slice(0, 100)}`);
      });
    }
    expect(bad).toEqual([]);
  });

  it('sandbox iframe benar-benar dipakai & tidak melonggarkan pop-up/unduhan', () => {
    const w = readFileSync('src/stream/pages/Watch.tsx', 'utf8');
    const v = w.match(/const SANDBOX = '([^']*)'/)?.[1] ?? '';
    expect(v.split(/\s+/).sort()).toEqual(['allow-presentation', 'allow-same-origin', 'allow-scripts']);
    expect((w.match(/<iframe/g) ?? []).length).toBe((w.match(/<iframe[^>]*sandbox=\{SANDBOX\}/g) ?? []).length);
  });
});
