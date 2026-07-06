// Emojis, on purpose: chosen for INSTANT recognizability (clarity over visual coherence).
// Each name maps to one full-color emoji; distinct concepts get distinct glyphs (box vs inbox,
// store vs globe vs handshake) so the icon is readable without leaning on the text label.
// Unknown names fall back to the raw text; `size` scales the glyph.
const EMOJI: Record<string, string> = {
  home: '🏠', plus: '➕', box: '📦', inbox: '📥', chart: '📊', bag: '🛍️', globe: '🌐',
  recycle: '🔁', sparkles: '🧹', rocket: '🚀', count: '🔢', return: '↩️', gift: '🎁',
  store: '🏬', handshake: '🤝', tag: '🏷️', euro: '💶', table: '📋', search: '🔍', pulse: '🩺',
};

export default function Icon({ name, size = 24 }: { name: string; size?: number }) {
  const e = EMOJI[name];
  if (!e) return <>{name}</>;
  return (
    <span aria-hidden="true" style={{ fontSize: Math.round(size * 0.92), lineHeight: 1, display: 'inline-block' }}>{e}</span>
  );
}
