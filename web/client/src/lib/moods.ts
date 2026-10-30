export const MOODS = [
  { title: 'Pop Indonesia', query: 'lagu pop indonesia terbaru', color: '#E13300' },
  { title: 'Galau', query: 'lagu galau indonesia', color: '#4B3FB8' },
  { title: 'Santai', query: 'lagu santai indonesia chill akustik', color: '#148A08' },
  { title: 'Lo-fi', query: 'lofi hip hop beats', color: '#7358FF' },
  { title: 'Workout', query: 'lagu semangat workout', color: '#E8115B' },
  { title: 'Fokus', query: 'lagu fokus belajar lofi instrumental', color: '#1E3264' },
  { title: 'Tidur', query: 'musik tidur relaksasi tenang', color: '#27856A' },
  { title: 'K-Pop', query: 'kpop hits', color: '#DC148C' },
  { title: 'Dangdut', query: 'dangdut koplo terbaru', color: '#BA5D07' },
  { title: 'Rock', query: 'rock indonesia legendaris', color: '#8D67AB' },
  { title: 'Jazz', query: 'jazz playlist', color: '#477D95' },
  { title: 'Hip-Hop', query: 'hip hop hits', color: '#BC5900' },
  { title: 'Akustik', query: 'acoustic cover songs', color: '#8C1932' },
  { title: 'Indie', query: 'indie indonesia', color: '#056952' },
  { title: 'Religi', query: 'lagu religi islami', color: '#509BF5' },
  { title: '90-an & 2000-an', query: 'lagu indonesia 2000an', color: '#AF2896' },
  { title: 'EDM', query: 'edm hits', color: '#0D73EC' },
  { title: 'Anime', query: 'anime songs opening', color: '#E91429' },
  { title: 'Romantis', query: 'lagu romantis indonesia', color: '#F037A5' },
];

export function greeting() {
  const h = new Date().getHours();
  if (h < 4) return 'Selamat malam';
  if (h < 11) return 'Selamat pagi';
  if (h < 15) return 'Selamat siang';
  if (h < 19) return 'Selamat sore';
  return 'Selamat malam';
}
