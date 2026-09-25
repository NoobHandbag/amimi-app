// Priorita' dei seed del modulo lead_* per il loop "100 pronti" (LOOP_100.md). Funzioni PURE, nessun I/O:
// next_batch.mjs le usa sui dati letti dal DB, tests/lead_priority.mjs le verifica offline.
//
// Punteggio = resa della fonte x area x segnale Maps x penalita' nome. La resa della fonte NON e' fissa:
// si ricalcola a ogni lotto dai giudizi gia' dati (quanti A/B completi su quanti giudicati per fonte_seed),
// con un prior (ab+1)/(giudicati+3): una fonte mai provata parte da 0,33 e si corregge da sola dopo il primo lotto.

// cerchio 1 stretto: la Lombardia intorno a Milano si visita di persona, quindi a parita' viene prima
export const AREA_VICINA = new Set(['Milano', 'Monza', 'Como', 'Bergamo', 'Brescia', 'Pavia', 'Varese']);

// nomi che nella notte del 10-09 erano quasi sempre produttori a marchio proprio, abiti da cerimonia o perline:
// non rivenditori multimarca di borse
export const NOME_FUORI_TARGET = /factory shop|kids|bambin|sposa|cerimonia|perlin|bigiotteria fai|pelletteria|valigeria|cinturific|calzatur|intimo|lingerie|taglie forti|outlet|ingrosso/i;

// "Maps \"concept store\" Milano · 4,6 (123)" -> { rating: 4.6, rec: 123 }
export function parseMapsNote(note) {
  const s = String(note ?? '');
  const r = s.match(/·\s*(\d)[,.](\d)/);
  const n = s.match(/\((\d+)\)\s*$/) || s.match(/\((\d+)\)/);
  return { rating: r ? Number(`${r[1]}.${r[2]}`) : null, rec: n ? Number(n[1]) : null };
}

export function resaFonte(stats, fonte) {
  const s = stats?.[fonte] ?? { giudicati: 0, ab: 0 };
  return (s.ab + 1) / (s.giudicati + 3);
}

export function fattoreMaps({ rating, rec }) {
  if (rating == null) return 0.6;
  if (rating < 4.0) return 0.4;
  if (rec == null || rec < 10) return 0.6;
  if (rec < 20) return 0.85;
  return rating >= 4.5 ? 1 : 0.9;
}

export function prioritaSeed(acc, stats) {
  const maps = parseMapsNote(acc.owner_note);
  const resa = resaFonte(stats, acc.fonte_seed ?? '-');
  const area = AREA_VICINA.has(acc.citta) ? 1 : 0.85;
  const nome = NOME_FUORI_TARGET.test(acc.nome ?? '') ? 0.5 : 1;
  return Math.round(resa * area * fattoreMaps(maps) * nome * 1000) / 1000;
}

// ordina per priorita' e prende n, con un tetto per citta' (default 5) cosi' un lotto non finisce tutto in una citta';
// se il tetto lascia il lotto corto, lo riempie coi migliori rimasti
export function scegliLotto(seeds, stats, n = 20, tettoCitta = 5) {
  const ranked = seeds.map((a) => ({ ...a, priorita: prioritaSeed(a, stats) }))
    .sort((x, y) => y.priorita - x.priorita || String(x.created_at).localeCompare(String(y.created_at)));
  const out = [], perCitta = new Map(), resto = [];
  for (const a of ranked) {
    if (out.length >= n) break;
    const c = perCitta.get(a.citta) ?? 0;
    if (c < tettoCitta) { out.push(a); perCitta.set(a.citta, c + 1); } else resto.push(a);
  }
  for (const a of resto) { if (out.length >= n) break; out.push(a); }
  return out;
}
