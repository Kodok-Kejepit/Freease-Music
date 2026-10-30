import { createPortal } from 'react-dom';
import { useSettings } from '../lib/settings';
import { useVideo } from '../player/video';
import { useSubtitles } from '../player/subtitles';
import { videoHost } from '../player/player';

/** Subtitle di atas video (di dalam wadah video, jadi ikut tampil saat layar penuh). */
export function SubtitleOverlay() {
  const text = useSubtitles((s) => s.text);
  const on = useSettings((s) => s.subtitleLang !== '');
  const size = useSettings((s) => s.subtitleSize);
  const ready = useVideo((v) => v.active && v.ready);
  if (!on || !ready || !text) return null;
  return createPortal(
    <div className="subtitle" style={{ ['--sub-scale' as string]: size / 100 }}><span>{text}</span></div>,
    videoHost,
  );
}
