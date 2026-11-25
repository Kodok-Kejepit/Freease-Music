import { useLayoutEffect, useRef } from 'react';

/**
 * Elemen video (audio/video lokal atau player YouTube) tidak dipindah-pindah di DOM — iframe akan
 * dimuat ulang kalau dipindah. Komponen ini hanya menjadi "tempat": host video ditempatkan tepat di atasnya.
 */
export function VideoSlot({ host, className, style }: { host: HTMLElement; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    let raf = 0;
    const place = () => {
      const r = el.getBoundingClientRect();
      Object.assign(host.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    };
    host.classList.add('placed');
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    const loop = () => { place(); raf = requestAnimationFrame(loop); };
    // Ikuti animasi/scroll sebentar setelah muncul.
    raf = requestAnimationFrame(loop);
    const stop = setTimeout(() => cancelAnimationFrame(raf), 600);
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      clearTimeout(stop);
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
      host.classList.remove('placed');
      host.removeAttribute('style');
    };
  }, [host]);
  return <div ref={ref} className={className} style={{ background: '#000', ...style }} />;
}
