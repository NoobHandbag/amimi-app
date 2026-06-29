// Elegant, dependency-free toast: slides up from the bottom, auto-dismisses, color-coded.
export function toast(message: string, type: 'ok' | 'err' = 'ok') {
  let host = document.getElementById('toast-host');
  if (!host) { host = document.createElement('div'); host.id = 'toast-host'; document.body.appendChild(host); }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = (type === 'ok' ? '✓  ' : '✕  ') + message;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const ttl = type === 'err' ? 4500 : 2600;
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, ttl);
}
