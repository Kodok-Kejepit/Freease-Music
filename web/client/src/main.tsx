import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './styles.css';

// Versi baru di server langsung dipakai: cek saat aplikasi dibuka lagi dan tiap 30 menit.
registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) {
    if (!reg) return;
    setInterval(() => void reg.update(), 30 * 60_000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) void reg.update(); });
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
