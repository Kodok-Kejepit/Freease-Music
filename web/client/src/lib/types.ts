/** Satu lagu. `id` = id video YouTube, atau "file:<nama>" untuk berkas dari perangkat. */
export interface Song {
  id: string;
  title: string;
  artist: string;
  artistId?: string | null;
  album?: string | null;
  duration: number;
  thumbnail?: string | null;
  /** Hanya dari pencarian video YouTube: "1,2 jt x ditonton", "3 hari yang lalu", siaran langsung. */
  views?: string | null;
  published?: string | null;
  live?: boolean;
  /** Diputar dari mode YouTube → layar tonton ala YouTube (video di atas, berikutnya di bawah). */
  yt?: boolean;
}

export interface PlaylistItem {
  id: string;
  title: string;
  subtitle?: string;
  thumbnail?: string | null;
  album?: boolean;
}

export interface ArtistItem {
  id: string;
  name: string;
  thumbnail?: string | null;
  subscribers?: string;
}

export interface LocalPlaylist {
  id: string;
  name: string;
  description: string;
  folder: string;
  pinned: boolean;
  songs: Song[];
  createdAt: number;
  updatedAt: number;
}

export interface PlayEvent {
  id?: number;
  songId: string;
  timestamp: number;
  playedMs: number;
}

export const isLocalFile = (id: string) => id.startsWith('file:');
