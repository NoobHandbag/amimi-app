// Coherent line-icon set (one stroke path per icon, currentColor) — replaces mismatched emojis
// in nav + tiles so the icon language is uniform and on-brand. Unknown names fall back to text
// (so any not-yet-migrated emoji still renders).
const PATHS: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5 M5 9.5V20h14V9.5 M10 20v-5.5h4V20',
  plus: 'M12 5v14 M5 12h14',
  box: 'M12 3 3 7.5v9L12 21l9-4.5v-9z M3 7.5 12 12l9-4.5 M12 12v9',
  chart: 'M4 20h16 M7.5 20v-5 M12 20V8 M16.5 20v-8',
  bag: 'M5.5 8h13l-1 11a1 1 0 0 1-1 1H7.5a1 1 0 0 1-1-1z M9 8V6.5a3 3 0 0 1 6 0V8',
  recycle: 'M4 12a8 8 0 0 1 13.7-5.7L20 8 M20 4.5V8.5h-4 M20 12a8 8 0 0 1-13.7 5.7L4 16 M4 19.5V15.5h4',
  sparkles: 'M12 3.5l1.7 4.3 4.3 1.7-4.3 1.7L12 15.5l-1.7-4.3L6 9.5l4.3-1.7z M18.5 14l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z',
  rocket: 'M12 3c2.5 2 4 5 4 8 0 1.7-.5 3.3-1.4 4.6H9.4C8.5 14.3 8 12.7 8 11c0-3 1.5-6 4-8z M9.4 15.6 7 18 M14.6 15.6 17 18 M10.5 19l1.5 2 1.5-2 M12 9.4a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6',
  count: 'M5 5.5A1.5 1.5 0 0 1 6.5 4H9 M15 4h2.5A1.5 1.5 0 0 1 19 5.5V19.5A1.5 1.5 0 0 1 17.5 21h-11A1.5 1.5 0 0 1 5 19.5z M9 3.5h6v3H9z M9 11h6 M9 15h6',
  return: 'M9 14 4 9.5 9 5 M4 9.5h10.5a5 5 0 0 1 5 5v.5a5 5 0 0 1-5 5H9',
  gift: 'M4.5 9.5h15v3.5h-15z M5.5 13v6.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V13 M12 9.5v11 M12 9.5C11 8 9 6.5 8 7.6s.6 1.9 4 1.9 M12 9.5C13 8 15 6.5 16 7.6s-.6 1.9-4 1.9',
  store: 'M4 9.5 5.2 5A1 1 0 0 1 6.2 4.3h11.6a1 1 0 0 1 1 .7L20 9.5 M4 9.5a2.2 2.2 0 0 0 4 0 2.2 2.2 0 0 0 4 0 2.2 2.2 0 0 0 4 0 2.2 2.2 0 0 0 4 0 M5.5 11.5V20h13v-8.5',
  tag: 'M11 3.5H5.5A1.5 1.5 0 0 0 4 5v5.5l9.5 9.5a1.5 1.5 0 0 0 2.1 0l5-5a1.5 1.5 0 0 0 0-2.1L11 3.5z M8.6 7.6a1.3 1.3 0 1 1-2.6 0 1.3 1.3 0 0 1 2.6 0',
  euro: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M15.5 9A4 4 0 1 0 15.5 15 M7.5 11h6 M7.5 13h5',
  table: 'M4 5.5h16v13H4z M4 10h16 M4 14.5h16 M9.5 5.5v13 M15 5.5v13',
};

export default function Icon({ name, size = 24 }: { name: string; size?: number }) {
  const d = PATHS[name];
  if (!d) return <>{name}</>;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}
