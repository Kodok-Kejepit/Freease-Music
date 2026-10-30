// Karaoke cepat (tanpa AI) dengan Web Audio.
//
// Vokal biasanya ada di tengah (kiri = kanan). Jalur "samping" (L−R) membuangnya, tetapi lagu yang dicampur
// hampir mono — atau yang semua instrumennya juga di tengah — jadi nyaris senyap. Karena itu jalur "tengah"
// ikut dipakai dengan pita vokal (±300 Hz–3 kHz) ditekan kuat: bas, drum, dan simbal tetap terdengar.
// Seberapa banyak masing-masing jalur dipakai diatur otomatis dari perbandingan tenaga samping/tengah.

export interface KaraokeGraph {
  /** Keluaran stereo tanpa vokal. */
  out: GainNode;
  /** Sinyal tengah asli (untuk mengembalikan sebagian vokal). */
  mid: AudioNode;
  /** Perbarui campuran dari tenaga sinyal yang sedang diputar; kembalikan rasio samping/tengah. */
  balance(): number;
}

const VOCAL_CUTS: [number, number, number][] = [
  // [frekuensi Hz, Q, penguatan dB]
  [300, 0.9, -14],
  [1000, 0.7, -22],
  [3000, 0.9, -16],
];

export function buildKaraoke(ctx: BaseAudioContext, input: AudioNode): KaraokeGraph {
  const split = ctx.createChannelSplitter(2);
  input.connect(split);
  const gain = (v: number) => { const g = ctx.createGain(); g.gain.value = v; return g; };

  // tengah = (L+R)/2, samping = (L−R)/2
  const mid = gain(1), side = gain(1);
  const lm = gain(0.5), rm = gain(0.5), ls = gain(0.5), rs = gain(-0.5);
  split.connect(lm, 0); split.connect(rm, 1); split.connect(ls, 0); split.connect(rs, 1);
  lm.connect(mid); rm.connect(mid); ls.connect(side); rs.connect(side);
  mid.channelCount = side.channelCount = 1;
  mid.channelCountMode = side.channelCountMode = 'explicit';

  // Tengah tanpa pita vokal.
  let chain: AudioNode = mid;
  for (const [f, q, db] of VOCAL_CUTS) {
    const b = ctx.createBiquadFilter();
    b.type = 'peaking'; b.frequency.value = f; b.Q.value = q; b.gain.value = db;
    chain.connect(b); chain = b;
  }
  const midLevel = gain(0.8);
  chain.connect(midLevel);

  // Samping tetap stereo: kiri = +samping, kanan = −samping.
  const sideLevel = gain(1.6);
  side.connect(sideLevel);
  const sideInv = gain(-1);
  sideLevel.connect(sideInv);

  const merge = ctx.createChannelMerger(2);
  sideLevel.connect(merge, 0, 0); sideInv.connect(merge, 0, 1);
  midLevel.connect(merge, 0, 0); midLevel.connect(merge, 0, 1);
  const out = gain(1);
  merge.connect(out);

  const am = ctx.createAnalyser(), as = ctx.createAnalyser();
  am.fftSize = as.fftSize = 2048;
  mid.connect(am); side.connect(as);
  const buf = new Float32Array(2048);
  const rms = (a: AnalyserNode) => { a.getFloatTimeDomainData(buf); let s = 0; for (const x of buf) s += x * x; return Math.sqrt(s / buf.length); };

  return {
    out,
    mid,
    balance() {
      const m = rms(am), s = rms(as);
      if (m < 1e-4) return 1;
      const ratio = s / m;
      // Stereo lebar → andalkan samping (vokal bersih hilang); hampir mono → andalkan tengah tanpa pita vokal.
      const sideG = Math.min(3, Math.max(1, (0.7 * m) / Math.max(s, 1e-4)));
      const midG = ratio < 0.12 ? 1.2 : ratio < 0.3 ? 0.9 : 0.6;
      const t = 'currentTime' in ctx ? ctx.currentTime : 0;
      sideLevel.gain.setTargetAtTime(sideG, t, 0.3);
      midLevel.gain.setTargetAtTime(midG, t, 0.3);
      return ratio;
    },
  };
}
