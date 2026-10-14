// Indice anti-doppioni e letture paginate del modulo lead_* (Regola Ferrea 20 b). Funzioni PURE, nessun I/O proprio:
// seed.mjs e stato100.mjs passano le query, tests/lead_seed_indice.mjs le verifica offline.
//
// Perche' esiste (14-10): l'indice di seed.mjs era una select di lead_accounts senza range, e PostgREST ne restituiva
// 1.000 su 6.957 senza errore (cap max-rows): un negozio gia' presente oltre la riga 1.000 rientrava come nuovo.
// Ora l'indice si costruisce solo sulle righe CANDIDATE per i valori del file (place_id, handle, dominio, citta'),
// e ogni lettura e' paginata fino al conteggio esatto.

export const normName = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
export const domainOf = (u) => { if (!u) return null; try { return new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; } };
export const handleOf = (h) => (h ? String(h).replace(/^@/, '').replace(/\/$/, '').toLowerCase().trim() : null);
export const nameKey = (r) => `${normName(r.nome)}|${normName(r.citta)}`;

export const PAGINA = 1000;

// Tutte le righe di una query, a pagine di `range`, fino al conteggio esatto. `q` ricostruisce la query a ogni pagina
// e deve avere select(..., { count: 'exact' }) e un order stabile (senza order due pagine possono sovrapporsi).
// Non si ferma sulla "pagina corta": se il max-rows del server scende sotto PAGINA, corta non vuol dire finita.
export async function tutte(q, cosa = 'lettura') {
  const out = [];
  for (;;) {
    const { data, error, count } = await q().range(out.length, out.length + PAGINA - 1);
    if (error) throw new Error(`STOP: ${cosa} fallita (${error.message}): nessuna scrittura`);
    if (typeof count !== 'number') throw new Error(`STOP: ${cosa} senza conteggio: serve select(..., { count: 'exact' })`);
    out.push(...data);
    if (out.length >= count) return out;
    if (!data.length) throw new Error(`STOP: ${cosa} incompleta (${out.length} righe su ${count})`);
  }
}

export const aBlocchi = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

