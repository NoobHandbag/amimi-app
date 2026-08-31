// Icone a linea del Design System Amimì v2 (DESIGN.md §5.10).
// viewBox 24, stroke 1.75, currentColor, fill none, linecap/linejoin round: ereditano
// il colore dal contenitore, quindi la stessa icona funziona su tile brand, positive,
// negative o warning senza varianti.
//
// Questo file e' anche il rimpiazzo delle emoji: l'interfaccia non ne contiene piu'
// nessuna (DESIGN.md §1.6 e §6). Chi aggiunge un pittogramma aggiunge una voce qui.
// Nome sconosciuto -> cerchio neutro, mai testo grezzo nella UI.

import type { ReactNode } from 'react';

const P: Record<string, ReactNode> = {
  // --- navigazione e struttura ---
  home: <><path d="M3 11l9-8 9 8" /><path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10" /></>,
  plus: <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>,
  minus: <><line x1="5" y1="12" x2="19" y2="12" /></>,
  x: <><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></>,
  'chevron-right': <><polyline points="9 5 16 12 9 19" /></>,
  'chevron-left': <><polyline points="15 5 8 12 15 19" /></>,
  'chevron-down': <><polyline points="5 9 12 16 19 9" /></>,
  'chevron-up': <><polyline points="5 15 12 8 19 15" /></>,
  'arrow-left': <><line x1="20" y1="12" x2="4" y2="12" /><polyline points="10 6 4 12 10 18" /></>,
  'arrow-right': <><line x1="4" y1="12" x2="20" y2="12" /><polyline points="14 6 20 12 14 18" /></>,
  'arrow-up': <><line x1="12" y1="20" x2="12" y2="4" /><polyline points="6 10 12 4 18 10" /></>,
  'arrow-down': <><line x1="12" y1="4" x2="12" y2="20" /><polyline points="6 14 12 20 18 14" /></>,
  external: <><path d="M14 4h6v6" /><line x1="20" y1="4" x2="11" y2="13" /><path d="M19 14v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>,
  table: <><rect x="4" y="4" width="16" height="16" rx="2" /><line x1="4" y1="10" x2="20" y2="10" /><line x1="10" y1="10" x2="10" y2="20" /></>,
  search: <><circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" /></>,
  filter: <><path d="M4 5h16l-6 7v6l-4 2v-8z" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></>,
  'more-horizontal': <><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></>,

  // --- esito e stato ---
  check: <><polyline points="4 12 10 18 20 6" /></>,
  'check-circle': <><circle cx="12" cy="12" r="9" /><polyline points="8 12.5 11 15.5 16 9" /></>,
  'x-circle': <><circle cx="12" cy="12" r="9" /><line x1="9" y1="9" x2="15" y2="15" /><line x1="15" y1="9" x2="9" y2="15" /></>,
  alert: <><path d="M12 4.5 2.8 20h18.4z" /><line x1="12" y1="10" x2="12" y2="14.5" /><circle cx="12" cy="17.4" r=".6" /></>,
  info: <><circle cx="12" cy="12" r="9" /><line x1="12" y1="11" x2="12" y2="16.5" /><circle cx="12" cy="7.8" r=".6" /></>,
  ban: <><circle cx="12" cy="12" r="9" /><line x1="5.6" y1="18.4" x2="18.4" y2="5.6" /></>,
  shield: <><path d="M12 3l8 3v6c0 4.4-3.2 8-8 9-4.8-1-8-4.6-8-9V6z" /><polyline points="9 12 11 14 15 9.5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" /></>,
  hourglass: <><path d="M7 3h10M7 21h10" /><path d="M8 3v3.5c0 2 4 3.6 4 5.5s-4 3.5-4 5.5V21" /><path d="M16 3v3.5c0 2-4 3.6-4 5.5s4 3.5 4 5.5V21" /></>,
  flag: <><line x1="5" y1="21" x2="5" y2="3" /><path d="M5 4h11l-2 3.5L16 11H5z" /></>,
  bell: <><path d="M18 15V10a6 6 0 1 0-12 0v5l-1.5 3h15z" /><path d="M10 21h4" /></>,
  'bell-off': <><path d="M9 4.6A6 6 0 0 1 18 10v5l1.5 3H8" /><path d="M6 8.6V10v5l-1.5 3H14" /><line x1="4" y1="3.5" x2="20" y2="20.5" /><path d="M10 21h4" /></>,
  pulse: <><polyline points="3 13 8 13 11 6 14 18 17 12 21 12" /></>,

  // --- merce e magazzino ---
  box: <><path d="M4 8l8-4 8 4-8 4-8-4z" /><path d="M4 8v8l8 4 8-4V8" /><line x1="12" y1="12" x2="12" y2="20" /></>,
  bag: <><path d="M6 8h12l-1 11H7L6 8z" /><path d="M9 8a3 3 0 0 1 6 0" /></>,
  inbox: <><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5 5h14l3 7v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-6z" /></>,
  truck: <><path d="M3 7h10v9H3z" /><path d="M13 10h4l3 3v3h-7" /><circle cx="7" cy="18.5" r="1.8" /><circle cx="17" cy="18.5" r="1.8" /></>,
  store: <><path d="M4 9l1.2-5h13.6L20 9" /><path d="M4 9a2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0" /><path d="M5 11v9h14v-9" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><line x1="3" y1="12" x2="21" y2="12" /><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z" /></>,
  archive: <><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" /><line x1="10" y1="12" x2="14" y2="12" /></>,
  count: <><rect x="4" y="4" width="16" height="16" rx="2" /><line x1="8" y1="9" x2="16" y2="9" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></>,
  calculator: <><rect x="5" y="3" width="14" height="18" rx="2" /><line x1="8" y1="7.5" x2="16" y2="7.5" /><line x1="8.5" y1="12" x2="8.6" y2="12" /><line x1="12" y1="12" x2="12.1" y2="12" /><line x1="15.5" y1="12" x2="15.6" y2="12" /><line x1="8.5" y1="16.5" x2="8.6" y2="16.5" /><line x1="12" y1="16.5" x2="12.1" y2="16.5" /><line x1="15.5" y1="16.5" x2="15.6" y2="16.5" /></>,
  swap: <><polyline points="7 4 3 8 7 12" /><line x1="3" y1="8" x2="16" y2="8" /><polyline points="17 12 21 16 17 20" /><line x1="21" y1="16" x2="8" y2="16" /></>,
  refresh: <><path d="M20 11a8 8 0 0 0-13.7-5L3 9" /><polyline points="3 4 3 9 8 9" /><path d="M4 13a8 8 0 0 0 13.7 5L21 15" /><polyline points="21 20 21 15 16 15" /></>,
  recycle: <><polyline points="21 4 21 10 15 10" /><polyline points="3 20 3 14 9 14" /><path d="M4 10a8 8 0 0 1 13-3l4 3M20 14a8 8 0 0 1-13 3l-4-3" /></>,
  return: <><polyline points="9 7 4 12 9 17" /><path d="M4 12h11a5 5 0 0 1 5 5v1" /></>,
  undo: <><polyline points="8 7 3 12 8 17" /><path d="M3 12h11a6 6 0 0 1 0 12h-3" /></>,
  gift: <><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M12 8v13" /><path d="M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8" /><path d="M12 8C12 5.5 10.5 4 9 4.5S8 8 12 8zM12 8c0-2.5 1.5-4 3-3.5S16 8 12 8z" /></>,
  tag: <><path d="M20 12l-8 8-9-9V4h7z" /><circle cx="7.5" cy="7.5" r="1.3" /></>,
  wrench: <><path d="M15.5 3a5.5 5.5 0 0 0-5 7.6L3 18v3h3l7.4-7.5A5.5 5.5 0 1 0 15.5 3z" /><circle cx="16.5" cy="7.5" r="1.2" /></>,
  broom: <><line x1="19" y1="5" x2="11" y2="13" /><path d="M11 11l3 3-5 6H4l3-6z" /></>,
  camera: <><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13" r="3.4" /></>,

  // --- soldi e commerciale ---
  euro: <><path d="M17 6a7 7 0 1 0 0 12" /><line x1="4" y1="10" x2="13" y2="10" /><line x1="4" y1="14" x2="12" y2="14" /></>,
  chart: <><line x1="5" y1="20" x2="5" y2="11" /><line x1="10.5" y1="20" x2="10.5" y2="4" /><line x1="16" y1="20" x2="16" y2="14" /><line x1="21" y1="20" x2="21" y2="8" /></>,
  percent: <><line x1="19" y1="5" x2="5" y2="19" /><circle cx="7.5" cy="7.5" r="2.5" /><circle cx="16.5" cy="16.5" r="2.5" /></>,
  card: <><rect x="2.5" y="5" width="19" height="14" rx="2" /><line x1="2.5" y1="10" x2="21.5" y2="10" /><line x1="6" y1="15" x2="10" y2="15" /></>,
  handshake: <><path d="M11 7 8.4 9.6a2 2 0 0 0 2.8 2.8l.8-.8 2.8 2.8a2 2 0 0 0 2.8-2.8L14 5.9a2 2 0 0 0-2.8 0z" /><path d="M8 6 4 8v5M20 13v-5l-3-1.5" /></>,
  megaphone: <><path d="M4 10v4a1 1 0 0 0 1 1h3l8 4V5L8 9H5a1 1 0 0 0-1 1z" /><path d="M19 9.5a3.5 3.5 0 0 1 0 5" /></>,
  ring: <><circle cx="12" cy="14.5" r="5.5" /><path d="M9 8.5 10.5 4h3L15 8.5" /></>,

  // --- persone e comunicazione ---
  chat: <><path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 4V6a1 1 0 0 1 1-1z" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M4 7l8 6 8-6" /></>,
  pencil: <><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z" /><line x1="14.5" y1="5.5" x2="18.5" y2="9.5" /></>,
  note: <><path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><polyline points="15 3 15 7 19 7" /><line x1="8.5" y1="12" x2="15.5" y2="12" /><line x1="8.5" y1="16" x2="13" y2="16" /></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M15 6V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h1" /></>,
  send: <><path d="M21 3 10.5 13.5" /><path d="M21 3l-7 18-3.5-7.5L3 10z" /></>,
  hand: <><path d="M9 11V4.8a1.4 1.4 0 0 1 2.8 0V11" /><path d="M11.8 10.5V3.8a1.4 1.4 0 0 1 2.8 0v6.7" /><path d="M14.6 11V5.8a1.4 1.4 0 0 1 2.8 0V14a7 7 0 0 1-7 7 6 6 0 0 1-4.4-1.9L3 15.5a1.5 1.5 0 0 1 2.2-2L9 17" /></>,
  wave: <><path d="M12 21a7 7 0 0 0 7-7V7.6a1.3 1.3 0 0 0-2.6 0V11" /><path d="M16.4 10.6V5.4a1.3 1.3 0 0 0-2.6 0v5" /><path d="M13.8 10.2V4.3a1.3 1.3 0 0 0-2.6 0v6" /><path d="M11.2 10.6V6.8a1.3 1.3 0 0 0-2.6 0V14l-2-2.2a1.4 1.4 0 0 0-2 2L8.6 19" /></>,
  pin: <><path d="M12 21s7-6.4 7-11a7 7 0 1 0-14 0c0 4.6 7 11 7 11z" /><circle cx="12" cy="10" r="2.6" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="16" rx="2" /><line x1="3.5" y1="10" x2="20.5" y2="10" /><line x1="8" y1="3" x2="8" y2="6.5" /><line x1="16" y1="3" x2="16" y2="6.5" /></>,
  trash: <><polyline points="3 6 5 6 21 6" /><path d="M8 6V4h8v2m-9 0v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6" /></>,
  sparkles: <><path d="M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3z" /><path d="M5 15l.8 2 2 .8-2 .8L5 22l-.8-2.4L2 18.8l2.2-.8z" /></>,
  bulb: <><path d="M9.2 17a6 6 0 1 1 5.6 0v2.2a1 1 0 0 1-1 1h-3.6a1 1 0 0 1-1-1z" /><line x1="10" y1="21.5" x2="14" y2="21.5" /></>,
  rocket: <><path d="M5 13c-1.6.5-3 2.4-3 6 3.6 0 5.5-1.4 6-3" /><path d="M12 15l-3-3a12 12 0 0 1 6-9c3 0 5 2 5 5a12 12 0 0 1-9 6z" /><circle cx="15" cy="9" r="1.2" /></>,
  dot: <><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" /></>,
  circle: <><circle cx="12" cy="12" r="4.5" /></>,
};

export default function Icon({ name, size = 24 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={{ display: 'inline-block', verticalAlign: 'middle', flex: 'none' }}>
      {P[name] ?? <circle cx="12" cy="12" r="8" />}
    </svg>
  );
}
