// Line icons (stroke, currentColor) — GEEIQ redesign: le emoji sono state sostituite
// da icone a linea (stroke ~1.9) che ereditano il colore dal contenitore (tinta 700 su
// tile tint). Stessa API {name,size} di prima: sostituzione globale in tutta l'app.
// Nome sconosciuto -> cerchio neutro (mai testo grezzo nella UI).

import type { ReactNode } from 'react';

const P: Record<string, ReactNode> = {
  home: <><path d="M3 11l9-8 9 8" /><path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10" /></>,
  plus: <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>,
  box: <><path d="M4 8l8-4 8 4-8 4-8-4z" /><path d="M4 8v8l8 4 8-4V8" /><line x1="12" y1="12" x2="12" y2="20" /></>,
  inbox: <><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5 5h14l3 7v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-6z" /></>,
  chart: <><line x1="5" y1="20" x2="5" y2="11" /><line x1="10.5" y1="20" x2="10.5" y2="4" /><line x1="16" y1="20" x2="16" y2="14" /><line x1="21" y1="20" x2="21" y2="8" /></>,
  bag: <><path d="M6 8h12l-1 11H7L6 8z" /><path d="M9 8a3 3 0 0 1 6 0" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><line x1="3" y1="12" x2="21" y2="12" /><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z" /></>,
  recycle: <><polyline points="21 4 21 10 15 10" /><polyline points="3 20 3 14 9 14" /><path d="M4 10a8 8 0 0 1 13-3l4 3M20 14a8 8 0 0 1-13 3l-4-3" /></>,
  sparkles: <><path d="M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3z" /><path d="M5 15l.8 2 2 .8-2 .8L5 22l-.8-2.4L2 18.8l2.2-.8z" /></>,
  rocket: <><path d="M5 13c-1.6.5-3 2.4-3 6 3.6 0 5.5-1.4 6-3" /><path d="M12 15l-3-3a12 12 0 0 1 6-9c3 0 5 2 5 5a12 12 0 0 1-9 6z" /><circle cx="15" cy="9" r="1.2" /></>,
  count: <><rect x="4" y="4" width="16" height="16" rx="2" /><line x1="8" y1="9" x2="16" y2="9" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></>,
  return: <><polyline points="9 7 4 12 9 17" /><path d="M4 12h11a5 5 0 0 1 5 5v1" /></>,
  gift: <><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M12 8v13" /><path d="M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8" /><path d="M12 8C12 5.5 10.5 4 9 4.5S8 8 12 8zM12 8c0-2.5 1.5-4 3-3.5S16 8 12 8z" /></>,
  store: <><path d="M4 9l1.2-5h13.6L20 9" /><path d="M4 9a2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0" /><path d="M5 11v9h14v-9" /></>,
  handshake: <><path d="M11 7 8.4 9.6a2 2 0 0 0 2.8 2.8l.8-.8 2.8 2.8a2 2 0 0 0 2.8-2.8L14 5.9a2 2 0 0 0-2.8 0z" /><path d="M8 6 4 8v5M20 13v-5l-3-1.5" /></>,
  tag: <><path d="M20 12l-8 8-9-9V4h7z" /><circle cx="7.5" cy="7.5" r="1.3" /></>,
  euro: <><path d="M17 6a7 7 0 1 0 0 12" /><line x1="4" y1="10" x2="13" y2="10" /><line x1="4" y1="14" x2="12" y2="14" /></>,
  table: <><rect x="4" y="4" width="16" height="16" rx="2" /><line x1="4" y1="10" x2="20" y2="10" /><line x1="10" y1="10" x2="10" y2="20" /></>,
  search: <><circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" /></>,
  pulse: <><polyline points="3 13 8 13 11 6 14 18 17 12 21 12" /></>,
  chat: <><path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 4V6a1 1 0 0 1 1-1z" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M4 7l8 6 8-6" /></>,
  trash: <><polyline points="3 6 5 6 21 6" /><path d="M8 6V4h8v2m-9 0v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6" /></>,
  check: <><polyline points="4 12 10 18 20 6" /></>,
};

export default function Icon({ name, size = 24 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      {P[name] ?? <circle cx="12" cy="12" r="8" />}
    </svg>
  );
}
