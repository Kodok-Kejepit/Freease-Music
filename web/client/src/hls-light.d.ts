// hls.js versi ringan (tanpa subtitle/DRM) memakai tipe yang sama dengan paket utamanya.
declare module 'hls.js/dist/hls.light.mjs' {
  import Hls from 'hls.js';
  export default Hls;
}