// Valore di un ilike dentro .or(): i metacaratteri di LIKE (% _ \) e le virgolette diventano `_` (un carattere
// qualunque), cosi' il filtro puo' prendere qualche riga in piu' ma mai una in meno; la conferma esatta e' in creaIndice.
const lit = (s) => String(s).replace(/[\\%_"]/g, '_');
const ilike = (col, patt) => `${col}.ilike."${patt}"`;
// citta': le lettere di normName con le vocali come `_` ("Forli" trova "Forlì") e ogni separatore come `%`
// ("Massa Carrara" trova "Massa-Carrara").
export const pattCitta = (c) => `%${normName(c).split(' ').map((t) => t.replace(/[aeiou]/g, '_')).join('%')}%`;

// Filtri che portano dal DB ogni account che creaIndice().match potrebbe agganciare a una riga del file:
// place_id esatto con .in(), handle e dominio contenuti (ilike), citta' per la chiave nome+citta'.
export function filtriCandidati(rows, blocco = 40) {
  const place = new Set(), or = new Set();
  for (const r of rows) {
    if (r.google_place_id) place.add(r.google_place_id);
    const h = handleOf(r.ig_handle); if (h) or.add(ilike('ig_handle', `%${lit(h)}%`));
    const d = domainOf(r.website); if (d) or.add(ilike('website', `%${lit(d)}%`));
    if (normName(r.citta)) or.add(ilike('citta', pattCitta(r.citta)));
    else { or.add('citta.is.null'); or.add('citta.eq.""'); }
  }
  return { place: aBlocchi([...place], blocco), or: aBlocchi([...or], blocco) };
}

// Dedup multi-chiave (piano 3.2), nell'ordine: google_place_id | dominio del sito | ig_handle | nome normalizzato + citta.
// `stessoGiro`: l'account e' nato in questo stesso giro di seed (seed.mjs lo passa per le righe appena inserite).
export function creaIndice() {
  const byPlace = new Map(), byDomain = new Map(), byHandle = new Map(), byName = new Map(), info = new Map();
  const add = (a, stessoGiro = false) => {
    info.set(a.id, { fonte_seed: a.fonte_seed ?? null, google_place_id: a.google_place_id ?? null, owner_note: a.owner_note ?? null, stesso_giro: stessoGiro });
    if (a.google_place_id) byPlace.set(a.google_place_id, a.id);
    const d = domainOf(a.website); if (d) byDomain.set(d, a.id);
    const h = handleOf(a.ig_handle); if (h) byHandle.set(h, a.id);
    byName.set(nameKey(a), a.id);
  };
  const trovato = (id, chiave) => ({ id, chiave, ...info.get(id) });
  const match = (r) => {
    if (r.google_place_id && byPlace.has(r.google_place_id)) return trovato(byPlace.get(r.google_place_id), 'place_id');
    const d = domainOf(r.website); if (d && byDomain.has(d)) return trovato(byDomain.get(d), 'dominio');
    const h = handleOf(r.ig_handle); if (h && byHandle.has(h)) return trovato(byHandle.get(h), 'ig_handle');
    const nk = nameKey(r); if (byName.has(nk)) return trovato(byName.get(nk), 'nome+citta');
    return null;
  };
  return { add, match };
}

// Evidenza `fonte` "in piu'" su un doppione: solo se la fonte della riga e' DIVERSA da quella con cui l'account e' nato
// (gate 14-10, B2). Prima si guardavano solo le evidenze `fonte` gia' scritte, mai `lead_accounts.fonte_seed`: un
// rilancio dello stesso file, due sweep con la stessa query o un doppione nel file davano all'account un'evidenza uguale
// alla sua fonte, e il negozio sembrava trovato da piu' fonti (al 14-10 in prod 179 evidenze `fonte` dello script su 337).
export const serveFonte = (hit, r) => !!r.fonte_seed && r.fonte_seed !== hit.fonte_seed;

// Voto e recensioni in coda alla nota di seed_maps.mjs: `Maps "concept store" Napoli · 4,8 (1.049)` -> '4.8|1049';
// una nota Maps senza voto -> '-'; una nota che non e' di seed_maps (scritta a mano, altra fonte) -> null.
export function votoMaps(nota) {
  if (!/^Maps "/.test(nota ?? '')) return null;
  const m = String(nota).match(/·\s*(\d[,.]\d)(?:\s*\(([\d.]+)\))?\s*$/);
  return m ? `${m[1].replace(',', '.')}|${(m[2] ?? '').replace(/\./g, '')}` : '-';
}

// Omonimo Maps: una riga agganciata SOLO per nome+citta che e' un'altra scheda Maps (seconda sede, catena o negozio
// omonimo), non lo stesso negozio ritrovato. Prima di serveFonte la sua traccia era un'evidenza `fonte`, che lo faceva
// sembrare trovato da piu' fonti; con serveFonte non restava niente (14-10: 50 delle 231 evidenze `fonte` in prod,
// place_id ritrovato nei file di seed). Torna 'place_id' o 'voto' (altra scheda), 'incerto' o null (stessa scheda,
// o niente da confrontare).
// - place_id della riga e dell'account entrambi presenti: diversi = altra scheda.
// - senza uno dei due place_id, fra due note Maps decidono voto e recensioni, ma solo con l'account nato nello stesso
//   giro: due schede dello stesso giro con la nota diversa sono due schede (48 su 48 al 14-10), mentre fra un giro e
//   l'altro la stessa scheda cambia numeri (85 schede ritrovate su 87 con la nota diversa): li' e' 'incerto'.
export function omonimoMaps(hit, r) {
  if (hit?.chiave !== 'nome+citta') return null;
  if (r.google_place_id && hit.google_place_id) return r.google_place_id !== hit.google_place_id ? 'place_id' : null;
  const a = votoMaps(hit.owner_note), b = votoMaps(r.owner_note);
  if (!a || !b || a === b) return null;
  return hit.stesso_giro ? 'voto' : 'incerto';
}

// L'evidenza che seed.mjs scrive su un doppione, o null: `omonimo_maps` per un'altra scheda (mai `fonte`: non e' lo
// stesso negozio), `fonte` per lo stesso negozio da una fonte diversa, niente se non si sa quale dei due e'.
// `cerca` e' il filtro contains() che dice se c'e' gia' (rilancio dello stesso file, sweep che ritrova la scheda).
export function evidenzaDoppione(hit, r) {
  const motivo = omonimoMaps(hit, r);
  if (motivo === 'incerto') return null;
  if (motivo) {
    const payload = { google_place_id: r.google_place_id ?? null, nome_visto: r.nome, nota: r.owner_note ?? null, fonte_seed: r.fonte_seed ?? null, google_maps_url: r.google_maps_url ?? null, motivo };
    return { tipo: 'omonimo_maps', payload, cerca: r.google_place_id ? { google_place_id: r.google_place_id } : { nota: payload.nota } };
  }
  if (serveFonte(hit, r)) return { tipo: 'fonte', payload: { fonte_seed: r.fonte_seed, nome_visto: r.nome, nota: r.owner_note ?? null }, cerca: { fonte_seed: r.fonte_seed } };
  return null;
}

// Carica l'indice di un file di seed: legge solo i candidati (filtriCandidati), a blocchi, ognuno paginato fino al
// conteggio esatto. Una lettura fallita lancia STOP prima di qualunque scrittura.
// owner_note serve a omonimoMaps (voto e recensioni Maps).
export const COLS_INDICE = 'id,nome,citta,website,ig_handle,google_place_id,fonte_seed,owner_note';
export async function caricaIndice(sb, rows) {
  const idx = creaIndice(), { place, or } = filtriCandidati(rows), visti = new Set();
  for (const blocco of place) {
    for (const a of await tutte(() => sb.from('lead_accounts').select(COLS_INDICE, { count: 'exact' }).in('google_place_id', blocco).order('id'), 'indice lead_accounts per place_id')) { idx.add(a); visti.add(a.id); }
  }
  for (const blocco of or) {
    for (const a of await tutte(() => sb.from('lead_accounts').select(COLS_INDICE, { count: 'exact' }).or(blocco.join(',')).order('id'), 'indice lead_accounts per handle, dominio e citta')) { idx.add(a); visti.add(a.id); }
  }
  return { idx, candidati: visti.size };
}
